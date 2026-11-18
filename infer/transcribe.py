"""Speech-to-text for automatic transcript (Whisper Large-v3 Bilingual EN/VI)."""

from __future__ import annotations

import os
import re
import threading
from pathlib import Path
from typing import Any, Dict, Optional, Sequence, Tuple, Union

import torch
import torch.nn.functional as F
import torchaudio
import yaml

from data.audio_preprocess import load_audio_file
from data.cmudict import expand_numbers_in_text
from infer.device_utils import resolve_device
from paths import PRONUNCIATION_CONFIG, ROOT

PathLike = Union[str, Path]
WHISPER_SR = 16000
WHISPER_CHUNK_SEC = 30.0
WHISPER_DEFAULT_MODEL = "openai/whisper-large-v3-turbo"
LOCAL_WHISPER_DIR = ROOT / "pretrained_models" / "whisper-large-v3-turbo"
DEFAULT_ALLOWED_LANGUAGES = ("en",)  # Strictly English-only: no Vietnamese detection/transcription


def _local_whisper_ready(local_dir: Path = LOCAL_WHISPER_DIR) -> bool:
    if not local_dir.is_dir() or not (local_dir / "config.json").is_file():
        return False
    return any(
        (local_dir / fname).is_file()
        for fname in ("model.safetensors", "model.safetensors.index.json", "pytorch_model.bin")
    )


def _resolve_whisper_model_name(model_name: Optional[str]) -> str:
    raw = (model_name or "").strip()
    if not raw or raw == WHISPER_DEFAULT_MODEL:
        if _local_whisper_ready(LOCAL_WHISPER_DIR):
            return str(LOCAL_WHISPER_DIR)
        return WHISPER_DEFAULT_MODEL

    if os.path.exists(raw):
        return raw

    if raw.startswith("/") or raw.startswith("pretrained_models") or "\\" in raw or os.sep in raw:
        if _local_whisper_ready(LOCAL_WHISPER_DIR):
            return str(LOCAL_WHISPER_DIR)
        return WHISPER_DEFAULT_MODEL

    return raw

_transcriber: Optional["WhisperTranscriber"] = None
_transcriber_error: Optional[str] = None
_lock = threading.Lock()


def clean_whisper_hallucinations(text: str) -> str:
    """Clean common Whisper hallucinations, YouTube tags, and loop repetitions."""
    if not text:
        return ""

    # Remove bracketed/parenthesized annotations like [applause], (music), ***
    cleaned = re.sub(r"\[.*?\]|\(.*?\)", " ", text).strip()
    cleaned = re.sub(r"\*+", " ", cleaned).strip()

    # Hallucination phrases (subtitles, youtube, silence triggers)
    lower = cleaned.lower().strip(" .,!?")
    hallucination_phrases = {
        "thank you for watching", "thanks for watching", "please subscribe",
        "subtitles by", "like and subscribe", "see you next time", "bye bye",
        "thank you so much for watching", "watch next", "translated by",
    }
    for phrase in hallucination_phrases:
        if lower == phrase:
            return ""
        if lower.startswith(phrase + " "):
            cleaned = cleaned[len(phrase):].strip()
        if lower.endswith(" " + phrase):
            cleaned = cleaned[:-len(phrase)].strip()

    # Collapse repetitive loops (e.g. "and then and then and then")
    cleaned = re.sub(r"\b(\w+(?:\s+\w+){0,2})(?:\s+\1){2,}\b", r"\1", cleaned, flags=re.IGNORECASE)

    return " ".join(cleaned.split())


