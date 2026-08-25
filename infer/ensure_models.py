"""Download ECAPA + Silero at startup when not bundled in the repo (HF Spaces)."""

from __future__ import annotations

import sys
from pathlib import Path

from paths import ECAPA_DIR

ECAPA_WEIGHTS = ECAPA_DIR / "pretrained_models" / "spkrec-ecapa-voxceleb" / "hyperparams.yaml"
TORCH_HUB_DIR = ECAPA_DIR / "pretrained_models" / "torch_hub"


def _silero_ready() -> bool:
    if not TORCH_HUB_DIR.exists():
        return False
    return bool(list(TORCH_HUB_DIR.glob("snakers4_silero-vad*")))


def ensure_pretrained_models() -> None:
    if ECAPA_WEIGHTS.is_file() and _silero_ready():
        return

    if str(ECAPA_DIR) not in sys.path:
        sys.path.insert(0, str(ECAPA_DIR))

    from scripts.download_models import download_ecapa, download_silero

    if not ECAPA_WEIGHTS.is_file():
        download_ecapa()
    if not _silero_ready():
        download_silero()
