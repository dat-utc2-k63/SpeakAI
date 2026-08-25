"""
Multi-task regression heads (GOPT-inspired).

Step 5: parallel heads for pronunciation aspects at 3 granularities.

Architecture mirrors GOPT (ICASSP 2022):
  - Each head: LayerNorm -> Linear(hidden, 1) regression.
  - Utterance heads: applied on utterance-level pooled representation.
  - Word heads: applied on mean-pool of phoneme nodes per word.
  - Phoneme heads: applied on each GAT output node.

Aspects mapped to SpeechOcean762 labels:
  Utterance: accuracy, fluency, completeness, prosodic, total
  Word:      accuracy, stress, total
  Phoneme:   accuracy (phones-accuracy)
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import torch
import torch.nn as nn


class RegressionHead(nn.Module):
    """Single-aspect regression head with layer norm (GOPT style)."""

    def __init__(self, input_dim: int, dropout: float = 0.1):
        super().__init__()
        self.net = nn.Sequential(
            nn.LayerNorm(input_dim),
            nn.Dropout(dropout),
            nn.Linear(input_dim, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)


class MultiTaskHeads(nn.Module):
    """Collection of aspect-specific heads at phoneme/word/utterance levels."""

    def __init__(
        self,
        input_dim: int,
        utterance_aspects: Optional[List[str]] = None,
        word_aspects: Optional[List[str]] = None,
        phoneme_aspects: Optional[List[str]] = None,
        dropout: float = 0.1,
    ):
        super().__init__()
        self.utterance_aspects = utterance_aspects or [
            "accuracy", "fluency", "completeness", "prosodic", "total"
        ]
        self.word_aspects = word_aspects or ["accuracy", "stress", "total"]
        self.phoneme_aspects = phoneme_aspects or ["accuracy"]
        self.input_dim = input_dim

        self.utt_heads = nn.ModuleDict(
            {a: RegressionHead(input_dim, dropout) for a in self.utterance_aspects}
        )
        self.word_heads = nn.ModuleDict(
            {a: RegressionHead(input_dim, dropout) for a in self.word_aspects}
        )
        self.phoneme_heads = nn.ModuleDict(
            {a: RegressionHead(input_dim, dropout) for a in self.phoneme_aspects}
        )

    def pool_utterance(self, phoneme_embeddings: torch.Tensor) -> torch.Tensor:
        """Mean-pool all phoneme nodes -> utterance representation."""
        if phoneme_embeddings.shape[0] == 0:
            return phoneme_embeddings.new_zeros(self.input_dim)
        return phoneme_embeddings.mean(dim=0)

    def pool_words(
        self,
        phoneme_embeddings: torch.Tensor,
        word_phone_ranges: List[Tuple[int, int]],
    ) -> torch.Tensor:
        """Mean-pool phoneme nodes per word -> (num_words, D)."""
        word_embs = []
        for start, end in word_phone_ranges:
            if start < end:
                word_embs.append(phoneme_embeddings[start:end].mean(dim=0))
            else:
                word_embs.append(phoneme_embeddings.new_zeros(self.input_dim))
        return torch.stack(word_embs, dim=0) if word_embs else phoneme_embeddings.new_zeros(0, self.input_dim)

    def forward_single(
        self,
        phoneme_embeddings: torch.Tensor,
        word_phone_ranges: List[Tuple[int, int]],
    ) -> Dict[str, torch.Tensor]:
        """
        Predict all aspects for one utterance.

        Returns dict with keys:
          utterance_{aspect}, word_{aspect} (W,), phoneme_{aspect} (N,)
        """
        utt_repr = self.pool_utterance(phoneme_embeddings)
        word_repr = self.pool_words(phoneme_embeddings, word_phone_ranges)

        out: Dict[str, torch.Tensor] = {}
        for aspect, head in self.utt_heads.items():
            out[f"utterance_{aspect}"] = head(utt_repr.unsqueeze(0)).squeeze(0)
        for aspect, head in self.word_heads.items():
            if word_repr.shape[0] > 0:
                out[f"word_{aspect}"] = head(word_repr)
            else:
                out[f"word_{aspect}"] = phoneme_embeddings.new_zeros(0)
        for aspect, head in self.phoneme_heads.items():
            if phoneme_embeddings.shape[0] > 0:
                out[f"phoneme_{aspect}"] = head(phoneme_embeddings)
            else:
                out[f"phoneme_{aspect}"] = phoneme_embeddings.new_zeros(0)
        return out

    def forward_batch(
        self,
        phoneme_embeddings_list: List[torch.Tensor],
        word_phone_ranges_list: List[List[Tuple[int, int]]],
    ) -> List[Dict[str, torch.Tensor]]:
        return [
            self.forward_single(pe, wr)
            for pe, wr in zip(phoneme_embeddings_list, word_phone_ranges_list)
        ]
