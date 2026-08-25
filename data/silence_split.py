"""Split audio into speech segments at silence boundaries."""

from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import torch

from data.audio_preprocess import PreprocessConfig, frame_rms, load_waveform, save_audio_file, trim_silence_edges

PathLike = Union[str, Path]


@dataclass
class SilenceSplitConfig:
    min_silence_sec: float = 0.45
    silence_thresh_db: float = -35.0
    min_segment_sec: float = 0.4
    max_segment_sec: Optional[float] = None
    padding_sec: float = 0.08
    frame_ms: float = 25.0
    hop_ms: float = 10.0
    trim_edges: bool = True
    trim_min_sec: float = 0.05

    @classmethod
    def from_dict(cls, cfg: Optional[dict]) -> "SilenceSplitConfig":
        if not cfg:
            return cls()
        fields = cls.__dataclass_fields__
        return cls(**{k: v for k, v in cfg.items() if k in fields})


def split_waveform(
    wav: torch.Tensor,
    sample_rate: int,
    cfg: Optional[SilenceSplitConfig] = None,
) -> List[Dict[str, float]]:
    """Return [{start_sec, end_sec}, ...] speech segments."""
    cfg = cfg or SilenceSplitConfig()
    if wav.numel() == 0:
        return []

    rms = frame_rms(wav, sample_rate, cfg.frame_ms, cfg.hop_ms)
    ref = rms.max().clamp(min=1e-8)
    thresh = ref * (10 ** (cfg.silence_thresh_db / 20.0))
    speech = rms >= thresh

    hop_sec = cfg.hop_ms / 1000.0
    min_silence_frames = max(1, int(cfg.min_silence_sec / hop_sec))
    min_seg_samples = int(cfg.min_segment_sec * sample_rate)
    pad_samples = int(cfg.padding_sec * sample_rate)
    max_samples = int(cfg.max_segment_sec * sample_rate) if cfg.max_segment_sec else None

    boundaries = [0]
    n = len(speech)
    i = 0
    while i < n:
        if not speech[i]:
            j = i
            while j < n and not speech[j]:
                j += 1
            if j - i >= min_silence_frames:
                split_sample = int((i + (j - i) // 2) * hop_sec * sample_rate)
                if split_sample > boundaries[-1] + min_seg_samples:
                    boundaries.append(split_sample)
            i = j
        else:
            i += 1
    boundaries.append(wav.shape[0])

    segments: List[Dict[str, float]] = []
    for start, end in zip(boundaries[:-1], boundaries[1:]):
        s = max(0, start - pad_samples)
        e = min(wav.shape[0], end + pad_samples)
        if e - s < min_seg_samples:
            continue
        if max_samples and e - s > max_samples:
            while e - s > max_samples:
                segments.append({
                    "start_sec": round(s / sample_rate, 3),
                    "end_sec": round((s + max_samples) / sample_rate, 3),
                })
                s += max_samples
        segments.append({
            "start_sec": round(s / sample_rate, 3),
            "end_sec": round(e / sample_rate, 3),
        })

    if not segments:
        segments.append({"start_sec": 0.0, "end_sec": round(wav.shape[0] / sample_rate, 3)})
    return segments


def split_active_regions(
    wav: torch.Tensor,
    sample_rate: int,
    cfg: Optional[SilenceSplitConfig] = None,
) -> List[Dict[str, float]]:
    """Split diarized tracks (zero-padded between turns) on amplitude gaps."""
    cfg = cfg or SilenceSplitConfig()
    if wav.numel() == 0:
        return []

    mono = wav if wav.dim() == 1 else wav.mean(0)
    peak = float(mono.abs().max())
    if peak < 1e-6:
        return [{"start_sec": 0.0, "end_sec": round(mono.shape[0] / sample_rate, 3)}]

    thresh = peak * (10 ** (cfg.silence_thresh_db / 20.0))
    active = mono.abs() >= thresh
    min_seg = int(cfg.min_segment_sec * sample_rate)
    pad = int(cfg.padding_sec * sample_rate)

    segments: List[Dict[str, float]] = []
    n = mono.shape[0]
    i = 0
    while i < n:
        while i < n and not active[i]:
            i += 1
        if i >= n:
            break
        start = i
        while i < n and active[i]:
            i += 1
        end = i
        if end - start < min_seg:
            continue
        s = max(0, start - pad)
        e = min(n, end + pad)
        segments.append({
            "start_sec": round(s / sample_rate, 3),
            "end_sec": round(e / sample_rate, 3),
        })

    if not segments:
        segments.append({"start_sec": 0.0, "end_sec": round(n / sample_rate, 3)})
    return segments


def _is_sparse_track(wav: torch.Tensor) -> bool:
    """True when many samples are near-zero (typical after 2-speaker diarization)."""
    mono = wav if wav.dim() == 1 else wav.mean(0)
    if mono.numel() == 0:
        return False
    return float((mono.abs() < 1e-5).float().mean()) > 0.2


def export_segments(
    wav: torch.Tensor,
    sample_rate: int,
    segments: List[Dict[str, float]],
    output_dir: PathLike,
    prefix: str = "sent",
    *,
    split_cfg: Optional[SilenceSplitConfig] = None,
) -> List[Dict[str, Any]]:
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    cfg = split_cfg or SilenceSplitConfig()
    min_samples = int(cfg.min_segment_sec * sample_rate)
    trim_min_samples = int(cfg.trim_min_sec * sample_rate)
    exported: List[Dict[str, Any]] = []

    for seg in segments:
        s = int(seg["start_sec"] * sample_rate)
        e = int(seg["end_sec"] * sample_rate)
        clip = wav[s:e].contiguous()

        trim_start = trim_end = 0
        if cfg.trim_edges:
            clip, trim_start, trim_end = trim_silence_edges(
                clip,
                sample_rate,
                thresh_db=cfg.silence_thresh_db,
                frame_ms=cfg.frame_ms,
                hop_ms=cfg.hop_ms,
                min_samples=trim_min_samples,
            )

        if clip.numel() < min_samples:
            continue

        idx = len(exported)
        path = out / f"{prefix}_{idx:03d}.wav"
        save_audio_file(path, clip.unsqueeze(0), sample_rate)
        duration = round(clip.shape[0] / sample_rate, 3)
        exported.append({
            "index": idx,
            "start_sec": round(seg["start_sec"] + trim_start / sample_rate, 3),
            "end_sec": round(seg["end_sec"] - trim_end / sample_rate, 3),
            "duration_sec": duration,
            "path": str(path),
            "preprocessed": True,
        })

    if not exported and wav.numel() > 0:
        mono = wav if wav.dim() == 1 else wav.mean(0)
        min_samples = int(cfg.min_segment_sec * sample_rate)
        if mono.numel() >= min_samples:
            path = out / f"{prefix}_000.wav"
            save_audio_file(path, mono.unsqueeze(0), sample_rate)
            exported.append({
                "index": 0,
                "start_sec": 0.0,
                "end_sec": round(mono.shape[0] / sample_rate, 3),
                "duration_sec": round(mono.shape[0] / sample_rate, 3),
                "path": str(path),
                "preprocessed": True,
            })
    return exported


def export_diarization_clips(
    source_audio: PathLike,
    diarize_segments: list,
    output_dir: PathLike,
    speaker_key: str,
    preprocess: Optional[PreprocessConfig] = None,
    *,
    merge_gap_sec: float = 0.35,
    min_duration_sec: float = 0.2,
    prefix: str = "sent",
) -> List[Dict[str, Any]]:
    """Cut clips from original audio using ECAPA diarization time spans."""
    label_map = {
        "A": "Speaker A",
        "B": "Speaker B",
        "TEACHER": "Teacher",
        "T": "Teacher",
        "STUDENT": "Student",
        "S": "Student",
    }
    label = label_map.get(speaker_key.upper(), speaker_key)
    spans: List[tuple[float, float]] = []
    for s in diarize_segments:
        sp = getattr(s, "speaker", None)
        if sp is None and isinstance(s, dict):
            sp = s.get("speaker")
        if sp != label:
            continue
        start = float(getattr(s, "start", 0) if not isinstance(s, dict) else s.get("start", 0))
        end = float(getattr(s, "end", 0) if not isinstance(s, dict) else s.get("end", 0))
        if end > start:
            spans.append((start, end))
    spans.sort()
    merged: List[tuple[float, float]] = []
    for start, end in spans:
        if end <= start:
            continue
        if merged and start - merged[-1][1] <= merge_gap_sec:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))

    preprocess = preprocess or PreprocessConfig()
    track_preprocess = replace(preprocess, denoise=False)
    wav = load_waveform(source_audio, track_preprocess)
    sr = track_preprocess.sample_rate
    mono = wav if wav.dim() == 1 else wav.mean(0)

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    min_samples = int(min_duration_sec * sr)
    exported: List[Dict[str, Any]] = []

    for start, end in merged:
        s = max(0, int(start * sr))
        e = min(mono.shape[0], int(end * sr))
        clip = mono[s:e].contiguous()
        if clip.numel() < min_samples:
            continue
        idx = len(exported)
        path = out / f"{prefix}_{idx:03d}.wav"
        save_audio_file(path, clip.unsqueeze(0), sr)
        exported.append({
            "index": idx,
            "start_sec": round(s / sr, 3),
            "end_sec": round(e / sr, 3),
            "duration_sec": round(clip.shape[0] / sr, 3),
            "path": str(path),
            "preprocessed": True,
        })
    return exported


def split_audio_file(
    audio_path: PathLike,
    output_dir: PathLike,
    preprocess: Optional[PreprocessConfig] = None,
    split_cfg: Optional[dict] = None,
    prefix: str = "sent",
) -> List[Dict[str, Any]]:
    preprocess = preprocess or PreprocessConfig()
    cfg = SilenceSplitConfig.from_dict(split_cfg)
    wav = load_waveform(audio_path, preprocess)
    sr = preprocess.sample_rate
    mono = wav if wav.dim() == 1 else wav.mean(0)
    if _is_sparse_track(mono):
        segments = split_active_regions(mono, sr, cfg)
        return export_segments(mono, sr, segments, output_dir, prefix, split_cfg=cfg)
    segments = split_waveform(wav, sr, cfg)
    return export_segments(wav, sr, segments, output_dir, prefix, split_cfg=cfg)
