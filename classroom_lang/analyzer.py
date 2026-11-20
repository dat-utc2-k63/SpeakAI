"""Classroom EN/VI Language Timeline Analyzer (Acoustic LID, Denoised, Speech-Only, Whisper Turbo).

Architecture:
    Audio (data.audio_preprocess.load_waveform: 16kHz mono + 85Hz highpass)
      ↓
    Audio Denoise (speaker_diarize.denoise.denoise_with_deepfilternet)
      ↓
    Speech-Only Gate (speaker_diarize.segmentation.RmsVad + voice-band spectral filter)
      ↓
    Chunk Slicing (<= 20s verified speech chunks)
      ↓
    Batched Whisper Turbo 1-Step Acoustic LID (<|nospeech|> + <|en|> vs <|vi|>)
      ↓
    Contiguous Timeline Block Assembly -> EN % | VI % | Silence %
"""

from __future__ import annotations

import logging
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

import numpy as np
import torch
import torch.nn.functional as F

from data.audio_preprocess import PreprocessConfig, _denoise as _noisereduce_denoise, load_waveform
from infer.transcribe import get_transcriber
from paths import ROOT

SAMPLE_RATE = 16000
PathLike = Union[str, Path]

# Ensure speaker-diarize package is importable for shared DeepFilterNet3 denoiser & RmsVad
_DIARIZE_PKG_DIR = str(ROOT / "speaker-diarize")
if _DIARIZE_PKG_DIR not in sys.path:
    sys.path.insert(0, _DIARIZE_PKG_DIR)


@dataclass
class ClassroomAnalysisConfig:
    """Configuration for Denoised, Speech-Only Classroom EN/VI/Silence Analysis."""

    model_name: str = "openai/whisper-large-v3-turbo"
    highpass_hz: float = 85.0
    enable_denoise: bool = True
    denoise_chunk_sec: float = 60.0
    chunk_sec: float = 20.0
    silence_rms_threshold: float = 0.0055
    speech_band_min_ratio: float = 0.22
    max_spectral_flatness: float = 0.48
    no_speech_threshold: float = 0.65
    group_max_gap_sec: float = 1.5
    group_max_duration_sec: float = 35.0
    batch_size_cuda: int = 32
    lang_id_batch_size_cuda: int = 32


def _load_mono_16k(audio_path: PathLike, highpass_hz: float = 85.0) -> np.ndarray:
    """Reuse shared data.audio_preprocess.load_waveform (16kHz mono + high-pass)."""
    cfg = PreprocessConfig(
        sample_rate=SAMPLE_RATE,
        highpass_hz=highpass_hz,
        denoise=False,
        peak_normalize=False,
    )
    mono = load_waveform(audio_path, cfg, apply_preprocess=True)
    return mono.detach().cpu().numpy().astype(np.float32)


def _denoise_classroom_audio(
    mono: np.ndarray,
    *,
    sample_rate: int = SAMPLE_RATE,
    chunk_sec: float = 60.0,
    progress_callback: Optional[Callable[[str], None]] = None,
) -> np.ndarray:
    """Reuse existing speaker_diarize.denoise (DeepFilterNet3 + level_audio_to_target) in 60s chunks."""
    if mono.size == 0:
        return mono

    chunk_samples = max(sample_rate * 10, int(chunk_sec * sample_rate))
    total_chunks = max(1, int(np.ceil(mono.size / chunk_samples)))

    # 1. Reuse existing DeepFilterNet3 singleton from speaker_diarize.denoise
    try:
        from speaker_diarize.denoise import (
            _get_df_model,
            denoise_with_deepfilternet,
        )

        _get_df_model()

        out_parts: List[np.ndarray] = []
        for idx in range(total_chunks):
            if progress_callback and (idx == 0 or (idx + 1) % 3 == 0 or idx + 1 == total_chunks):
                progress_callback(f"Đang khử nhiễu âm thanh tiết học ({idx + 1}/{total_chunks})...")
            s = idx * chunk_samples
            e = min(mono.size, s + chunk_samples)
            seg = mono[s:e]
            enhanced, _ = denoise_with_deepfilternet(seg, sample_rate)
            if enhanced.size > seg.size:
                enhanced = enhanced[: seg.size]
            elif enhanced.size < seg.size:
                enhanced = np.pad(enhanced, (0, seg.size - enhanced.size))
            out_parts.append(enhanced.astype(np.float32))

        denoised = np.concatenate(out_parts) if out_parts else mono
        return denoised.astype(np.float32)
    except Exception as exc:
        logging.warning("DeepFilterNet unavailable for classroom denoise (%s); reusing audio_preprocess._denoise.", exc)

    # 2. Fallback: reuse existing data.audio_preprocess._denoise (noisereduce) in chunks
    try:
        out_parts = []
        for idx in range(total_chunks):
            if progress_callback and (idx == 0 or (idx + 1) % 3 == 0 or idx + 1 == total_chunks):
                progress_callback(f"Đang khử nhiễu nền âm thanh ({idx + 1}/{total_chunks})...")
            s = idx * chunk_samples
            e = min(mono.size, s + chunk_samples)
            seg_t = torch.from_numpy(mono[s:e])
            reduced_t = _noisereduce_denoise(seg_t, sample_rate, 0.75)
            out_parts.append(reduced_t.detach().cpu().numpy().astype(np.float32))
        return np.concatenate(out_parts) if out_parts else mono
    except Exception:
        return mono


