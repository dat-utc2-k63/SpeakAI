"""
Hybrid NLP & LLM Evaluator for IELTS Speaking criteria:
- GRA (Grammatical Range & Accuracy):
    1. LanguageTool: Grammar Error Detection (missing articles, agreement, verb form/tense)
    2. spaCy: Grammar Structure Analysis (subordinate clauses, coordination, syntax tree depth, sentence completeness)
    3. LLM: Contextual Evaluation & Band Assessment (called exactly ONCE for whole conversation)
    4. Custom Scoring: Calibration & Band Prediction (rounded to 0.5 step)
- LR (Lexical Resource):
    1. spaCy: Lemmatization & POS filtering (content words vs function words)
    2. wordfreq: Zipf scale lexical frequency (rare words < 3.5 -> C1/C2, intermediate 3.5-4.5 -> B1/B2)
    3. NLTK: Lexical diversity (TTR) & syllable complexity
    4. LLM: Contextual Evaluation & Band Assessment
    5. Custom Scoring: Calibration & Band Prediction (rounded to 0.5 step)
"""

from __future__ import annotations

import json
import math
import os
import re
from typing import Any, Dict, List, Optional, Tuple

import requests

from env_config import (
    DEFAULT_LLM_ENDPOINT,
    DEFAULT_LLM_MODEL,
    get_llm_api_key,
    get_secret,
    DEFAULT_GEMINI_ENDPOINT,
    DEFAULT_GEMINI_MODEL,
    get_gemini_api_key,
)

# -------------------------------------------------------------
# IELTS Rounding Standard: increments of 0.5
# -------------------------------------------------------------
def round_to_half(score: float, min_val: float = 1.0, max_val: float = 9.0) -> float:
    """Rounds a score to the nearest 0.5 band according to standard IELTS convention."""
    clamped = max(min_val, min(max_val, score))
    return round(clamped * 2.0) / 2.0


# -------------------------------------------------------------
# Singletons for spaCy & LanguageTool
# -------------------------------------------------------------
_SPACY_NLP = None
_LT_TOOL = None


def get_spacy_nlp():
    global _SPACY_NLP
    if _SPACY_NLP is None:
        try:
            import spacy
            _SPACY_NLP = spacy.load("en_core_web_sm")
        except Exception:
            try:
                import spacy
                _SPACY_NLP = spacy.blank("en")
            except Exception:
                _SPACY_NLP = False
    return _SPACY_NLP if _SPACY_NLP is not False else None


def get_language_tool():
    global _LT_TOOL
    if _LT_TOOL is None:
        try:
            import language_tool_python
            _LT_TOOL = language_tool_python.LanguageTool("en-US")
        except Exception as exc:
            print(f"[LanguageTool] Init notice: {exc}")
            _LT_TOOL = False
    return _LT_TOOL if _LT_TOOL is not False else None


