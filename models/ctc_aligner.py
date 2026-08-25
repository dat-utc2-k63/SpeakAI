"""
CTC Forced Alignment for phoneme-level timestamp extraction.

Step 3 of pipeline:
  1. Project WavLM frame features -> CTC log-probs over phoneme vocabulary.
  2. Run torchaudio.functional.forced_align with canonical phoneme sequence.
  3. Convert alignment spans -> pooled phoneme node features for Graph Attention.

Key conversion (alignment -> node features):
  For each phoneme p_i aligned to frame range [t_start, t_end]:
      node_feature_i = mean(frame_hidden[t_start:t_end+1])
  This pools acoustic+linguistic context from the task Transformer output
  into one vector per phoneme, which becomes the initial GAT node embedding.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

# Lazy import: torchaudio may fail on some Windows/Python combos
torchaudio = None
forced_align = None


def _ensure_torchaudio():
    global torchaudio, forced_align
    if torchaudio is not None:
        return True
    try:
        import torchaudio as _ta
        from torchaudio.functional import forced_align as _fa

        torchaudio = _ta
        forced_align = _fa
        return True
    except (ImportError, OSError):
        return False


# espeak-style phoneme set subset (ARPAbet compatible with SpeechOcean762)
DEFAULT_PHONEME_VOCAB = [
    "<pad>", "<unk>", "|",  # blank, unknown, word boundary
    "AA0", "AA1", "AA2", "AE0", "AE1", "AE2", "AH0", "AH1", "AH2",
    "AO0", "AO1", "AO2", "AW0", "AW1", "AW2", "AY0", "AY1", "AY2",
    "B", "CH", "D", "DH", "EH0", "EH1", "EH2", "ER0", "ER1", "ER2",
    "EY0", "EY1", "EY2", "F", "G", "HH", "IH0", "IH1", "IH2",
    "IY0", "IY1", "IY2", "JH", "K", "L", "M", "N", "NG",
    "OW0", "OW1", "OW2", "OY0", "OY1", "OY2", "P", "R", "S", "SH",
    "T", "TH", "UH0", "UH1", "UH2", "UW0", "UW1", "UW2",
    "V", "W", "Y", "Z", "ZH",
]


@dataclass
class PhonemeAlignment:
    """Single phoneme alignment result."""

    phoneme: str
    token_id: int
    start_frame: int
    end_frame: int
    confidence: float


class CTCAligner(nn.Module):
    """
    CTC head + forced alignment to map phoneme sequence -> frame spans.

    Can optionally use a pretrained torchaudio CTC bundle for alignment-only
    mode; default trains a lightweight linear CTC head on WavLM features.
    """

    def __init__(
        self,
        input_dim: int,
        phoneme_vocab: Optional[List[str]] = None,
        use_pretrained_bundle: bool = False,
        blank_id: int = 0,
    ):
        super().__init__()
        self.phoneme_vocab = phoneme_vocab or DEFAULT_PHONEME_VOCAB
        self.token2id = {p: i for i, p in enumerate(self.phoneme_vocab)}
        self.blank_id = blank_id
        self.num_tokens = len(self.phoneme_vocab)

        self.ctc_proj = nn.Linear(input_dim, self.num_tokens)
        self.use_pretrained_bundle = use_pretrained_bundle
        self._bundle = None

        if use_pretrained_bundle and _ensure_torchaudio():
            try:
                # Phoneme ASR model (espeak phonemes) when available
                self._bundle = torchaudio.pipelines.MMS_FA
            except AttributeError:
                self._bundle = None

    def phonemes_to_ids(self, phonemes: List[str]) -> torch.Tensor:
        """Map ARPAbet phoneme strings to token IDs."""
        ids = []
        for p in phonemes:
            ids.append(self.token2id.get(p, self.token2id["<unk>"]))
        return torch.tensor(ids, dtype=torch.long)

    def forward_ctc_logits(self, frame_features: torch.Tensor) -> torch.Tensor:
        """(B, T, D) -> (T, B, C) log-probs for torch.nn.functional.ctc_loss."""
        logits = self.ctc_proj(frame_features)
        log_probs = F.log_softmax(logits, dim=-1)
        return log_probs.transpose(0, 1)

    def _align_log_probs(self, frame_features: torch.Tensor) -> torch.Tensor:
        """(T, D) -> (1, T, C) log-probs for torchaudio forced_align (batch-first)."""
        logits = self.ctc_proj(frame_features.unsqueeze(0))
        return F.log_softmax(logits, dim=-1)

    def _run_forced_align(
        self,
        log_probs: torch.Tensor,
        targets: torch.Tensor,
        input_lengths: torch.Tensor,
        target_lengths: torch.Tensor,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """forced_align wants (B, T, C) with B=1; GPU kernel errors on wrong layout."""
        assert log_probs.dim() == 3 and log_probs.shape[0] == 1
        try:
            return forced_align(
                log_probs.float(),
                targets.unsqueeze(0),
                input_lengths,
                target_lengths,
                blank=self.blank_id,
            )
        except RuntimeError:
            return forced_align(
                log_probs.float().cpu(),
                targets.unsqueeze(0).cpu(),
                input_lengths.cpu(),
                target_lengths.cpu(),
                blank=self.blank_id,
            )

    def align_utterance(
        self,
        frame_features: torch.Tensor,
        phonemes: List[str],
        frame_lengths: Optional[int] = None,
    ) -> Tuple[List[PhonemeAlignment], torch.Tensor]:
        """
        Force-align one utterance.

        Args:
            frame_features: (T, D) single utterance frame features.
            phonemes: canonical ARPAbet phoneme list from transcript/CMUdict.
            frame_lengths: number of valid frames T.

        Returns:
            alignments: list of PhonemeAlignment with frame spans.
            node_features: (num_phonemes, D) pooled features for GAT nodes.
        """
        if frame_lengths is None:
            frame_lengths = frame_features.shape[0]

        T, D = frame_features.shape
        if len(phonemes) == 0:
            return [], frame_features.new_zeros(0, D)

        targets = self.phonemes_to_ids(phonemes).to(frame_features.device)

        if not _ensure_torchaudio() or forced_align is None:
            return self._uniform_align(frame_features, phonemes)

        log_probs = self._align_log_probs(frame_features)  # (1, T, C)
        input_lengths = torch.tensor([frame_lengths], device=frame_features.device)
        target_lengths = torch.tensor([len(targets)], device=frame_features.device)

        aligned_tokens, _align_scores = self._run_forced_align(
            log_probs, targets, input_lengths, target_lengths
        )
        if aligned_tokens.dim() > 1:
            aligned = aligned_tokens[0, :frame_lengths]
        else:
            aligned = aligned_tokens[:frame_lengths]

        spans = self._tokens_to_spans(aligned, targets, phonemes)
        node_features = self._pool_node_features(frame_features, spans)
        return spans, node_features

    def _tokens_to_spans(
        self,
        aligned: torch.Tensor,
        targets: torch.Tensor,
        phonemes: List[str],
    ) -> List[PhonemeAlignment]:
        """
        Parse per-frame CTC alignment into phoneme start/end spans.

        forced_align output assigns each frame to a target token index or blank.
        Consecutive frames with the same non-blank token index form one span.
        """
        spans: List[PhonemeAlignment] = []
        target_list = targets.tolist()
        i = 0
        while i < len(phonemes):
            token_id = target_list[i]
            # find frames assigned to this target position
            mask = aligned == i  # forced_align uses target position indices
            if mask.any():
                idx = mask.nonzero(as_tuple=True)[0]
                start_f, end_f = int(idx[0]), int(idx[-1])
                conf = float(mask.float().mean())
            else:
                # phoneme got no frames — interpolate
                start_f = end_f = 0
                conf = 0.0
            spans.append(
                PhonemeAlignment(
                    phoneme=phonemes[i],
                    token_id=token_id,
                    start_frame=start_f,
                    end_frame=end_f,
                    confidence=conf,
                )
            )
            i += 1
        return spans

    def _pool_node_features(
        self,
        frame_features: torch.Tensor,
        spans: List[PhonemeAlignment],
    ) -> torch.Tensor:
        """
        Pool frame hidden states over [t_start, t_end] for each phoneme.

        This is the critical bridge from CTC alignment to Graph Attention:
        each phoneme node receives a fixed-size embedding regardless of
        how many frames it spans.
        """
        nodes = []
        T = frame_features.shape[0]
        for span in spans:
            s = max(0, span.start_frame)
            e = min(T - 1, span.end_frame)
            if s <= e:
                pooled = frame_features[s : e + 1].mean(dim=0)
            else:
                pooled = frame_features.mean(dim=0)
            nodes.append(pooled)
        return torch.stack(nodes, dim=0) if nodes else frame_features.new_zeros(0, frame_features.shape[-1])

    def _uniform_align(
        self,
        frame_features: torch.Tensor,
        phonemes: List[str],
    ) -> Tuple[List[PhonemeAlignment], torch.Tensor]:
        """Fallback equal-split alignment when forced_align is unavailable."""
        T, D = frame_features.shape
        n = max(len(phonemes), 1)
        chunk = T // n
        spans = []
        for i, ph in enumerate(phonemes):
            s = i * chunk
            e = min(T - 1, (i + 1) * chunk - 1) if i < n - 1 else T - 1
            tid = self.token2id.get(ph, self.token2id["<unk>"])
            spans.append(
                PhonemeAlignment(ph, tid, s, e, 1.0)
            )
        node_features = self._pool_node_features(frame_features, spans)
        return spans, node_features

    def batch_align(
        self,
        frame_features: torch.Tensor,
        phoneme_lists: List[List[str]],
        frame_lengths: torch.Tensor,
    ) -> List[Tuple[List[PhonemeAlignment], torch.Tensor]]:
        """Align a batch; returns per-utterance (spans, node_features)."""
        results = []
        B = frame_features.shape[0]
        for b in range(B):
            T_b = int(frame_lengths[b].item())
            spans, nodes = self.align_utterance(
                frame_features[b, :T_b],
                phoneme_lists[b],
                T_b,
            )
            results.append((spans, nodes))
        return results

    def ctc_loss(
        self,
        frame_features: torch.Tensor,
        phoneme_lists: List[List[str]],
        frame_lengths: torch.Tensor,
    ) -> torch.Tensor:
        """Auxiliary CTC loss for training the alignment head."""
        log_probs = self.forward_ctc_logits(frame_features)
        targets_list = []
        target_lengths = []
        for phs in phoneme_lists:
            t = self.phonemes_to_ids(phs)
            targets_list.append(t)
            target_lengths.append(len(t))
        targets = torch.cat(targets_list).to(frame_features.device)
        target_lengths_t = torch.tensor(target_lengths, device=frame_features.device)
        loss = F.ctc_loss(
            log_probs,
            targets,
            frame_lengths,
            target_lengths_t,
            blank=self.blank_id,
            zero_infinity=True,
        )
        return loss
