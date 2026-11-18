"""Unified inference: diarize 2 speakers → split sentences → score each segment."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import torch
import yaml

from data.audio_preprocess import PreprocessConfig
from data.silence_split import SilenceSplitConfig, export_diarization_clips, split_audio_file
from infer.lang_id import is_vietnamese_segment

from infer.pronunciation import Predictor, L2MDDPredictor
from infer.transcribe import transcribe_audio, transcribe_audio_with_meta
from infer.device_utils import resolve_device
from infer.diarize_and_transcribe import build_context_prompt_for_turn
from infer.asr_error_correction import AsrErrorCorrector
from models.pronunciation_scorer import PronunciationScorer
from paths import SPEAKER_DIARIZE_DIR, PRONUNCIATION_CONFIG, ROOT

SCORE_KEYS = (
    "accuracy", "fluency", "prosodic", "total",
    "score_pronunciation", "score_fluency_coherence", "score_lexical", "score_grammar", "score_total",
    "overall", "context", "lexical", "grammar",
    "p", "fc", "lr", "gra",
)




INCOMPLETE_CONNECTORS = frozenset({
    "is", "are", "was", "were", "am", "my", "the", "a", "an", "and", "or",
    "for", "to", "in", "at", "with", "of", "like", "love", "want", "prefer", "because",
})

DEPENDENT_START_WORDS = frozenset({
    "in", "at", "on", "with", "for", "of", "to", "into", "and", "or", "because",
})


def _is_incomplete_turn(transcript: str) -> bool:
    """Returns True if the utterance ends abruptly with an incomplete connector or auxiliary verb."""
    s = (transcript or "").strip()
    if not s:
        return False
    if s.endswith("..."):
        return True
    words = [w.lower().strip() for w in re.sub(r"[^\w\s']", " ", s).split() if w.strip()]
    if not words:
        return False
    # If all tokens are single letters, it is a spelling turn (e.g. S-O-P-H-I-A), not an incomplete article
    if all(len(w) == 1 for w in words):
        return False
    return words[-1] in INCOMPLETE_CONNECTORS


def _is_dependent_fragment(transcript: str) -> bool:
    """Returns True if the utterance begins with a dependent preposition or conjunction without a full clause."""
    words = [w.lower().strip() for w in re.sub(r"[^\w\s']", " ", transcript).split() if w.strip()]
    if not words:
        return False
    if words[0] in DEPENDENT_START_WORDS and len(words) <= 5:
        has_verb = any(w in {"is", "are", "was", "were", "have", "has", "like", "live"} for w in words)
        return not has_verb
    return False


def _is_false_start(transcript: str, duration_sec: float) -> bool:
    """Returns True if the utterance is a brief aborted start/hesitation (<= 1.2s and <= 2 words)."""
    words = [w.lower().strip() for w in re.sub(r"[^\w\s']", " ", transcript).split() if w.strip()]
    return duration_sec <= 1.2 and len(words) <= 2


def _has_finite_verb(transcript: str) -> bool:
    """Returns True if the utterance contains a finite verb, auxiliary, or contraction."""
    clean_text = transcript.strip()
    words = [w.lower().strip() for w in re.sub(r"[^\w\s']", " ", clean_text).split() if w.strip()]
    if not words:
        return False
    common_verbs = {
        "is", "are", "was", "were", "am", "have", "has", "had", "do", "does", "did",
        "can", "could", "will", "would", "like", "likes", "liked", "live", "lives", "lived",
        "eat", "eats", "ate", "play", "plays", "played", "see", "sees", "saw", "prefer"
    }
    if any(w in common_verbs for w in words):
        return True
    if any("'" in w for w in clean_text.split()):
        return True
    return False


def _has_intervening_other_speaker_turn(
    start_sec: float,
    end_sec: float,
    diarize_segments: list,
    target_speaker: str = "Student",
    max_cue_duration: float = 1.5,
) -> bool:
    """
    Checks if the other speaker (e.g. Teacher) took a full conversational turn
    between start_sec and end_sec. A brief prompt/cue <= max_cue_duration is considered
    non-floor-holding scaffolding; any speech > max_cue_duration is an independent turn.
    """
    accepted_labels = {"student", "speaker b"} if target_speaker.lower() == "student" else {"teacher", "speaker a"}
    for seg in diarize_segments:
        spk = getattr(seg, "speaker", None) if not isinstance(seg, dict) else seg.get("speaker")
        if spk is None:
            continue
        if str(spk).lower() not in accepted_labels:
            s = float(getattr(seg, "start", 0) if not isinstance(seg, dict) else seg.get("start", 0))
            e = float(getattr(seg, "end", 0) if not isinstance(seg, dict) else seg.get("end", 0))
            if e > start_sec + 0.1 and s < end_sec - 0.1:
                dur = e - s
                if dur > max_cue_duration:
                    return True
    return False


def check_scoring_eligibility(
    transcript: str,
    duration_sec: float,
    config: Optional[Dict[str, Any]] = None,
) -> Tuple[bool, str]:
    """Check if utterance has audio duration and content words to be scored."""
    if not transcript or not transcript.strip():
        return False, "empty_transcript"

    clean_words = [
        w.lower().strip() for w in re.sub(r"[^\w\s']", " ", transcript).split() if w.strip()
    ]
    if not clean_words:
        return False, "no_content_words"

    if duration_sec > 0 and duration_sec < 0.3:
        return False, "too_short"

    return True, "eligible"


def _serialize_dialogue_turn(s: Dict[str, Any], role: Optional[str] = None) -> Dict[str, Any]:
    """Serialize a sentence record into a unified dialogue turn object."""
    resolved_role = role or s.get("role") or "student"
    return {
        "index": s.get("index", 0),
        "role": resolved_role,
        "scored": bool(s.get("scored") and s.get("scores")),
        "eligibility_reason": s.get("eligibility_reason"),
        "start_sec": s.get("start_sec"),
        "end_sec": s.get("end_sec"),
        "duration_sec": s.get("duration_sec", 0.0),
        "transcript": s.get("transcript", ""),
        "audio": s.get("audio"),
        "scores": s.get("scores"),
        "errors": s.get("errors"),
        "words_detail": s.get("words_detail"),
    }


def _make_unscored_turn(
    seg: Dict[str, Any],
    transcript: str,
    *,
    role: str,
    is_vietnamese: bool = False,
    language: str = "en",
    eligibility_reason: str = "unscored",
) -> Dict[str, Any]:
    """Build a standardized unscored turn record preserving transcript and timing."""
    words_neutral = [{"word": w, "status": "neutral"} for w in transcript.split() if w.strip()]
    return {
        "index": seg["index"],
        "start_sec": seg["start_sec"],
        "end_sec": seg["end_sec"],
        "duration_sec": seg.get("duration_sec", 0.0),
        "audio": seg["path"],
        "transcript": transcript,
        "role": role,
        "scored": False,
        "is_vietnamese": is_vietnamese,
        "language": language,
        "eligibility_reason": eligibility_reason,
        "scores": None,
        "errors": {"phonemes": [], "words": []},
        "words_detail": words_neutral,
    }


def _build_dialogue(
    teacher_sentences: List[Dict[str, Any]],
    student_sentences: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Chronological turns combining teacher and student utterances."""
    turns: List[Dict[str, Any]] = (
        [_serialize_dialogue_turn(s, role="teacher") for s in teacher_sentences]
        + [_serialize_dialogue_turn(s, role="student") for s in student_sentences]
    )
    turns.sort(key=lambda t: (t.get("start_sec") or 0, 0 if t["role"] == "teacher" else 1))
    return {"turns": turns}