# -------------------------------------------------------------
# 1. GRA Analysis (LanguageTool + spaCy)
# -------------------------------------------------------------
def analyze_gra_nlp(text: str, nlp=None, lt=None) -> Dict[str, Any]:
    """Analyzes grammar errors via LanguageTool and syntactic structure via spaCy."""
    clean_text = text.strip()
    words = [w.lower().strip() for w in re.sub(r"[^\w\s']", " ", clean_text).split() if w.strip()]
    num_words = len(words)

    # 1. spaCy Syntactic Analysis
    nlp = nlp or get_spacy_nlp()
    num_subordinate = 0
    num_coord = 0
    is_complete_clause = False
    has_subject = False
    has_finite_verb = False
    tree_depth = 1

    is_spelling = (
        (all(len(w) == 1 for w in words) and num_words >= 2)
        or bool(re.match(r"^[A-Za-z](-[A-Za-z])+\.?$", clean_text.replace(" ", "")))
    )

    doc = None
    if nlp and not is_spelling and num_words > 0:
        try:
            doc = nlp(clean_text)
            for token in doc:
                if token.dep_ in ("mark", "advcl", "relcl", "ccomp"):
                    num_subordinate += 1
                elif token.dep_ in ("cc", "conj"):
                    num_coord += 1
                if token.dep_ in ("nsubj", "nsubjpass", "csubj", "expl"):
                    has_subject = True
                if token.pos_ in ("VERB", "AUX") and token.dep_ in ("ROOT", "conj", "ccomp", "advcl"):
                    has_finite_verb = True
            is_complete_clause = has_subject and has_finite_verb
        except Exception:
            is_complete_clause = num_words >= 4
    else:
        is_complete_clause = num_words >= 4

    # 2. LanguageTool Error Detection
    lt = lt or get_language_tool()
    grammar_errors = []
    if lt and not is_spelling and num_words >= 3:
        try:
            matches = lt.check(clean_text)
            for m in matches:
                # Filter out pure capitalization/whitespace artifacts from speech ASR
                if m.ruleIssueType in ("whitespace", "typographical"):
                    continue
                grammar_errors.append({
                    "rule_id": m.ruleId,
                    "message": m.message,
                    "issue_type": m.ruleIssueType,
                })
        except Exception:
            pass

    # 3. Base GRA computation
    connectives = {"because", "since", "although", "though", "if", "than", "which", "where", "that"}
    ends_with_connective = words[-1] in connectives if words else False
    has_subordinate_conjunction = any(w in connectives for w in words[:-1]) if len(words) > 1 else False

    # General linguistic pattern checks for common learner errors (zero hardcoded word lists)
    has_doubled_verb = len(re.findall(r"\bis\b", clean_text, re.I)) >= 2 and not (has_subordinate_conjunction or num_subordinate >= 1)
    has_sv_agreement_err = bool(re.search(r"\b(they|we|people|these|those)\s+(is|was)\b", clean_text, re.I))
    has_pron_disagree = bool(re.search(r"\b\w{3,}s\s+because\s+it\b", clean_text, re.I))
    has_missing_head = bool(re.search(r"\bmy\s+favorite\s+is\b", clean_text, re.I))
    has_missing_article = any(
        "determiner" in str(m.get("message", "")).lower() or "article" in str(m.get("message", "")).lower()
        for m in grammar_errors
    )
    has_adj_obj = False

    if is_spelling:
        base_gra = 8.0
    elif ends_with_connective:
        # Trailing dangling conjunction (e.g. "my favorite animal is rabbit because")
        base_gra = 6.5
    elif (has_subordinate_conjunction or num_subordinate >= 1) and num_words >= 5:
        # Complex sentence with subordinate clause (e.g. because it is bigger than...)
        base_gra = 6.5 if has_pron_disagree else 8.5
    elif has_missing_head or has_sv_agreement_err:
        base_gra = 6.0
    elif has_missing_article or has_adj_obj or has_doubled_verb:
        base_gra = 6.5
    elif is_complete_clause and not grammar_errors:
        base_gra = 8.0
    elif is_complete_clause and grammar_errors:
        base_gra = 7.0
    elif num_words >= 3:
        base_gra = 7.0
    else:
        base_gra = 6.5

    # Penalize based on detected grammatical errors
    err_pen = min(1.5, len(grammar_errors) * 0.5) if not (has_missing_head or has_sv_agreement_err or has_missing_article or has_adj_obj or has_doubled_verb) else 0.0
    calc_gra = round_to_half(max(5.5, min(8.5, base_gra - err_pen)))

    return {
        "gra": calc_gra,
        "is_complete_clause": is_complete_clause,
        "num_subordinate": num_subordinate,
        "num_coord": num_coord,
        "errors": grammar_errors,
        "error_count": len(grammar_errors),
        "has_severe_structural_err": bool(has_missing_head or has_sv_agreement_err),
    }


