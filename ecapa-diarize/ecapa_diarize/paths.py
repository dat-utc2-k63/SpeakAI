"""Local paths for bundled pretrained models."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRETRAINED = ROOT / "pretrained_models"
ECAPA_DIR = PRETRAINED / "spkrec-ecapa-voxceleb"
TORCH_HUB_DIR = PRETRAINED / "torch_hub"
MODEL_ID = "speechbrain/spkrec-ecapa-voxceleb"
