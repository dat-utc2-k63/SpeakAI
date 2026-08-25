"""Shared audio preprocessing: resample → high-pass → denoise → speech-aware peak normalize."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple, Union

import torch
import torchaudio

PathLike = Union[str, Path]


def load_audio_file(path: PathLike) -> Tuple[torch.Tensor, int]:
    """Load audio as float tensor [channels, samples] without torchcodec."""
    import soundfile as sf

    data, sr = sf.read(str(path), dtype="float32")
    if data.ndim == 1:
        wav = torch.from_numpy(data).unsqueeze(0)
    else:
        wav = torch.from_numpy(data.T.copy())
    return wav, int(sr)


def save_audio_file(path: PathLike, wav: torch.Tensor, sample_rate: int) -> None:
    """Save audio tensor [channels, samples] without torchcodec."""
    import soundfile as sf

    x = wav.detach().cpu()
    if x.ndim == 1:
        data = x.numpy()
    elif x.ndim == 2:
        data = x.T.numpy()
    else:
        raise ValueError(f"Unexpected wav shape {tuple(x.shape)}")
    sf.write(str(path), data, sample_rate, subtype="FLOAT")


@dataclass
class PreprocessConfig:
    sample_rate: int = 16000
    peak_normalize: bool = True
    target_peak: float = 0.95
    highpass_hz: float = 80.0
    denoise: bool = False
    denoise_prop: float = 0.75
    speech_normalize: bool = True
    speech_thresh_db: float = -35.0
    vad_frame_ms: float = 25.0
    vad_hop_ms: float = 10.0

    @classmethod
    def from_dict(cls, cfg: Optional[dict]) -> "PreprocessConfig":
        if not cfg:
            return cls()
        fields = cls.__dataclass_fields__
        return cls(**{k: v for k, v in cfg.items() if k in fields})


def _to_mono(wav: torch.Tensor) -> torch.Tensor:
    return wav.mean(0) if wav.dim() > 1 else wav


def _resample(wav: torch.Tensor, sr: int, target_sr: int) -> torch.Tensor:
    if sr == target_sr:
        return wav
    return torchaudio.functional.resample(wav, sr, target_sr)


def _highpass(wav: torch.Tensor, sr: int, cutoff: float) -> torch.Tensor:
    if cutoff <= 0:
        return wav
    return torchaudio.functional.highpass_biquad(wav.unsqueeze(0), sr, cutoff).squeeze(0)


def frame_rms(
    wav: torch.Tensor,
    sample_rate: int,
    frame_ms: float = 25.0,
    hop_ms: float = 10.0,
) -> torch.Tensor:
    frame_len = max(1, int(sample_rate * frame_ms / 1000))
    hop = max(1, int(sample_rate * hop_ms / 1000))
    if wav.numel() < frame_len:
        return torch.tensor([wav.pow(2).mean().sqrt()])
    frames = wav.unfold(0, frame_len, hop)
    return torch.sqrt(frames.pow(2).mean(dim=1) + 1e-10)


def speech_frame_mask(
    wav: torch.Tensor,
    sample_rate: int,
    *,
    thresh_db: float = -35.0,
    frame_ms: float = 25.0,
    hop_ms: float = 10.0,
) -> torch.Tensor:
    """Boolean mask per analysis frame (True = speech)."""
    if wav.numel() == 0:
        return torch.zeros(0, dtype=torch.bool)
    rms = frame_rms(wav, sample_rate, frame_ms, hop_ms)
    ref = rms.max().clamp(min=1e-8)
    thresh = ref * (10 ** (thresh_db / 20.0))
    return rms >= thresh


def speech_sample_mask(
    wav: torch.Tensor,
    sample_rate: int,
    *,
    thresh_db: float = -35.0,
    frame_ms: float = 25.0,
    hop_ms: float = 10.0,
) -> torch.Tensor:
    """Expand frame-level speech mask to per-sample boolean mask."""
    n = wav.shape[0]
    if n == 0:
        return torch.zeros(0, dtype=torch.bool)
    frame_len = max(1, int(sample_rate * frame_ms / 1000))
    hop = max(1, int(sample_rate * hop_ms / 1000))
    frames = speech_frame_mask(wav, sample_rate, thresh_db=thresh_db, frame_ms=frame_ms, hop_ms=hop_ms)
    mask = torch.zeros(n, dtype=torch.bool)
    for i, is_speech in enumerate(frames):
        start = i * hop
        end = min(n, start + frame_len)
        if is_speech:
            mask[start:end] = True
    return mask


def trim_silence_edges(
    wav: torch.Tensor,
    sample_rate: int,
    *,
    thresh_db: float = -35.0,
    frame_ms: float = 25.0,
    hop_ms: float = 10.0,
    min_samples: int = 0,
) -> Tuple[torch.Tensor, int, int]:
    """Trim leading/trailing non-speech. Returns (clip, start_offset, end_offset) in samples."""
    n = wav.shape[0]
    if n == 0:
        return wav, 0, 0

    frames = speech_frame_mask(wav, sample_rate, thresh_db=thresh_db, frame_ms=frame_ms, hop_ms=hop_ms)
    speech_idx = torch.nonzero(frames, as_tuple=False).flatten()
    if speech_idx.numel() == 0:
        return wav, 0, 0

    hop = max(1, int(sample_rate * hop_ms / 1000))
    frame_len = max(1, int(sample_rate * frame_ms / 1000))
    first = int(speech_idx[0].item()) * hop
    last = min(n, int(speech_idx[-1].item()) * hop + frame_len)

    if last - first < min_samples:
        return wav, 0, 0
    return wav[first:last].contiguous(), first, n - last


def _peak_normalize(
    wav: torch.Tensor,
    target: float,
    speech_mask: Optional[torch.Tensor] = None,
) -> torch.Tensor:
    if speech_mask is not None and speech_mask.any():
        peak = wav[speech_mask].abs().max()
    else:
        peak = wav.abs().max()
    if float(peak) < 1e-8:
        return wav
    return wav * (target / peak)


def _denoise(wav: torch.Tensor, sr: int, prop: float) -> torch.Tensor:
    try:
        import noisereduce as nr

        y = nr.reduce_noise(y=wav.detach().cpu().numpy(), sr=sr, stationary=True, prop_decrease=prop)
        return torch.from_numpy(y).to(dtype=wav.dtype, device=wav.device)
    except ImportError:
        return wav


def preprocess_waveform(
    wav: torch.Tensor,
    sample_rate: int,
    cfg: Optional[PreprocessConfig] = None,
) -> torch.Tensor:
    """Apply full chain to a mono waveform tensor."""
    cfg = cfg or PreprocessConfig()
    wav = _to_mono(wav)
    wav = _resample(wav, sample_rate, cfg.sample_rate)
    if cfg.highpass_hz > 0:
        wav = _highpass(wav, cfg.sample_rate, cfg.highpass_hz)
    if cfg.denoise:
        wav = _denoise(wav, cfg.sample_rate, cfg.denoise_prop)
    if cfg.peak_normalize:
        speech_mask = None
        if cfg.speech_normalize:
            speech_mask = speech_sample_mask(
                wav,
                cfg.sample_rate,
                thresh_db=cfg.speech_thresh_db,
                frame_ms=cfg.vad_frame_ms,
                hop_ms=cfg.vad_hop_ms,
            )
        wav = _peak_normalize(wav, cfg.target_peak, speech_mask)
    return wav.contiguous()


def load_waveform(
    path: PathLike,
    cfg: Optional[PreprocessConfig] = None,
    *,
    apply_preprocess: bool = True,
) -> torch.Tensor:
    """Load file; optionally run preprocessing chain."""
    cfg = cfg or PreprocessConfig()
    wav, sr = load_audio_file(path)
    if not apply_preprocess:
        wav = _to_mono(wav)
        wav = _resample(wav, sr, cfg.sample_rate)
        return wav.contiguous()
    return preprocess_waveform(wav, sr, cfg)


def truncate_waveform(
    wav: torch.Tensor,
    sample_rate: int,
    max_duration_sec: Optional[float],
) -> tuple[torch.Tensor, bool]:
    """Trim to max duration. None or <=0 = no limit."""
    if max_duration_sec is None or max_duration_sec <= 0:
        return wav, False
    max_samples = int(max_duration_sec * sample_rate)
    if wav.shape[0] <= max_samples:
        return wav, False
    return wav[:max_samples].contiguous(), True