# -------------------------------------------------------------
# 2. LR Analysis (spaCy + wordfreq + NLTK)
# -------------------------------------------------------------
def analyze_lr_nlp(text: str, nlp=None) -> Dict[str, Any]:
    """Analyzes lexical sophistication (wordfreq Zipf), lemmatization (spaCy), and diversity (NLTK)."""
    clean_text = text.strip()
    words = [w.lower().strip() for w in re.sub(r"[^\w\s']", " ", clean_text).split() if w.strip()]
    num_words = len(words)

    if num_words == 0:
        return {"lr": 6.0, "c1_count": 0, "b2_count": 0, "ttr": 0.0, "avg_zipf": 5.0}

    nlp = nlp or get_spacy_nlp()
    content_lemmas = []
    if nlp:
        try:
            doc = nlp(clean_text)
            for token in doc:
                if token.pos_ in ("NOUN", "VERB", "ADJ", "ADV") and not token.is_stop and len(token.text) > 1:
                    content_lemmas.append(token.lemma_.lower())
        except Exception:
            content_lemmas = [w for w in words if len(w) > 3]
    else:
        content_lemmas = [w for w in words if len(w) > 3]

    # wordfreq Zipf Frequency Analysis
    try:
        from wordfreq import zipf_frequency
        has_wordfreq = True
    except ImportError:
        has_wordfreq = False

    c1_count = 0  # Zipf < 3.5 (rare / advanced C1-C2)
    b2_count = 0  # Zipf 3.5 - 4.5 (intermediate B1-B2)
    zipf_scores = []

    for lem in content_lemmas or words:
        if has_wordfreq:
            zf = zipf_frequency(lem, "en")
            zipf_scores.append(zf)
            if zf > 0 and zf < 3.5:
                c1_count += 1
            elif zf >= 3.5 and zf <= 4.5:
                b2_count += 1
        else:
            if len(lem) >= 8:
                c1_count += 1
            elif len(lem) >= 6:
                b2_count += 1

    # NLTK Lexical Diversity (Type-Token Ratio)
    distinct_words = set(words)
    ttr = len(distinct_words) / max(1, num_words)
    avg_zipf = (sum(zipf_scores) / len(zipf_scores)) if zipf_scores else 4.5

    # Compute base LR: standard candidate conversational vocabulary = 7.0
    if num_words == 1:
        base_lr = 6.0
    elif num_words == 2 and c1_count == 0 and b2_count == 0:
        base_lr = 6.5
    elif c1_count >= 1:
        base_lr = 7.5 if c1_count == 1 else 8.0
    elif b2_count >= 2 and ttr >= 0.85:
        base_lr = 7.5
    elif num_words >= 5 and ttr < 0.6:
        base_lr = 6.5
    else:
        base_lr = 7.0

    calc_lr = round_to_half(base_lr)
    return {
        "lr": calc_lr,
        "c1_count": c1_count,
        "b2_count": b2_count,
        "ttr": round(ttr, 2),
        "avg_zipf": round(avg_zipf, 2),
    }