def _normalize_transcript(text: str, is_vietnamese: bool = False) -> str:
    """Normalize transcript for display or pronunciation assessment."""
    text = clean_whisper_hallucinations(text)
    if not text:
        return ""

    if is_vietnamese:
        # Preserve Vietnamese characters, accents, and case
        text = re.sub(r"[^\w\s\u00C0-\u1EF9']", " ", text)
        return " ".join(text.split())

    # English: expand numbers, standardize apostrophes, uppercase
    text = expand_numbers_in_text(text)
    text = text.replace("’", "'").replace("‘", "'")
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
    """
    Bilingual Whisper ASR (EN/VI) — default: openai/whisper-large-v3-turbo (128-mel).
    Restricts language detection to allowed_languages (default: ('en', 'vi'))
    and returns both acoustic probabilities and combined Vietnamese percentage.
    """

    def __init__(
        self,
        model_name: str = WHISPER_DEFAULT_MODEL,
        language: str = "auto",
        device: Optional[str] = None,
        load_progress: Optional[Any] = None,
        torch_dtype: Optional[str] = "float16",
        max_new_tokens: int = 440,
        asr_config: Optional[Dict[str, Any]] = None,
        allowed_languages: Optional[Sequence[str]] = None,
    ):
        from transformers import WhisperForConditionalGeneration, WhisperProcessor

        asr_cfg = asr_config if asr_config is not None else _load_asr_config()
        self.device = torch.device(
            device or resolve_device({"asr": asr_cfg}, asr_cfg.get("device"))
        )
        lang_cand = (language or asr_cfg.get("language", "en")).strip().lower()
        self.language = "en" if lang_cand in ("auto", "", "none", "en", "english") else lang_cand

        raw_allowed = allowed_languages or asr_cfg.get("allowed_languages") or DEFAULT_ALLOWED_LANGUAGES
        norm_allowed = []
        for code in raw_allowed:
            c = str(code).strip().lower()
            if c and c not in norm_allowed:
                norm_allowed.append(c)
        norm_allowed = [c for c in norm_allowed if c not in ("vi", "vie", "vietnamese")] or ["en"]
        self.allowed_languages: Tuple[str, ...] = tuple(norm_allowed)

        self.model_name = _resolve_whisper_model_name(model_name)
        self.max_new_tokens = max_new_tokens
        self.beam_size = int(asr_cfg.get("beam_size", 4))
        dtype = _parse_dtype(torch_dtype, self.device)

        is_local = bool(self.model_name and os.path.isdir(self.model_name))
        if load_progress is not None:
            load_progress.start("whisper_proc", self.model_name)
        proc_kw = {"local_files_only": True} if is_local else {}
        self.processor = WhisperProcessor.from_pretrained(self.model_name, **proc_kw)
        if load_progress is not None:
            load_progress.finish("whisper_proc", self.model_name)
            load_progress.start("whisper_model", self.model_name)

        load_kw: Dict[str, Any] = {}
        if is_local:
            load_kw["local_files_only"] = True
        if self.device.type == "cuda" and dtype != torch.float32:
            load_kw["torch_dtype"] = dtype
        try:
            import accelerate  # noqa: F401
            load_kw["low_cpu_mem_usage"] = True
        except ImportError:
            pass

        self.model = WhisperForConditionalGeneration.from_pretrained(self.model_name, **load_kw)
        if getattr(self.model, "generation_config", None) is not None:
            self.model.generation_config.max_length = None
        self.model.to(self.device)
        self.model.eval()

        if load_progress is not None:
            load_progress.finish("whisper_model", self.model_name)

    def _get_allowed_lang_token_ids(self) -> Dict[str, int]:
        gen_cfg = getattr(self.model, "generation_config", None)
        lang_to_id = getattr(gen_cfg, "lang_to_id", None) or {}
        tok = getattr(self.processor, "tokenizer", None)
        unk_id = getattr(tok, "unk_token_id", None) if tok is not None else None
        mapping: Dict[str, int] = {}
        for code in self.allowed_languages:
            tid = lang_to_id.get(f"<|{code}|>")
            if tid is None:
                tid = lang_to_id.get(code)
            if tid is None and tok is not None and hasattr(tok, "convert_tokens_to_ids"):
                cand = tok.convert_tokens_to_ids(f"<|{code}|>")
                if isinstance(cand, int) and cand >= 0 and cand != unk_id:
                    tid = cand
            if isinstance(tid, int) and tid >= 0:
                mapping[code] = int(tid)
        return mapping

    def detect_language_probs(self, input_features: torch.Tensor) -> Tuple[str, Dict[str, float]]:
        """
        Detect language restricted strictly to self.allowed_languages (default: EN vs VI)
        and return (best_language, {lang_code: probability}).
        """
        allowed = self.allowed_languages or DEFAULT_ALLOWED_LANGUAGES
        if len(allowed) <= 1 or allowed == ("en",):
            return "en", {"en": 1.0}
        default_lang = allowed[0]

        if str(self.model_name).lower().endswith(".en"):
            return "en", {c: (1.0 if c == "en" else 0.0) for c in allowed}

        tid_map = self._get_allowed_lang_token_ids()
        codes = [c for c in allowed if c in tid_map]

        if codes and callable(self.model):
            try:
                gen_cfg = getattr(self.model, "generation_config", None)
                start_id = getattr(gen_cfg, "decoder_start_token_id", None)
                if start_id is None:
                    tok = getattr(self.processor, "tokenizer", None)
                    if tok is not None and hasattr(tok, "convert_tokens_to_ids"):
                        cand = tok.convert_tokens_to_ids("<|startoftranscript|>")
                        if isinstance(cand, int) and cand >= 0:
                            start_id = cand
                if start_id is None:
                    start_id = 50258

                batch_size = int(input_features.shape[0])
                dec_ids = torch.full(
                    (batch_size, 1),
                    int(start_id),
                    device=input_features.device,
                    dtype=torch.long,
                )
                with torch.no_grad():
                    out = self.model(
                        input_features=input_features[:, :, :3000],
                        decoder_input_ids=dec_ids,
                        use_cache=False,
                    )
                logits = getattr(out, "logits", None)
                tids = [tid_map[c] for c in codes]
                if logits is not None and int(logits.shape[-1]) > max(tids):
                    step_logits = logits[:, -1, :].float()
                    sub_logits = step_logits[:, tids]
                    probs_tensor = F.softmax(sub_logits, dim=-1).mean(dim=0)
                    probs = {c: float(probs_tensor[i].item()) for i, c in enumerate(codes)}
                    for c in allowed:
                        probs.setdefault(c, 0.0)
                    best_lang = max(codes, key=lambda c: probs[c])
                    return best_lang, probs
            except Exception:
                pass

        try:
            tokens = self.model.detect_language(input_features)
            lang_str = self.processor.tokenizer.decode(tokens[0]).strip().strip("<|>").lower()
            if lang_str not in allowed:
                lang_str = default_lang
            probs = {c: (1.0 if c == lang_str else 0.0) for c in allowed}
            return lang_str, probs
        except Exception:
            probs = {c: (1.0 if c == default_lang else 0.0) for c in allowed}
            return default_lang, probs

    def detect_language(self, input_features: torch.Tensor) -> str:
        """Detect language code restricted to self.allowed_languages ('en' or 'vi')."""
        lang, _ = self.detect_language_probs(input_features)
        return lang

    def _generate_with_lang(
        self,
        input_features: torch.Tensor,
        forced_lang: Optional[str] = None,
        prompt: Optional[str] = None,
    ) -> Tuple[str, str]:
        """Generate transcription and return (raw_text, detected_language)."""
        name = self.model_name.lower()
        max_pos = getattr(getattr(self.model, "config", None), "max_target_positions", 448)
        max_tokens = max(1, min(getattr(self, "max_new_tokens", 440), max_pos - 12))

        # English-only checkpoints have no language tokens
        if name.endswith(".en"):
            ids = self.model.generate(input_features, max_new_tokens=max_tokens)
            text = self.processor.batch_decode(ids, skip_special_tokens=True)[0]
            return text, "en"

        # Determine target language
        target_lang = forced_lang
        if not target_lang:
            if self.language in ("auto", "", "none"):
                target_lang = self.detect_language(input_features)
            else:
                target_lang = self.language

        # Decode with native language/task args first (required for whisper-large-v3 on transformers >= 4.41/5.x)
        prompt_ids = None
        if prompt:
            try:
                p_ids = self.processor.get_prompt_ids(prompt, return_tensors="pt")
                prompt_ids = p_ids.to(self.device)
            except Exception:
                prompt_ids = None

        prompt_len = int(prompt_ids.shape[-1]) if prompt_ids is not None else 0
        max_tokens = max(1, min(max_tokens, max_pos - prompt_len - 16))

        beam_size = getattr(self, "beam_size", 4)
        gen_kw: Dict[str, Any] = {
            "max_new_tokens": max_tokens,
            "language": target_lang,
            "task": "transcribe",
            "num_beams": beam_size,
            "no_repeat_ngram_size": 3,
        }
        if prompt_ids is not None:
            gen_kw["prompt_ids"] = prompt_ids

        try:
            ids = self.model.generate(
                input_features,
                **gen_kw,
            )
        except Exception:
            # Legacy fallback with explicit forced_decoder_ids for older transformers
            decoder_ids = self.processor.get_decoder_prompt_ids(
                language=target_lang,
                task="transcribe",
            )
            fallback_kw = {
                "max_new_tokens": max_tokens,
                "forced_decoder_ids": decoder_ids,
                "num_beams": beam_size,
                "no_repeat_ngram_size": 3,
            }
            if prompt_ids is not None:
                fallback_kw["prompt_ids"] = prompt_ids
            ids = self.model.generate(
                input_features,
                **fallback_kw,
            )

        text = self.processor.batch_decode(ids, skip_special_tokens=True)[0]
        return text, target_lang

    def _transcribe_waveform_with_meta(
        self,
        wav: torch.Tensor,
        *,
        language_override: Optional[str] = None,
        prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Process waveform tensor and return text and language metadata."""
        from infer.lang_id import compute_vietnamese_percent, text_looks_vietnamese

        target_mode = (language_override or self.language or "auto").strip().lower()
        inputs = self.processor(wav.numpy(), sampling_rate=WHISPER_SR, return_tensors="pt")
        model_dtype = getattr(self.model, "dtype", None)
        if model_dtype is not None:
            input_features = inputs.input_features.to(device=self.device, dtype=model_dtype)
        else:
            input_features = inputs.input_features.to(self.device)
            if self.device.type == "cuda" and input_features.dtype == torch.float32:
                input_features = input_features.half()

        # Pure forced-language mode (e.g., conversation/practice 'en'): skip language-ID forward pass
        if target_mode not in ("auto", "", "none"):
            raw_text, used_lang = self._generate_with_lang(input_features, forced_lang=target_mode, prompt=prompt)
            is_vi = used_lang in ("vi", "vie", "vietnamese")
            normalized_text = _normalize_transcript(raw_text, is_vietnamese=is_vi)
            return {
                "text": normalized_text,
                "raw_text": raw_text.strip(),
                "language": used_lang,
                "is_vietnamese": is_vi,
            }

        # Bilingual EN/VI auto mode (used by classroom language analysis)
        detected_lang, lang_probs = self.detect_language_probs(input_features)
        raw_text, used_lang = self._generate_with_lang(input_features, forced_lang=detected_lang)

        vi_prob = float(lang_probs.get("vi", 1.0 if used_lang == "vi" else 0.0))
        vi_stats = compute_vietnamese_percent(vi_prob, raw_text, detected_lang=used_lang)

        is_vi = (
            (used_lang in ("vi", "vie", "vietnamese"))
            or text_looks_vietnamese(raw_text)
            or (vi_stats["vi_percent"] >= 50.0)
        )
        final_lang = "vi" if is_vi else ("en" if used_lang not in ("vi", "vie", "vietnamese") else used_lang)

        normalized_text = _normalize_transcript(raw_text, is_vietnamese=is_vi)
        return {
            "text": normalized_text,
            "raw_text": raw_text.strip(),
            "language": final_lang,
            "is_vietnamese": is_vi,
            **vi_stats,
        }

    @torch.inference_mode()
    def transcribe_waveform(
        self,
        wav: Union[torch.Tensor, Any],
        sample_rate: int = WHISPER_SR,
        *,
        language: Optional[str] = None,
        skip_vad_check: bool = False,
        prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Transcribe an in-memory 1D mono waveform without temporary file I/O."""
        from infer.lang_id import compute_vietnamese_percent

        if not isinstance(wav, torch.Tensor):
            wav = torch.as_tensor(wav, dtype=torch.float32)
        else:
            wav = wav.detach().cpu().float()
        if wav.dim() > 1:
            wav = wav.mean(0)
        if sample_rate != WHISPER_SR and wav.numel() > 0:
            wav = torchaudio.functional.resample(wav, sample_rate, WHISPER_SR)

        if wav.numel() == 0:
            raise ValueError("File audio rỗng")
        if not skip_vad_check:
            peak_amp = float(wav.abs().max())
            rms = float(torch.sqrt(torch.mean(wav ** 2)))
            if peak_amp < 0.015 or rms < 0.003:
                raise ValueError(f"Không phát hiện tiếng người trong audio (VAD: peak={peak_amp:.4f}, rms={rms:.4f})")

        duration_sec = float(wav.shape[0]) / float(WHISPER_SR)

        # Adaptive Peak Gain Normalization: optimize dynamic range for quiet child speech (-0.5 dBFS)
        peak_val = float(wav.abs().max())
        if peak_val > 1e-4:
            target_peak = 0.95
            gain = min(target_peak / peak_val, 4.0)
            if gain > 1.15:
                wav = wav * gain

        chunk_samples = int(WHISPER_CHUNK_SEC * WHISPER_SR)
        target_mode = (language or self.language or "auto").strip().lower()

        if wav.shape[0] <= chunk_samples:
            res = self._transcribe_waveform_with_meta(wav, language_override=language, prompt=prompt)
            res["duration_sec"] = duration_sec
            return res

        parts_text = []
        parts_raw = []
        detected_languages = []
        is_vi_flags = []
        chunk_weights = []
        chunk_vi_probs = []

        for start in range(0, wav.shape[0], chunk_samples):
            chunk = wav[start : start + chunk_samples]
            chunk_res = self._transcribe_waveform_with_meta(chunk, language_override=language, prompt=prompt)
            if chunk_res["text"] or chunk_res["raw_text"]:
                parts_text.append(chunk_res["text"])
                parts_raw.append(chunk_res["raw_text"])
                detected_languages.append(chunk_res["language"])
                is_vi_flags.append(chunk_res["is_vietnamese"])
                w_sec = max(0.1, float(chunk.shape[0]) / float(WHISPER_SR))
                chunk_weights.append(w_sec)
                if "acoustic_vi_percent" in chunk_res or "language_probs" in chunk_res:
                    c_vi_prob = float((chunk_res.get("language_probs") or {}).get("vi", chunk_res.get("acoustic_vi_percent", 0.0) / 100.0))
                    chunk_vi_probs.append(c_vi_prob)

        combined_text = " ".join(p for p in parts_text if p)
        combined_raw = " ".join(p for p in parts_raw if p)

        if target_mode not in ("auto", "", "none"):
            is_any_vi = any(is_vi_flags)
            return {
                "text": combined_text,
                "raw_text": combined_raw,
                "language": target_mode,
                "is_vietnamese": is_any_vi,
                "duration_sec": duration_sec,
            }

        total_w = sum(chunk_weights) or 1.0
        avg_vi_prob = sum(p * w for p, w in zip(chunk_vi_probs, chunk_weights)) / total_w if chunk_vi_probs else 0.0
        overall_lang = "vi" if (any(is_vi_flags) or avg_vi_prob >= 0.5) else (detected_languages[0] if detected_languages else "en")
        vi_stats = compute_vietnamese_percent(avg_vi_prob, combined_raw or combined_text, detected_lang=overall_lang)
        is_any_vi = any(is_vi_flags) or (vi_stats["vi_percent"] >= 50.0)

        return {
            "text": combined_text,
            "raw_text": combined_raw,
            "language": "vi" if is_any_vi else "en",
            "is_vietnamese": is_any_vi,
            "duration_sec": duration_sec,
            **vi_stats,
        }

    @torch.inference_mode()
    def transcribe_with_meta(
        self,
        audio_path: PathLike,
        *,
        language: Optional[str] = None,
        prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Transcribe audio file and return metadata including detected language."""
        wav, sr = load_audio_file(audio_path)
        wav = wav.mean(0)
        return self.transcribe_waveform(wav, sample_rate=sr, language=language, prompt=prompt)

    @torch.inference_mode()
    def transcribe(self, audio_path: PathLike, prompt: Optional[str] = None) -> str:
        """Transcribe audio file and return normalized text string."""
        meta = self.transcribe_with_meta(audio_path, prompt=prompt)
        return meta["text"]


class Qwen3Transcriber:
    """ASR transcriber powered by Qwen3-ASR (e.g. Qwen/Qwen3-ASR-1.7B-hf)."""

    def __init__(
        self,
        model_name: str = "Qwen/Qwen3-ASR-1.7B-hf",
        language: str = "English",
        device: Optional[str] = None,
        load_progress: Optional[Any] = None,
        torch_dtype: str = "float16",
        max_new_tokens: int = 128,
        asr_config: Optional[Dict[str, Any]] = None,
        allowed_languages: Optional[Sequence[str]] = None,
    ):
        from transformers import AutoProcessor, AutoModelForMultimodalLM

        self.model_name = model_name or "Qwen/Qwen3-ASR-1.7B-hf"
        self.language = language or "English"
        if str(self.language).lower() in ("en", "english"):
            self.language = "English"
        elif str(self.language).lower() in ("vi", "vietnamese"):
            self.language = "Vietnamese"
        self.max_new_tokens = max_new_tokens

        if device is not None:
            self.device = torch.device(device)
        else:
            self.device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")

        is_local = bool(self.model_name and os.path.isdir(self.model_name))
        if load_progress is not None:
            load_progress.start("qwen3_proc", self.model_name)
        proc_kw: Dict[str, Any] = {"trust_remote_code": True}
        if is_local:
            proc_kw["local_files_only"] = True
        try:
            self.processor = AutoProcessor.from_pretrained(self.model_name, **proc_kw)
        except Exception as e:
            if "qwen3_asr" in str(e) or "model type" in str(e) or isinstance(e, KeyError):
                raise RuntimeError(
                    "Transformers phiên bản hiện tại chưa hỗ trợ kiến trúc 'qwen3_asr'. "
                    "Vui lòng nâng cấp thư viện bằng lệnh: pip install -U 'transformers>=5.0.0'"
                ) from e
            raise

        if load_progress is not None:
            load_progress.finish("qwen3_proc", self.model_name)
            load_progress.start("qwen3_model", self.model_name)

        target_dtype = torch.float16 if str(torch_dtype).lower() in ("float16", "fp16") else torch.float32
        load_kw: Dict[str, Any] = {
            "torch_dtype": target_dtype,
            "trust_remote_code": True,
        }
        if is_local:
            load_kw["local_files_only"] = True
        if self.device.type == "cuda":
            load_kw["device_map"] = {"": self.device}
        else:
            load_kw["device_map"] = "cpu"

        try:
            self.model = AutoModelForMultimodalLM.from_pretrained(
                self.model_name,
                **load_kw,
            )
        except Exception as e:
            if "qwen3_asr" in str(e) or "model type" in str(e) or isinstance(e, KeyError):
                raise RuntimeError(
                    "Transformers phiên bản hiện tại chưa hỗ trợ kiến trúc 'qwen3_asr'. "
                    "Vui lòng nâng cấp thư viện bằng lệnh: pip install -U 'transformers>=5.0.0'"
                ) from e
            raise

        if load_progress is not None:
            load_progress.finish("qwen3_model", self.model_name)

    @torch.inference_mode()
    def transcribe_waveform(
        self,
        waveform: torch.Tensor,
        sample_rate: int = 16000,
        *,
        language: Optional[str] = None,
        prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Transcribe waveform tensor and return metadata matching evaluation format."""
        if waveform.dim() > 1:
            waveform = waveform.mean(0)

        if sample_rate != 16000:
            import torchaudio.transforms as T
            resampler = T.Resample(orig_freq=sample_rate, new_freq=16000)
            waveform = resampler(waveform)
            sample_rate = 16000

        wav_np = waveform.detach().cpu().numpy()
        duration_sec = float(len(wav_np) / sample_rate)

        target_lang = language or self.language
        if target_lang and str(target_lang).lower() in ("en", "english"):
            target_lang = "English"
        elif target_lang and str(target_lang).lower() in ("vi", "vietnamese"):
            target_lang = "Vietnamese"
        elif target_lang and str(target_lang).lower() in ("auto", "none"):
            target_lang = None

        req_kw: Dict[str, Any] = {
            "audio": wav_np,
            "language": target_lang,
        }
        if prompt:
            req_kw["prompt"] = prompt

        inputs = self.processor.apply_transcription_request(**req_kw).to(self.model.device, self.model.dtype)

        output_ids = self.model.generate(**inputs, max_new_tokens=self.max_new_tokens)
        generated_ids = output_ids[:, inputs["input_ids"].shape[1]:]

        raw_text = self.processor.decode(generated_ids, return_format="transcription_only")[0].strip()
        normalized_text = _normalize_transcript(raw_text, is_vietnamese=False)

        return {
            "text": normalized_text,
            "raw_text": raw_text,
            "language": "en" if target_lang == "English" else (str(target_lang).lower() if target_lang else "en"),
            "is_vietnamese": False,
            "duration_sec": duration_sec,
            "vi_percent": 0.0,
            "char_count": len(raw_text),
            "word_count": len(raw_text.split()),
        }

    @torch.inference_mode()
    def transcribe_with_meta(
        self,
        audio_path: PathLike,
        *,
        language: Optional[str] = None,
        prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        wav, sr = load_audio_file(audio_path)
        wav = wav.mean(0)
        return self.transcribe_waveform(wav, sample_rate=sr, language=language, prompt=prompt)

    @torch.inference_mode()
    def transcribe(self, audio_path: PathLike, prompt: Optional[str] = None) -> str:
        meta = self.transcribe_with_meta(audio_path, prompt=prompt)
        return meta["text"]


def reset_transcriber() -> None:
    """Clear cached transcriber instance and free GPU memory."""
    global _transcriber, _transcriber_error
    with _lock:
        _transcriber = None
        _transcriber_error = None
        import gc
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def get_transcriber(
    load_progress: Optional[Any] = None,
    device: Optional[str] = None,
    asr_config: Optional[Dict[str, Any]] = None,
) -> Union[WhisperTranscriber, Qwen3Transcriber]:
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
            asr = asr_config if asr_config is not None else _load_asr_config()
            target_device = device or asr.get("device")
            engine = str(asr.get("engine", "")).strip().lower()
            model_name = str(asr.get("model_name", "")).strip()

            if engine == "qwen3" or "qwen3" in model_name.lower():
                _transcriber = Qwen3Transcriber(
                    model_name=model_name or "Qwen/Qwen3-ASR-1.7B-hf",
                    language=asr.get("language", "English"),
                    device=target_device,
                    load_progress=load_progress,
                    torch_dtype=asr.get("torch_dtype", "float16"),
                    max_new_tokens=int(asr.get("max_new_tokens", 128)),
                    asr_config=asr,
                    allowed_languages=asr.get("allowed_languages"),
                )
            else:
                _transcriber = WhisperTranscriber(
                    model_name=model_name or WHISPER_DEFAULT_MODEL,
                    language=asr.get("language", "auto"),
                    device=target_device,
                    load_progress=load_progress,
                    torch_dtype=asr.get("torch_dtype", "float16"),
                    max_new_tokens=int(asr.get("max_new_tokens", 440)),
                    asr_config=asr,
                    allowed_languages=asr.get("allowed_languages"),
                )
        except Exception as exc:
            _transcriber_error = str(exc)
            if load_progress is not None:
                load_progress.fail_running(str(exc))
            raise RuntimeError(_transcriber_error) from exc
        return _transcriber


def transcribe_audio(
    audio_path: PathLike,
    *,
    asr_config: Optional[Dict[str, Any]] = None,
    prompt: Optional[str] = None,
) -> str:
    """Convenience helper returning normalized transcript string."""
    return get_transcriber(asr_config=asr_config).transcribe(audio_path, prompt=prompt)


def transcribe_audio_with_meta(
    audio_path: PathLike,
    *,
    asr_config: Optional[Dict[str, Any]] = None,
    prompt: Optional[str] = None,
) -> Dict[str, Any]:
    """Convenience helper returning transcript with language and detection metadata."""
    return get_transcriber(asr_config=asr_config).transcribe_with_meta(audio_path, prompt=prompt)
