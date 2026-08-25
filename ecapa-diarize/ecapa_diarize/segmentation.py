"""Voice activity detection and speech window extraction."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import torch

from ecapa_diarize.paths import TORCH_HUB_DIR

SAMPLE_RATE = 16000


@dataclass
class SpeechWindow:
    audio: np.ndarray
    start_sample: int
    end_sample: int

    @property
    def start_sec(self) -> float:
        return self.start_sample / SAMPLE_RATE

    @property
    def end_sec(self) -> float:
        return self.end_sample / SAMPLE_RATE


class SileroVAD:
    """Silero VAD loaded from local torch hub cache."""

    def __init__(self, threshold: float = 0.5) -> None:
        if not TORCH_HUB_DIR.exists():
            raise FileNotFoundError(
                f"Silero VAD chưa có tại {TORCH_HUB_DIR}. "
                "Chạy: python scripts/download_models.py"
            )
        torch.hub.set_dir(str(TORCH_HUB_DIR))
        self.threshold = threshold
        self._model, self._utils = torch.hub.load(
            "snakers4/silero-vad",
            "silero_vad",
            trust_repo=True,
        )
        self._get_speech_timestamps = self._utils[0]

    def is_speech(self, audio: np.ndarray, sample_rate: int = SAMPLE_RATE, min_ratio: float = 0.3) -> bool:
        if len(audio) == 0:
            return False
        wav = torch.from_numpy(audio.astype(np.float32))
        stamps = self._get_speech_timestamps(
            wav, self._model, sampling_rate=sample_rate, threshold=self.threshold
        )
        if not stamps:
            return False
        speech_samples = sum(s["end"] - s["start"] for s in stamps)
        return (speech_samples / len(audio)) >= min_ratio

    def get_timestamps(self, audio: np.ndarray, sample_rate: int = SAMPLE_RATE) -> list[dict]:
        if len(audio) == 0:
            return []
        wav = torch.from_numpy(audio.astype(np.float32))
        return self._get_speech_timestamps(
            wav, self._model, sampling_rate=sample_rate, threshold=self.threshold
        )


class SlidingWindowBuffer:
    """Accumulate mic chunks and emit overlapping speech windows."""

    def __init__(
        self,
        window_sec: float = 1.5,
        step_sec: float = 0.5,
        min_speech_sec: float = 0.5,
        sample_rate: int = SAMPLE_RATE,
    ) -> None:
        self.window_samples = int(window_sec * sample_rate)
        self.step_samples = int(step_sec * sample_rate)
        self.min_speech_samples = int(min_speech_sec * sample_rate)
        self._buffer = np.array([], dtype=np.float32)
        self._total_samples = 0
        self._next_emit = 0

    def push(self, chunk: np.ndarray) -> list[SpeechWindow]:
        if chunk.size == 0:
            return []
        self._buffer = np.concatenate([self._buffer, chunk.astype(np.float32)])
        windows: list[SpeechWindow] = []

        while self._total_samples + len(self._buffer) - self._next_emit >= self.window_samples:
            start = self._next_emit
            end = start + self.window_samples
            if end > self._total_samples + len(self._buffer):
                break
            rel_start = start - self._total_samples
            audio = self._buffer[rel_start : rel_start + self.window_samples].copy()
            windows.append(SpeechWindow(audio=audio, start_sample=start, end_sample=end))
            self._next_emit += self.step_samples

        consumed = self._next_emit - self._total_samples
        if consumed > 0:
            self._buffer = self._buffer[consumed:]
            self._total_samples = self._next_emit

        return [w for w in windows if len(w.audio) >= self.min_speech_samples]

    def iter_windows(self, audio: np.ndarray) -> list[SpeechWindow]:
        """Generate sliding windows over a full waveform."""
        windows: list[SpeechWindow] = []
        offset = 0
        while offset + self.window_samples <= len(audio):
            chunk = audio[offset : offset + self.window_samples]
            windows.append(
                SpeechWindow(
                    audio=chunk.copy(),
                    start_sample=offset,
                    end_sample=offset + self.window_samples,
                )
            )
            offset += self.step_samples
        return [w for w in windows if len(w.audio) >= self.min_speech_samples]
