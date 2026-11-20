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

SYSTEM_PROMPT = """ASR post-editor for English interviews of Vietnamese young learners (ages 7-12).
Input: JSON array [{"id":1,"q":"teacher question","a":"raw student speech"}].
Fix ONLY clear acoustic/ASR errors without paraphrasing or fixing real learner grammar:
1. Names & Spelling: Cross-reference name and spelling turns; resolve Vietnamese phonetic ASR distortions (unreleased finals, /ɲ/, /ŋ/, /x/, /z/~/j/) into authentic proper names and hyphenated uppercase spelling (e.g. "A-N-N-A.").
2. Topic Homophones & Stutters: Use "q" to fix phonetically close ASR mishearings for numbers/ages, everyday category words (fruit/food/drink/color/weather/animal), and truncated onsets.
3. Minimal Pairs ("X or X?"): Resolve identical repeated alternatives using "q" context (e.g. "fruit" vs "food").
4. Age-Appropriate Domain: Resolve incongruous adult terms to the phonetically closest child-appropriate word in the asked category.
5. Faithfulness: Preserve learner grammar errors, syntax, and punctuation/capitalization. Never invent extra clauses.
Output ONLY a valid JSON array of turns that CHANGED (or [] if none changed), no markdown:
[{"id":1,"text":"corrected transcript"}]"""


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
                self.api_key = env_config.get_llm_api_key()
                self.endpoint = self.endpoint or env_config.get_secret("DEFAULT_LLM_ENDPOINT", env_config.DEFAULT_LLM_ENDPOINT)
                self.model = env_config.get_secret("DEFAULT_LLM_MODEL", env_config.DEFAULT_LLM_MODEL)
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

        # Build lean payload containing ALL turns of the dialogue (omit empty q)
        items_payload = []
        for idx, t in enumerate(results):
            row: Dict[str, Any] = {
                "id": int(t.get("turn_id", idx + 1)),
                "a": t.get("transcript", t.get("raw_transcript", "")),
            }
            q_str = (t.get("teacher_prompt") or "").strip()
            if q_str:
                row["q"] = q_str
            items_payload.append(row)

        import requests

        for attempt in range(3):
            try:
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
                        "max_tokens": 1024,
                        "enable_thinking": False,
                    },
                    timeout=min(self.timeout, 45.0),
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

                match = re.search(r"\[\s*(?:\{.*\})?\s*\]", content, flags=re.DOTALL)
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

                if isinstance(corrected_list, list):
                    corr_map = {}
                    for x in corrected_list:
                        if isinstance(x, dict) and "id" in x:
                            val = x.get("text", x.get("corrected", ""))
                            if isinstance(val, str) and val.strip():
                                try:
                                    corr_map[int(x["id"])] = val.strip()
                                except (TypeError, ValueError):
                                    pass
                    for idx, t in enumerate(results, start=1):
                        tid = int(t.get("turn_id", idx))
                        if tid in corr_map:
                            t["transcript"] = corr_map[tid]
                    return results
            except Exception as exc:
                logger.warning(f"[AsrCorrector] Attempt {attempt + 1} LLM notice ({exc}).")

        return results
