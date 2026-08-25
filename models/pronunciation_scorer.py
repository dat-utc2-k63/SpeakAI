"""
Pronunciation score aggregation (0-10 scale).

Step 6: combine multi-task head outputs into interpretable final scores.
"""

from __future__ import annotations

from typing import Dict, List, Optional

import torch


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
        phoneme_low_threshold: float = 1.2,
    ):
        self.score_scale = score_scale
        self.weights = weights or {
            "utterance_total": 0.4,
            "word_total": 0.3,
            "phoneme_accuracy": 0.3,
        }
        self.phoneme_low_threshold = phoneme_low_threshold

    def to_display_scale(self, score: float) -> float:
        """Map 0-2 normalized score -> 0-10 display scale."""
        return min(10.0, max(0.0, score * self.score_scale))

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
        return sum(parts) / w_sum

    def find_errors(
        self,
        predictions: Dict[str, torch.Tensor],
        phoneme_tokens: List[str],
        word_texts: List[str],
        word_phone_ranges: List[tuple],
        threshold: Optional[float] = None,
    ) -> Dict[str, List[dict]]:
        """
        Identify low-scoring phonemes/words for LLM feedback.

        Returns:
            {"phonemes": [...], "words": [...]} with scores on 0-10 scale.
        """
        thr = threshold if threshold is not None else self.phoneme_low_threshold
        errors = {"phonemes": [], "words": []}

        pa = predictions.get("phoneme_accuracy")
        if pa is not None and isinstance(pa, torch.Tensor):
            for i, (tok, score) in enumerate(zip(phoneme_tokens, pa.tolist())):
                if score < thr:
                    errors["phonemes"].append(
                        {
                            "index": i,
                            "phoneme": tok,
                            "score": self.to_display_scale(score),
                        }
                    )

        wt = predictions.get("word_accuracy")
        if wt is not None and isinstance(wt, torch.Tensor):
            for i, (word, score) in enumerate(zip(word_texts, wt.tolist())):
                display = self.to_display_scale(score)
                if display < self.to_display_scale(thr):
                    errors["words"].append(
                        {"index": i, "word": word, "score": display}
                    )

        return errors
