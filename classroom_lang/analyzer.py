"""Classroom EN/VI Language Timeline Analyzer (Denoised, Speech-Only, Batched, Whisper Turbo).

Architecture (reusing existing project modules):
    Audio (data.audio_preprocess.load_waveform: 16kHz mono + high-pass)
      ↓
    Audio Denoise (speaker_diarize.denoise.denoise_with_deepfilternet + level_audio_to_target)
      ↓
    Speech-Only Gate (speaker_diarize.segmentation.RmsVad + voice-band spectral filter)
      ↓
    Batched Whisper Turbo Acoustic Gate (<|nospeech|> rejection + EN/VI vs Unknown routing)
      ↓
    Batched Whisper Turbo Beam Decoding (num_beams=2, SDPA, native segment timestamps)
      ↓
    Lingua + Wordfreq 3-Class Labeling ('en' | 'vi' | 'unknown')
      ↓
    Time-based Language Grouping -> EN % | VI % | Unknown %
"""

from __future__ import annotations

import logging
import re
import sys
import unicodedata
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

import numpy as np
import torch
import torch.nn.functional as F

from data.audio_preprocess import PreprocessConfig, _denoise as _noisereduce_denoise, load_waveform
from infer.transcribe import clean_whisper_hallucinations, get_transcriber
from paths import ROOT

SAMPLE_RATE = 16000
PathLike = Union[str, Path]

# Ensure speaker-diarize package is importable for shared DeepFilterNet3 denoiser & RmsVad
_DIARIZE_PKG_DIR = str(ROOT / "speaker-diarize")
if _DIARIZE_PKG_DIR not in sys.path:
    sys.path.insert(0, _DIARIZE_PKG_DIR)

# Vietnamese-specific diacritic characters (100% deterministic VI signal)
_VI_DIACRITIC_RE = re.compile(
    r"[ăâđêôơưĂÂĐÊÔƠƯàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ"
    r"ÀẢÃÁẠẰẲẴẮẶẦẨẪẤẬÈẺẼÉẸỀỂỄẾỆÌỈĨÍỊÒỎÕÓỌỒỔỖỐỘỜỞỠỚỢÙỦŨÚỤỪỬỮỨỰỲỶỸÝỴ]"
)
_WORD_ALPHA_RE = re.compile(r"[A-Za-zÀ-ỹ]+")

# Non-Latin scripts (Japanese, CJK, Korean, Cyrillic, Arabic, Thai, Indic)
_NON_LATIN_SCRIPT_RE = re.compile(
    r"[\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F"
    r"\u3040-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF"
    r"\uAC00-\uD7AF\uF900-\uFAFF\uFF65-\uFF9F]"
)
# Non-speech Whisper sound/music markers
_NON_SPEECH_TAG_RE = re.compile(
    r"(\[[^\]]*\]|\([^)]*\)|♪+|♫+|\*+)",
    flags=re.IGNORECASE,
)
_COMPACT_LOOP_RE = re.compile(r"(.{3,20})\1{3,}", flags=re.IGNORECASE)

_LINGUA_DETECTOR = None


def get_lingua_detector():
    """Lazily build a singleton Lingua detector restricted strictly to EN and VI."""
    global _LINGUA_DETECTOR
    if _LINGUA_DETECTOR is None:
        from lingua import Language, LanguageDetectorBuilder

        _LINGUA_DETECTOR = (
            LanguageDetectorBuilder.from_languages(Language.ENGLISH, Language.VIETNAMESE)
            .with_preloaded_language_models()
            .build()
        )
    return _LINGUA_DETECTOR


