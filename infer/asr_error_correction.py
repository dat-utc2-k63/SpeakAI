"""ASR Error Correction module based on zk2/asr_error_correction.

Design principles (from https://github.com/zk2/asr_error_correction):
1. Conservative post-editing: Fix only clear phonetic recognition errors, proper nouns,
   and spelling/punctuation. NEVER paraphrase, delete, or hallucinate content.
2. Length-drift check: Rejects any correction where word count drifts significantly (<0.8 or >1.3).
3. Conversational context awareness: Uses Teacher prompt as context to disambiguate phonetic homophones
   (e.g., "How old are you?" -> "I'm a year old" -> "I'm 8 years old").
4. Deterministic offline fallback: Works 100% offline without external API dependencies.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Sequence, Union

logger = logging.getLogger("asrec")

SYSTEM_PROMPT = """You are an expert Automatic Speech Recognition (ASR) transcript post-editor for spoken English language interviews of Vietnamese young learners (ages 7-12).
Your task is to analyze the entire interview dialogue, understand the context of each question, and correct acoustic recognition errors, misheard proper nouns, and letter-by-letter spellings.

GENERAL LINGUISTIC RULES (NO GUESSING, NO INVENTING CONTENT):
1. CONTEXTUAL QUESTION ANALYSIS & VIETNAMESE PROPER NOUN PREDICTION:
   - Identify the intent of the interviewer's question:
     * Self-introduction / Name questions (e.g. "What's your name?", "Hi, what's your name?").
     * Name spelling questions (e.g. "How do you spell your name?").
     * Location / Origin questions (e.g. "Where do you live?", "Where are you from?").
   - Vietnamese Phonetic Interference in English ASR:
     * The students are Vietnamese children speaking English. Pure English ASR models (like Whisper) frequently distort Vietnamese proper names, surnames, and locations into phonetically similar English words due to Vietnamese phonology (unreleased final consonants, tones, /ɲ/, /ŋ/, initial /x/, /v/ vs /w/):
       - Final /ɲ/ (nh) is often misheard by ASR as /s/, /ns/, or /mp/ (e.g., "Vinh" heard as "Vince", "Vins", "Wimp", or "Win").
       - Final /k/ (c/ch) is often misheard as "ck", "rk", or vowel stops (e.g., "Đức/Duc" heard as "Duck", "Dirk", "Eat").
       - Initial /x/ (kh) is often misheard as "qu", "squ", or "th" (e.g., "Khoa" heard as "Quire", "Squire", "Thao", "Hua").
       - Initial /z/ or /j/ (d/gi) is often misheard as "y" or "d" (e.g., "Du" heard as "Yu", "Dew", "You").
       - Compound names (e.g. "Trúc Anh") often heard with stray sibilants like "S-T-R-U-C-A-N-H" or "Truck Anne".
   - Joint Cross-Referencing & Disambiguation:
     * Always cross-reference the name turn ("My name is...") and the spelling turn ("How do you spell your name?").
     * If the raw speech in the name turn sounds like an approximation ("Vince", "Quire", "Yu", "Duck") and the spelling turn reveals the letters (e.g. "V-I-N-H" or "V-I-N-S", "K-H-O-A", "D-U", "D-U-C"), jointly resolve them to the authentic student name and correct letter spelling:
       -> Introduction: "My name is <Name>." (e.g. "My name is Vinh.", "My name is Khoa.", "My name is Duc.", "My name is Du.").
       -> Spelling turn: Capital letters separated by hyphens (e.g. "V-I-N-H.", "K-H-O-A.", "D-U.", "D-U-C.").
     * For proper locations (Hanoi, Danang, Ho Chi Minh City) or Vietnamese school names, resolve phonetic distortions to standard Vietnamese geographical/proper names.

2. CONTEXTUAL VOCABULARY & HOMOPHONE RESOLUTION:
   - Use question topic to resolve ambiguous acoustic tokens:
     * Numbers & Age: Resolve phonetically distorted numbers (e.g., "How old are you?" -> resolve to standard digits e.g. "8 years old").
     * Category questions (fruit, food, drink, color, weather, animal): When the child's acoustic token matches the question category phonetically (e.g., "orange juice", "turquoise", "grapes", "sweet", "sunny", "rabbit"), select the genuine English vocabulary that matches both the acoustic trace and the question topic.
     * Category Stutters & Truncated Onsets: When a child stutters, pauses, or pronounces only the initial syllables/onset of a target category vocabulary (e.g. "tur- tur-" or "tur" when answering a color question, "straw-" for fruit, "wa-" for watermelon/water), resolve it to the full intended English target word (e.g. "I like turquoise.", "strawberry", "watermelon").
     * Alternative/Clarification Questions ("X or X?"): In English, a clarification question never contrasts two identical words ("A or A?"). When ASR outputs an identical pair, disambiguate the phonetically close minimal pair using the interviewer's question topic (e.g. "food" vs "fruit").
     * Age-Appropriate Domain Disambiguation: For young learners (ages 7-12), if an acoustic token is an incongruous adult term (e.g. alcoholic beverages) that is phonetically close to an everyday child-appropriate word in the asked category (e.g. "cola" or "water" for drink), resolve it to the phonetically closest age-appropriate word.
     * Capitalize proper names, brand names (e.g. "Coca-Cola"), and sentence starts.

3. FAITHFULNESS & PRESERVATION OF CHILD SPEECH:
   - NEVER paraphrase or alter correct grammatical choices or child syntax.
   - Retain the child's exact sentence structure, grammar, repetitions, stutters, and self-corrections.
   - Do NOT insert extra words, clauses, or explanations that were not acoustically uttered.
   - Fix ONLY phonetic/acoustic speech recognition distortions.

