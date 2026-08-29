"""Voice activity detection and speech window extraction."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

NOISE_FLOOR_DB = -65.0

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


class RmsVad:
    """VAD based on RMS noise floor."""

    def __init__(self, threshold_db: float = NOISE_FLOOR_DB) -> None:
        self.threshold_lin = 10.0 ** (threshold_db / 20.0)

    def is_speech(self, audio: np.ndarray, sample_rate: int = SAMPLE_RATE, min_ratio: float = 0.3) -> bool:
        if len(audio) == 0:
            return False
        frame_len = int(sample_rate * 0.05)
        if len(audio) < frame_len:
            rms = np.sqrt(np.mean(audio ** 2) + 1e-12)
            return bool(rms > self.threshold_lin)
            
        n_frames = len(audio) // frame_len
        trimmed = audio[: n_frames * frame_len]
        frames = trimmed.reshape(n_frames, frame_len)
        rms = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)
        speech_frames = np.sum(rms > self.threshold_lin)
        return (speech_frames / n_frames) >= min_ratio

    def get_timestamps(self, audio: np.ndarray, sample_rate: int = SAMPLE_RATE) -> list[dict]:
        if len(audio) == 0:
            return []
        frame_len = int(sample_rate * 0.05)
        n_frames = max(1, len(audio) // frame_len)
        trimmed = audio[: n_frames * frame_len]
        frames = trimmed.reshape(n_frames, frame_len)
        rms = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)
        
        is_speech = rms > self.threshold_lin
        
        stamps = []
        in_speech = False
        start_frame = 0
        for i, speech in enumerate(is_speech):
            if speech and not in_speech:
                in_speech = True
                start_frame = i
            elif not speech and in_speech:
                in_speech = False
                stamps.append({
                    "start": start_frame * frame_len,
                    "end": i * frame_len
                })
        if in_speech:
            stamps.append({
                "start": start_frame * frame_len,
                "end": len(audio)
            })
        return stamps


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
