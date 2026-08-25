"""
End-to-end Pronunciation Assessment model.

Full pipeline:
  waveform -> WavLM -> TaskTransformer -> CTC align -> GAT graph -> multi-task heads
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import torch
import torch.nn as nn

from .wavlm_encoder import WavLMEncoder
from .transformer_encoder import TaskTransformerEncoder
from .ctc_aligner import CTCAligner
from .phoneme_graph import PhonemeGraphNetwork
from .multitask_heads import MultiTaskHeads


class PronunciationAssessmentModel(nn.Module):
    """Full pronunciation assessment pipeline."""

    def __init__(self, config: Dict[str, Any]):
        super().__init__()
        wavlm_cfg = config.get("wavlm", {})
        trans_cfg = config.get("transformer", {})
        ctc_cfg = config.get("ctc_align", {})
        graph_cfg = config.get("phoneme_graph", {})
        mt_cfg = config.get("multitask", {})

        self.wavlm = WavLMEncoder(
            model_name=wavlm_cfg.get("model_name", "microsoft/wavlm-large"),
            freeze=wavlm_cfg.get("freeze", True),
            use_lora=wavlm_cfg.get("use_lora", False),
            lora_r=wavlm_cfg.get("lora_r", 8),
            lora_alpha=wavlm_cfg.get("lora_alpha", 16),
            lora_dropout=wavlm_cfg.get("lora_dropout", 0.05),
            lora_target_modules=wavlm_cfg.get("lora_target_modules"),
        )
        d = self.wavlm.output_dim

        self.task_transformer = TaskTransformerEncoder(
            input_dim=d,
            num_layers=trans_cfg.get("num_layers", 3),
            num_heads=trans_cfg.get("num_heads", 8),
            ff_dim=trans_cfg.get("ff_dim", 3072),
            dropout=trans_cfg.get("dropout", 0.1),
            max_seq_len=trans_cfg.get("max_seq_len", 2000),
        )

        self.ctc_aligner = CTCAligner(
            input_dim=d,
            use_pretrained_bundle=not ctc_cfg.get("use_wavlm_ctc_head", True),
        )

        graph_hidden = graph_cfg.get("hidden_dim", 256)
        self.phoneme_graph = PhonemeGraphNetwork(
            input_dim=d,
            hidden_dim=graph_hidden,
            num_layers=graph_cfg.get("num_gat_layers", 2),
            num_heads=graph_cfg.get("num_heads", 4),
            dropout=graph_cfg.get("dropout", 0.1),
            edge_sequential=graph_cfg.get("edge_types", {}).get("sequential", True),
            edge_same_word=graph_cfg.get("edge_types", {}).get("same_word", True),
            edge_same_syllable=graph_cfg.get("edge_types", {}).get("same_syllable", False),
        )

        self.multitask_heads = MultiTaskHeads(
            input_dim=graph_hidden,
            utterance_aspects=mt_cfg.get("utterance_aspects"),
            word_aspects=mt_cfg.get("word_aspects"),
            phoneme_aspects=mt_cfg.get("phoneme_aspects"),
            dropout=mt_cfg.get("dropout", 0.1),
        )

        self.sample_rate = config.get("train", {}).get("dataset", {}).get("sample_rate", 16000)

    def _frame_lengths_from_wave(self, wav_lengths: torch.Tensor) -> torch.Tensor:
        """Convert sample lengths to WavLM frame lengths using model conv math."""
        return self.wavlm.frame_lengths_from_samples(wav_lengths)

    def forward(
        self,
        waveforms: torch.Tensor,
        wav_lengths: torch.Tensor,
        phoneme_tokens: List[List[str]],
        word_phone_ranges: List[List[tuple]],
        return_alignments: bool = False,
    ) -> Dict[str, Any]:
        """
        Forward pass for a batch.

        Args:
            waveforms: (B, samples) padded.
            wav_lengths: (B,) actual sample counts.
            phoneme_tokens: list of phoneme strings per utterance.
            word_phone_ranges: word -> phoneme index ranges.

        Returns:
            dict with per-utterance predictions, optional alignments, ctc_loss.
        """
        # Step 1: WavLM features
        frame_feats = self.wavlm(waveforms, wav_lengths=wav_lengths)  # (B, T, D)
        frame_lengths = self._frame_lengths_from_wave(wav_lengths)

        # padding mask for transformer
        T = frame_feats.shape[1]
        pad_mask = torch.arange(T, device=waveforms.device).unsqueeze(0) >= frame_lengths.unsqueeze(1)

        # Step 2: task transformer
        frame_feats = self.task_transformer(frame_feats, src_key_padding_mask=pad_mask)

        # Step 3: CTC alignment -> phoneme node features
        align_results = self.ctc_aligner.batch_align(
            frame_feats, phoneme_tokens, frame_lengths
        )
        node_features_list = [nodes for _, nodes in align_results]
        alignments_list = [spans for spans, _ in align_results] if return_alignments else None

        # Step 4: graph attention
        graph_out = self.phoneme_graph.forward_batch(
            node_features_list, word_phone_ranges
        )

        # Step 5: multi-task heads
        predictions = self.multitask_heads.forward_batch(graph_out, word_phone_ranges)

        # auxiliary CTC loss
        ctc_loss = self.ctc_aligner.ctc_loss(frame_feats, phoneme_tokens, frame_lengths)

        out = {
            "predictions": predictions,
            "ctc_loss": ctc_loss,
            "graph_embeddings": graph_out,
        }
        if return_alignments:
            out["alignments"] = alignments_list
        return out

    @classmethod
    def from_config_path(cls, path: str) -> "PronunciationAssessmentModel":
        import yaml

        with open(path, encoding="utf-8") as f:
            config = yaml.safe_load(f)
        return cls(config)