@dataclass
class ClassroomAnalysisConfig:
    """Configuration for Denoised, Speech-Only Classroom EN/VI/Unknown Analysis."""

    model_name: str = "openai/whisper-large-v3-turbo"
    highpass_hz: float = 85.0
    enable_denoise: bool = True
    denoise_chunk_sec: float = 60.0
    chunk_sec: float = 24.0
    silence_rms_threshold: float = 0.0048
    speech_band_min_ratio: float = 0.25
    max_spectral_flatness: float = 0.48
    no_speech_threshold: float = 0.70
    min_en_vi_acoustic_share: float = 0.05
    vi_route_threshold: float = 0.35
    lingua_confidence_threshold: float = 0.65
    group_max_gap_sec: float = 1.5
    group_max_duration_sec: float = 30.0
    phrase_pause_sec: float = 0.9
    batch_size_cuda: int = 12
    lang_id_batch_size_cuda: int = 32
    num_beams: int = 1
    max_new_tokens: int = 150
    compression_ratio_threshold: float = 2.4


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

        # Verify shared DeepFilterNet3 model is available before chunk loop
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


def _has_vi_diacritics(text: str) -> bool:
    return bool(_VI_DIACRITIC_RE.search(unicodedata.normalize("NFC", text)))


def _is_pure_number_or_punct(word: str) -> bool:
    return not bool(_WORD_ALPHA_RE.search(word))


def _wordfreq_zipf(word: str, lang: str) -> float:
    try:
        from wordfreq import zipf_frequency

        clean = re.sub(r"^[^A-Za-zÀ-ỹ]+|[^A-Za-zÀ-ỹ]+$", "", word).lower()
        if not clean:
            return 0.0
        return float(zipf_frequency(clean, lang))
    except Exception:
        return 0.0


def _is_repetitive_hallucination(text: str, compression_threshold: float = 2.4) -> bool:
    """Detect Whisper repetition loops using zlib compression ratio and substring repetition."""
    cleaned = " ".join(text.split())
    if not cleaned:
        return True
    if _COMPACT_LOOP_RE.search(cleaned):
        return True
    raw_bytes = cleaned.encode("utf-8")
    if len(raw_bytes) >= 40:
        comp_len = max(1, len(zlib.compress(raw_bytes)))
        if (len(raw_bytes) / comp_len) > compression_threshold:
            return True
    return False


def _sanitize_en_vi_text(text: str, compression_threshold: float = 2.4) -> Tuple[str, bool]:
    """Sanitize decoded text.

    Returns (cleaned_text, has_foreign_script):
    - Non-speech sound tags ([Music], (Applause), ♪) are stripped.
    - Pure repetition loops are rejected as empty.
    - Non-Latin scripts (Japanese/CJK/Korean/Cyrillic) are flagged as foreign/unknown
      so they are never mislabeled as EN or VI.
    """
    if not text:
        return "", False

    stripped = _NON_SPEECH_TAG_RE.sub(" ", text).strip()
    if not stripped:
        return "", False

    non_ws = re.sub(r"\s+", "", stripped)
    if not non_ws:
        return "", False

    if _is_repetitive_hallucination(stripped, compression_threshold=compression_threshold):
        return "", False

    non_latin_hits = _NON_LATIN_SCRIPT_RE.findall(non_ws)
    if non_latin_hits:
        # Reject hallucinated foreign scripts (Japanese/CJK/Korean/etc.) completely
        if len(non_latin_hits) / max(1, len(non_ws)) >= 0.10:
            return "", True
        stripped = _NON_LATIN_SCRIPT_RE.sub(" ", stripped)

    cleaned = clean_whisper_hallucinations(stripped)
    if not cleaned:
        return "", False
    if not _WORD_ALPHA_RE.search(cleaned):
        return "", False
    return cleaned, False


