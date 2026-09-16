"""
Pronunciation score aggregation (0-10 scale).

Step 6: combine multi-task head outputs into interpretable final scores.
SpeechOcean762 provides utterance-level scores (Total, Accuracy, Fluency, Prosodic).
L2-MDD provides full-phoneme error scanning with ASHA distinctive articulatory rules.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import torch


# ── Standard ARPAbet to IPA Mapping ─────────────────────────────────
ARPABET_TO_IPA: Dict[str, str] = {
    # Vowels & Diphthongs
    "AA": "ɑː",
    "AE": "æ",
    "AH0": "ə",
    "AH": "ʌ",
    "AH1": "ʌ",
    "AH2": "ʌ",
    "AO": "ɔː",
    "AW": "aʊ",
    "AY": "aɪ",
    "EH": "e",
    "ER": "ɜːr",
    "ER0": "ər",
    "ER1": "ɜːr",
    "ER2": "ɜːr",
    "EY": "eɪ",
    "IH": "ɪ",
    "IH0": "ɪ",
    "IH1": "ɪ",
    "IH2": "ɪ",
    "IY": "iː",
    "IY0": "i",
    "IY1": "iː",
    "IY2": "iː",
    "OW": "oʊ",
    "OY": "ɔɪ",
    "UH": "ʊ",
    "UW": "uː",
    # Consonants
    "B": "b",
    "CH": "tʃ",
    "D": "d",
    "DH": "ð",
    "F": "f",
    "G": "ɡ",
    "HH": "h",
    "JH": "dʒ",
    "K": "k",
    "L": "l",
    "M": "m",
    "N": "n",
    "NG": "ŋ",
    "P": "p",
    "R": "r",
    "S": "s",
    "SH": "ʃ",
    "T": "t",
    "TH": "θ",
    "V": "v",
    "W": "w",
    "Y": "j",
    "Z": "z",
    "ZH": "ʒ",
}

def phone_to_ipa(phoneme: str) -> str:
    """Convert ARPAbet phoneme (e.g. 'TH', 'AE1') to standard IPA symbol (e.g. 'θ', 'æ')."""
    if not phoneme:
        return ""
    if phoneme in ARPABET_TO_IPA:
        return ARPABET_TO_IPA[phoneme]
    base = phoneme.rstrip("012")
    return ARPABET_TO_IPA.get(base, base.lower())

def format_phone_ipa(phoneme: str) -> str:
    """Format single phoneme in standard IPA notation e.g. /θ/, /ð/."""
    ipa = phone_to_ipa(phoneme)
    return f"/{ipa}/" if ipa else f"/{phoneme}/"

def phones_to_word_ipa(phones: List[str]) -> str:
    """Convert sequence of ARPAbet phonemes to standard dictionary word IPA.
    
    e.g. ['TH', 'IH1', 'NG', 'K'] -> '/θɪŋk/'
         ['W', 'EH1', 'DH', 'ER0'] -> '/ˈweðər/'
    """
    if not phones:
        return ""
    vowels = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"}
    vowel_indices = [i for i, p in enumerate(phones) if p.rstrip("012") in vowels]
    primary_stress_idx = next((i for i, p in enumerate(phones) if len(p) > 1 and p[-1] == "1"), None)
    
    stress_mark_at = None
    if len(vowel_indices) > 1 and primary_stress_idx is not None:
        k = primary_stress_idx
        while k > 0 and (phones[k - 1].rstrip("012") not in vowels):
            k -= 1
        stress_mark_at = k
        
    parts = []
    for i, p in enumerate(phones):
        if stress_mark_at is not None and i == stress_mark_at:
            parts.append("ˈ")
        parts.append(phone_to_ipa(p))
        
    return f"/{''.join(parts)}/"


from .asha_phonology import (
    ASHAPhonologicalAnalyzer,
    ASHADiagnosis,
    get_features,
    ArticulatoryFeatures,
)


def _get_phoneme_tip(phoneme: str) -> str:
    """Return clinical-grade articulatory placement tip using ASHA distinctive features."""
    if not phoneme:
        return ""
    feat = get_features(phoneme)
    if not feat:
        return ""
    if feat.is_vowel:
        tense = "căng cơ má" if feat.vowel_tense else "thả lỏng cơ miệng"
        return f"{feat.name_vi}: chú ý độ mở vòm miệng và {tense}."
    return f"{feat.name_vi}: vị trí cấu âm tại {feat.place}, phương thức cấu âm {feat.manner} ({'rung thanh quản' if feat.voicing == 'voiced' else 'không rung thanh quản'})."


class PronunciationScorer:
    """
    Aggregate multi-granularity predictions into final 0-10 scores.

    Training targets are normalized to 0-2 (GOPT convention); this class
    denormalizes back to SpeechOcean762's 0-10 scale for reporting.
    Supports dynamic affine calibration, duration-aware bias correction,
    and phoneme-level re-scaling.
    """

    def __init__(
        self,
        score_scale: float = 5.0,
        weights: Optional[Dict[str, float]] = None,
        phoneme_low_threshold: float = 1.4,
        calibration: Optional[Dict[str, Any]] = None,
    ):
        self.score_scale = score_scale
        self.weights = weights or {
            "utterance_total": 0.5,
            "word_total": 0.25,
            "phoneme_accuracy": 0.25,
        }
        self.phoneme_low_threshold = phoneme_low_threshold
        self.calibration = calibration or {}

    def to_display_scale(
        self,
        score: float,
        *,
        is_utterance: bool = False,
        is_phone: bool = False,
        duration_sec: Optional[float] = None,
    ) -> float:
        """Map 0-2 normalized score -> 0-10 display scale.
        
        Applies affine calibration and duration-aware adjustment when enabled
        in config to stabilize predictions across varying clip lengths and quality levels.
        """
        raw = score * self.score_scale
        cal_cfg = self.calibration if self.calibration.get("enabled", False) else None

        if cal_cfg:
            if is_phone:
                phone_slope = float(cal_cfg.get("phone_slope", 7.0))
                phone_offset = float(cal_cfg.get("phone_offset", -4.0))
                raw = phone_slope * score + phone_offset
            elif is_utterance:
                slope = float(cal_cfg.get("slope", 1.39))
                offset = float(cal_cfg.get("offset", -3.20))
                cal = slope * raw + offset
                short_sec = float(cal_cfg.get("short_duration_sec", 3.5))
                factor = float(cal_cfg.get("short_duration_factor", 0.75))
                if duration_sec is not None and duration_sec < short_sec and raw < 8.2:
                    cal -= factor * (short_sec - duration_sec)

                # Long duration adjustment (compensates for embedding dispersion on long clips > 4.0s):
                long_sec = float(cal_cfg.get("long_duration_sec", 4.0))
                long_factor = float(cal_cfg.get("long_duration_factor", 0.28))
                max_boost = float(cal_cfg.get("long_duration_max_boost", 2.5))
                if duration_sec is not None and duration_sec > long_sec:
                    cal += min(max_boost, long_factor * (duration_sec - long_sec))
                raw = cal

        # Clamp to [0, 10] range
        clamped = min(10.0, max(0.0, raw))
        # Minimum floor to avoid misleading 0-scores for valid predictions
        if score > 0.01:
            clamped = max(0.5, clamped)
        return round(clamped, 2)

    def aggregate_utterance(
        self,
        predictions: Dict[str, torch.Tensor],
        duration_sec: Optional[float] = None,
    ) -> Dict[str, float]:
        """Build utterance-level score dict on 0-10 scale."""
        result = {}
        for key, val in predictions.items():
            if key.startswith("utterance_"):
                aspect = key.replace("utterance_", "")
                if isinstance(val, torch.Tensor):
                    val = float(val.detach().cpu().item())
                result[aspect] = self.to_display_scale(
                    val, is_utterance=True, duration_sec=duration_sec
                )

        # Multi-granularity anchor for Accuracy on longer utterances:
        # Prevents utterance pooling dispersion from degrading phoneme accuracy on long sentences.
        if "phoneme_accuracy" in predictions:
            pa = predictions["phoneme_accuracy"]
            if isinstance(pa, torch.Tensor) and pa.numel() > 0:
                pa_val = float(pa.mean().detach().cpu().item())
                pa_disp = self.to_display_scale(pa_val, is_phone=True)
                if "accuracy" in result:
                    if duration_sec is not None and duration_sec > 4.5:
                        w_pa = min(0.40, 0.15 + (duration_sec - 4.5) * 0.02)
                    else:
                        w_pa = 0.15
                    result["accuracy"] = round(min(10.0, max(0.5, (1.0 - w_pa) * result["accuracy"] + w_pa * pa_disp)), 2)

        # Multi-granularity anchor for Total score:
        # Total is anchored with word_total and phoneme_accuracy via final_score.
        calc_final = self.final_score(predictions, duration_sec=duration_sec)
        if "total" in result:
            w_final = min(0.60, 0.40 + (max(0.0, (duration_sec or 0.0) - 4.0) * 0.02))
            result["total"] = round(min(10.0, max(0.5, (1.0 - w_final) * result["total"] + w_final * calc_final)), 2)
        else:
            result["total"] = calc_final

        return result

    def final_score(
        self,
        predictions: Dict[str, torch.Tensor],
        duration_sec: Optional[float] = None,
    ) -> float:
        """
        Weighted combination of total/accuracy signals -> single 0-10 score.
        """
        parts = []
        w_sum = 0.0

        w_utt = float(self.weights.get("utterance_total", 0.5))
        w_word = float(self.weights.get("word_total", 0.25))
        w_phone = float(self.weights.get("phoneme_accuracy", 0.25))

        # Dynamically shift weight towards word and phoneme models on long clips:
        if duration_sec is not None and duration_sec > 4.5:
            shift = min(0.20, (duration_sec - 4.5) * 0.02)
            w_utt = max(0.30, w_utt - shift)
            w_word += shift / 2.0
            w_phone += shift / 2.0

        if "utterance_total" in predictions:
            v = predictions["utterance_total"]
            v = float(v.detach().cpu().item()) if isinstance(v, torch.Tensor) else v
            parts.append(w_utt * self.to_display_scale(v, is_utterance=True, duration_sec=duration_sec))
            w_sum += w_utt

        if "word_total" in predictions:
            wt = predictions["word_total"]
            if isinstance(wt, torch.Tensor) and wt.numel() > 0:
                v = float(wt.mean().detach().cpu().item())
                parts.append(w_word * self.to_display_scale(v, is_utterance=True, duration_sec=duration_sec))
                w_sum += w_word

        if "phoneme_accuracy" in predictions:
            pa = predictions["phoneme_accuracy"]
            if isinstance(pa, torch.Tensor) and pa.numel() > 0:
                v = float(pa.mean().detach().cpu().item())
                parts.append(w_phone * self.to_display_scale(v, is_phone=True))
                w_sum += w_phone

        if w_sum == 0:
            return 0.0
        score = sum(parts) / w_sum
        # Minimum floor for valid predictions
        if score > 0 and score < 0.5:
            score = 0.5
        return round(score, 2)

    def find_errors(
        self,
        predictions: Dict[str, torch.Tensor],
        phoneme_tokens: List[str],
        word_texts: List[str],
        word_phone_ranges: List[tuple],
        alignments: Optional[List[dict]] = None,
        threshold: Optional[float] = None,
    ) -> Dict[str, List[dict]]:
        """
        Identify low-scoring phonemes/words for feedback, grouped by severity,
        with standard IPA and word IPA for clear cross-referencing.

        Returns:
            {"phonemes": [...], "words": [...]} with scores on 0-10 scale and severity.
        """
        thr = threshold if threshold is not None else self.phoneme_low_threshold
        display_thr = self.to_display_scale(thr, is_phone=True)
        errors = {"phonemes": [], "words": []}

        # Map each phoneme index to its containing word and word IPA
        phone_to_word: Dict[int, dict] = {}
        word_ipas: List[str] = []
        for w_idx, (start_idx, end_idx) in enumerate(word_phone_ranges):
            w_text = word_texts[w_idx] if w_idx < len(word_texts) else ""
            w_phones = phoneme_tokens[start_idx:end_idx] if start_idx < end_idx else []
            w_ipa = phones_to_word_ipa(w_phones)
            word_ipas.append(w_ipa)
            for p_idx in range(start_idx, end_idx):
                phone_to_word[p_idx] = {
                    "word": w_text,
                    "word_ipa": w_ipa,
                }

        def get_severity(score_10: float) -> str:
            if score_10 < 4.0:
                return "critical"
            elif score_10 < 6.0:
                return "warning"
            else:
                return "minor"

        pa = predictions.get("phoneme_accuracy")
        if pa is not None and isinstance(pa, torch.Tensor):
            for i, (tok, score) in enumerate(zip(phoneme_tokens, pa.tolist())):
                display_score = self.to_display_scale(score, is_phone=True)
                valid = True

                if valid and display_score < display_thr:
                    w_info = phone_to_word.get(i, {})
                    errors["phonemes"].append(
                        {
                            "index": i,
                            "phoneme": tok,
                            "ipa": format_phone_ipa(tok),
                            "word": w_info.get("word", ""),
                            "word_ipa": w_info.get("word_ipa", ""),
                            "score": display_score,
                            "severity": get_severity(display_score),
                            "tip": _get_phoneme_tip(tok),
                        }
                    )

        wt_acc = predictions.get("word_accuracy")
        wt_stress = predictions.get("word_stress")
        if wt_acc is not None and isinstance(wt_acc, torch.Tensor):
            for i, (word, acc_score) in enumerate(zip(word_texts, wt_acc.tolist())):
                stress_score = wt_stress[i].item() if (wt_stress is not None and isinstance(wt_stress, torch.Tensor) and i < len(wt_stress)) else acc_score
                combined_score = (acc_score + stress_score) / 2.0
                display_score = self.to_display_scale(combined_score)
                valid = True

                if valid and display_score < display_thr:
                    w_ipa = word_ipas[i] if i < len(word_ipas) else ""
                    errors["words"].append(
                        {
                            "index": i, 
                            "word": word, 
                            "word_ipa": w_ipa,
                            "score": display_score,
                            "severity": get_severity(display_score)
                        }
                    )

        return errors

    def build_words_detail(
        self,
        predictions: Dict[str, torch.Tensor],
        phoneme_tokens: List[str],
        word_texts: List[str],
        word_phone_ranges: List[tuple],
    ) -> List[Dict[str, Any]]:
        """Build detailed word-by-word analysis with IPA and constituent phonemes for interactive UI."""
        words_detail = []
        pa = predictions.get("phoneme_accuracy")
        wt_acc = predictions.get("word_accuracy")
        wt_stress = predictions.get("word_stress")
        wt_total = predictions.get("word_total")

        for i, word in enumerate(word_texts):
            start_idx, end_idx = word_phone_ranges[i] if i < len(word_phone_ranges) else (0, 0)
            w_phones = phoneme_tokens[start_idx:end_idx] if start_idx < end_idx else []
            w_ipa = phones_to_word_ipa(w_phones)

            # Determine word score
            if wt_total is not None and isinstance(wt_total, torch.Tensor) and i < len(wt_total):
                w_score = self.to_display_scale(wt_total[i].item())
            elif wt_acc is not None and isinstance(wt_acc, torch.Tensor) and i < len(wt_acc):
                stress = wt_stress[i].item() if (wt_stress is not None and isinstance(wt_stress, torch.Tensor) and i < len(wt_stress)) else wt_acc[i].item()
                w_score = self.to_display_scale((wt_acc[i].item() + stress) / 2.0)
            else:
                w_score = 8.0

            # Constituent phonemes with calibrated IPA scoring
            phones_list = []
            for p_idx in range(start_idx, end_idx):
                p_tok = phoneme_tokens[p_idx]
                p_raw = pa[p_idx].item() if (pa is not None and isinstance(pa, torch.Tensor) and p_idx < len(pa)) else None
                p_score = self.to_display_scale(p_raw, is_phone=True) if p_raw is not None else w_score
                p_status = "good" if p_score >= 7.5 else ("warning" if p_score >= 5.5 else "bad")
                phones_list.append({
                    "phoneme": p_tok,
                    "ipa": format_phone_ipa(p_tok),
                    "ipa_char": phone_to_ipa(p_tok),
                    "score": p_score,
                    "status": p_status,
                    "tip": _get_phoneme_tip(p_tok),
                })

            if phones_list:
                phone_avg = sum(p["score"] for p in phones_list) / len(phones_list)
                phone_min = min(p["score"] for p in phones_list)
                # Blend word prediction with calibrated phoneme accuracy so word scores accurately reflect mispronounced sounds
                if wt_total is not None and isinstance(wt_total, torch.Tensor) and i < len(wt_total):
                    w_score = round(0.5 * w_score + 0.5 * phone_avg, 1)
                elif wt_acc is not None and isinstance(wt_acc, torch.Tensor) and i < len(wt_acc):
                    w_score = round(0.4 * w_score + 0.6 * phone_avg, 1)
                else:
                    w_score = round(phone_avg, 1)
                if phone_min < 5.0 and w_score > 6.0:
                    w_score = round(max(phone_min + 1.0, 4.5), 1)

            w_status = "good" if w_score >= 7.5 else ("warning" if w_score >= 5.5 else "bad")

            words_detail.append({
                "word": word,
                "word_ipa": w_ipa,
                "score": w_score,
                "status": w_status,
                "phonemes": phones_list,
            })

        return words_detail

    # ── L2-MDD Per-Turn Feedback (ASHA Clinical Diagnostic Engine) ───
    @staticmethod
    def generate_l2_turn_feedback(errors: Optional[Dict[str, List[dict]]]) -> Optional[str]:
        """Generate clinical-grade ASHA articulatory feedback from L2-MDD full phoneme scan."""
        if not errors:
            return None

        phones = errors.get("phonemes", [])
        if not phones:
            return "L2-MDD: Toàn bộ âm vị đều phát âm đạt chuẩn, không phát hiện âm lệch."

        parts = []
        seen_items = set()
        for p in phones:
            w_text = p.get("word", "")
            target_ipa = p.get("target_ipa") or format_phone_ipa(p.get("target_phone") or p.get("phoneme", ""))
            actual_ipa = p.get("actual_ipa", "")
            rule_name = p.get("rule_name_vi", "")
            tip = p.get("articulatory_tip") or p.get("tip") or ""

            key = f"{target_ipa}_{actual_ipa}_{w_text}"
            if key in seen_items:
                continue
            seen_items.add(key)

            if actual_ipa and actual_ipa != target_ipa:
                item = f"âm {target_ipa} bị lệch thành {actual_ipa}"
            else:
                item = f"âm {target_ipa}"

            if w_text:
                w_ipa = p.get("word_ipa", "")
                item += f" trong \"{w_text}\"" + (f" ({w_ipa})" if w_ipa else "")
            if rule_name:
                item += f" [{rule_name}]"
            if tip:
                item += f" — {tip}"
            parts.append(item)

        if not parts:
            return None
        return "L2-MDD (ASHA) lưu ý: " + "; ".join(parts[:3]) + "."

    # ── SpeechOcean Feedback Generation (No L2-MDD in overall) ──────
    @staticmethod
    def generate_transformer_feedback(
        scores_pronunciation: Optional[Dict[str, float]] = None,
        errors_pronunciation: Optional[Dict[str, List[dict]]] = None,
        transcript: str = "",
    ) -> Dict[str, Any]:
        """Generate structured feedback based purely on SpeechOcean762 scores with standard IPA."""
        feedback: Dict[str, Any] = {}

        ref_scores = scores_pronunciation or {}
        ref_errors = errors_pronunciation or {}

        if ref_scores:
            weak_words_p = [w for w in ref_errors.get("words", []) if w.get("score", 10.0) < 7.0]
            weak_phones_p = [p for p in ref_errors.get("phonemes", []) if p.get("score", 10.0) < 7.0]
            feedback["pronunciation_model"] = {
                "scores": ref_scores,
                "weak_words": [
                    {
                        "word": w["word"], 
                        "word_ipa": w.get("word_ipa", ""), 
                        "score": w["score"], 
                        "severity": w["severity"]
                    } for w in weak_words_p
                ],
                "weak_phonemes": [
                    {
                        "phoneme": p["phoneme"], 
                        "ipa": p.get("ipa") or format_phone_ipa(p["phoneme"]),
                        "word": p.get("word", ""),
                        "word_ipa": p.get("word_ipa", ""),
                        "score": p["score"], 
                        "severity": p["severity"], 
                        "tip": p.get("tip", "")
                    } for p in weak_phones_p
                ],
            }

        total = ref_scores.get("total", ref_scores.get("final", 0.0))
        acc = ref_scores.get("accuracy", 0.0)
        flu = ref_scores.get("fluency", 0.0)
        pro = ref_scores.get("prosodic", 0.0)

        # Determine level
        if total >= 8.5:
            level = "excellent"
            level_vi = "Xuất sắc"
        elif total >= 7.0:
            level = "good"
            level_vi = "Tốt"
        elif total >= 5.0:
            level = "average"
            level_vi = "Trung bình"
        elif total >= 3.0:
            level = "weak"
            level_vi = "Yếu"
        else:
            level = "critical"
            level_vi = "Cần cải thiện nhiều"

        feedback["level"] = level
        feedback["level_vi"] = level_vi

        # Build summary
        summary_parts = []
        summary_parts.append(f"📊 Mức đánh giá: **{level_vi}** ({total:.1f}/10)")

        if acc >= 7.0:
            summary_parts.append(f"✅ Phát âm chính xác tốt ({acc:.1f}/10)")
        elif acc >= 5.0:
            summary_parts.append(f"⚠️ Phát âm chính xác ở mức trung bình ({acc:.1f}/10)")
        else:
            summary_parts.append(f"❌ Phát âm chưa chính xác ({acc:.1f}/10), cần luyện tập thêm")

        if flu >= 7.0:
            summary_parts.append(f"✅ Nói trôi chảy ({flu:.1f}/10)")
        elif flu >= 5.0:
            summary_parts.append(f"⚠️ Còn ngắc ngứ, chưa thật trôi chảy ({flu:.1f}/10)")
        else:
            summary_parts.append(f"❌ Nói chưa trôi chảy ({flu:.1f}/10), thử nói chậm hơn và rõ ràng hơn")

        if pro >= 7.0:
            summary_parts.append(f"✅ Ngữ điệu tự nhiên ({pro:.1f}/10)")
        elif pro >= 5.0:
            summary_parts.append(f"⚠️ Ngữ điệu cần cải thiện ({pro:.1f}/10)")
        else:
            summary_parts.append(f"❌ Ngữ điệu đơn điệu ({pro:.1f}/10), thử nhấn mạnh từ quan trọng")

        feedback["summary"] = "\n".join(summary_parts)

        # Build tips from SpeechOcean error analysis using IPA
        tips: List[str] = []
        model_data = feedback.get("pronunciation_model", {})
        weak_phones = model_data.get("weak_phonemes", [])
        sorted_phones = sorted(weak_phones, key=lambda x: x["score"])
        for p in sorted_phones[:5]:  # Top 5 worst phonemes
            tip = p.get("tip", "")
            ph_ipa = p.get("ipa") or format_phone_ipa(p.get("phoneme", ""))
            w_text = p.get("word", "")
            w_ipa = p.get("word_ipa", "")
            in_word = f" trong từ \"{w_text}\" ({w_ipa})" if (w_text and w_ipa) else (f" trong từ \"{w_text}\"" if w_text else "")
            
            if tip:
                tips.append(f"🔤 Âm {ph_ipa}{in_word}: {tip} (điểm: {p['score']:.1f})")
            else:
                tips.append(f"🔤 Luyện phát âm {ph_ipa}{in_word} (điểm: {p['score']:.1f})")

        weak_words = model_data.get("weak_words", [])
        sorted_words = sorted(weak_words, key=lambda x: x["score"])
        for w in sorted_words[:5]:  # Top 5 worst words
            w_ipa = w.get("word_ipa", "")
            ipa_str = f" ({w_ipa})" if w_ipa else ""
            tips.append(f"📝 Từ \"{w['word']}\"{ipa_str}: cần luyện phát âm rõ hơn (điểm: {w['score']:.1f})")

        feedback["tips"] = tips

        return feedback
