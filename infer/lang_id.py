"""Language identification — filter non-English / Vietnamese speech segments."""

from __future__ import annotations

import re
import threading
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

PathLike = str | Path

_VI_CHARS = re.compile(
    r"[\u0103\u0102\u00e2\u00c2\u00ea\u00ca\u00f4\u00d4\u01a1\u01a0\u01b0\u01af"
    r"\u00e0\u00e1\u00e3\u00e4\u00e5\u00e8\u00e9\u00eb\u00ec\u00ed\u00f2\u00f3"
    r"\u00f5\u00f9\u00fa\u00fd\u0111\u0110\u1ea0-\u1ef9]",
    re.UNICODE,
)

# Common Vietnamese words mis-heard by English-only Whisper
_VI_WORDS = re.compile(
    r"\b(V[AĂÂÁẠẢÃ]NG|KH[OÔÓỌỎÕ]NG|Đ[UƯÚỤỦŨ]|T[ÔƠÓỌỎÕ]I|C[OÔÓỌỎÕ]|M[UƯÚỤỦŨ]ON|"
    r"EM|ANH|CH[ÀAÁẠẢÃ]|KH[OÔ]|B[AĂÂÁẠẢÃ]N|NH[EÊÉẸẺẼ]|R[AĂÂÁẠẢÃ]T|N[ÀAÁẠẢÃ]Y|"
    r"G[IÍỊỈĨ]|H[OÔÓỌỎÕ]C|TI[ẾEÉẸẺẼ]NG|VI[EÊÉẸẺẼ]T)\b",
    re.IGNORECASE,
)

_classifier = None
_classifier_error: Optional[str] = None
_lock = threading.Lock()

# ISO 639-1 / SpeechBrain label fragments treated as Vietnamese
_VI_CODES = frozenset({"vi", "vie", "vietnamese"})


def _load_asr_lang_cfg() -> Dict[str, Any]:
    try:
        import yaml
        from paths import PRONUNCIATION_CONFIG

        with open(PRONUNCIATION_CONFIG, encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
        return (cfg.get("asr") or {}).get("lang_id") or {}
    except Exception:
        return {}


def _normalize_lang(label: str) -> str:
    s = (label or "").strip().lower()
    if ":" in s:
        s = s.split(":", 1)[0].strip()
    if " " in s:
        s = s.split()[0]
    return s


def _get_classifier(device: str = "cpu"):
    global _classifier, _classifier_error
    if _classifier is not None:
        return _classifier
    if _classifier_error:
        return None
    with _lock:
        if _classifier is not None:
            return _classifier
        if _classifier_error:
            return None
        try:
            from speechbrain.inference.classifiers import EncoderClassifier

            from paths import ROOT

            savedir = ROOT / "pretrained_models" / "lang-id-voxlingua107-ecapa"
            _classifier = EncoderClassifier.from_hparams(
                source="speechbrain/lang-id-voxlingua107-ecapa",
                savedir=str(savedir),
                run_opts={"device": device},
            )
        except Exception as exc:
            _classifier_error = str(exc)
            print(f"[lang_id] Không tải được model LID: {exc}", flush=True)
            return None
        return _classifier


def detect_audio_language(
    audio_path: PathLike,
    *,
    device: str = "cpu",
) -> Tuple[Optional[str], float]:
    """Return (language_code, confidence) e.g. ('en', 0.92) or (None, 0)."""
    clf = _get_classifier(device)
    if clf is None:
        return None, 0.0
    try:
        out = clf.classify_file(str(audio_path))
        if isinstance(out, (list, tuple)):
            if len(out) >= 4:
                score = float(out[1]) if out[1] is not None else 0.0
                label = str(out[3])
            elif len(out) >= 2:
                score = float(out[0].max()) if hasattr(out[0], "max") else 0.0
                label = str(out[1][0]) if hasattr(out[1], "__getitem__") else str(out[1])
            else:
                return None, 0.0
        else:
            return None, 0.0
        return _normalize_lang(label), score
    except Exception as exc:
        print(f"[lang_id] classify_file lỗi: {exc}", flush=True)
        return None, 0.0


def text_looks_vietnamese(text: str) -> bool:
    if not text or not text.strip():
        return False
    if _VI_CHARS.search(text):
        return True
    if _VI_WORDS.search(text.upper()):
        return True
    return False


def is_vietnamese_segment(
    audio_path: PathLike,
    transcript: str = "",
    *,
    device: str = "cpu",
    cfg: Optional[Dict[str, Any]] = None,
) -> Tuple[bool, str]:
    """
    True if segment should be dropped as Vietnamese.
    Returns (drop, reason).
    """
    cfg = cfg or _load_asr_lang_cfg()
    if not cfg.get("enabled", True):
        return False, ""

    drop_langs = {_normalize_lang(x) for x in cfg.get("drop_languages", ["vi", "vie", "vietnamese"])}
    min_conf = float(cfg.get("min_confidence", 0.45))

    if cfg.get("text_vi_regex", True) and text_looks_vietnamese(transcript):
        return True, "text"

    lang, conf = detect_audio_language(audio_path, device=device)
    if lang is None:
        return False, ""

    if lang in drop_langs and conf >= min_conf:
        return True, f"audio:{lang}:{conf:.2f}"

    # SpeechBrain sometimes returns full name
    if any(v in lang for v in ("viet", "vietnam")) and conf >= min_conf:
        return True, f"audio:{lang}:{conf:.2f}"

    return False, ""