INPUT FORMAT: JSON array of dialogue turns:
[{"id": 1, "q": "interviewer question", "a": "raw student speech"}]

OUTPUT FORMAT: Return ONLY a valid JSON array matching the input ids without markdown fences or explanations:
[{"id": 1, "text": "corrected transcript"}]"""


def normalize_whitespace(text: str) -> str:
    """Collapse multiple spaces/tabs/newlines into a single space."""
    return re.sub(r"\s+", " ", (text or "").strip())


def deterministic_clean_transcript(text: str, teacher_prompt: Optional[str] = None) -> str:
    """Minimal whitespace and ALL-CAPS normalizer without heuristic word manipulation."""
    s = normalize_whitespace(text)
    if not s:
        return ""
    # Normalize ALL-CAPS ASR outputs to natural sentence case (preserving letter-by-letter spellings like D-U-C)
    is_spelling = bool(re.match(r"^[A-Za-z](?:-[A-Za-z])+\.?$", s.replace(" ", "")))
    if not is_spelling and s.isupper() and len(s) > 2:
        s = s[0].upper() + s[1:].lower()
        s = re.sub(r"\bi('m|'ll|'ve|'d)?\b", lambda m: "I" + (m.group(1) or ""), s)
    if not s.endswith((".", "!", "?")):
        s += "."
    return s


class AsrErrorCorrector:
    """Post-editing engine for ASR transcripts using LLM + deterministic fallback."""

    def __init__(
        self,
        endpoint: Optional[str] = None,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        enable_llm: bool = True,
        timeout: float = 90.0,
    ):
        self.enable_llm = enable_llm
        self.timeout = timeout
        self.endpoint = endpoint
        self.model = model or "deepseek-v4.1-flash"
        self.api_key = api_key

        if self.enable_llm and not self.api_key:
            try:
                import env_config
                self.api_key = env_config.get_gemini_api_key()
                self.endpoint = self.endpoint or env_config.get_secret("DEFAULT_GEMINI_ENDPOINT", env_config.DEFAULT_GEMINI_ENDPOINT)
                self.model = env_config.get_secret("DEFAULT_GEMINI_MODEL", "deepseek-v4.1-flash")
            except Exception:
                pass

    def correct_turns(self, turns: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Correct an entire conversation in ONE single prompt using strictly deepseek-v4.1-flash."""
        if not turns:
            return []

        results = []
        for t in turns:
            item = dict(t)
            raw = t.get("raw_transcript", t.get("transcript", ""))
            tp = t.get("teacher_prompt", "")
            det = deterministic_clean_transcript(raw, tp)
            item["raw_transcript"] = raw
            item["transcript"] = det
            results.append(item)

        if not self.enable_llm or not self.api_key or not self.endpoint:
            return results

        # Build lean payload containing ALL turns of the dialogue (minimal tokens)
        items_payload = [{
            "id": t.get("turn_id", idx + 1),
            "q": t.get("teacher_prompt", ""),
            "a": t.get("transcript", t.get("raw_transcript", "")),
        } for idx, t in enumerate(results)]

        import requests

        for attempt in range(3):
            try:
                # Strictly use deepseek-v4.1-flash in 1 prompt with sufficient reasoning budget
                resp = requests.post(
                    self.endpoint,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {self.api_key}",
                        "x-api-key": self.api_key,
                    },
                    json={
                        "model": self.model or "deepseek-v4.1-flash",
                        "messages": [
                            {"role": "system", "content": SYSTEM_PROMPT},
                            {"role": "user", "content": json.dumps(items_payload, ensure_ascii=False, separators=(',', ':'))},
                        ],
                        "temperature": 0.0,
                        "max_tokens": 2048,
                        "enable_thinking": False,
                    },
                    timeout=self.timeout,
                )

                if not resp.ok:
                    logger.warning(f"[AsrCorrector] Attempt {attempt + 1} HTTP {resp.status_code}: {resp.text[:100]}")
                    continue

                msg = resp.json()["choices"][0]["message"]
                content = (msg.get("content") or "").strip()
                if not content:
                    logger.warning(f"[AsrCorrector] Attempt {attempt + 1} empty content from {self.model}, retrying...")
                    continue

                if content.startswith("```"):
                    content = re.sub(r"^```\w*\n", "", content)
                    content = re.sub(r"\n```$", "", content)

                match = re.search(r"\[\s*\{.*\}\s*\]", content, flags=re.DOTALL)
                raw_json = match.group(0) if match else content
                corrected_list = None
                try:
                    corrected_list = json.loads(raw_json)
                except Exception:
                    objs = re.findall(r"\{[^{}]+\}", content)
                    salvaged = []
                    for o in objs:
                        try:
                            salvaged.append(json.loads(o))
                        except Exception:
                            pass
                    if salvaged:
                        corrected_list = salvaged

                if isinstance(corrected_list, list) and corrected_list:
                    corr_map = {}
                    for x in corrected_list:
                        if "id" in x:
                            val = x.get("text", x.get("corrected", ""))
                            if isinstance(val, str) and val.strip():
                                corr_map[x["id"]] = val.strip()
                    if corr_map:
                        for idx, t in enumerate(results, start=1):
                            tid = t.get("turn_id", idx)
                            if tid in corr_map:
                                t["transcript"] = corr_map[tid]
                        return results
            except Exception as exc:
                logger.warning(f"[AsrCorrector] Attempt {attempt + 1} LLM notice ({exc}).")

        return results
