"""Audio file metadata helpers."""

from __future__ import annotations

from pathlib import Path
from typing import Union

PathLike = Union[str, Path]


def get_duration_sec(path: PathLike) -> float:
    """Return audio duration in seconds."""
    import soundfile as sf

    info = sf.info(str(path))
    return float(info.duration)
