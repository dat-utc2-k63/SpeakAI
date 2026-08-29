"""Project root paths — import from anywhere after sys.path includes repo root."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIGS = ROOT / "configs"
PRONUNCIATION_CONFIG = CONFIGS / "pronunciation.yaml"

TRANSFORMER_MODELS = ROOT / "transformer_models"
SPEAKER_DIARIZE_DIR = ROOT / "speaker-diarize"
LOGS_DIR = ROOT / "logs"
WEB_UPLOADS = ROOT / "web" / "uploads"
TEACHER_REFERENCE_DIR = WEB_UPLOADS / "teacher_reference"
