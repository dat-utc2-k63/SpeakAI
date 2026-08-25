"""Resolve compute device for inference (GPU / CPU)."""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

import torch


def resolve_device(
    config: Optional[Dict[str, Any]] = None,
    explicit: Optional[str] = None,
) -> str:
    """Prefer explicit arg → env → config → auto cuda/cpu."""
    if explicit:
        return _normalize(explicit)

    for key in ("DEVICE", "TORCH_DEVICE", "HF_DEVICE"):
        if os.getenv(key):
            return _normalize(os.getenv(key))

    cfg = config or {}
    inf = cfg.get("inference") or {}
    if inf.get("device"):
        return _normalize(inf["device"])

    proj = cfg.get("project") or {}
    if proj.get("device"):
        return _normalize(proj["device"])

    return "cuda" if torch.cuda.is_available() else "cpu"


def _normalize(device: str) -> str:
    device = device.strip().lower()
    if device in ("gpu", "cuda", "cuda:0"):
        return "cuda" if torch.cuda.is_available() else "cpu"
    if device.startswith("cuda") and not torch.cuda.is_available():
        return "cpu"
    return device
