"""
WavLM Large feature extractor.

Step 1 of pipeline: waveform -> frame-level hidden states (B, T, D).
Supports frozen backbone or LoRA fine-tuning via PEFT.
"""

from __future__ import annotations

from contextlib import nullcontext
from typing import Optional

import torch
import torch.nn as nn
from transformers import WavLMModel


class WavLMEncoder(nn.Module):
    """
    Wraps `microsoft/wavlm-large` for pronunciation feature extraction.

    Output: frame-level representations at ~20ms stride (50 Hz for 16kHz audio
    with conv subsampling factor 320: 16000/320 = 50 frames/sec).
    """

    def __init__(
        self,
        model_name: str = "microsoft/wavlm-large",
        freeze: bool = True,
        use_lora: bool = False,
        lora_r: int = 8,
        lora_alpha: int = 16,
        lora_dropout: float = 0.05,
        lora_target_modules: Optional[list] = None,
    ):
        super().__init__()
        self.wavlm = WavLMModel.from_pretrained(model_name)
        self.output_dim = self.wavlm.config.hidden_size  # 1024 for large

        if freeze and not use_lora:
            for p in self.wavlm.parameters():
                p.requires_grad = False
            self.wavlm.eval()

        self._frozen = freeze and not use_lora

        if use_lora:
            from peft import LoraConfig, get_peft_model

            target = lora_target_modules or ["q_proj", "v_proj"]
            lora_config = LoraConfig(
                r=lora_r,
                lora_alpha=lora_alpha,
                target_modules=target,
                lora_dropout=lora_dropout,
                bias="none",
            )
            self.wavlm = get_peft_model(self.wavlm, lora_config)

    def forward(
        self,
        waveform: torch.Tensor,
        wav_lengths: Optional[torch.Tensor] = None,
        attention_mask: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        """
        Args:
            waveform: (B, num_samples) float tensor, 16kHz mono.
            wav_lengths: (B,) actual sample counts before padding.
            attention_mask: optional (B, num_samples), 1=valid 0=pad.

        Returns:
            hidden_states: (B, T_frames, D) last hidden layer output.
        """
        if attention_mask is None:
            B, S = waveform.shape
            if wav_lengths is not None:
                attention_mask = (
                    torch.arange(S, device=waveform.device).unsqueeze(0)
                    < wav_lengths.unsqueeze(1)
                ).long()
            else:
                # padded batch: trailing zeros from pad_sequence
                attention_mask = (waveform.abs() > 1e-8).long()

        if self._frozen:
            self.wavlm.eval()

        ctx = torch.inference_mode if self._frozen else nullcontext
        with ctx():
            outputs = self.wavlm(
                input_values=waveform,
                attention_mask=attention_mask,
            )
        return outputs.last_hidden_state

    def frame_lengths_from_samples(self, wav_lengths: torch.Tensor) -> torch.Tensor:
        """Exact WavLM frame counts from raw sample lengths (not samples//320)."""
        return self.wavlm._get_feat_extract_output_lengths(wav_lengths).long()

    def frame_rate(self, sample_rate: int = 16000) -> float:
        """Approximate frame rate (Hz) of WavLM output."""
        # WavLM conv feature extractor: total stride 320 samples
        return sample_rate / 320.0
