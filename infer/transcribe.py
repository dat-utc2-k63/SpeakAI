"""Speech-to-text for automatic transcript (Whisper)."""

from __future__ import annotations

import re
import threading
from pathlib import Path
from typing import Any, Dict, Optional, Union

import torch
import torchaudio
from data.audio_preprocess import load_audio_file
import yaml

from infer.device_utils import resolve_device
from paths import PRONUNCIATION_CONFIG

PathLike = Union[str, Path]
WHISPER_SR = 16000
WHISPER_CHUNK_SEC = 30.0

_transcriber: Optional["WhisperTranscriber"] = None
_transcriber_error: Optional[str] = None
_lock = threading.Lock()


def _normalize_transcript(text: str) -> str:
    text = re.sub(r"[^\w\s']", " ", text.upper())
    return " ".join(text.split())


def _load_asr_config() -> Dict[str, Any]:
    if PRONUNCIATION_CONFIG.is_file():
        with open(PRONUNCIATION_CONFIG, encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
        return cfg.get("asr") or {}
    return {}


def _parse_dtype(name: Optional[str], device: torch.device) -> torch.dtype:
    if device.type != "cuda":
        return torch.float32
    if not name or name == "float16":
        return torch.float16
    if name == "bfloat16":
        return torch.bfloat16
    return torch.float32


class WhisperTranscriber:
    """Whisper ASR — default: whisper-small.en (English, CPU-friendly)."""

    def __init__(
        self,
        model_name: str = "openai/whisper-small.en",
        language: str = "en",
        device: Optional[str] = None,
        load_progress: Optional[Any] = None,
        torch_dtype: Optional[str] = "float16",
        max_new_tokens: int = 448,
    ):
        from transformers import WhisperForConditionalGeneration, WhisperProcessor

        asr_cfg = _load_asr_config()
        self.device = torch.device(
            device or resolve_device({"asr": asr_cfg}, asr_cfg.get("device"))
        )
        self.language = language
        self.max_new_tokens = max_new_tokens
        self.model_name = model_name
        dtype = _parse_dtype(torch_dtype, self.device)

        if load_progress is not None:
            load_progress.start("whisper_proc", model_name)
        self.processor = WhisperProcessor.from_pretrained(model_name)
        if load_progress is not None:
            load_progress.finish("whisper_proc", model_name)
            load_progress.start("whisper_model", model_name)

        load_kw: Dict[str, Any] = {}
        if self.device.type == "cuda" and dtype != torch.float32:
            load_kw["torch_dtype"] = dtype

        self.model = WhisperForConditionalGeneration.from_pretrained(model_name, **load_kw)
        self.model.to(self.device)
        self.model.eval()

        if load_progress is not None:
            load_progress.finish("whisper_model", model_name)

    def _generate(self, input_features: torch.Tensor) -> torch.Tensor:
        name = self.model_name.lower()
        max_tokens = self.max_new_tokens

        if name.endswith(".en"):
            # English-only checkpoints: no language/task prefix tokens
            return self.model.generate(input_features, max_new_tokens=max_tokens)

        if "large-v3" in name or "large-v2" in name:
            return self.model.generate(
                input_features,
                max_new_tokens=max_tokens,
                language=self.language,
                task="transcribe",
            )

        # Multilingual (medium/small/tiny): forced_decoder_ids uses ~4 prefix tokens
        max_tokens = min(max_tokens, 444)
        return self.model.generate(
            input_features,
            max_new_tokens=max_tokens,
            forced_decoder_ids=self.processor.get_decoder_prompt_ids(
                language=self.language, task="transcribe"
            ),
        )

    def _transcribe_waveform(self, wav: torch.Tensor) -> str:
        inputs = self.processor(wav.numpy(), sampling_rate=WHISPER_SR, return_tensors="pt")
        input_features = inputs.input_features.to(self.device)
        if self.device.type == "cuda" and input_features.dtype == torch.float32:
            input_features = input_features.half()
        ids = self._generate(input_features)
        return self.processor.batch_decode(ids, skip_special_tokens=True)[0]

    @torch.inference_mode()
    def transcribe(self, audio_path: PathLike) -> str:
        wav, sr = load_audio_file(audio_path)
        wav = wav.mean(0)
        if sr != WHISPER_SR:
            wav = torchaudio.functional.resample(wav, sr, WHISPER_SR)

        chunk_samples = int(WHISPER_CHUNK_SEC * WHISPER_SR)
        if wav.shape[0] <= chunk_samples:
            text = self._transcribe_waveform(wav)
        else:
            parts = []
            for start in range(0, wav.shape[0], chunk_samples):
                parts.append(self._transcribe_waveform(wav[start : start + chunk_samples]))
            text = " ".join(parts)

        normalized = _normalize_transcript(text)
        if not normalized:
            raise ValueError("Không nhận diện được lời nói trong audio")
        return normalized


def get_transcriber(load_progress: Optional[Any] = None) -> WhisperTranscriber:
    global _transcriber, _transcriber_error
    if _transcriber is not None:
        return _transcriber
    if _transcriber_error:
        raise RuntimeError(_transcriber_error)
    with _lock:
        if _transcriber is not None:
            return _transcriber
        if _transcriber_error:
            raise RuntimeError(_transcriber_error)
        try:
            asr = _load_asr_config()
            _transcriber = WhisperTranscriber(
                model_name=asr.get("model_name", "openai/whisper-small.en"),
                language=asr.get("language", "en"),
                device=asr.get("device"),
                load_progress=load_progress,
                torch_dtype=asr.get("torch_dtype", "float16"),
                max_new_tokens=int(asr.get("max_new_tokens", 448)),
            )
        except Exception as exc:
            _transcriber_error = str(exc)
            if load_progress is not None:
                load_progress.fail_running(str(exc))
            raise RuntimeError(_transcriber_error) from exc
        return _transcriber


def transcribe_audio(audio_path: PathLike) -> str:
    return get_transcriber().transcribe(audio_path)
