"""
Task-specific Transformer encoder stacked on WavLM features.

Step 2: refines frame-level representations for pronunciation assessment.
"""

from __future__ import annotations

import math
from typing import Optional

import torch
import torch.nn as nn


class TaskTransformerEncoder(nn.Module):
    """
    Additional Transformer encoder layers (2-4) on top of WavLM hidden states.

    Uses pre-norm TransformerEncoderLayer for training stability.
    """

    def __init__(
        self,
        input_dim: int,
        num_layers: int = 3,
        num_heads: int = 8,
        ff_dim: int = 4096,
        dropout: float = 0.1,
        max_seq_len: int = 2000,
    ):
        super().__init__()
        if input_dim % num_heads != 0:
            raise ValueError(
                f"input_dim ({input_dim}) must be divisible by num_heads ({num_heads})"
            )
        self.input_proj = nn.Linear(input_dim, input_dim)
        self.pos_encoding = SinusoidalPositionalEncoding(input_dim, max_seq_len)

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=input_dim,
            nhead=num_heads,
            dim_feedforward=ff_dim,
            dropout=dropout,
            batch_first=True,
            norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        self.output_dim = input_dim

    def forward(
        self,
        x: torch.Tensor,
        src_key_padding_mask: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        """
        Args:
            x: (B, T, D) frame features from WavLM.
            src_key_padding_mask: (B, T) True = padded frame (ignore).

        Returns:
            (B, T, D) refined frame features.
        """
        x = self.input_proj(x)
        x = self.pos_encoding(x)
        return self.encoder(x, src_key_padding_mask=src_key_padding_mask)


class SinusoidalPositionalEncoding(nn.Module):
    """Standard sinusoidal position encoding added to frame features."""

    def __init__(self, dim: int, max_len: int = 2000):
        super().__init__()
        pe = torch.zeros(max_len, dim)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(
            torch.arange(0, dim, 2, dtype=torch.float) * (-math.log(10000.0) / dim)
        )
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        self.register_buffer("pe", pe.unsqueeze(0), persistent=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        seq_len = x.size(1)
        if seq_len > self.pe.size(1):
            self._grow_pe(seq_len)
        return x + self.pe[:, :seq_len, :].to(dtype=x.dtype, device=x.device)

    def _grow_pe(self, seq_len: int) -> None:
        dim = self.pe.size(-1)
        pe = torch.zeros(seq_len, dim, device=self.pe.device, dtype=self.pe.dtype)
        position = torch.arange(0, seq_len, dtype=torch.float, device=self.pe.device).unsqueeze(1)
        div_term = torch.exp(
            torch.arange(0, dim, 2, dtype=torch.float, device=self.pe.device)
            * (-math.log(10000.0) / dim)
        )
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        self.pe = pe.unsqueeze(0)
