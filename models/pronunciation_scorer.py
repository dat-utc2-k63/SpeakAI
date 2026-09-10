"""
Pronunciation score aggregation (0-10 scale).

Step 6: combine multi-task head outputs into interpretable final scores.
Supports ensemble scoring from multiple transformer models (pronunciation + L2-MDD).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import torch


# ── IPA / ARPAbet helpers for human-readable feedback ──────────────
_PHONEME_TIPS: Dict[str, str] = {
    "TH": "Đặt lưỡi giữa hai hàm răng, thổi nhẹ (think, three)",
    "DH": "Đặt lưỡi giữa hai hàm răng, rung dây thanh (this, that)",
    "R": "Cuộn lưỡi nhẹ ra sau, không chạm vòm miệng (red, run)",
    "L": "Đầu lưỡi chạm nướu trên, giữ giọng (light, love)",
    "V": "Răng trên chạm môi dưới, rung dây thanh (very, voice)",
    "W": "Tròn môi, giống âm 'u' ngắn (water, we)",
    "Z": "Giống âm 's' nhưng rung dây thanh (zoo, buzz)",
    "ZH": "Giống âm 'sh' nhưng rung dây thanh (measure, vision)",
    "SH": "Đẩy môi ra trước, luồng hơi rộng (she, ship)",
    "CH": "Kết hợp âm 't' + 'sh' nhanh (church, check)",
    "JH": "Kết hợp âm 'd' + 'zh' nhanh (judge, jump)",
    "NG": "Phần sau lưỡi chạm vòm mềm (sing, ring)",
    "AE1": "Mở miệng rộng, kéo dài (cat, bad)",
    "IH0": "Ngắn hơn 'ee', thả lỏng (bit, sit)",
    "UH1": "Ngắn, tròn môi nhẹ (book, put)",
    "ER0": "Âm 'r' kéo dài, cuộn lưỡi (butter, teacher)",
    "AH0": "Âm schwa - ngắn, nhẹ (about, sofa)",
}

def _get_phoneme_tip(phoneme: str) -> str:
    """Return a pronunciation tip for a phoneme, or a generic one."""
    # Strip stress digits for lookup
    base = phoneme.rstrip("012")
    if phoneme in _PHONEME_TIPS:
        return _PHONEME_TIPS[phoneme]
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
        Identify low-scoring phonemes/words for LLM feedback, grouped by severity.

        Returns:
            {"phonemes": [...], "words": [...]} with scores on 0-10 scale and severity.
        """
        thr = threshold if threshold is not None else self.phoneme_low_threshold
        display_thr = self.to_display_scale(thr)
        errors = {"phonemes": [], "words": []}

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
                
                # We no longer filter out low confidence/short phonemes because the user explicitly said:
                # "confidence < 0.5 -> noise: Không nên kết luận như vậy"
                valid = True

                if valid and display_score < display_thr:
                    errors["phonemes"].append(
                        {
                            "index": i,
                            "phoneme": tok,
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
                
                # Word confidence and frames derived from constituent phonemes
                valid = True
                if alignments and i < len(word_phone_ranges):
                    start_idx, end_idx = word_phone_ranges[i]
                    word_conf = 0.0
                    word_dur = 0
                    count = 0
                    for p_idx in range(start_idx, end_idx):
                        if p_idx < len(alignments):
                            al = alignments[p_idx]
                            word_conf += al.get("confidence", 1.0)
                            word_dur += (al.get("end_frame", 2) - al.get("start_frame", 0))
                            count += 1
                    if count > 0:
                        word_conf /= count
                        # We no longer filter out low confidence/short words
                        # if word_conf < 0.5 or word_dur < 2:
                        #     valid = False

                if valid and display_score < display_thr:
                    errors["words"].append(
                        {
                            "index": i, 
                            "word": word, 
                            "score": display_score,
                            "severity": get_severity(display_score)
                        }
                    )

        return errors

    # ── Ensemble Scoring ────────────────────────────────────────────
    @staticmethod
    def ensemble_scores(
        scores_a: Dict[str, float],
        scores_b: Dict[str, float],
        weight_a: float = 0.5,
        weight_b: float = 0.5,
    ) -> Dict[str, float]:
        """Combine scores from two models (e.g. pronunciation + L2-MDD).
        
        If one model's scores are missing for an aspect, use the other's.
        """
        all_keys = set(list(scores_a.keys()) + list(scores_b.keys()))
        combined = {}
        for key in all_keys:
            a_val = scores_a.get(key)
            b_val = scores_b.get(key)
            if a_val is not None and b_val is not None:
                combined[key] = round(weight_a * a_val + weight_b * b_val, 2)
            elif a_val is not None:
                combined[key] = round(a_val, 2)
            elif b_val is not None:
                combined[key] = round(b_val, 2)
        return combined

    @staticmethod
    def merge_errors(
        errors_a: Dict[str, List[dict]],
        errors_b: Dict[str, List[dict]],
    ) -> Dict[str, List[dict]]:
        """Merge error lists from two models, keeping the worst score for duplicates."""
        merged: Dict[str, List[dict]] = {"phonemes": [], "words": []}

        for category in ("phonemes", "words"):
            key_field = "phoneme" if category == "phonemes" else "word"
            seen: Dict[str, dict] = {}
            for err in errors_a.get(category, []) + errors_b.get(category, []):
                k = f"{err.get('index', '')}_{err.get(key_field, '')}"
                if k not in seen or err["score"] < seen[k]["score"]:
                    seen[k] = err
            merged[category] = sorted(seen.values(), key=lambda x: x["score"])

        return merged

    # ── Transformer Feedback Generation ─────────────────────────────
    @staticmethod
    def generate_transformer_feedback(
        scores_pronunciation: Optional[Dict[str, float]] = None,
        errors_pronunciation: Optional[Dict[str, List[dict]]] = None,
        scores_l2_mdd: Optional[Dict[str, float]] = None,
        errors_l2_mdd: Optional[Dict[str, List[dict]]] = None,
        ensemble_scores: Optional[Dict[str, float]] = None,
        transcript: str = "",
    ) -> Dict[str, Any]:
        """Generate structured feedback from both transformer models.
        
        Returns a dict with:
        - pronunciation_model: individual model analysis
        - l2_mdd_model: individual model analysis
        - summary: concise Vietnamese summary
        - tips: list of actionable improvement tips
        - level: overall level (excellent/good/average/weak/critical)
        """
        feedback: Dict[str, Any] = {}

        # Individual model results
        if scores_pronunciation:
            weak_words_p = [w for w in (errors_pronunciation or {}).get("words", []) if w["score"] < 7.0]
            weak_phones_p = [p for p in (errors_pronunciation or {}).get("phonemes", []) if p["score"] < 7.0]
            feedback["pronunciation_model"] = {
                "scores": scores_pronunciation,
                "weak_words": [{"word": w["word"], "score": w["score"], "severity": w["severity"]} for w in weak_words_p],
                "weak_phonemes": [{"phoneme": p["phoneme"], "score": p["score"], "severity": p["severity"], "tip": p.get("tip", "")} for p in weak_phones_p],
            }

        if scores_l2_mdd:
            weak_words_m = [w for w in (errors_l2_mdd or {}).get("words", []) if w["score"] < 7.0]
            weak_phones_m = [p for p in (errors_l2_mdd or {}).get("phonemes", []) if p["score"] < 7.0]
            feedback["l2_mdd_model"] = {
                "scores": scores_l2_mdd,
                "weak_words": [{"word": w["word"], "score": w["score"], "severity": w["severity"]} for w in weak_words_m],
                "weak_phonemes": [{"phoneme": p["phoneme"], "score": p["score"], "severity": p["severity"], "tip": p.get("tip", "")} for p in weak_phones_m],
            }

        # Use ensemble scores for summary
        ref_scores = ensemble_scores or scores_pronunciation or scores_l2_mdd or {}
        total = ref_scores.get("total", ref_scores.get("final", 0))
        acc = ref_scores.get("accuracy", 0)
        flu = ref_scores.get("fluency", 0)
        pro = ref_scores.get("prosodic", 0)

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

        # Build tips from error analysis
        tips: List[str] = []
        # Collect all weak phonemes from both models
        all_weak_phones: Dict[str, dict] = {}
        for model_key in ("pronunciation_model", "l2_mdd_model"):
            model_data = feedback.get(model_key, {})
            for p in model_data.get("weak_phonemes", []):
                ph = p["phoneme"]
                if ph not in all_weak_phones or p["score"] < all_weak_phones[ph]["score"]:
                    all_weak_phones[ph] = p

        # Sort by severity (lowest score first)
        sorted_phones = sorted(all_weak_phones.values(), key=lambda x: x["score"])
        for p in sorted_phones[:5]:  # Top 5 worst phonemes
            tip = p.get("tip", "")
            if tip:
                tips.append(f"🔤 Âm /{p['phoneme']}/: {tip} (điểm: {p['score']:.1f})")
            else:
                tips.append(f"🔤 Luyện phát âm /{p['phoneme']}/ (điểm: {p['score']:.1f})")

        # Collect weak words
        all_weak_words: Dict[str, dict] = {}
        for model_key in ("pronunciation_model", "l2_mdd_model"):
            model_data = feedback.get(model_key, {})
            for w in model_data.get("weak_words", []):
                word = w["word"]
                if word not in all_weak_words or w["score"] < all_weak_words[word]["score"]:
                    all_weak_words[word] = w

        sorted_words = sorted(all_weak_words.values(), key=lambda x: x["score"])
        for w in sorted_words[:5]:  # Top 5 worst words
            tips.append(f"📝 Từ \"{w['word']}\": cần luyện phát âm rõ hơn (điểm: {w['score']:.1f})")

        feedback["tips"] = tips

        return feedback
