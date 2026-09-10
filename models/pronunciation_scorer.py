"""
Pronunciation score aggregation (0-10 scale).

Step 6: combine multi-task head outputs into interpretable final scores.
Supports ensemble scoring from multiple transformer models (pronunciation + L2-MDD).
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


# ── IPA / ARPAbet helpers for human-readable feedback ──────────────
_PHONEME_TIPS: Dict[str, str] = {
    "TH": "Đặt lưỡi giữa hai hàm răng, thổi nhẹ (think, three)",
    "θ": "Đặt lưỡi giữa hai hàm răng, thổi nhẹ (think, three)",
    "DH": "Đặt lưỡi giữa hai hàm răng, rung dây thanh (this, that)",
    "ð": "Đặt lưỡi giữa hai hàm răng, rung dây thanh (this, that)",
    "R": "Cuộn lưỡi nhẹ ra sau, không chạm vòm miệng (red, run)",
    "r": "Cuộn lưỡi nhẹ ra sau, không chạm vòm miệng (red, run)",
    "L": "Đầu lưỡi chạm nướu trên, giữ giọng (light, love)",
    "l": "Đầu lưỡi chạm nướu trên, giữ giọng (light, love)",
    "V": "Răng trên chạm môi dưới, rung dây thanh (very, voice)",
    "v": "Răng trên chạm môi dưới, rung dây thanh (very, voice)",
    "W": "Tròn môi, giống âm 'u' ngắn (water, we)",
    "w": "Tròn môi, giống âm 'u' ngắn (water, we)",
    "Z": "Giống âm 's' nhưng rung dây thanh (zoo, buzz)",
    "z": "Giống âm 's' nhưng rung dây thanh (zoo, buzz)",
    "ZH": "Giống âm 'sh' nhưng rung dây thanh (measure, vision)",
    "ʒ": "Giống âm 'sh' nhưng rung dây thanh (measure, vision)",
    "SH": "Đẩy môi ra trước, luồng hơi rộng (she, ship)",
    "ʃ": "Đẩy môi ra trước, luồng hơi rộng (she, ship)",
    "CH": "Kết hợp âm 't' + 'sh' nhanh (church, check)",
    "tʃ": "Kết hợp âm 't' + 'sh' nhanh (church, check)",
    "JH": "Kết hợp âm 'd' + 'zh' nhanh (judge, jump)",
    "dʒ": "Kết hợp âm 'd' + 'zh' nhanh (judge, jump)",
    "NG": "Phần sau lưỡi chạm vòm mềm (sing, ring)",
    "ŋ": "Phần sau lưỡi chạm vòm mềm (sing, ring)",
    "AE": "Mở miệng rộng, kéo dài (cat, bad)",
    "æ": "Mở miệng rộng, kéo dài (cat, bad)",
    "IH": "Ngắn hơn 'ee', thả lỏng (bit, sit)",
    "ɪ": "Ngắn hơn 'ee', thả lỏng (bit, sit)",
    "UH": "Ngắn, tròn môi nhẹ (book, put)",
    "ʊ": "Ngắn, tròn môi nhẹ (book, put)",
    "ER": "Âm 'r' kéo dài, cuộn lưỡi (butter, teacher)",
    "ɜːr": "Âm 'r' kéo dài, cuộn lưỡi (butter, teacher)",
    "ər": "Âm 'r' nhẹ, lướt nhanh (butter, teacher)",
    "AH0": "Âm schwa - ngắn, nhẹ (about, sofa)",
    "ə": "Âm schwa - ngắn, nhẹ (about, sofa)",
    "IY": "Cười nhẹ, kéo dài âm 'ee' (see, seat)",
    "iː": "Cười nhẹ, kéo dài âm 'ee' (see, seat)",
}

def _get_phoneme_tip(phoneme: str) -> str:
    """Return a pronunciation tip for a phoneme (supports ARPAbet or IPA)."""
    if not phoneme:
        return ""
    if phoneme in _PHONEME_TIPS:
        return _PHONEME_TIPS[phoneme]
    ipa = phone_to_ipa(phoneme)
    if ipa in _PHONEME_TIPS:
        return _PHONEME_TIPS[ipa]
    base = phoneme.rstrip("012")
    if base in _PHONEME_TIPS:
        return _PHONEME_TIPS[base]
    return ""


class PronunciationScorer:
    """
    Aggregate multi-granularity predictions into final 0-10 scores.

    Training targets are normalized to 0-2 (GOPT convention); this class
    denormalizes back to SpeechOcean762's 0-10 scale for reporting.
    """

    def __init__(
        self,
        score_scale: float = 5.0,
        weights: Optional[Dict[str, float]] = None,
        phoneme_low_threshold: float = 1.4,
    ):
        self.score_scale = score_scale
        self.weights = weights or {
            "utterance_total": 0.4,
            "word_total": 0.3,
            "phoneme_accuracy": 0.3,
        }
        self.phoneme_low_threshold = phoneme_low_threshold

    def to_display_scale(self, score: float) -> float:
        """Map 0-2 normalized score -> 0-10 display scale.
        
        Includes a minimum floor of 0.5 to avoid returning 0 for valid predictions.
        The model outputs 0 only for truly empty/invalid input.
        """
        raw = score * self.score_scale
        # Clamp to [0, 10] range
        clamped = min(10.0, max(0.0, raw))
        # If the raw prediction is positive (model made a real prediction),
        # apply a minimum floor to avoid misleading 0-scores
        if score > 0.01:
            clamped = max(0.5, clamped)
        return round(clamped, 2)

    def aggregate_utterance(self, predictions: Dict[str, torch.Tensor]) -> Dict[str, float]:
        """Build utterance-level score dict on 0-10 scale."""
        result = {}
        for key, val in predictions.items():
            if key.startswith("utterance_"):
                aspect = key.replace("utterance_", "")
                if isinstance(val, torch.Tensor):
                    val = float(val.detach().cpu().item())
                result[aspect] = self.to_display_scale(val)
        return result

    def final_score(self, predictions: Dict[str, torch.Tensor]) -> float:
        """
        Weighted combination of total/accuracy signals -> single 0-10 score.
        """
        parts = []
        w_sum = 0.0

        if "utterance_total" in predictions:
            v = predictions["utterance_total"]
            v = float(v.detach().cpu().item()) if isinstance(v, torch.Tensor) else v
            parts.append(self.weights["utterance_total"] * self.to_display_scale(v))
            w_sum += self.weights["utterance_total"]

        if "word_total" in predictions:
            wt = predictions["word_total"]
            if isinstance(wt, torch.Tensor) and wt.numel() > 0:
                v = float(wt.mean().detach().cpu().item())
                parts.append(self.weights["word_total"] * self.to_display_scale(v))
                w_sum += self.weights["word_total"]

        if "phoneme_accuracy" in predictions:
            pa = predictions["phoneme_accuracy"]
            if isinstance(pa, torch.Tensor) and pa.numel() > 0:
                v = float(pa.mean().detach().cpu().item())
                parts.append(self.weights["phoneme_accuracy"] * self.to_display_scale(v))
                w_sum += self.weights["phoneme_accuracy"]

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
        display_thr = self.to_display_scale(thr)
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
                display_score = self.to_display_scale(score)
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

            w_status = "good" if w_score >= 7.5 else ("warning" if w_score >= 5.5 else "bad")

            # Constituent phonemes
            phones_list = []
            for p_idx in range(start_idx, end_idx):
                p_tok = phoneme_tokens[p_idx]
                p_score = self.to_display_scale(pa[p_idx].item()) if (pa is not None and isinstance(pa, torch.Tensor) and p_idx < len(pa)) else w_score
                p_status = "good" if p_score >= 7.5 else ("warning" if p_score >= 5.5 else "bad")
                phones_list.append({
                    "phoneme": p_tok,
                    "ipa": format_phone_ipa(p_tok),
                    "ipa_char": phone_to_ipa(p_tok),
                    "score": p_score,
                    "status": p_status,
                    "tip": _get_phoneme_tip(p_tok),
                })

            words_detail.append({
                "word": word,
                "word_ipa": w_ipa,
                "score": w_score,
                "status": w_status,
                "phonemes": phones_list,
            })

        return words_detail

    # ── L2-MDD Per-Turn Feedback ────────────────────────────────────
    @staticmethod
    def generate_l2_turn_feedback(errors: Optional[Dict[str, List[dict]]]) -> Optional[str]:
        """Generate simple per-turn feedback from L2-MDD model using standard IPA symbols.
        
        SpeechOcean762 handles all scoring; L2-MDD only spots L2 learner pronunciation errors
        and gives a concise note with IPA for the individual turn.
        """
        if not errors:
            return None

        weak_phones = [p for p in errors.get("phonemes", []) if p.get("score", 10.0) < 6.5]
        weak_words = [w for w in errors.get("words", []) if w.get("score", 10.0) < 6.5]

        if not weak_phones and not weak_words:
            return "L2-MDD: Phát âm rõ ràng, không phát hiện lỗi phát âm đáng kể."

        parts = []
        if weak_phones:
            seen_ph = set()
            ph_tips = []
            for p in weak_phones:
                ph_raw = p.get("phoneme", "")
                ph_ipa = p.get("ipa") or format_phone_ipa(ph_raw)
                w_text = p.get("word", "")
                w_ipa = p.get("word_ipa", "")

                key = f"{ph_ipa}_{w_text}"
                if key not in seen_ph:
                    seen_ph.add(key)
                    tip = p.get("tip") or _get_phoneme_tip(ph_raw)
                    item = f"âm {ph_ipa}"
                    if w_text:
                        item += f" trong \"{w_text}\""
                        if w_ipa:
                            item += f" ({w_ipa})"
                    if tip:
                        item += f" — {tip}"
                    ph_tips.append(item)

            if ph_tips:
                parts.append("chú ý " + "; ".join(ph_tips[:3]))

        if weak_words:
            seen_w = set()
            w_list = []
            for w in weak_words:
                wd = w.get("word", "")
                w_ipa = w.get("word_ipa", "")
                if wd and wd not in seen_w:
                    seen_w.add(wd)
                    item = f'"{wd}"'
                    if w_ipa:
                        item += f" ({w_ipa})"
                    w_list.append(item)
            if w_list:
                parts.append(f"từ cần đọc rõ: {', '.join(w_list[:3])}")

        if not parts:
            return None
        return "L2-MDD lưu ý: " + ". ".join(parts) + "."

    # ── SpeechOcean Feedback Generation (No L2-MDD in overall) ──────
    @staticmethod
    def generate_transformer_feedback(
        scores_pronunciation: Optional[Dict[str, float]] = None,
        errors_pronunciation: Optional[Dict[str, List[dict]]] = None,
        scores_l2_mdd: Optional[Dict[str, float]] = None,
        errors_l2_mdd: Optional[Dict[str, List[dict]]] = None,
        ensemble_scores: Optional[Dict[str, float]] = None,
        transcript: str = "",
    ) -> Dict[str, Any]:
        """Generate structured feedback based purely on SpeechOcean762 scores with standard IPA."""
        feedback: Dict[str, Any] = {}

        ref_scores = scores_pronunciation or ensemble_scores or {}
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
