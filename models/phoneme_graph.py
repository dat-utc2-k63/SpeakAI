"""
Graph Attention Network over phoneme nodes.

Step 4: build per-utterance phoneme graph and apply GATv2Conv layers.

Graph construction per utterance:
  - Nodes: one per phoneme instance, initial feature = pooled frame embedding
    from CTC alignment (see ctc_aligner._pool_node_features).
  - Edges:
      * Sequential: (i, i+1) bidirectional — captures coarticulation context.
      * Same-word: all phoneme pairs within one word — captures lexical stress.
      * Same-syllable (optional): pairs within syllable group.

After GAT message passing, each node has context-aware embedding used by
multi-task regression heads at phoneme level; word/utterance levels pool
these node embeddings.
"""

from __future__ import annotations

from typing import List, Optional, Tuple

import torch
import torch.nn as nn

try:
    from torch_geometric.nn import GATv2Conv
except ImportError:
    GATv2Conv = None


class PhonemeGraphNetwork(nn.Module):
    """GATv2-based phoneme graph encoder."""

    def __init__(
        self,
        input_dim: int,
        hidden_dim: int = 256,
        num_layers: int = 2,
        num_heads: int = 4,
        dropout: float = 0.1,
        edge_sequential: bool = True,
        edge_same_word: bool = True,
        edge_same_syllable: bool = False,
    ):
        super().__init__()
        if GATv2Conv is None:
            raise ImportError("torch_geometric is required for PhonemeGraphNetwork")

        self.input_proj = nn.Linear(input_dim, hidden_dim)
        self.edge_sequential = edge_sequential
        self.edge_same_word = edge_same_word
        self.edge_same_syllable = edge_same_syllable

        self.gat_layers = nn.ModuleList()
        for i in range(num_layers):
            in_ch = hidden_dim
            out_ch = hidden_dim // num_heads
            self.gat_layers.append(
                GATv2Conv(
                    in_channels=in_ch,
                    out_channels=out_ch,
                    heads=num_heads,
                    dropout=dropout,
                    concat=True,
                )
            )
        self.norm = nn.LayerNorm(hidden_dim)
        self.dropout = nn.Dropout(dropout)
        self.output_dim = hidden_dim

    @staticmethod
    def build_edge_index(
        num_phonemes: int,
        word_phone_ranges: List[Tuple[int, int]],
        sequential: bool = True,
        same_word: bool = True,
        same_syllable: bool = False,
    ) -> torch.Tensor:
        """
        Build COO edge_index (2, E) for one utterance.

        Args:
            num_phonemes: total phoneme count.
            word_phone_ranges: list of (start, end) exclusive indices per word.
        """
        edges = set()

        if sequential:
            for i in range(num_phonemes - 1):
                edges.add((i, i + 1))
                edges.add((i + 1, i))

        if same_word:
            for start, end in word_phone_ranges:
                for i in range(start, end):
                    for j in range(start, end):
                        if i != j:
                            edges.add((i, j))

        if same_syllable:
            # simple heuristic: split each word's phones in half
            for start, end in word_phone_ranges:
                mid = (start + end) // 2
                for i in range(start, mid):
                    for j in range(start, mid):
                        if i != j:
                            edges.add((i, j))
                for i in range(mid, end):
                    for j in range(mid, end):
                        if i != j:
                            edges.add((i, j))

        if not edges:
            # self-loop fallback for single phoneme
            edges.add((0, 0))

        src, dst = zip(*edges)
        return torch.tensor([src, dst], dtype=torch.long)

    def forward_single(
        self,
        node_features: torch.Tensor,
        word_phone_ranges: List[Tuple[int, int]],
    ) -> torch.Tensor:
        """
        Args:
            node_features: (N, D) pooled phoneme embeddings from CTC align step.
            word_phone_ranges: phoneme index ranges per word.

        Returns:
            (N, hidden_dim) context-enriched phoneme embeddings.
        """
        x = self.input_proj(node_features)
        edge_index = self.build_edge_index(
            node_features.shape[0],
            word_phone_ranges,
            self.edge_sequential,
            self.edge_same_word,
            self.edge_same_syllable,
        ).to(node_features.device)

        for gat in self.gat_layers:
            x = gat(x, edge_index)
            x = self.dropout(torch.relu(x))
        return self.norm(x)

    def forward_batch(
        self,
        node_features_list: List[torch.Tensor],
        word_phone_ranges_list: List[List[Tuple[int, int]]],
    ) -> List[torch.Tensor]:
        """Process variable-size graphs per utterance."""
        outputs = []
        for nodes, ranges in zip(node_features_list, word_phone_ranges_list):
            if nodes.shape[0] == 0:
                outputs.append(nodes.new_zeros(0, self.output_dim))
            else:
                outputs.append(self.forward_single(nodes, ranges))
        return outputs
