"""Load and save audio files."""

from __future__ import annotations

from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000


def load_audio(path: str | Path) -> tuple[np.ndarray, int]:
    """Load mono float32 audio, resampled to 16 kHz if needed."""
    import soundfile as sf
    import torchaudio

    audio, sr = sf.read(str(path), dtype="float32", always_2d=True)
    mono = audio.mean(axis=1)
    if sr != SAMPLE_RATE:
        wav = torchaudio.functional.resample(
            __import__("torch").from_numpy(mono).unsqueeze(0), sr, SAMPLE_RATE
        )
        mono = wav.squeeze(0).numpy()
    return mono.astype(np.float32), SAMPLE_RATE


def save_audio(path: str | Path, audio: np.ndarray, sample_rate: int = SAMPLE_RATE) -> None:
    import soundfile as sf

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), audio, sample_rate)