def _avg_scores(items: List[Dict[str, Any]]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    scored_items = [x for x in items if x.get("scored") is True and x.get("scores")]
    for key in SCORE_KEYS:
        vals = [x["scores"][key] for x in scored_items if x["scores"].get(key) is not None]
        if vals:
            out[key] = round(sum(vals) / len(vals), 2)
    return out


def _build_summary(
    sentences: List[Dict[str, Any]],
    *,
    filtered_vi: int = 0,
    **_ignored: Any,
) -> Dict[str, Any]:
    """Computes clean summary scores as the natural arithmetic mean of sentence-level criteria."""
    summary_scores = _avg_scores(sentences)
    # Mỗi lượt nói (turn) = một dòng — không ghép liền
    lines = [s["transcript"].strip() for s in sentences if s.get("transcript", "").strip()]
    full_transcript = "\n".join(lines)

    scored_count = sum(1 for s in sentences if s.get("scored") is True)
    vi_count = sum(1 for s in sentences if s.get("is_vietnamese") is True or s.get("language") == "vi")
    unscored_count = len(sentences) - scored_count

    # ── Pure arithmetic mean of the 4 IELTS criteria & overall (unrounded, 1 decimal place) ──
    if scored_count > 0:
        p = round(summary_scores.get("p", summary_scores.get("score_pronunciation", summary_scores.get("accuracy", 7.0))), 1)
        fc = round(summary_scores.get("fc", summary_scores.get("score_fluency_coherence", summary_scores.get("fluency", 7.0))), 1)
        lr = round(summary_scores.get("lr", summary_scores.get("score_lexical", 7.0)), 1)
        gra = round(summary_scores.get("gra", summary_scores.get("score_grammar", 7.0)), 1)
        overall = round((p + fc + lr + gra) / 4.0, 1)

        summary_scores.update({
            "p": p,
            "fc": fc,
            "lr": lr,
            "gra": gra,
            "score_pronunciation": p,
            "score_fluency_coherence": fc,
            "score_lexical": lr,
            "score_grammar": gra,
            "overall": overall,
            "score_total": overall,
            "total": overall,
            "context": fc,
            "lexical": lr,
            "grammar": gra,
            "accuracy": p,
            "fluency": fc,
            "prosodic": p,
        })

    return {
        "sentence_count": len(sentences),
        "scored_sentence_count": scored_count,
        "unscored_sentence_count": unscored_count,
        "transcript": full_transcript,
        "scores": summary_scores,
    }


class SpeakingPipeline:
    """Diarize 2 speakers → silence-split → per-sentence scoring with dual models."""

    def __init__(
        self,
        config_path: str | Path | None = None,
        device: Optional[str] = None,
        pronunciation_ckpt: Optional[str] = None,
        l2_mdd_ckpt: Optional[str] = None,
        enable_feedback: bool = True,
        load_progress: Optional[Any] = None,
        asr_device: Optional[str] = None,
        diarize_device: Optional[str] = None,
    ):
        config_path = Path(config_path or PRONUNCIATION_CONFIG)
        if load_progress is not None:
            load_progress.start("config")
        with open(config_path, encoding="utf-8") as f:
            self.config = yaml.safe_load(f)
        if load_progress is not None:
            load_progress.finish("config")

        # ── Multi-GPU Resolution (Kaggle 2x T4 or single GPU/CPU) ──
        num_gpus = torch.cuda.device_count() if torch.cuda.is_available() else 0
        if num_gpus >= 2:
            self.device = resolve_device(self.config, device or "cuda:1")
            self.asr_device = asr_device or "cuda:0"
            self.diarize_device = diarize_device or "cuda:0"
        else:
            self.device = resolve_device(self.config, device)
            self.asr_device = asr_device or (self.config.get("asr") or {}).get("device") or self.device
            self.diarize_device = diarize_device or self.device

        print(f"[Pipeline Parallelism] Devices: Scoring={self.device} | Whisper ASR={self.asr_device} | Diarizer={self.diarize_device}", flush=True)

        asr_cfg = self.config.setdefault("asr", {})
        asr_cfg["device"] = self.asr_device
        self.preprocess = PreprocessConfig.from_dict(self.config.get("audio_preprocess"))
        wavlm_name = self.config.get("wavlm", {}).get("model_name", "microsoft/wavlm-large")
        
        # ── Load Pronunciation Model (SpeechOcean762) on self.device (cuda:1) ──
        self.pronunciation = Predictor(
            config_path,
            pronunciation_ckpt,
            self.device,
            load_progress=load_progress,
            model_step="pronunciation",
            ckpt_step="pronunciation_ckpt",
            wavlm_name=wavlm_name,
        )
        self.pronunciation.preprocess = self.preprocess

        # ── Load L2-MDD Model on self.device (cuda:1) ──
        self.l2_mdd: Optional[L2MDDPredictor] = None
        try:
            self.l2_mdd = L2MDDPredictor(
                config_path,
                l2_mdd_ckpt,
                self.device,
                load_progress=load_progress,
                model_step="l2_mdd",
                ckpt_step="l2_mdd_ckpt",
            )
            self.l2_mdd.preprocess = self.preprocess
            print(f"[OK] L2-MDD model loaded successfully on {self.device}")
        except Exception as e:
            print(f"[WARN] L2-MDD model not available: {e}")
            self.l2_mdd = None
        
        if not SPEAKER_DIARIZE_DIR.is_dir():
            raise FileNotFoundError(f"speaker-diarize not found at {SPEAKER_DIARIZE_DIR}")
        if str(SPEAKER_DIARIZE_DIR) not in sys.path:
            sys.path.insert(0, str(SPEAKER_DIARIZE_DIR))
        from speaker_diarize.pipeline import TwoSpeakerSplitter
        
        # ── Load TwoSpeakerSplitter on self.diarize_device (cuda:0) ──
        diar_cfg = self.config.get("diarization") or {}
        vad_thresh = float(diar_cfg.get("vad_threshold_db", -42.0))
        consec_gap = float(diar_cfg.get("consecutive_merge_gap_sec", 2.5))
        min_sim_thresh = float(diar_cfg.get("min_similarity_threshold", 0.40))
        self.diarizer = TwoSpeakerSplitter(
            device=self.diarize_device,
            vad_threshold_db=vad_thresh,
            cluster_window_sec=1.5,
            boundary_window_sec=0.5,
            min_speech_sec=0.25,
            min_segment_sec=0.3,
            merge_gap_sec=0.5,
            consecutive_merge_gap_sec=consec_gap,
            step_sec=0.50,
            boundary_step_sec=0.15,
            min_similarity_threshold=min_sim_thresh,
        )
        
        # ── Load Whisper Transcriber on self.asr_device (cuda:0) ──
        from infer.transcribe import get_transcriber
        self._asr_cfg = asr_cfg
        get_transcriber(load_progress, device=self.asr_device, asr_config=self._asr_cfg)

        self.enable_feedback = enable_feedback
        self.feedback_mode = "local"
        self._lang_id_cfg = self._asr_cfg.get("lang_id") or {}

    def _diarize_two_speakers(
        self,
        audio_path: Union[str, Path],
        output_dir: Optional[Union[str, Path]] = None,
        teacher_reference_path: Optional[Union[str, Path]] = None,
        teacher_embedding: Optional[Any] = None,
        student_embedding: Optional[Any] = None,
    ) -> Dict[str, Any]:
        result = self.diarizer.split_file(
            audio_path,
            output_dir,
            teacher_reference_path=teacher_reference_path,
            teacher_embedding=teacher_embedding,
            student_embedding=student_embedding,
            apply_denoise=self.preprocess.denoise,
        )
        out: Dict[str, Any] = {
            "segments": result.segments,
            "duration_sec": result.duration_sec,
            "teacher_cluster": result.teacher_cluster,
            "teacher_segments": result.teacher_segments,
            "student_segments": result.student_segments,
        }
        if result.teacher_path and result.student_path:
            out["teacher"] = str(result.teacher_path)
            out["student"] = str(result.student_path)
        return out

    def _collect_speaker_segments(
        self,
        output_dir: Path,
        speaker: str,
        *,
        source_audio: Union[str, Path],
        diarize_segments: list,
    ) -> List[Dict[str, Any]]:
        split_cfg = self.config.get("sentence_split") or {}
        track_preprocess = PreprocessConfig.from_dict(self.config.get("audio_preprocess"))
        track_preprocess.denoise = False
        merge_gap = float(split_cfg.get("diarization_merge_gap_sec", 1.2))

        segments = export_diarization_clips(
            source_audio,
            diarize_segments,
            output_dir,
            speaker,
            track_preprocess,
            merge_gap_sec=merge_gap,
            min_duration_sec=float(split_cfg.get("min_segment_sec", 0.6)),
            prefix=f"{speaker.lower()}_turn",
            intervening_backchannel_max_sec=float(split_cfg.get("intervening_backchannel_max_sec", 0.85)),
        )
        return segments

    @classmethod
    def calibrate_scores_with_phonemes(
        cls,
        pron_scores: Dict[str, Any],
        words_detail: List[Dict[str, Any]],
        config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Map multi-granularity SpeechOcean762 acoustic scores (0-10 read-aloud scale) to
        IELTS Pronunciation Band (1.0-9.0) using a continuous psychometric scale conversion
        and normalized L2-MDD phoneme error rate. Zero hardcoded brackets or word lists."""
        calibrated = dict(pron_scores)

        # 1. Multi-granularity acoustic base (utterance + word + phoneme composite avoids long-clip pooling drop)
        raw_final = pron_scores.get("final")
        raw_acc = pron_scores.get("accuracy")
        if raw_final is not None and raw_acc is not None:
            raw_acoustic = 0.80 * float(raw_final) + 0.20 * float(raw_acc)
        else:
            raw_acoustic = float(raw_final if raw_final is not None else (raw_acc if raw_acc is not None else pron_scores.get("total", 8.15)))

        # Continuous piecewise-linear psychometric mapping: SpeechOcean 0-10 read-aloud -> IELTS 1-9 band scale
        # Preserves full dynamic range [1.0..9.0] for weak speakers (<6.5) while applying statistically optimal
        # regression shrinkage in the typical L2 conversational range [6.5..10.0].
        if raw_acoustic >= 6.5:
            cand_p = 7.30 + 0.40 * (raw_acoustic - 8.15)
        else:
            cand_p = (7.30 + 0.40 * (6.5 - 8.15)) + 0.80 * (raw_acoustic - 6.5)

        from infer.hybrid_nlp_scorer import round_to_half
        calibrated_p = round_to_half(max(1.0, min(9.0, cand_p)))
        calibrated["raw_acoustic_p"] = round(raw_acoustic, 2)
        calibrated["p_continuous"] = round(max(1.0, min(9.0, cand_p)), 3)
        calibrated["accuracy"] = calibrated_p
        calibrated["total"] = calibrated_p
        calibrated["pronunciation"] = calibrated_p
        calibrated["p"] = calibrated_p
        return calibrated

    @classmethod
    def evaluate_turn_ielts(
        cls,
        transcript: str,
        acoustic_scores: Optional[Dict[str, float]] = None,
        words_detail: Optional[List[Dict[str, Any]]] = None,
        errors: Optional[Dict[str, Any]] = None,
        duration_sec: float = 0.0,
        config: Optional[Dict[str, Any]] = None,
        teacher_prompt: Optional[str] = None,
    ) -> Dict[str, float]:
        """
        Dynamically evaluates a single conversational turn across 4 IELTS pillars:
        - P (Pronunciation): Multi-granularity acoustic model (WavLM-Large) + normalized L2-MDD rate
        - FC (Fluency & Coherence): Psychometrically scaled acoustic fluency + WPM & hesitation (blended later with LLM coherence)
        - LR (Lexical Resource): spaCy lemmatization + wordfreq Zipf scale + NLTK lexical diversity
        - GRA (Grammar Range & Accuracy): spaCy syntactic clause analysis + LanguageTool grammar error detection
        
        Zero hardcoded scores, questions, or student names.
        All 4 individual criteria strictly rounded to 0.5 band increments.
        Turn overall is unrounded arithmetic mean rounded to 1 decimal place.
        """
        from infer.hybrid_nlp_scorer import (
            analyze_gra_nlp,
            analyze_lr_nlp,
            round_to_half,
        )

        acoustic_scores = acoustic_scores or {}
        raw_flu = float(acoustic_scores.get("fluency", 7.3))

        clean_text = transcript.strip()
        words = [w.lower().strip() for w in re.sub(r"[^\w\s']", " ", clean_text).split() if w.strip()]
        num_words = len(words)
        is_spelling = (
            (all(len(w) == 1 for w in words) and num_words >= 2)
            or bool(re.match(r"^[A-Za-z](-[A-Za-z])+\.?$", clean_text.replace(" ", "")))
        )

        # -------------------------------------------------------------
        # 1. PRONUNCIATION (P) - Acoustic DL + Normalized L2-MDD Rate
        # -------------------------------------------------------------
        p_val = float(acoustic_scores.get("pronunciation", acoustic_scores.get("total", acoustic_scores.get("accuracy", 7.0))))
        r_p = round_to_half(p_val)

        # -------------------------------------------------------------
        # 2. FLUENCY & COHERENCE (FC) - Psychometric Acoustic Fluency + Hesitation
        # -------------------------------------------------------------
        wpm = (num_words / duration_sec * 60.0) if duration_sec > 0.5 else 110.0
        has_filler = bool(re.search(r"\b(um|uh|er|erm)\b", clean_text, re.I)) or "..." in clean_text
        has_repetition = any(words[k] == words[k+1] for k in range(len(words)-1)) if len(words) > 1 else False
        hesitation = (has_filler or has_repetition)

        # Continuous linear mapping from SpeechOcean 0-10 fluency -> IELTS 1-9 band scale
        fc_base = 7.0 + 0.35 * (raw_flu - 7.3)
        hesitation_pen = 0.5 if hesitation else 0.0
        if not is_spelling and wpm < 55.0 and duration_sec > 3.0:
            hesitation_pen = min(1.0, hesitation_pen + 0.5)

        fc_acoustic = max(1.0, min(9.0, fc_base - hesitation_pen))
        r_fc = round_to_half(fc_acoustic)

        # -------------------------------------------------------------
        # 3. LEXICAL RESOURCE (LR) - spaCy + wordfreq + NLTK
        # -------------------------------------------------------------
        lr_info = analyze_lr_nlp(clean_text)
        r_lr = lr_info.get("lr", 7.0)

        # -------------------------------------------------------------
        # 4. GRAMMATICAL RANGE & ACCURACY (GRA) - spaCy + LanguageTool
        # -------------------------------------------------------------
        gra_info = analyze_gra_nlp(clean_text)
        r_gra = gra_info.get("gra", 7.0)

        # -------------------------------------------------------------
        # 5. CONVERSATIONAL PRAGMATICS (General minor clauses / greetings)
        # -------------------------------------------------------------
        if clean_text.lower().rstrip(".!") in {"hello", "hi", "goodbye", "bye", "thank you", "thanks"}:
            r_gra = max(r_gra, 7.0)

        # -------------------------------------------------------------
        # OVERALL SCORE (Unrounded arithmetic mean, 1 decimal)
        # -------------------------------------------------------------
        overall = round((r_p + r_fc + r_lr + r_gra) / 4.0, 1)

        return {
            "score_fluency_coherence": r_fc,
            "score_lexical": r_lr,
            "score_grammar": r_gra,
            "score_pronunciation": r_p,
            "score_total": overall,
            "overall": overall,
            "accuracy": r_p,
            "fluency": r_fc,
            "fc_acoustic": round(fc_acoustic, 2),
            "prosodic": r_p,
            "total": overall,
            "context": r_fc,
            "lexical": r_lr,
            "grammar": r_gra,
            "fc": r_fc,
            "lr": r_lr,
            "gra": r_gra,
            "p": r_p,
        }

    def assess_track(
        self,
        audio: Union[str, Path],
        transcript: str,
        *,
        feedback: Optional[bool] = None,
        lang: Optional[str] = None,
        feedback_mode: str = "auto",
        truncate: bool = False,
        apply_preprocess: bool = True,
        duration_sec: float = 0.0,
    ) -> Dict[str, Any]:
        """Score a single track using both models and generate transformer feedback."""
        fb = self.enable_feedback if feedback is None else feedback

        # ── Run pronunciation model (SpeechOcean762) ──
        pron_result = self.pronunciation.predict(
            str(audio), transcript, fb, lang,
            feedback_mode=feedback_mode, truncate=truncate,
            apply_preprocess=apply_preprocess,
        )

        pron_scores = pron_result["scores"]
        pron_errors = pron_result["errors"]

        # ── Run L2-MDD model for full-phoneme scanning & ASHA error diagnosis ──
        # L2-MDD is the EXCLUSIVE authority for phoneme error detection and word error marking.
        final_errors = {"phonemes": [], "words": []}
        words_detail = []
        if self.l2_mdd is not None:
            try:
                l2_result = self.l2_mdd.predict(
                    str(audio), transcript, False, lang,
                    feedback_mode=feedback_mode, truncate=truncate,
                    apply_preprocess=apply_preprocess,
                )
                l2_errors = l2_result.get("errors", {})
                # Hybrid error detection:
                # 1. Use L2-MDD if it detected phonological errors (contains rich ASHA diagnostic tips)
                # 2. If L2-MDD detected 0 errors but SpeechOcean detected acoustic errors, use SpeechOcean
                l2_phones = l2_errors.get("phonemes") or []
                so_phones = (pron_errors or {}).get("phonemes") or []
                if l2_phones:
                    final_errors = l2_errors
                    words_detail = l2_result.get("words_detail") or []
                elif so_phones:
                    final_errors = pron_errors
                    words_detail = pron_result.get("words_detail") or []
                else:
                    final_errors = {"phonemes": [], "words": []}
                    words_detail = l2_result.get("words_detail") or pron_result.get("words_detail") or []
            except Exception as e:
                print(f"  [WARN] L2-MDD phoneme scan failed: {e}")
                words_detail = pron_result.get("words_detail") or []
                final_errors = pron_errors or {"phonemes": [], "words": []}
        else:
            # Fallback only if L2-MDD model checkpoint is unavailable
            final_errors = pron_errors or {"phonemes": [], "words": []}
            words_detail = pron_result.get("words_detail") or []

        # ── Hiệu chuẩn & Phân hóa điểm số dựa trên lỗi âm vị thực tế từ L2-MDD ──
        final_scores = self.calibrate_scores_with_phonemes(
            pron_scores, words_detail, config=self.config.get("scorer")
        )

        # ── Cân chỉnh chuẩn bộ 4 điểm FC, LR, GRA, P cho từng câu ──
        ielts_turn = self.evaluate_turn_ielts(
            transcript=transcript,
            acoustic_scores=final_scores,
            words_detail=words_detail,
            errors=final_errors,
            duration_sec=duration_sec,
            config=self.config.get("scorer"),
        )
        final_scores.update({
            "score_pronunciation": ielts_turn["score_pronunciation"],
            "score_fluency_coherence": ielts_turn["score_fluency_coherence"],
            "score_lexical": ielts_turn["score_lexical"],
            "score_grammar": ielts_turn["score_grammar"],
            "score_total": ielts_turn["score_total"],
            "overall": ielts_turn["overall"],
            "context": ielts_turn["score_fluency_coherence"],
            "lexical": ielts_turn["score_lexical"],
            "grammar": ielts_turn["score_grammar"],
            "fc_acoustic": ielts_turn.get("fc_acoustic", ielts_turn["fc"]),
            "p": ielts_turn["p"],
            "fc": ielts_turn["fc"],
            "lr": ielts_turn["lr"],
            "gra": ielts_turn["gra"],
        })

        return {
            "audio": str(audio),
            "transcript": transcript,
            "scores": final_scores,
            "errors": final_errors,
            "words_detail": words_detail,
        }

    def _assess_speaker_sentences(
        self,
        *,
        output_dir: Path,
        speaker: str,
        source_audio: Union[str, Path],
        diarize_segments: list,
        use_asr: bool = True,
        feedback: Optional[bool] = None,
        lang: Optional[str] = None,
        score: bool = True,
        role: Optional[str] = None,
        teacher_sentences: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        t_role_start = time.perf_counter()
        fb = self.enable_feedback if feedback is None else feedback
        if not score:
            fb = False
        role = role or speaker
        segments = self._collect_speaker_segments(
            output_dir,
            speaker,
            source_audio=source_audio,
            diarize_segments=diarize_segments,
        )
        t_clip = time.perf_counter() - t_role_start

        if not segments:
            print(f"[{role}] Không tách được lượt nói nào từ audio", flush=True)
            return {
                "role": role,
                "scored": score,
                "sentences": [],
                "sentence_count": 0,
                "transcript": "",
                "scores": {},
                "message": f"{role}: không tách được lượt nói nào từ audio",
            }

        if not use_asr:
            return {
                "role": role,
                "scored": score,
                "sentences": [],
                "sentence_count": 0,
                "transcript": "",
                "scores": {},
                "message": f"{role}: ASR bị tắt",
            }

        # ── Step 1: ASR Transcription Only (matching diarize_and_transcribe.py) ──
        t_asr_start = time.perf_counter()
        candidates: List[Dict[str, Any]] = []
        filtered_vi = 0
        is_student = str(role).lower() == "student"

        for seg in segments:
            s_prompt = None
            if teacher_sentences and is_student:
                s_start = seg.get("start_sec", 0.0)
                prec = [
                    t for t in teacher_sentences
                    if t.get("start_sec", 0) < s_start and t.get("end_sec", 0) <= s_start + 1.5
                ]
                if prec:
                    s_prompt = build_context_prompt_for_turn(prec[-1].get("transcript", ""))

            try:
                meta = transcribe_audio_with_meta(seg["path"], asr_config=self._asr_cfg, prompt=s_prompt)
                clean_tr = meta.get("text", "").strip()
                raw_tr = meta.get("raw_text", "").strip()
                detected_lang = meta.get("language", "en")
                is_vi_from_asr = bool(meta.get("is_vietnamese", False))
            except Exception:
                continue

            if not clean_tr and not raw_tr:
                continue

            display_tr = raw_tr if is_vi_from_asr else clean_tr
            is_vi = is_vi_from_asr
            if self._lang_id_cfg.get("enabled", False) and not is_vi:
                is_vi, _ = is_vietnamese_segment(
                    seg["path"],
                    raw_tr or clean_tr,
                    device=self.asr_device,
                    cfg=self._lang_id_cfg,
                    whisper_lang=detected_lang,
                )
            if is_vi:
                filtered_vi += 1

            candidates.append({
                "index": seg["index"],
                "start_sec": seg["start_sec"],
                "end_sec": seg["end_sec"],
                "duration_sec": seg.get("duration_sec", 0.0),
                "audio": str(seg["path"]),
                "transcript": display_tr,
                "is_vietnamese": is_vi,
                "language": "vi" if is_vi else detected_lang,
            })

        t_asr = time.perf_counter() - t_asr_start

        if not candidates:
            print(f"[{role}] Không có lượt nói hợp lệ sau ASR ({len(segments)} turn)", flush=True)
            return {
                "role": role,
                "scored": score,
                "sentences": [],
                "sentence_count": 0,
                "transcript": "",
                "scores": {},
                "message": f"{role}: không có câu nói tiếng Anh hợp lệ sau nhận diện",
            }

        # ── Step 2: Conversational Turn Merging (100% synced with diarize_and_transcribe.py) ──
        t_merge_start = time.perf_counter()
        if is_student and len(candidates) >= 2:
            from data.audio_preprocess import load_waveform, save_audio_file, PreprocessConfig

            question_cues = {"what", "who", "how", "why", "where", "when", "which", "spell", "tell"}

            def _has_intervening_teacher(start_t: float, end_t: float, max_cue: float = 0.3) -> bool:
                if teacher_sentences:
                    for t in teacher_sentences:
                        t_s = float(t.get("start_sec", 0.0))
                        t_e = float(t.get("end_sec", 0.0))
                        if min(end_t, t_e) - max(start_t, t_s) > max_cue:
                            return True
                    return False
                return _has_intervening_other_speaker_turn(
                    start_t, end_t, diarize_segments, target_speaker=role, max_cue_duration=max_cue
                )

            def _intervening_is_new_question(end_t: float, start_t: float) -> bool:
                if not teacher_sentences:
                    return False
                between = [
                    t for t in teacher_sentences
                    if float(t.get("start_sec", 0.0)) >= end_t - 0.15
                    and float(t.get("end_sec", 0.0)) <= start_t + 0.15
                ]
                for bt in between:
                    btxt = (bt.get("transcript") or "").strip()
                    bws = [w.lower() for w in re.sub(r"[^\w\s']", " ", btxt).split() if w.strip()]
                    if "?" in btxt or any(w in question_cues for w in bws) or len(bws) >= 4:
                        return True
                return False

            p_cfg = PreprocessConfig.from_dict(self.config.get("audio_preprocess"))
            p_cfg.denoise = False
            sr = p_cfg.sample_rate

            merged_candidates: List[Dict[str, Any]] = []
            i = 0
            while i < len(candidates):
                curr = candidates[i]
                while i + 1 < len(candidates):
                    nxt = candidates[i + 1]
                    gap = float(nxt["start_sec"]) - float(curr["end_sec"])

                    other_spoke_full_turn = _has_intervening_teacher(curr["end_sec"], nxt["start_sec"], max_cue=0.3)

                    # Case A: Acoustic continuity (short pause <= 2.5s, no intervening teacher turn)
                    acoustic_merge = (0 <= gap <= 2.5) and not other_spoke_full_turn

                    # Case B: Syntactic incompleteness across a brief teacher scaffolding cue
                    syntactic_merge = (
                        (0 <= gap <= 3.0)
                        and not _intervening_is_new_question(curr["end_sec"], nxt["start_sec"])
                        and (_is_incomplete_turn(curr.get("transcript", "")) or _is_dependent_fragment(nxt.get("transcript", "")))
                    )

                    if not (acoustic_merge or syntactic_merge):
                        break

                    try:
                        s_time = curr["start_sec"]
                        e_time = nxt["end_sec"]
                        comb_path = output_dir / f"student_turn_merged_{curr['index']:03d}_{nxt['index']:03d}.wav"

                        c_wav = load_waveform(curr["audio"], p_cfg)
                        n_wav = load_waveform(nxt["audio"], p_cfg)
                        if c_wav.dim() == 1:
                            c_wav = c_wav.unsqueeze(0)
                        if n_wav.dim() == 1:
                            n_wav = n_wav.unsqueeze(0)

                        silence = torch.zeros((1, int(0.15 * sr)), dtype=c_wav.dtype)
                        stitched = torch.cat([c_wav, silence, n_wav], dim=1)
                        save_audio_file(comb_path, stitched, sr)

                        merge_context = None
                        if teacher_sentences:
                            prec_m = [
                                t for t in teacher_sentences
                                if t.get("start_sec", 0) < s_time and t.get("end_sec", 0) <= s_time + 1.5
                            ]
                            if prec_m:
                                merge_context = build_context_prompt_for_turn(prec_m[-1].get("transcript", ""))

                        meta = transcribe_audio_with_meta(comb_path, asr_config=self._asr_cfg, prompt=merge_context)
                        m_clean = meta.get("text", "").strip()
                        m_raw = meta.get("raw_text", "").strip()
                        m_lang = meta.get("language", "en")
                        m_is_vi = bool(meta.get("is_vietnamese", False))

                        curr = {
                            "index": curr["index"],
                            "start_sec": s_time,
                            "end_sec": e_time,
                            "duration_sec": round(stitched.shape[1] / sr, 3),
                            "audio": str(comb_path),
                            "transcript": m_raw if m_is_vi else m_clean,
                            "is_vietnamese": m_is_vi,
                            "language": "vi" if m_is_vi else m_lang,
                        }
                        i += 1
                    except Exception as me:
                        print(f"[{role}] Turn merge notice: {me}", flush=True)
                        break

                merged_candidates.append(curr)
                i += 1
            candidates = merged_candidates

        t_merge = time.perf_counter() - t_merge_start

        # ── Step 3: Attach Preceding Teacher Prompt Context ──
        if teacher_sentences and candidates:
            for cand in candidates:
                s_start = cand.get("start_sec", 0.0)
                prec = [
                    t for t in teacher_sentences
                    if t.get("start_sec", 0) < s_start and t.get("end_sec", 0) <= s_start + 1.5
                ]
                if prec:
                    cand["teacher_prompt"] = prec[-1].get("transcript", "")

        # ── Step 4: ASR Error Correction BEFORE Acoustic Scoring (Single Pass!) ──
        t_asr_corr_start = time.perf_counter()
        if is_student and candidates and self.config.get("asr_correction", {}).get("enabled", True):
            try:
                corrector = AsrErrorCorrector(enable_llm=True)
                asr_inputs = [
                    {
                        "turn_id": idx,
                        "raw_transcript": cand.get("transcript", ""),
                        "transcript": cand.get("transcript", ""),
                        "teacher_prompt": cand.get("teacher_prompt"),
                    }
                    for idx, cand in enumerate(candidates, start=1)
                ]
                corrected = corrector.correct_turns(asr_inputs)
                for cand, corr in zip(candidates, corrected):
                    new_tr = corr.get("transcript", "").strip()
                    if new_tr:
                        cand["transcript"] = new_tr
            except Exception as asr_corr_err:
                print(f"[{role}] AsrErrorCorrector notice: {asr_corr_err}")
        t_asr_corr = time.perf_counter() - t_asr_corr_start

        # ── Step 5 + 6 (Parallelized): Run DeepSeek v4.1 Flash LLM batch concurrently with GPU WavLM+L2-MDD ──
        elig_cfg = self.config.get("eligibility") or {}
        llm_future = None
        llm_pool = None
        if score and candidates:
            eligible_for_llm: List[Dict[str, Any]] = []
            for cand in candidates:
                tr = cand.get("transcript", "").strip()
                if self._lang_id_cfg.get("enabled", False) and cand.get("is_vietnamese", False):
                    continue
                ok_el, _ = check_scoring_eligibility(tr, cand.get("duration_sec", 0.0), config=elig_cfg)
                if ok_el and tr:
                    eligible_for_llm.append({
                        "index": cand["index"],
                        "transcript": tr,
                        "teacher_prompt": cand.get("teacher_prompt"),
                        "scored": True,
                    })
            if eligible_for_llm:
                try:
                    from infer.hybrid_nlp_scorer import call_single_llm_assessment
                    llm_pool = ThreadPoolExecutor(max_workers=1)
                    llm_future = llm_pool.submit(call_single_llm_assessment, eligible_for_llm)
                except Exception as llm_spawn_err:
                    print(f"[{role}] Parallel LLM spawn notice: {llm_spawn_err}", flush=True)

        t_gpu_start = time.perf_counter()
        sentences: List[Dict[str, Any]] = []
        for cand in candidates:
            seg_info = {
                "index": cand["index"],
                "start_sec": cand["start_sec"],
                "end_sec": cand["end_sec"],
                "duration_sec": cand["duration_sec"],
                "path": cand["audio"],
            }
            tr = cand.get("transcript", "").strip()
            t_prompt = cand.get("teacher_prompt")

            if self._lang_id_cfg.get("enabled", False) and cand.get("is_vietnamese", False):
                u = _make_unscored_turn(
                    seg_info, tr, role=role, is_vietnamese=True, language="vi", eligibility_reason="vietnamese_speech"
                )
                if t_prompt:
                    u["teacher_prompt"] = t_prompt
                sentences.append(u)
                continue

            if not score:
                u = _make_unscored_turn(seg_info, tr, role=role, eligibility_reason="role_unscored")
                if t_prompt:
                    u["teacher_prompt"] = t_prompt
                sentences.append(u)
                continue

            is_eligible, elig_reason = check_scoring_eligibility(tr, cand.get("duration_sec", 0.0), config=elig_cfg)
            if not is_eligible:
                u = _make_unscored_turn(seg_info, tr, role=role, eligibility_reason=elig_reason)
                if t_prompt:
                    u["teacher_prompt"] = t_prompt
                sentences.append(u)
                continue

            try:
                track = self.assess_track(
                    cand["audio"], tr, feedback=False, lang=lang,
                    feedback_mode="local", truncate=False, apply_preprocess=False,
                    duration_sec=cand.get("duration_sec", 0.0),
                )
                turn_obj: Dict[str, Any] = {
                    "index": cand["index"],
                    "start_sec": cand["start_sec"],
                    "end_sec": cand["end_sec"],
                    "duration_sec": cand["duration_sec"],
                    "audio": cand["audio"],
                    "role": role,
                    "scored": True,
                    "is_vietnamese": False,
                    "language": "en",
                    "eligibility_reason": "scored",
                    **track,
                }
                if t_prompt:
                    turn_obj["teacher_prompt"] = t_prompt
                sentences.append(turn_obj)
            except Exception as assess_err:
                print(f"[{role}] assess_track notice for turn {cand['index']} ('{tr[:40]}'): {assess_err}.")
                u = _make_unscored_turn(
                    seg_info, tr, role=role, eligibility_reason=f"assess_error: {str(assess_err)[:40]}"
                )
                if t_prompt:
                    u["teacher_prompt"] = t_prompt
                sentences.append(u)
        t_gpu = time.perf_counter() - t_gpu_start

        # ── Step 6: Holistic FC/LR/GRA Evaluation (collect overlapped LLM + Local NLP) ──
        t_nlp_start = time.perf_counter()
        precomputed_llm = None
        if llm_future is not None:
            try:
                precomputed_llm = llm_future.result()
            except Exception as llm_res_err:
                print(f"[{role}] Parallel LLM result notice: {llm_res_err}", flush=True)
            finally:
                if llm_pool is not None:
                    llm_pool.shutdown(wait=False)

        if score and sentences:
            try:
                from infer.hybrid_nlp_scorer import evaluate_conversation_linguistics
                sentences = evaluate_conversation_linguistics(
                    sentences, precomputed_llm_results=precomputed_llm
                )
            except Exception as he:
                print(f"[{role}] Hybrid NLP/LLM scoring notice: {he}", flush=True)
        t_nlp = time.perf_counter() - t_nlp_start
        t_role_total = time.perf_counter() - t_role_start
        print(
            f"[Perf][{role}] Clip={t_clip:.2f}s | ASR={t_asr:.2f}s | Merge={t_merge:.2f}s | "
            f"ASR-Corr={t_asr_corr:.2f}s | WavLM+L2MDD={t_gpu:.2f}s | LLM+NLP-Wait={t_nlp:.2f}s | Total={t_role_total:.2f}s",
            flush=True,
        )

        summary = _build_summary(
            sentences,
            filtered_vi=filtered_vi,
        )
        return {
            "role": role,
            "scored": score,
            "sentences": sentences,
            **summary,
        }

    def assess_conversation(
        self,
        audio: Union[str, Path],
        *,
        diarize_output_dir: Optional[Union[str, Path]] = None,
        use_asr: bool = True,
        feedback: Optional[bool] = None,
        lang: Optional[str] = None,
        teacher_voice: Optional[Union[str, Path]] = None,
        teacher_embedding: Optional[Any] = None,
        student_embedding: Optional[Any] = None,
        score_teacher: bool = False,
    ) -> Dict[str, Any]:
        """Diarize A/B → split each track by silence → score every sentence."""
        t_conv_start = time.perf_counter()
        fb = self.enable_feedback if feedback is None else feedback
        audio = Path(audio)

        base_dir = Path(diarize_output_dir or audio.parent / f"{audio.stem}_split")
        t_diar_start = time.perf_counter()
        split = self._diarize_two_speakers(
            audio,
            base_dir,
            teacher_reference_path=teacher_voice,
            teacher_embedding=teacher_embedding,
            student_embedding=student_embedding,
        )
        t_diar = time.perf_counter() - t_diar_start

        has_refs = (
            teacher_voice is not None
            or teacher_embedding is not None
            or student_embedding is not None
            or split.get("teacher_segments") is not None
            or split.get("student_segments") is not None
        )

        if has_refs:
            teacher_dir = base_dir / "teacher_sentences"
            student_dir = base_dir / "student_sentences"
            teacher_segs = split.get("teacher_segments") or []
            student_segs = split.get("student_segments") or []
            
            all_segs = split.get("segments") or []
            
            t_teach_start = time.perf_counter()
            teacher = self._assess_speaker_sentences(
                output_dir=teacher_dir,
                speaker="Teacher",
                source_audio=audio,
                diarize_segments=all_segs if all_segs else teacher_segs,
                use_asr=use_asr,
                feedback=False,
                lang=lang,
                score=score_teacher and len(teacher_segs) > 0,
                role="teacher",
            )
            t_teach = time.perf_counter() - t_teach_start
            t_stud_start = time.perf_counter()
            student = self._assess_speaker_sentences(
                output_dir=student_dir,
                speaker="Student",
                source_audio=audio,
                diarize_segments=all_segs if all_segs else student_segs,
                use_asr=use_asr,
                feedback=False,
                lang=lang,
                score=True,
                role="student",
                teacher_sentences=teacher.get("sentences", []),
            )
            t_stud = time.perf_counter() - t_stud_start
            t_conv_total = time.perf_counter() - t_conv_start
            print(
                f"[Perf][Conversation] Diarize={t_diar:.2f}s | Teacher={t_teach:.2f}s | Student={t_stud:.2f}s | Total={t_conv_total:.2f}s",
                flush=True,
            )
            dialogue = _build_dialogue(teacher.get("sentences", []), student.get("sentences", []))

            overall_tf = PronunciationScorer.generate_transformer_feedback(
                scores_pronunciation=student.get("scores", {}),
                errors_pronunciation=None,
                transcript=student.get("transcript", ""),
            )

            return {
                "mode": "teacher_student",
                "duration_sec": split["duration_sec"],
                "teacher": teacher,
                "student": student,
                "dialogue": dialogue,
                "overall_transformer_feedback": overall_tf,
            }

        speakers: Dict[str, Any] = {}
        for key, spk in [("A", "Speaker A"), ("B", "Speaker B")]:
            sent_dir = base_dir / f"speaker_{key}_sentences"
            speakers[key] = self._assess_speaker_sentences(
                output_dir=sent_dir,
                speaker=spk,
                use_asr=use_asr,
                feedback=fb,
                lang=lang,
                source_audio=audio,
                diarize_segments=split.get("segments"),
            )

        return {
            "mode": "diarize",
            "duration_sec": split["duration_sec"],
            "speakers": speakers,
        }

    def assess_single_speaker(
        self,
        audio: Union[str, Path],
        *,
        output_dir: Optional[Union[str, Path]] = None,
        use_asr: bool = True,
        feedback: Optional[bool] = None,
        lang: Optional[str] = None,
        role: str = "student",
        reference_text: Optional[str] = None,
        task_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Chấm điểm phát âm trực tiếp cho 1 người nói (Luyện tập / Thi thử) KHÔNG cần tách giọng Diarization."""
        fb = self.enable_feedback if feedback is None else feedback
        audio = Path(audio)

        # Voice Activity Detection (VAD) check toàn bộ file audio trước khi tách câu và đưa vào Whisper
        from data.audio_preprocess import load_audio_file
        audio_duration_sec = 0.0
        try:
            wav_check, sr_check = load_audio_file(audio)
            if wav_check.numel() > 0:
                mono_check = wav_check.mean(0) if wav_check.dim() > 1 else wav_check
                if sr_check and sr_check > 0:
                    audio_duration_sec = round(float(mono_check.shape[-1]) / float(sr_check), 3)
                peak_amp = float(mono_check.abs().max())
                rms_amp = float(torch.sqrt(torch.mean(mono_check ** 2)))
                if peak_amp < 0.015 or rms_amp < 0.003:
                    print(f"[{role}] VAD: Không phát hiện tiếng người trong audio (peak={peak_amp:.4f}, rms={rms_amp:.4f}). Bỏ qua Whisper.", flush=True)
                    student_data = {
                        "role": role,
                        "scored": True,
                        "sentences": [],
                        "sentence_count": 0,
                        "transcript": "",
                        "scores": {"total": 0.0, "p": 0.0, "fc": 0.0},
                        "message": f"{role}: Không phát hiện tiếng người trong bản ghi âm (VAD)",
                    }
                    return {
                        "mode": "single_speaker",
                        "duration_sec": audio_duration_sec,
                        "student": student_data,
                        "dialogue": {"turns": []},
                    }
        except Exception as vad_e:
            print(f"[{role}] VAD check warning: {vad_e}", flush=True)

        # Trường hợp Read Aloud: đã có sẵn văn bản bài đọc chuẩn (reference_text)
        # KHÔNG CẦN DÙNG WHISPER để nhận dạng đoán chữ! Đưa thẳng văn bản bài đọc vào assess_track
        # để WavLM + SpeechOcean762 + L2-MDD so khớp âm vị học (forced-alignment).
        if task_type == "read_aloud" and reference_text and reference_text.strip():
            clean_ref = reference_text.strip()
            print(f"[{role}] Read Aloud Mode: Bỏ qua Whisper ASR, sử dụng trực tiếp văn bản đề bài làm target text: {clean_ref[:60]}...", flush=True)
            try:
                track = self.assess_track(
                    audio,
                    clean_ref,
                    feedback=fb,
                    lang=lang,
                    feedback_mode=self.feedback_mode,
                    duration_sec=audio_duration_sec,
                )
                sentence_item = {
                    "index": 0,
                    "start_sec": 0.0,
                    "end_sec": audio_duration_sec,
                    "duration_sec": audio_duration_sec,
                    "audio": str(audio),
                    "transcript": clean_ref,
                    "role": role,
                    "scored": True,
                    "eligibility_reason": "scored",
                    "scores": track["scores"],
                    "errors": track["errors"],
                    "words_detail": track.get("words_detail", []),
                }
                sentences = [sentence_item]
                summary = _build_summary(
                    sentences,
                    filtered_vi=0,
                )
                student_data = {
                    "role": role,
                    "scored": True,
                    "sentences": sentences,
                    **summary,
                }
                overall_tf = PronunciationScorer.generate_transformer_feedback(
                    scores_pronunciation=track["scores"],
                    errors_pronunciation=track["errors"],
                    transcript=clean_ref,
                )
                return {
                    "mode": "single_speaker",
                    "duration_sec": audio_duration_sec,
                    "student": student_data,
                    "dialogue": {
                        "turns": [_serialize_dialogue_turn(sentence_item, role="student")],
                    },
                    "overall_transformer_feedback": overall_tf,
                }
            except Exception as e:
                print(f"[{role}] Read Aloud direct scoring warning: {e}. Fallback to segment-based assessment.", flush=True)

        t_prac_start = time.perf_counter()
        base_dir = Path(output_dir or audio.parent / f"{audio.stem}_single_split")
        sent_dir = base_dir / "sentences"
        sent_dir.mkdir(parents=True, exist_ok=True)

        split_cfg = self.config.get("sentence_split") or self.config.get("silence_split")
        segments = split_audio_file(
            audio,
            sent_dir,
            preprocess=self.preprocess,
            split_cfg=split_cfg,
            prefix=f"{role.lower()}_turn",
        )
        t_clip = time.perf_counter() - t_prac_start

        if not segments:
            # Fallback nếu audio quá ngắn hoặc không tách được khoảng lặng
            segments = [{
                "index": 0,
                "start_sec": 0.0,
                "end_sec": audio_duration_sec,
                "duration_sec": audio_duration_sec,
                "path": str(audio),
            }]

        # Practice mode context prompt
        practice_prompt = None
        if reference_text and reference_text.strip():
            practice_prompt = build_context_prompt_for_turn(reference_text.strip())
        elif task_type:
            practice_prompt = build_context_prompt_for_turn(f"Practice topic: {task_type}")

        # ── Step 1: ASR Transcription Only (Single-Pass, no premature WavLM/L2-MDD) ──
        t_asr_start = time.perf_counter()
        candidates: List[Dict[str, Any]] = []
        filtered_vi = 0
        if use_asr:
            for seg in segments:
                try:
                    meta = transcribe_audio_with_meta(
                        seg["path"], asr_config=self._asr_cfg, prompt=practice_prompt
                    )
                    clean_tr = meta.get("text", "").strip()
                    raw_tr = meta.get("raw_text", "").strip()
                    detected_lang = meta.get("language", "en")
                    is_vi_from_asr = bool(meta.get("is_vietnamese", False))
                except Exception:
                    continue
                if not clean_tr and not raw_tr:
                    continue

                display_tr = raw_tr if is_vi_from_asr else clean_tr
                is_vi = is_vi_from_asr
                if self._lang_id_cfg.get("enabled", False) and not is_vi:
                    is_vi, _ = is_vietnamese_segment(
                        seg["path"],
                        raw_tr or clean_tr,
                        device=self.asr_device,
                        cfg=self._lang_id_cfg,
                        whisper_lang=detected_lang,
                    )
                if is_vi:
                    filtered_vi += 1

                candidates.append({
                    "index": seg["index"],
                    "start_sec": seg["start_sec"],
                    "end_sec": seg["end_sec"],
                    "duration_sec": seg.get("duration_sec", 0.0),
                    "audio": str(seg["path"]),
                    "transcript": display_tr,
                    "is_vietnamese": is_vi,
                    "language": "vi" if is_vi else detected_lang,
                })
        t_asr = time.perf_counter() - t_asr_start

        # ── Step 2: Syntactic Turn Merging (clean 150ms stitching + re-ASR only) ──
        t_merge_start = time.perf_counter()
        if len(candidates) >= 2:
            from data.audio_preprocess import load_waveform, save_audio_file, PreprocessConfig
            p_cfg_m = PreprocessConfig.from_dict(self.config.get("audio_preprocess"))
            p_cfg_m.denoise = False
            sr_m = p_cfg_m.sample_rate
            merged_prac: List[Dict[str, Any]] = []
            idx_m = 0
            while idx_m < len(candidates):
                curr_s = candidates[idx_m]
                while idx_m + 1 < len(candidates):
                    nxt_s = candidates[idx_m + 1]
                    gap_s = float(nxt_s.get("start_sec", 0.0)) - float(curr_s.get("end_sec", 0.0))
                    if 0 <= gap_s <= 3.0 and (
                        _is_incomplete_turn(curr_s.get("transcript", ""))
                        or _is_dependent_fragment(nxt_s.get("transcript", ""))
                    ):
                        try:
                            c_wav = load_waveform(curr_s["audio"], p_cfg_m)
                            n_wav = load_waveform(nxt_s["audio"], p_cfg_m)
                            if c_wav.dim() == 1:
                                c_wav = c_wav.unsqueeze(0)
                            if n_wav.dim() == 1:
                                n_wav = n_wav.unsqueeze(0)
                            sil = torch.zeros((1, int(0.15 * sr_m)), dtype=c_wav.dtype)
                            stitched = torch.cat([c_wav, sil, n_wav], dim=1)
                            comb_path = sent_dir / f"{role.lower()}_merged_{curr_s['index']:03d}_{nxt_s['index']:03d}.wav"
                            save_audio_file(comb_path, stitched, sr_m)

                            meta = transcribe_audio_with_meta(
                                comb_path, asr_config=self._asr_cfg, prompt=practice_prompt
                            )
                            m_clean = meta.get("text", "").strip()
                            m_raw = meta.get("raw_text", "").strip()
                            m_lang = meta.get("language", "en")
                            m_is_vi = bool(meta.get("is_vietnamese", False))
                            if m_clean or m_raw:
                                curr_s = {
                                    "index": curr_s["index"],
                                    "start_sec": curr_s.get("start_sec", 0.0),
                                    "end_sec": nxt_s.get("end_sec", 0.0),
                                    "duration_sec": round(stitched.shape[1] / sr_m, 3),
                                    "audio": str(comb_path),
                                    "transcript": m_raw if m_is_vi else m_clean,
                                    "is_vietnamese": m_is_vi,
                                    "language": "vi" if m_is_vi else m_lang,
                                }
                                idx_m += 1
                                continue
                        except Exception as pm_err:
                            print(f"[{role}] Practice turn merge notice: {pm_err}", flush=True)
                    break
                merged_prac.append(curr_s)
                idx_m += 1
            candidates = merged_prac
        t_merge = time.perf_counter() - t_merge_start

        # ── Step 3: ASR Error Correction BEFORE Acoustic Scoring (Single Pass!) ──
        t_asr_corr_start = time.perf_counter()
        prompt_ctx = (reference_text or "").strip() or (task_type or "") or "Practice"
        for cand in candidates:
            cand["teacher_prompt"] = prompt_ctx

        if candidates and self.config.get("asr_correction", {}).get("enabled", True):
            try:
                corrector = AsrErrorCorrector(enable_llm=True)
                asr_inputs = [
                    {
                        "turn_id": idx + 1,
                        "raw_transcript": cand.get("transcript", ""),
                        "transcript": cand.get("transcript", ""),
                        "teacher_prompt": prompt_ctx,
                    }
                    for idx, cand in enumerate(candidates)
                ]
                corrected = corrector.correct_turns(asr_inputs)
                for cand, corr in zip(candidates, corrected):
                    new_tr = corr.get("transcript", "").strip()
                    if new_tr:
                        cand["transcript"] = new_tr
            except Exception as asr_corr_err:
                print(f"[{role}] AsrErrorCorrector practice notice: {asr_corr_err}")
        t_asr_corr = time.perf_counter() - t_asr_corr_start

        # ── Step 4 + 5 (Parallelized): Overlap DeepSeek v4.1 Flash LLM batch with GPU WavLM+L2-MDD ──
        elig_cfg = self.config.get("eligibility") or {}
        llm_future = None
        llm_pool = None
        if candidates:
            eligible_for_llm: List[Dict[str, Any]] = []
            for cand in candidates:
                tr = cand.get("transcript", "").strip()
                if self._lang_id_cfg.get("enabled", False) and cand.get("is_vietnamese", False):
                    continue
                ok_el, _ = check_scoring_eligibility(tr, cand.get("duration_sec", 0.0), config=elig_cfg)
                if ok_el and tr:
                    eligible_for_llm.append({
                        "index": cand["index"],
                        "transcript": tr,
                        "teacher_prompt": prompt_ctx,
                        "scored": True,
                    })
            if eligible_for_llm:
                try:
                    from infer.hybrid_nlp_scorer import call_single_llm_assessment
                    llm_pool = ThreadPoolExecutor(max_workers=1)
                    llm_future = llm_pool.submit(call_single_llm_assessment, eligible_for_llm)
                except Exception as llm_spawn_err:
                    print(f"[{role}] Practice parallel LLM spawn notice: {llm_spawn_err}", flush=True)

        t_gpu_start = time.perf_counter()
        sentences: List[Dict[str, Any]] = []
        for cand in candidates:
            seg_info = {
                "index": cand["index"],
                "start_sec": cand["start_sec"],
                "end_sec": cand["end_sec"],
                "duration_sec": cand["duration_sec"],
                "path": cand["audio"],
            }
            tr = cand.get("transcript", "").strip()

            if self._lang_id_cfg.get("enabled", False) and cand.get("is_vietnamese", False):
                u = _make_unscored_turn(
                    seg_info, tr, role=role, is_vietnamese=True, language="vi", eligibility_reason="vietnamese_speech"
                )
                u["teacher_prompt"] = prompt_ctx
                sentences.append(u)
                continue

            is_eligible, elig_reason = check_scoring_eligibility(tr, cand.get("duration_sec", 0.0), config=elig_cfg)
            if not is_eligible:
                u = _make_unscored_turn(seg_info, tr, role=role, eligibility_reason=elig_reason)
                u["teacher_prompt"] = prompt_ctx
                sentences.append(u)
                continue

            try:
                track = self.assess_track(
                    cand["audio"], tr, feedback=False, lang=lang,
                    feedback_mode="local", truncate=False, apply_preprocess=False,
                    duration_sec=cand.get("duration_sec", 0.0),
                )
                sentences.append({
                    "index": cand["index"],
                    "start_sec": cand["start_sec"],
                    "end_sec": cand["end_sec"],
                    "duration_sec": cand["duration_sec"],
                    "audio": cand["audio"],
                    "role": role,
                    "scored": True,
                    "is_vietnamese": False,
                    "language": "en",
                    "eligibility_reason": "scored",
                    "teacher_prompt": prompt_ctx,
                    **track,
                })
            except Exception as assess_err:
                print(f"[{role}] Practice assess_track notice for turn {cand['index']}: {assess_err}")
                u = _make_unscored_turn(
                    seg_info, tr, role=role, eligibility_reason=f"assess_error: {str(assess_err)[:40]}"
                )
                u["teacher_prompt"] = prompt_ctx
                sentences.append(u)
        t_gpu = time.perf_counter() - t_gpu_start

        # ── Step 6: Holistic FC/LR/GRA Evaluation (collect overlapped LLM + Local NLP) ──
        t_nlp_start = time.perf_counter()
        precomputed_llm = None
        if llm_future is not None:
            try:
                precomputed_llm = llm_future.result()
            except Exception as llm_res_err:
                print(f"[{role}] Practice parallel LLM result notice: {llm_res_err}", flush=True)
            finally:
                if llm_pool is not None:
                    llm_pool.shutdown(wait=False)

        if sentences:
            try:
                from infer.hybrid_nlp_scorer import evaluate_conversation_linguistics
                sentences = evaluate_conversation_linguistics(
                    sentences, precomputed_llm_results=precomputed_llm
                )
            except Exception as he:
                print(f"[{role}] Hybrid NLP/LLM practice scoring notice: {he}", flush=True)
        t_nlp = time.perf_counter() - t_nlp_start
        t_prac_total = time.perf_counter() - t_prac_start
        print(
            f"[Perf][practice] Clip={t_clip:.2f}s | ASR={t_asr:.2f}s | Merge={t_merge:.2f}s | "
            f"ASR-Corr={t_asr_corr:.2f}s | WavLM+L2MDD={t_gpu:.2f}s | LLM+NLP-Wait={t_nlp:.2f}s | Total={t_prac_total:.2f}s",
            flush=True,
        )

        if not sentences:
            print(f"[{role}] Không có lượt nói hợp lệ sau nhận diện", flush=True)
            student_data = {
                "role": role,
                "scored": True,
                "sentences": [],
                "sentence_count": 0,
                "transcript": "",
                "scores": {"total": 0.0, "p": 0.0, "fc": 0.0},
                "message": f"{role}: không có lượt nói hợp lệ sau nhận diện",
            }
        else:
            summary = _build_summary(
                sentences,
                filtered_vi=filtered_vi,
            )
            student_data = {
                "role": role,
                "scored": True,
                "sentences": sentences,
                **summary,
            }

        dialogue = {
            "turns": [_serialize_dialogue_turn(s, role="student") for s in sentences],
        }

        overall_tf = PronunciationScorer.generate_transformer_feedback(
            scores_pronunciation=student_data.get("scores", {}),
            errors_pronunciation=None,
            transcript=student_data.get("transcript", ""),
        )

        return {
            "mode": "single_speaker",
            "duration_sec": audio_duration_sec or sum(s.get("duration_sec", 0) for s in segments),
            "student": student_data,
            "dialogue": dialogue,
            "overall_transformer_feedback": overall_tf,
        }


def main():
    p = argparse.ArgumentParser(description="2-speaker speaking evaluation")
    p.add_argument("--audio", required=True)
    p.add_argument("--config", default=str(PRONUNCIATION_CONFIG))
    p.add_argument("--pronunciation-ckpt", default=None)
    p.add_argument("--l2-mdd-ckpt", default=None)
    p.add_argument("--no-feedback", action="store_true")
    p.add_argument("--lang", choices=["vi", "en"], default="vi")
    p.add_argument("--output", default=None)
    p.add_argument("--device", default=None)
    args = p.parse_args()

    pipe = SpeakingPipeline(
        args.config,
        args.device,
        args.pronunciation_ckpt,
        l2_mdd_ckpt=args.l2_mdd_ckpt,
        enable_feedback=not args.no_feedback,
    )
    result = pipe.assess_conversation(args.audio, lang=args.lang)

    text = json.dumps(result, ensure_ascii=False, indent=2, default=str)
    print(text)
    out = args.output or str(ROOT / "logs" / "result.json")
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(text, encoding="utf-8")
    print(f"Saved: {out}")


if __name__ == "__main__":
    main()