def _detect_speech_windows(
    mono: np.ndarray,
    *,
    sample_rate: int = SAMPLE_RATE,
    max_chunk_sec: float = 20.0,
    silence_rms_threshold: float = 0.0055,
    speech_band_min_ratio: float = 0.22,
    max_spectral_flatness: float = 0.48,
) -> List[Tuple[int, int]]:
    """Extract strictly human-speech windows (<= max_chunk_sec) reusing speaker_diarize.denoise/segmentation + voice-band gate."""
    total_samples = int(mono.shape[0])
    if total_samples == 0:
        return []

    from speaker_diarize.denoise import compute_rms_frames
    from speaker_diarize.segmentation import RmsVad

    frame_len = int(0.05 * sample_rate)  # 50ms frames
    rms, n_frames = compute_rms_frames(mono, frame_len)
    if n_frames == 0:
        return []
    trimmed = mono[: n_frames * frame_len].reshape(n_frames, frame_len)

    # Adaptive RMS floor passed into existing RmsVad
    noise_floor = float(np.percentile(rms, 20))
    effective_rms_thresh = max(silence_rms_threshold, min(0.015, noise_floor * 1.5))
    thresh_db = float(20.0 * np.log10(max(effective_rms_thresh, 1e-6)))
    vad = RmsVad(threshold_db=thresh_db)

    # Build initial RMS speech mask from existing RmsVad.get_timestamps()
    rms_mask = np.zeros(n_frames, dtype=bool)
    for st in vad.get_timestamps(mono, sample_rate=sample_rate):
        s_f = max(0, int(st["start"]) // frame_len)
        e_f = min(n_frames, (int(st["end"]) + frame_len - 1) // frame_len)
        if e_f > s_f:
            rms_mask[s_f:e_f] = True

    if not np.any(rms_mask):
        return []

    # Reject non-speech (low-freq hum, hiss, white noise, clicks) using 300-3400Hz voice-band ratio & spectral flatness
    win = np.hanning(frame_len).astype(np.float32)
    spec = np.abs(np.fft.rfft(trimmed * win, axis=1)) ** 2 + 1e-12
    freqs = np.fft.rfftfreq(frame_len, d=1.0 / sample_rate)
    voice_mask = (freqs >= 300.0) & (freqs <= 3400.0)

    total_power = np.sum(spec, axis=1)
    voice_power = np.sum(spec[:, voice_mask], axis=1)
    voice_ratio = voice_power / (total_power + 1e-12)

    log_mean = np.mean(np.log(spec[:, voice_mask]), axis=1)
    arith_mean = np.mean(spec[:, voice_mask], axis=1)
    flatness = np.exp(log_mean) / (arith_mean + 1e-12)

    speech_frame = (
        rms_mask
        & (voice_ratio >= speech_band_min_ratio)
        & (flatness <= max_spectral_flatness)
    )

    # Require consecutive speech frames to reject isolated clicks/taps
    if speech_frame.size >= 3:
        kernel = np.ones(3, dtype=np.int32)
        conv = np.convolve(speech_frame.astype(np.int32), kernel, mode="same")
        speech_frame = speech_frame & (conv >= 2)

    if not np.any(speech_frame):
        return []

    pad_frames = 5  # 250ms padding
    merge_gap_frames = 20  # 1.0s gap bridging
    islands_f: List[Tuple[int, int]] = []
    in_seg = False
    seg_start = 0
    for i, v in enumerate(speech_frame):
        if v and not in_seg:
            seg_start = max(0, i - pad_frames)
            in_seg = True
        elif not v and in_seg:
            end_i = min(n_frames, i + pad_frames)
            if islands_f and seg_start - islands_f[-1][1] <= merge_gap_frames:
                islands_f[-1] = (islands_f[-1][0], end_i)
            else:
                islands_f.append((seg_start, end_i))
            in_seg = False
    if in_seg:
        end_i = n_frames
        if islands_f and seg_start - islands_f[-1][1] <= merge_gap_frames:
            islands_f[-1] = (islands_f[-1][0], end_i)
        else:
            islands_f.append((seg_start, end_i))

    islands_samples = [
        (s_f * frame_len, min(total_samples, e_f * frame_len))
        for s_f, e_f in islands_f
        if (e_f - s_f) >= 6  # >= 300ms minimum speech island
    ]

    # Split any speech island longer than max_chunk_sec at its quietest internal pause point
    max_frames = int(max_chunk_sec / 0.05)
    min_chunk_frames = int(6.0 / 0.05)
    windows: List[Tuple[int, int]] = []
    for s_samp, e_samp in islands_samples:
        s_f = s_samp // frame_len
        e_f = min(n_frames, (e_samp + frame_len - 1) // frame_len)
        cur = s_f
        while e_f - cur > max_frames:
            search_lo = cur + min_chunk_frames
            search_hi = min(e_f, cur + max_frames)
            local_rms = rms[search_lo:search_hi]
            split_f = search_lo + int(np.argmin(local_rms)) if local_rms.size > 0 else search_hi
            windows.append((cur * frame_len, min(total_samples, split_f * frame_len)))
            cur = split_f
        if e_f > cur:
            windows.append((cur * frame_len, min(total_samples, e_f * frame_len)))

    return windows


def _resolve_whisper_control_token_ids(
    model: Any, tokenizer: Any
) -> Tuple[Optional[int], Optional[int], Optional[int], List[int], int]:
    """Resolve (<|en|>, <|vi|>, <|nospeech|>, all_lang_tids, <|startoftranscript|>) token IDs."""
    gen_cfg = getattr(model, "generation_config", None)
    lang_to_id = getattr(gen_cfg, "lang_to_id", None) or {}
    unk_id = getattr(tokenizer, "unk_token_id", None)

    def _lookup(tok_str: str) -> Optional[int]:
        tid = lang_to_id.get(tok_str)
        if tid is None and hasattr(tokenizer, "convert_tokens_to_ids"):
            cand = tokenizer.convert_tokens_to_ids(tok_str)
            if isinstance(cand, int) and cand >= 0 and cand != unk_id:
                tid = cand
        return int(tid) if isinstance(tid, int) and tid >= 0 else None

    en_tid = _lookup("<|en|>") or _lookup("en") or 50259
    vi_tid = _lookup("<|vi|>") or _lookup("vi") or 50278
    no_speech_tid = _lookup("<|nospeech|>") or 50363

    all_lang_tids = sorted({int(v) for v in lang_to_id.values() if isinstance(v, int) and v >= 0})
    if not all_lang_tids and en_tid is not None and vi_tid is not None:
        all_lang_tids = [en_tid, vi_tid]

    start_id = getattr(gen_cfg, "decoder_start_token_id", None)
    if start_id is None:
        start_id = _lookup("<|startoftranscript|>")
    if start_id is None:
        start_id = 50258

    return en_tid, vi_tid, no_speech_tid, all_lang_tids, int(start_id)


def group_acoustic_chunks_into_timeline(
    classified_chunks: List[Dict[str, Any]],
    *,
    max_gap_sec: float = 1.5,
    max_duration_sec: float = 35.0,
) -> List[Dict[str, Any]]:
    """Group consecutive same-language acoustic chunks ('en' | 'vi' | 'unknown') into timeline blocks."""
    if not classified_chunks:
        return []

    groups: List[List[Dict[str, Any]]] = []
    cur: List[Dict[str, Any]] = [classified_chunks[0]]

    for c in classified_chunks[1:]:
        prev = cur[-1]
        same_lang = c["language"] == prev["language"]
        gap = float(c["offset_sec"]) - float(prev["offset_sec"] + prev["duration_sec"])
        span = float(c["offset_sec"] + c["duration_sec"]) - float(cur[0]["offset_sec"])
        if same_lang and gap <= max_gap_sec and span <= max_duration_sec:
            cur.append(c)
        else:
            groups.append(cur)
            cur = [c]
    if cur:
        groups.append(cur)

    timeline: List[Dict[str, Any]] = []
    for idx, grp in enumerate(groups):
        lang = grp[0]["language"]
        start_sec = round(float(grp[0]["offset_sec"]), 2)
        end_sec = round(float(grp[-1]["offset_sec"] + grp[-1]["duration_sec"]), 2)
        dur_sec = round(max(0.1, end_sec - start_sec), 2)
        label_text = (
            "[Tiếng Anh]" if lang == "en" else ("[Tiếng Việt]" if lang == "vi" else "[Không xác định]")
        )
        rate = 2.4 if lang == "en" else 2.8
        timeline.append(
            {
                "index": idx,
                "language": lang,
                "start_sec": start_sec,
                "end_sec": end_sec,
                "duration_sec": dur_sec,
                "word_count": max(1, int(round(dur_sec * rate))),
                "transcript": label_text,
            }
        )
    return timeline


class ClassroomLanguageAnalyzer:
    """
    Denoised, Speech-Only, Batched Classroom EN/VI/Silence Analyzer (Whisper Large-v3-Turbo Acoustic LID).
    """

    def __init__(
        self,
        *,
        transcriber: Optional[Any] = None,
        device: Optional[str] = None,
        config: Optional[ClassroomAnalysisConfig] = None,
        **_ignored: Any,
    ) -> None:
        self.device = device or ("cuda:0" if torch.cuda.is_available() else "cpu")
        self._transcriber = transcriber
        self.config = config or ClassroomAnalysisConfig()

    def _get_transcriber(self) -> Any:
        if self._transcriber is not None:
            return self._transcriber
        dtype = "float16" if str(self.device).startswith("cuda") else "float32"
        self._transcriber = get_transcriber(
            device=self.device,
            asr_config={
                "model_name": self.config.model_name,
                "language": "auto",
                "allowed_languages": ["en", "vi"],
                "device": self.device,
                "torch_dtype": dtype,
            },
        )
        return self._transcriber

    def _prepare_chunks(
        self,
        mono: np.ndarray,
        windows: List[Tuple[int, int]],
    ) -> List[Dict[str, Any]]:
        """Slice verified speech windows with conservative peak leveling and energy filtering."""
        items: List[Dict[str, Any]] = []
        for s_samp, e_samp in windows:
            chunk = mono[s_samp:e_samp]
            if chunk.size < int(0.35 * SAMPLE_RATE):
                continue
            rms = float(np.sqrt(np.mean(chunk ** 2) + 1e-12))
            peak = float(np.max(np.abs(chunk)))
            # Drop low-energy residual noise / quiet breathing
            if rms < 0.0042 or peak < 0.015:
                continue
            if rms >= 0.006 and 0.015 < peak < 0.85:
                chunk = chunk * min(2.0, 0.88 / peak)
            items.append(
                {
                    "audio": chunk,
                    "offset_sec": s_samp / float(SAMPLE_RATE),
                    "duration_sec": chunk.size / float(SAMPLE_RATE),
                    "acoustic_unknown": False,
                }
            )
        return items

    def _classify_chunks_acoustic(
        self,
        chunk_items: List[Dict[str, Any]],
        model: Any,
        processor: Any,
        tokenizer: Any,
        device: torch.device,
        dtype: torch.dtype,
        progress_callback: Optional[Callable[[str], None]] = None,
    ) -> List[Dict[str, Any]]:
        """Fast, robust 1-step batched Whisper Acoustic LID (zero autoregressive hallucinations)."""
        en_tid, vi_tid, no_speech_tid, all_lang_tids, start_id = _resolve_whisper_control_token_ids(
            model, tokenizer
        )
        if en_tid is None or vi_tid is None:
            for item in chunk_items:
                item["language"] = "en"
                item["p_en"] = 1.0
                item["p_vi"] = 0.0
            return chunk_items

        is_cuda = device.type == "cuda"
        batch_size = self.config.lang_id_batch_size_cuda if is_cuda else 4
        classified: List[Dict[str, Any]] = []
        total = len(chunk_items)

        with torch.inference_mode():
            for idx in range(0, total, batch_size):
                sub_items = chunk_items[idx : idx + batch_size]
                if progress_callback and (idx == 0 or (idx + batch_size) % (batch_size * 2) == 0 or idx + len(sub_items) >= total):
                    progress_callback(
                        f"Đang phân tích âm học ngôn ngữ EN/VI ({min(total, idx + len(sub_items))}/{total} đoạn)..."
                    )

                audios = [it["audio"] for it in sub_items]
                inputs = processor(
                    audios,
                    sampling_rate=SAMPLE_RATE,
                    return_tensors="pt",
                )
                feats = inputs.input_features.to(device=device, dtype=dtype)
                dec_ids = torch.full(
                    (feats.shape[0], 1),
                    start_id,
                    device=device,
                    dtype=torch.long,
                )
                out = model(
                    input_features=feats[:, :, :3000],
                    decoder_input_ids=dec_ids,
                    use_cache=False,
                )
                logits = out.logits[:, -1, :].float()
                en_vi_probs = F.softmax(logits[:, [en_tid, vi_tid]], dim=-1).cpu().numpy()
                all_probs = F.softmax(logits, dim=-1)
                p_nospeech = (
                    all_probs[:, no_speech_tid].cpu().numpy()
                    if (no_speech_tid is not None and no_speech_tid < all_probs.shape[-1])
                    else np.zeros(len(sub_items))
                )

                for j, item in enumerate(sub_items):
                    p_en = float(en_vi_probs[j, 0])
                    p_vi = float(en_vi_probs[j, 1])
                    p_ns = float(p_nospeech[j])

                    if p_ns > 0.65 and (p_en + p_vi) < 0.15:
                        lang = "unknown"
                    elif p_vi > 0.45:
                        lang = "vi"
                    else:
                        lang = "en"

                    item_copy = dict(item)
                    item_copy["language"] = lang
                    item_copy["p_en"] = p_en
                    item_copy["p_vi"] = p_vi
                    classified.append(item_copy)

        return classified

    def analyze(
        self,
        audio_path: PathLike,
        *,
        progress_callback: Optional[Callable[[str], None]] = None,
        **_ignored: Any,
    ) -> Dict[str, Any]:
        """Run full denoised, speech-only Classroom EN / VI / Silence analysis."""
        cfg = self.config

        if progress_callback:
            progress_callback("Đang chuẩn bị bản ghi âm tiết học...")

        mono = _load_mono_16k(audio_path, highpass_hz=cfg.highpass_hz)
        total_audio_sec = round(float(mono.shape[0]) / float(SAMPLE_RATE), 2)

        # 0. Audio Denoising (DeepFilterNet3 -> noisereduce fallback)
        if cfg.enable_denoise and mono.size > 0:
            mono = _denoise_classroom_audio(
                mono,
                sample_rate=SAMPLE_RATE,
                chunk_sec=cfg.denoise_chunk_sec,
                progress_callback=progress_callback,
            )

        # 1. Speech-Only Gate -> Speech Windows (loại bỏ khoảng lặng & tạp âm)
        if progress_callback:
            progress_callback("Đang lọc tách các đoạn tiếng nói (loại bỏ khoảng lặng & tạp âm)...")

        windows = _detect_speech_windows(
            mono,
            sample_rate=SAMPLE_RATE,
            max_chunk_sec=cfg.chunk_sec,
            silence_rms_threshold=cfg.silence_rms_threshold,
            speech_band_min_ratio=cfg.speech_band_min_ratio,
            max_spectral_flatness=cfg.max_spectral_flatness,
        )

        chunk_items = self._prepare_chunks(mono, windows)
        if not chunk_items:
            return {
                "duration": {
                    "total_audio_sec": total_audio_sec,
                    "total_speech_sec": 0.0,
                    "en_speech_sec": 0.0,
                    "vi_speech_sec": 0.0,
                    "unknown_speech_sec": 0.0,
                    "silence_sec": total_audio_sec,
                    "speech_ratio_percent": 0.0,
                },
                "overall": {
                    "en_words": 0,
                    "vi_words": 0,
                    "unknown_words": 0,
                    "total_words": 0,
                    "en_percent": 0.0,
                    "vi_percent": 0.0,
                    "unknown_percent": 0.0,
                    "en_time_percent": 0.0,
                    "vi_time_percent": 0.0,
                    "unknown_time_percent": 0.0,
                },
                "timeline": [],
            }

        # 2. Fast 1-Step Batched Whisper Acoustic LID (Zero Hallucination)
        transcriber = self._get_transcriber()
        model = transcriber.model
        processor = transcriber.processor
        tokenizer = processor.tokenizer
        device = transcriber.device
        dtype = model.dtype

        if progress_callback:
            progress_callback(f"Đang phân tích âm học ngôn ngữ EN/VI ({len(chunk_items)} đoạn)...")

        classified_chunks = self._classify_chunks_acoustic(
            chunk_items, model, processor, tokenizer, device, dtype, progress_callback=progress_callback
        )

        # 3. Group into chronological timeline
        if progress_callback:
            progress_callback("Đang tổng hợp diễn biến ngôn ngữ tiết học...")

        timeline = group_acoustic_chunks_into_timeline(
            classified_chunks,
            max_gap_sec=cfg.group_max_gap_sec,
            max_duration_sec=cfg.group_max_duration_sec,
        )

        # 4. Statistics aggregation
        en_words = sum(seg["word_count"] for seg in timeline if seg["language"] == "en")
        vi_words = sum(seg["word_count"] for seg in timeline if seg["language"] == "vi")
        unknown_words = sum(seg["word_count"] for seg in timeline if seg["language"] == "unknown")
        total_words = en_words + vi_words + unknown_words

        en_speech_sec = round(sum(seg["duration_sec"] for seg in timeline if seg["language"] == "en"), 2)
        vi_speech_sec = round(sum(seg["duration_sec"] for seg in timeline if seg["language"] == "vi"), 2)
        unknown_speech_sec = round(sum(seg["duration_sec"] for seg in timeline if seg["language"] == "unknown"), 2)
        total_speech_sec = round(min(total_audio_sec, en_speech_sec + vi_speech_sec + unknown_speech_sec), 2)
        silence_sec = round(max(0.0, total_audio_sec - total_speech_sec), 2)
        speech_ratio = round(100.0 * total_speech_sec / total_audio_sec, 1) if total_audio_sec > 0 else 0.0

        if total_words > 0:
            en_pct = round(100.0 * en_words / total_words, 1)
            vi_pct = round(100.0 * vi_words / total_words, 1)
            unknown_pct = round(max(0.0, 100.0 - en_pct - vi_pct), 1)
        else:
            en_pct = 0.0
            vi_pct = 0.0
            unknown_pct = 0.0

        sum_speech_sec = en_speech_sec + vi_speech_sec + unknown_speech_sec
        if sum_speech_sec > 0:
            en_time_pct = round(100.0 * en_speech_sec / sum_speech_sec, 1)
            vi_time_pct = round(100.0 * vi_speech_sec / sum_speech_sec, 1)
            unknown_time_pct = round(max(0.0, 100.0 - en_time_pct - vi_time_pct), 1)
        else:
            en_time_pct = 0.0
            vi_time_pct = 0.0
            unknown_time_pct = 0.0

        return {
            "duration": {
                "total_audio_sec": total_audio_sec,
                "total_speech_sec": total_speech_sec,
                "en_speech_sec": en_speech_sec,
                "vi_speech_sec": vi_speech_sec,
                "unknown_speech_sec": unknown_speech_sec,
                "silence_sec": silence_sec,
                "speech_ratio_percent": speech_ratio,
            },
            "overall": {
                "en_words": en_words,
                "vi_words": vi_words,
                "unknown_words": unknown_words,
                "total_words": total_words,
                "en_percent": en_pct,
                "vi_percent": vi_pct,
                "unknown_percent": unknown_pct,
                "en_time_percent": en_time_pct,
                "vi_time_percent": vi_time_pct,
                "unknown_time_percent": unknown_time_pct,
            },
            "timeline": timeline,
        }


def analyze_classroom_audio(
    audio_path: PathLike,
    *,
    transcriber: Optional[Any] = None,
    device: Optional[str] = None,
    progress_callback: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Convenience function to run denoised, speech-only Classroom EN / VI / Silence analysis."""
    analyzer = ClassroomLanguageAnalyzer(transcriber=transcriber, device=device)
    return analyzer.analyze(audio_path, progress_callback=progress_callback)