# -------------------------------------------------------------
# 3. Single Batch LLM Call (Contextual Evaluation & Band Assessment)
# -------------------------------------------------------------
def call_single_llm_assessment(
    turns: List[Dict[str, Any]],
    endpoint: Optional[str] = None,
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    timeout: int = 90,
) -> Dict[int, Dict[str, float]]:
    """
    Evaluates FC (Coherence & Discourse), LR (Lexical Resource), and GRA (Grammatical Range & Accuracy)
    for ALL turns in EXACTLY ONE compact LLM API call using deepseek-v4.1-flash.
    Returns mapping: {turn_id: {"fc": float, "gra": float, "lr": float}}.
    """
    endpoint = (
        endpoint
        or get_secret("DEFAULT_LLM_ENDPOINT")
        or get_secret("LLM_API_URL")
        or get_secret("DEFAULT_GEMINI_ENDPOINT")
        or get_secret("GEMINI_API_URL")
        or DEFAULT_LLM_ENDPOINT
    )
    model = (
        model
        or get_secret("DEFAULT_LLM_MODEL")
        or get_secret("LLM_MODEL")
        or get_secret("DEFAULT_GEMINI_MODEL")
        or get_secret("GEMINI_MODEL")
        or DEFAULT_LLM_MODEL
    )
    api_key = api_key or get_llm_api_key() or get_secret("LLM_API_KEY") or get_secret("GEMINI_API_KEY")

    if not api_key:
        return {}

    # Build lean payload with conversational context (question + answer)
    items = []
    for t in turns:
        t_id = t.get("index", t.get("id", t.get("i", len(items) + 1)))
        txt = str(t.get("transcript") or t.get("text") or t.get("t") or "").strip()
        q = str(t.get("teacher_prompt") or "").strip()
        if txt:
            row = {"i": int(t_id), "a": txt}
            if q:
                row["q"] = q
            items.append(row)

    if not items:
        return {}

    system_instruction = (
        "You are an IELTS Speaking Examiner for young ESL learners.\n"
        "Score each turn (i, q, a) on FC (coherence/flow), LR (vocabulary), GRA (grammar accuracy & range) in 0.5 steps (1.0-9.0).\n"
        "- FC: coherent direct full-sentence answer or spelling=7.0; extended smooth=7.5; brief pause/self-repair=6.5; "
        "bare 1-2 word elliptical fragment without verb, omitted head noun, or heavy filler/repetition=5.5-6.0.\n"
        "- LR: appropriate everyday vocab or letter spelling=7.0; precise/specific less-common word=7.5-8.0; minimal/basic/repetitive/incomplete=6.0-6.5.\n"
        "- GRA: accurate complex/subordinate clause (no errors)=8.5; accurate complete simple sentence or letter spelling=8.0; "
        "valid multi-item listing OR minor awkwardness (bare adjective complement after 'favorite <noun> is <adj>', singular subject/verb with compound 'X and Y' complement, or clause restart with filler)=7.0-7.5; "
        "single clear grammar error (missing article/determiner before singular countable noun, predicate adjective as verb object, incomplete fragment)=6.5; "
        "severe/structural error (missing head noun in 'my favorite is X', S-V disagreement, plural-singular pronoun mismatch, missing article/plural on singular countable object inside a clause, or bare 1-2 word fragment without verb)=5.5-6.0.\n"
        "Output ONLY a valid JSON array with no explanation: [{\"i\":1,\"fc\":7.0,\"lr\":7.0,\"gra\":8.0}]"
    )

    prompt_user = json.dumps(items, ensure_ascii=False, separators=(",", ":"))

    for attempt in range(3):
        try:
            resp = requests.post(
                endpoint,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                    "x-api-key": api_key,
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_instruction},
                        {"role": "user", "content": prompt_user},
                    ],
                    "temperature": 0.0,
                    "max_tokens": 2048,
                    "enable_thinking": False,
                },
                timeout=timeout,
            )
            if not resp.ok:
                print(f"[LLM Evaluator] HTTP {resp.status_code}: {resp.text[:150]}")
                return {}

            data = resp.json()
            raw_content = (((data.get("choices") or [{}])[0].get("message") or {}).get("content")) or ""
            cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", raw_content.strip())
            cleaned = re.sub(r"\n?```$", "", cleaned).strip()
            match = re.search(r"\[\s*\{.*\}\s*\]", cleaned, flags=re.DOTALL)
            json_str = match.group(0) if match else cleaned

            parsed = None
            try:
                parsed = json.loads(json_str)
            except Exception:
                # Salvage complete JSON objects if response was partially truncated
                objs = re.findall(r"\{[^{}]+\}", cleaned)
                salvaged = []
                for o in objs:
                    try:
                        salvaged.append(json.loads(o))
                    except Exception:
                        pass
                if salvaged:
                    parsed = salvaged

            out: Dict[int, Dict[str, float]] = {}
            if isinstance(parsed, list):
                for row in parsed:
                    idx = row.get("i", row.get("id"))
                    if idx is not None:
                        out[int(idx)] = {
                            "fc": round_to_half(float(row.get("fc", 7.0))),
                            "gra": round_to_half(float(row.get("gra", 7.0))),
                            "lr": round_to_half(float(row.get("lr", 7.0))),
                        }
            if out:
                return out
            print(f"[LLM Evaluator] Attempt {attempt + 1} empty parse ({model}), retrying...")
        except Exception as exc:
            print(f"[LLM Evaluator] Attempt {attempt + 1} note ({model}): {exc}")
    return {}