def _detect_speech_windows(
    mono: np.ndarray,
    *,
    sample_rate: int = SAMPLE_RATE,
    max_chunk_sec: float = 24.0,
    silence_rms_threshold: float = 0.0048,
    speech_band_min_ratio: float = 0.25,
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
    merge_gap_frames = 24  # 1.2s clause gap
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
    min_chunk_frames = int(8.0 / 0.05)
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


def _extract_words_from_timestamp_sequence(
    seq_ids: List[int],
    tokenizer: Any,
    offset_sec: float,
    chunk_duration_sec: float,
    compression_threshold: float = 2.4,
    acoustic_unknown: bool = False,
) -> List[Dict[str, Any]]:
    """Decode a Whisper return_timestamps=True token sequence into sanitized timestamped words."""
    special_ids = set(getattr(tokenizer, "all_special_ids", []) or [])
    ts_begin = getattr(tokenizer, "timestamp_begin", None)
    eos_id = getattr(tokenizer, "eos_token_id", None)

    segments: List[Tuple[float, float, List[int]]] = []
    cur_start: Optional[float] = None
    cur_tokens: List[int] = []

    for tid in seq_ids:
        if eos_id is not None and tid == eos_id:
            break
        if ts_begin is not None and tid >= ts_begin:
            t_sec = max(0.0, min(chunk_duration_sec, (tid - ts_begin) * 0.02))
            if cur_tokens:
                st = cur_start if cur_start is not None else 0.0
                en = max(st + 0.05, t_sec)
                segments.append((st, en, cur_tokens))
                cur_tokens = []
                cur_start = t_sec
            else:
                cur_start = t_sec
            continue

        if tid in special_ids:
            continue
        cur_tokens.append(tid)

    if cur_tokens:
        st = cur_start if cur_start is not None else 0.0
        en = max(st + 0.1, chunk_duration_sec)
        segments.append((st, en, cur_tokens))

    words: List[Dict[str, Any]] = []
    for seg_start, seg_end, tok_ids in segments:
        raw_text = tokenizer.decode(tok_ids, skip_special_tokens=True).strip()
        cleaned, had_foreign = _sanitize_en_vi_text(
            raw_text, compression_threshold=compression_threshold
        )
        if not cleaned:
            continue

        sub_words = cleaned.split()
        if not sub_words:
            continue

        span = max(0.08, min(chunk_duration_sec, seg_end) - seg_start)
        weights = [max(1, len(w)) for w in sub_words]
        total_w = float(sum(weights))
        cursor = seg_start

        for sw, w_len in zip(sub_words, weights):
            w_dur = span * (w_len / total_w)
            w_st = cursor
            w_en = min(chunk_duration_sec, cursor + max(0.03, w_dur))
            cursor += w_dur
            words.append(
                {
                    "word": sw,
                    "start_sec": round(offset_sec + w_st, 3),
                    "end_sec": round(offset_sec + max(w_st + 0.03, w_en), 3),
                    "acoustic_unknown": bool(acoustic_unknown or had_foreign),
                }
            )

    return words


def detect_word_languages_with_lingua(
    words: List[Dict[str, Any]],
    *,
    phrase_pause_sec: float = 0.9,
    confidence_threshold: float = 0.65,
) -> List[Dict[str, Any]]:
    """Classify each timestamped word as 'en', 'vi', or 'unknown' (when neither EN nor VI is confident)."""
    if not words:
        return []

    from lingua import Language

    detector = get_lingua_detector()

    # 1. Partition words into natural pause-delimited phrases so Lingua sees full bilingual context
    phrases: List[List[int]] = []
    cur_phrase: List[int] = [0]
    for i in range(1, len(words)):
        gap = float(words[i]["start_sec"]) - float(words[i - 1]["end_sec"])
        prev_txt = words[i - 1]["word"]
        if gap >= phrase_pause_sec or prev_txt.endswith((".", "!", "?")):
            phrases.append(cur_phrase)
            cur_phrase = [i]
        else:
            cur_phrase.append(i)
    if cur_phrase:
        phrases.append(cur_phrase)

    labeled = [dict(w) for w in words]

    for idx_list in phrases:
        spans: List[Tuple[int, int, int]] = []
        parts: List[str] = []
        cursor = 0
        for wi in idx_list:
            wtxt = labeled[wi]["word"]
            if parts:
                parts.append(" ")
                cursor += 1
            c_start = cursor
            parts.append(wtxt)
            cursor += len(wtxt)
            spans.append((wi, c_start, cursor))
        phrase_str = "".join(parts)

        # Phrase-level confidence from Lingua
        conf_vals = detector.compute_language_confidence_values(phrase_str)
        top_phrase_conf = float(conf_vals[0].value) if conf_vals else 0.0
        top_phrase_lang = (
            "vi" if (conf_vals and conf_vals[0].language == Language.VIETNAMESE) else "en"
        )

        # Multi-language character spans for bilingual code-switched phrases
        multi_res = detector.detect_multiple_languages_of(phrase_str)
        char_lang: List[Optional[str]] = [None] * len(phrase_str)
        for seg in multi_res:
            code = "vi" if seg.language == Language.VIETNAMESE else "en"
            for ci in range(max(0, seg.start_index), min(len(phrase_str), seg.end_index)):
                char_lang[ci] = code

        # Phrase-level lexical coverage in EN/VI to guard against 2-class softmax overconfidence
        # on gibberish or foreign phrases
        phrase_lex_total = 0
        phrase_lex_known = 0
        word_zipf_cache: Dict[int, Tuple[float, float]] = {}
        for wi, _cs, _ce in spans:
            wtxt = labeled[wi]["word"]
            if _is_pure_number_or_punct(wtxt):
                continue
            phrase_lex_total += 1
            if _has_vi_diacritics(wtxt):
                word_zipf_cache[wi] = (0.0, 6.0)
                phrase_lex_known += 1
            else:
                ze = _wordfreq_zipf(wtxt, "en")
                zv = _wordfreq_zipf(wtxt, "vi")
                word_zipf_cache[wi] = (ze, zv)
                if ze >= 2.0 or zv >= 2.0:
                    phrase_lex_known += 1
        phrase_known_ratio = (phrase_lex_known / phrase_lex_total) if phrase_lex_total > 0 else 0.0

        for wi, cs, ce in spans:
            wtxt = labeled[wi]["word"]
            is_acoustic_uncertain = bool(labeled[wi].get("acoustic_unknown", False))

            if _is_pure_number_or_punct(wtxt):
                labeled[wi]["language"] = None
                continue

            # Deterministic Vietnamese diacritics -> always 'vi'
            if _has_vi_diacritics(wtxt):
                labeled[wi]["language"] = "vi"
                continue

            z_en, z_vi = word_zipf_cache.get(wi, (0.0, 0.0))
            known_en = z_en >= 2.0
            known_vi = z_vi >= 2.0

            # If Whisper acoustically flagged the chunk as not EN/VI, require strong lexical evidence
            if is_acoustic_uncertain and not (z_en >= 3.2 or z_vi >= 3.2):
                labeled[wi]["language"] = "unknown"
                continue

            # If word is unrecognized in BOTH EN & VI dictionaries:
            # mark 'unknown' whenever phrase coverage is weak or Lingua confidence isn't decisive
            if not known_en and not known_vi:
                if phrase_known_ratio < 0.50 or top_phrase_conf < max(confidence_threshold, 0.72):
                    labeled[wi]["language"] = "unknown"
                    continue
                alpha_only = re.sub(r"[^A-Za-zÀ-ỹ]", "", wtxt)
                if len(alpha_only) >= 2 and top_phrase_conf < 0.85:
                    labeled[wi]["language"] = "unknown"
                    continue

            seg_votes = [char_lang[ci] for ci in range(cs, ce) if char_lang[ci] is not None]
            if seg_votes:
                vi_v = sum(1 for v in seg_votes if v == "vi")
                en_v = sum(1 for v in seg_votes if v == "en")
                if vi_v > en_v:
                    labeled[wi]["language"] = "vi"
                elif en_v > vi_v:
                    labeled[wi]["language"] = "en"
                elif known_en and not known_vi:
                    labeled[wi]["language"] = "en"
                elif known_vi and not known_en:
                    labeled[wi]["language"] = "vi"
                else:
                    labeled[wi]["language"] = (
                        top_phrase_lang if top_phrase_conf >= confidence_threshold else "unknown"
                    )
            else:
                if known_en and not known_vi:
                    labeled[wi]["language"] = "en"
                elif known_vi and not known_en:
                    labeled[wi]["language"] = "vi"
                elif top_phrase_conf >= confidence_threshold:
                    labeled[wi]["language"] = top_phrase_lang
                else:
                    labeled[wi]["language"] = "unknown"

    # Resolve numbers/punctuation by inheriting from nearest adjacent lexical word (or 'unknown')
    last_lang: Optional[str] = None
    for i, item in enumerate(labeled):
        if item.get("language") in ("en", "vi", "unknown"):
            last_lang = item["language"]
        else:
            nxt_lang = next(
                (
                    labeled[j]["language"]
                    for j in range(i + 1, len(labeled))
                    if labeled[j].get("language") in ("en", "vi", "unknown")
                ),
                None,
            )
            item["language"] = last_lang if last_lang is not None else (nxt_lang or "unknown")
        item.pop("acoustic_unknown", None)

    return labeled


def group_words_into_language_timeline(
    labeled_words: List[Dict[str, Any]],
    *,
    max_gap_sec: float = 1.5,
    max_duration_sec: float = 30.0,
) -> List[Dict[str, Any]]:
    """Group consecutive same-language ('en' | 'vi' | 'unknown') words into timeline segments."""
    if not labeled_words:
        return []

    groups: List[List[Dict[str, Any]]] = []
    cur: List[Dict[str, Any]] = [labeled_words[0]]

    for w in labeled_words[1:]:
        prev = cur[-1]
        same_lang = w["language"] == prev["language"]
        gap = float(w["start_sec"]) - float(prev["end_sec"])
        span = float(w["end_sec"]) - float(cur[0]["start_sec"])
        if same_lang and gap <= max_gap_sec and span <= max_duration_sec:
            cur.append(w)
        else:
            groups.append(cur)
            cur = [w]
    if cur:
        groups.append(cur)

    timeline: List[Dict[str, Any]] = []
    for idx, grp in enumerate(groups):
        lang = grp[0]["language"]
        start_sec = round(float(grp[0]["start_sec"]), 2)
        end_sec = round(max(start_sec + 0.05, float(grp[-1]["end_sec"])), 2)
        dur_sec = round(end_sec - start_sec, 2)
        transcript = " ".join(w["word"] for w in grp).strip()
        timeline.append(
            {
                "index": idx,
                "language": lang,
                "start_sec": start_sec,
                "end_sec": end_sec,
                "duration_sec": dur_sec,
                "word_count": len(grp),
                "transcript": transcript,
            }
        )
    return timeline


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

    en_tid = _lookup("<|en|>") or _lookup("en")
    vi_tid = _lookup("<|vi|>") or _lookup("vi")
    no_speech_tid = _lookup("<|nospeech|>")

    all_lang_tids = sorted({int(v) for v in lang_to_id.values() if isinstance(v, int) and v >= 0})
    if not all_lang_tids and en_tid is not None and vi_tid is not None:
        all_lang_tids = [en_tid, vi_tid]

    start_id = getattr(gen_cfg, "decoder_start_token_id", None)
    if start_id is None:
        start_id = _lookup("<|startoftranscript|>")
    if start_id is None:
        start_id = 50258

    return en_tid, vi_tid, no_speech_tid, all_lang_tids, int(start_id)


class ClassroomLanguageAnalyzer:
    """
    Denoised, Speech-Only, Batched Classroom EN/VI/Unknown Analyzer (Whisper Large-v3-Turbo).
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
                "max_new_tokens": self.config.max_new_tokens,
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

    def _route_speech_chunks(
        self,
        chunk_items: List[Dict[str, Any]],
        model: Any,
        processor: Any,
        tokenizer: Any,
        device: torch.device,
        dtype: torch.dtype,
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """Fast 1-step batched Whisper acoustic gate:
        1. Reject non-speech chunks (music/clapping/noise) via <|nospeech|> probability.
        2. Route genuine speech into EN vs VI buckets.
        """
        en_tid, vi_tid, no_speech_tid, all_lang_tids, start_id = _resolve_whisper_control_token_ids(
            model, tokenizer
        )
        if en_tid is None or vi_tid is None:
            return [], list(chunk_items)

        is_cuda = device.type == "cuda"
        lang_bs = self.config.lang_id_batch_size_cuda if is_cuda else 2
        no_speech_thresh = self.config.no_speech_threshold

        en_bucket: List[Dict[str, Any]] = []
        vi_bucket: List[Dict[str, Any]] = []

        with torch.inference_mode():
            for start_i in range(0, len(chunk_items), lang_bs):
                batch_items = chunk_items[start_i : start_i + lang_bs]
                audios = [it["audio"] for it in batch_items]
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
                logits_full = out.logits[:, -1, :].float()
                probs_full = F.softmax(logits_full, dim=-1).cpu().numpy()

                for item, p_row in zip(batch_items, probs_full):
                    p_en = float(p_row[en_tid])
                    p_vi = float(p_row[vi_tid])
                    p_nospeech = (
                        float(p_row[no_speech_tid])
                        if no_speech_tid is not None and no_speech_tid < p_row.shape[0]
                        else 0.0
                    )

                    # Only drop if Whisper is overwhelmingly confident it's no-speech (> 0.70)
                    if p_nospeech > no_speech_thresh and (p_en + p_vi) < 0.05:
                        continue

                    # Determine target bucket based on EN vs VI relative likelihood
                    target_lang = "vi" if p_vi > (p_en * 0.90) else "en"
                    if target_lang == "vi":
                        vi_bucket.append(item)
                    else:
                        en_bucket.append(item)

        return en_bucket, vi_bucket

    def _generate_bucket(
        self,
        bucket: List[Dict[str, Any]],
        *,
        lang: str,
        model: Any,
        processor: Any,
        tokenizer: Any,
        device: torch.device,
        dtype: torch.dtype,
        progress_callback: Optional[Callable[[str], None]],
        processed_so_far: int,
        total_chunks: int,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Run batched Whisper Turbo beam decoding with native segment timestamps + OOM fallback."""
        if not bucket:
            return [], processed_so_far

        cfg = self.config
        is_cuda = device.type == "cuda"
        batch_size = cfg.batch_size_cuda if is_cuda else 1
        num_beams = cfg.num_beams if is_cuda else 1
        extracted: List[Dict[str, Any]] = []

        idx = 0
        while idx < len(bucket):
            cur_bs = min(batch_size, len(bucket) - idx)
            sub_items = bucket[idx : idx + cur_bs]

            if progress_callback:
                done_now = min(total_chunks, processed_so_far + idx + cur_bs)
                progress_callback(
                    f"Đang nghe hiểu nội dung nói ({done_now}/{total_chunks} đoạn)..."
                )

            audios = [it["audio"] for it in sub_items]
            inputs = processor(
                audios,
                sampling_rate=SAMPLE_RATE,
                return_tensors="pt",
                return_attention_mask=True,
            )
            feats = inputs.input_features.to(device=device, dtype=dtype)
            attn_mask = inputs.attention_mask.to(device=device) if "attention_mask" in inputs else None

            gen_kwargs: Dict[str, Any] = {
                "language": lang,
                "task": "transcribe",
                "return_timestamps": True,
                "num_beams": num_beams,
                "do_sample": False,
                "max_new_tokens": cfg.max_new_tokens,
                "no_repeat_ngram_size": 5,
            }
            if attn_mask is not None:
                gen_kwargs["attention_mask"] = attn_mask

            try:
                with torch.inference_mode():
                    sequences = model.generate(feats, **gen_kwargs)
            except torch.cuda.OutOfMemoryError:
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                if batch_size > 1:
                    batch_size = max(1, batch_size // 2)
                    continue
                if num_beams > 1:
                    num_beams = 1
                    continue
                raise

            seq_cpu = sequences.detach().cpu().tolist()
            for item, seq_ids in zip(sub_items, seq_cpu):
                chunk_words = _extract_words_from_timestamp_sequence(
                    seq_ids,
                    tokenizer,
                    offset_sec=item["offset_sec"],
                    chunk_duration_sec=item["duration_sec"],
                    compression_threshold=cfg.compression_ratio_threshold,
                    acoustic_unknown=bool(item.get("acoustic_unknown", False)),
                )
                extracted.extend(chunk_words)

            idx += cur_bs

        return extracted, processed_so_far + len(bucket)

    def _transcribe_word_timestamps(
        self,
        mono: np.ndarray,
        progress_callback: Optional[Callable[[str], None]] = None,
    ) -> List[Dict[str, Any]]:
        cfg = self.config

        if progress_callback:
            progress_callback("Đang lọc tách đoạn có giọng nói (loại bỏ nhạc & tiếng ồn)...")

        windows = _detect_speech_windows(
            mono,
            sample_rate=SAMPLE_RATE,
            max_chunk_sec=cfg.chunk_sec,
            silence_rms_threshold=cfg.silence_rms_threshold,
            speech_band_min_ratio=cfg.speech_band_min_ratio,
            max_spectral_flatness=cfg.max_spectral_flatness,
        )
        if not windows:
            return []

        chunk_items = self._prepare_chunks(mono, windows)
        if not chunk_items:
            return []

        transcriber = self._get_transcriber()
        model = transcriber.model
        processor = transcriber.processor
        tokenizer = processor.tokenizer
        device = transcriber.device
        dtype = model.dtype

        if progress_callback:
            progress_callback(f"Đang kiểm tra giọng nói & ngôn ngữ ({len(chunk_items)} đoạn)...")

        en_bucket, vi_bucket = self._route_speech_chunks(
            chunk_items, model, processor, tokenizer, device, dtype
        )

        total_chunks = len(en_bucket) + len(vi_bucket)
        if total_chunks == 0:
            return []

        all_words: List[Dict[str, Any]] = []
        done = 0

        en_words, done = self._generate_bucket(
            en_bucket,
            lang="en",
            model=model,
            processor=processor,
            tokenizer=tokenizer,
            device=device,
            dtype=dtype,
            progress_callback=progress_callback,
            processed_so_far=done,
            total_chunks=total_chunks,
        )
        all_words.extend(en_words)

        vi_words, done = self._generate_bucket(
            vi_bucket,
            lang="vi",
            model=model,
            processor=processor,
            tokenizer=tokenizer,
            device=device,
            dtype=dtype,
            progress_callback=progress_callback,
            processed_so_far=done,
            total_chunks=total_chunks,
        )
        all_words.extend(vi_words)

        all_words.sort(key=lambda w: (float(w["start_sec"]), float(w["end_sec"])))
        return all_words

    def analyze(
        self,
        audio_path: PathLike,
        *,
        progress_callback: Optional[Callable[[str], None]] = None,
        **_ignored: Any,
    ) -> Dict[str, Any]:
        """Run full denoised, speech-only Classroom EN / VI / Unknown analysis."""
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

        # 1. Speech-Only Gate + Batched Whisper Turbo -> Words + Timestamps
        raw_words = self._transcribe_word_timestamps(mono, progress_callback=progress_callback)

        # 2. 3-Class Labeling ('en' | 'vi' | 'unknown')
        if progress_callback:
            progress_callback(f"Đang phân loại Tiếng Anh / Tiếng Việt / Không xác định ({len(raw_words)} từ)...")
        labeled_words = detect_word_languages_with_lingua(
            raw_words,
            phrase_pause_sec=cfg.phrase_pause_sec,
            confidence_threshold=cfg.lingua_confidence_threshold,
        )

        # 3. Group into chronological timeline
        if progress_callback:
            progress_callback("Đang tổng hợp diễn biến ngôn ngữ tiết học...")
        timeline = group_words_into_language_timeline(
            labeled_words,
            max_gap_sec=cfg.group_max_gap_sec,
            max_duration_sec=cfg.group_max_duration_sec,
        )

        # 4. Aggregate EN vs VI vs Unknown statistics
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
    """Convenience function to run denoised, speech-only Classroom EN / VI / Unknown analysis."""
    analyzer = ClassroomLanguageAnalyzer(transcriber=transcriber, device=device)
    return analyzer.analyze(audio_path, progress_callback=progress_callback)