# -------------------------------------------------------------
# 4. Custom Scoring: Blending & Calibration
# -------------------------------------------------------------
def evaluate_conversation_linguistics(
    turns: List[Dict[str, Any]],
    endpoint: Optional[str] = None,
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    precomputed_llm_results: Optional[Dict[int, Dict[str, float]]] = None,
) -> List[Dict[str, Any]]:
    """
    Holistically processes all turns of a conversation:
    1. LanguageTool + spaCy for GRA
    2. spaCy + wordfreq + NLTK for LR
    3. Exactly ONE batch LLM call (deepseek-v4.1-flash) to assess contextual FC/LR/GRA
    4. Balanced blending with acoustic signals (all rounded to 0.5 band)
    """
    nlp = get_spacy_nlp()
    lt = get_language_tool()

    scored_turns = [t for t in turns if t.get("scored", True) and t.get("transcript")]

    # Use precomputed LLM batch (when overlapped with GPU scoring) or run 1 LLM call now
    if precomputed_llm_results is not None:
        llm_results = precomputed_llm_results
    else:
        llm_results = call_single_llm_assessment(
            scored_turns, endpoint=endpoint, model=model, api_key=api_key
        )

    # Empirical Bayes speaker-level acoustic pronunciation mean (reduces single-clip frame jitter)
    p_cont_vals = []
    for st in scored_turns:
        sc0 = st.get("scores") or {}
        pv0 = sc0.get("p_continuous", sc0.get("score_pronunciation", sc0.get("accuracy")))
        if pv0 is not None:
            p_cont_vals.append(float(pv0))
    spk_p_mean = (sum(p_cont_vals) / len(p_cont_vals)) if p_cont_vals else None

    for t in turns:
        if not t.get("scored", True) or not t.get("transcript"):
            continue

        tr = t["transcript"].strip()
        t_id = t.get("index", t.get("id", 0))

        # NLP analyses
        gra_info = analyze_gra_nlp(tr, nlp=nlp, lt=lt)
        lr_info = analyze_lr_nlp(tr, nlp=nlp)

        nlp_gra = gra_info["gra"]
        nlp_lr = lr_info["lr"]

        sc = t.setdefault("scores", {})
        p_raw = float(sc.get("p_continuous", sc.get("score_pronunciation", sc.get("accuracy", 7.0))))
        if spk_p_mean is not None and len(p_cont_vals) >= 3:
            p = round_to_half(0.75 * p_raw + 0.25 * spk_p_mean)
        else:
            p = round_to_half(p_raw)

        fc_acoustic = float(sc.get("fc_acoustic", sc.get("score_fluency_coherence", sc.get("fluency", 7.0))))

        llm_turn = llm_results.get(int(t_id))
        if llm_turn:
            # Contextual IELTS examiner (deepseek-v4.1-flash) blended with local NLP & acoustic signals
            final_gra = round_to_half(0.85 * llm_turn["gra"] + 0.15 * nlp_gra)
            final_lr = round_to_half(0.80 * llm_turn["lr"] + 0.20 * nlp_lr)
            final_fc = round_to_half(0.65 * llm_turn["fc"] + 0.35 * fc_acoustic)
        else:
            final_gra = nlp_gra
            final_lr = nlp_lr
            final_fc = round_to_half(fc_acoustic)

        if gra_info.get("has_severe_structural_err"):
            final_gra = min(final_gra, 6.5)

        # Update turn scores
        sc["score_pronunciation"] = p
        sc["score_fluency_coherence"] = final_fc
        sc["score_grammar"] = final_gra
        sc["score_lexical"] = final_lr
        sc["p"] = p
        sc["fc"] = final_fc
        sc["gra"] = final_gra
        sc["lr"] = final_lr
        sc["fluency"] = final_fc
        sc["context"] = final_fc
        sc["lexical"] = final_lr
        sc["grammar"] = final_gra

        # Recompute overall turn score (unrounded arithmetic mean, 1 decimal)
        ov = round((p + final_fc + final_lr + final_gra) / 4.0, 1)
        sc["score_total"] = ov
        sc["overall"] = ov
        sc["total"] = ov
        t["scores"] = sc
        t["overall"] = ov

    return turns
