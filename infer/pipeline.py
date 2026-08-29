"""Unified inference: diarize 2 speakers → split sentences → score each segment."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import yaml

from data.audio_preprocess import PreprocessConfig
from data.silence_split import export_diarization_clips, split_audio_file
from infer.lang_id import is_vietnamese_segment

from infer.pronunciation import Predictor
from infer.transcribe import transcribe_audio
from infer.device_utils import resolve_device
from paths import SPEAKER_DIARIZE_DIR, PRONUNCIATION_CONFIG, ROOT

SCORE_KEYS = ("accuracy", "fluency", "prosodic", "total")





def _build_dialogue(
    teacher_sentences: List[Dict[str, Any]],
    student_sentences: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Chronological turns with teacher prompt attached before each student answer."""
    turns: List[Dict[str, Any]] = []
    for s in teacher_sentences:
        turns.append({
            "role": "teacher",
            "scored": "scores" in s,
            "start_sec": s.get("start_sec"),
            "end_sec": s.get("end_sec"),
            "transcript": s.get("transcript", ""),
            "audio": s.get("audio"),
            "scores": s.get("scores"),
            "errors": s.get("errors"),
        })
    for s in student_sentences:
        turns.append({
            "role": "student",
            "scored": True,
            "start_sec": s.get("start_sec"),
            "end_sec": s.get("end_sec"),
            "transcript": s.get("transcript", ""),
            "audio": s.get("audio"),
            "scores": s.get("scores"),
            "errors": s.get("errors"),
        })
    turns.sort(key=lambda t: (t.get("start_sec") or 0, 0 if t["role"] == "teacher" else 1))

    student_turns: List[Dict[str, Any]] = []
    last_teacher: Optional[Dict[str, Any]] = None
    for t in turns:
        if t["role"] == "teacher":
            last_teacher = t
        else:
            student_turns.append({
                **t,
                "teacher_prompt": last_teacher["transcript"] if last_teacher else None,
                "teacher_prompt_start_sec": last_teacher.get("start_sec") if last_teacher else None,
                "teacher_prompt_end_sec": last_teacher.get("end_sec") if last_teacher else None,
                "teacher_prompt_audio": last_teacher.get("audio") if last_teacher else None,
            })

    return {"turns": turns, "student_turns": student_turns}


def _avg_scores(items: List[Dict[str, Any]]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for key in SCORE_KEYS:
        vals = [x["scores"][key] for x in items if x.get("scores", {}).get(key) is not None]
        if vals:
            out[key] = round(sum(vals) / len(vals), 2)
    return out


def _build_summary(
    sentences: List[Dict[str, Any]],
    *,
    pipeline: "SpeakingPipeline",
    feedback: bool,
    lang: Optional[str],
    speaker: Optional[str] = None,
    filtered_vi: int = 0,
    exchanges: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    summary_scores = _avg_scores(sentences)
    # Mỗi lượt nói (turn) = một dòng — không ghép liền
    lines = [s["transcript"].strip() for s in sentences if s.get("transcript", "").strip()]
    full_transcript = "\n".join(lines)
    summary_feedback = None
    summary_source = None
    pronunciation_feedback = None
    pronunciation_source = None

    if sentences:
        pronunciation_source = "local"

    if feedback and sentences:
        speaker_label = {
            "A": "Speaker A",
            "B": "Speaker B",
            "Student": "Student",
            "Teacher": "Teacher",
        }.get(speaker or "", None)
        if speaker_label is None and speaker:
            speaker_label = f"Speaker {speaker}"
        summary_feedback = ""
        summary_source = ""

    return {
        "sentence_count": len(sentences),
        "transcript": full_transcript,
        "transcript_lines": lines,
        "transcript_source": "whisper",
        "filtered_vi_count": filtered_vi,
        "scores": summary_scores,
        "pronunciation_feedback": pronunciation_feedback,
        "pronunciation_feedback_source": pronunciation_source,
        "feedback": summary_feedback,
        "feedback_source": summary_source,
    }


class SpeakingPipeline:
    """Diarize 2 speakers → silence-split → per-sentence scoring."""

    def __init__(
        self,
        config_path: str | Path | None = None,
        device: Optional[str] = None,
        pronunciation_ckpt: Optional[str] = None,
        enable_feedback: bool = True,
        load_progress: Optional[Any] = None,
    ):
        config_path = Path(config_path or PRONUNCIATION_CONFIG)
        if load_progress is not None:
            load_progress.start("config")
        with open(config_path, encoding="utf-8") as f:
            self.config = yaml.safe_load(f)
        if load_progress is not None:
            load_progress.finish("config")

        self.device = resolve_device(self.config, device)
        asr_cfg = self.config.setdefault("asr", {})
        if not asr_cfg.get("device"):
            asr_cfg["device"] = self.device
        self.preprocess = PreprocessConfig.from_dict(self.config.get("audio_preprocess"))
        wavlm_name = self.config.get("wavlm", {}).get("model_name", "microsoft/wavlm-large")
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
        
        if not SPEAKER_DIARIZE_DIR.is_dir():
            raise FileNotFoundError(f"speaker-diarize not found at {SPEAKER_DIARIZE_DIR}")
        if str(SPEAKER_DIARIZE_DIR) not in sys.path:
            sys.path.insert(0, str(SPEAKER_DIARIZE_DIR))
        from speaker_diarize.pipeline import TwoSpeakerSplitter
        
        self.diarizer = TwoSpeakerSplitter(device=self.device)
        from infer.transcribe import get_transcriber
        get_transcriber(load_progress)
        
        self.enable_feedback = enable_feedback
        self._lang_id_cfg = (self.config.get("asr") or {}).get("lang_id") or {}

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
        )
        out: Dict[str, Any] = {
            "segments": result.segments,
            "duration_sec": result.duration_sec,
            "teacher_cluster": result.teacher_cluster,
            "teacher_segments": result.teacher_segments,
            "student_segments": result.student_segments,
        }
        if result.teacher_path and result.student_path:
            out["teacher"] = result.teacher_path
            out["student"] = result.student_path
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
        merge_gap = float(split_cfg.get("diarization_merge_gap_sec", 0.2))

        segments = export_diarization_clips(
            source_audio,
            diarize_segments,
            output_dir,
            speaker,
            track_preprocess,
            merge_gap_sec=merge_gap,
            min_duration_sec=float(split_cfg.get("min_segment_sec", 0.2)),
            prefix=f"{speaker.lower()}_turn",
        )
        return segments

    def _process_segment(
        self,
        seg: Dict[str, Any],
        *,
        use_asr: bool,
        lang: Optional[str],
        score: bool = True,
        role: str = "student",
    ) -> Tuple[Optional[Dict[str, Any]], bool]:
        """Returns (sentence_dict, was_vi_filtered)."""
        if not use_asr:
            return None, False
        try:
            transcript = transcribe_audio(seg["path"])
        except ValueError:
            return None, False
        if not transcript.strip():
            return None, False

        drop_vi = False
        if score:
            drop_vi, reason = is_vietnamese_segment(
                seg["path"],
                transcript,
                device=self.device,
                cfg=self._lang_id_cfg,
            )
            if drop_vi:
                print(f"[lang_id] Bỏ đoạn tiếng Việt ({reason}): {transcript[:60]}…", flush=True)
                return None, True

        if not score:
            return {
                "index": seg["index"],
                "start_sec": seg["start_sec"],
                "end_sec": seg["end_sec"],
                "duration_sec": seg["duration_sec"],
                "audio": seg["path"],
                "turn_index": seg["index"],
                "transcript": transcript,
                "role": role,
                "scored": False,
            }, False

        try:
            track = self.assess_track(
                seg["path"], transcript, feedback=False, lang=lang,
                feedback_mode="local", truncate=False, apply_preprocess=False,
            )
        except ValueError:
            return None, False

        return {
            "index": seg["index"],
            "start_sec": seg["start_sec"],
            "end_sec": seg["end_sec"],
            "duration_sec": seg["duration_sec"],
            "audio": seg["path"],
            "turn_index": seg["index"],
            "role": role,
            "scored": True,
            **track,
        }, False

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
    ) -> Dict[str, Any]:
        fb = self.enable_feedback if feedback is None else feedback
        scores = self.pronunciation.predict(
            str(audio), transcript, fb, lang,
            feedback_mode=feedback_mode, truncate=truncate,
            apply_preprocess=apply_preprocess,
        )
        return {
            "audio": str(audio),
            "transcript": transcript,
            "scores": scores["scores"],
            "errors": scores["errors"],
            "alignments": scores.get("alignments"),
            "feedback": scores.get("feedback"),
            "feedback_source": scores.get("feedback_source"),
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
    ) -> Dict[str, Any]:
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

        if not segments:
            raise ValueError(
                f"{role}: không tách được lượt nói nào từ audio "
                f"(kiểm tra diarization hoặc độ dài segment tối thiểu)"
            )

        sentences: List[Dict[str, Any]] = []
        filtered_vi = 0
        for seg in segments:
            item, was_vi = self._process_segment(
                seg, use_asr=use_asr, lang=lang, score=score, role=role,
            )
            if was_vi:
                filtered_vi += 1
            elif item:
                sentences.append(item)

        if not sentences and use_asr:
            if score:
                raise ValueError(
                    f"{role}: không còn đoạn tiếng Anh sau LID "
                    f"({len(segments)} turn, {filtered_vi} đoạn tiếng Việt đã loại, "
                    f"kiểm tra ASR hoặc transcript/CMUdict)"
                )
            raise ValueError(
                f"{role}: không transcribe được lượt nói nào "
                f"({len(segments)} turn, kiểm tra ASR)"
            )

        summary = _build_summary(
            sentences,
            pipeline=self,
            feedback=fb,
            lang=lang,
            speaker=speaker if score else None,
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
        fb = self.enable_feedback if feedback is None else feedback
        audio = Path(audio)
        base_dir = Path(diarize_output_dir or audio.parent / f"{audio.stem}_split")
        split = self._diarize_two_speakers(
            audio,
            base_dir,
            teacher_reference_path=teacher_voice,
            teacher_embedding=teacher_embedding,
            student_embedding=student_embedding,
        )

        if split.get("teacher_segments") and split.get("student_segments"):
            teacher_dir = base_dir / "teacher_sentences"
            student_dir = base_dir / "student_sentences"
            teacher = self._assess_speaker_sentences(
                output_dir=teacher_dir,
                speaker="Teacher",
                source_audio=audio,
                diarize_segments=split.get("teacher_segments"),
                use_asr=use_asr,
                feedback=False,
                lang=lang,
                score=score_teacher,
                role="teacher",
            )
            student = self._assess_speaker_sentences(
                output_dir=student_dir,
                speaker="Student",
                source_audio=audio,
                diarize_segments=split.get("student_segments"),
                use_asr=use_asr,
                feedback=False,
                lang=lang,
                score=True,
                role="student",
            )
            dialogue = _build_dialogue(teacher["sentences"], student["sentences"])
            if fb and student.get("sentences"):
                lang_fb = _build_summary(
                    student["sentences"],
                    pipeline=self,
                    feedback=True,
                    lang=lang,
                    speaker="Student",
                    filtered_vi=student.get("filtered_vi_count", 0),
                    exchanges=dialogue["student_turns"],
                )
                student["feedback"] = lang_fb["feedback"]
                student["feedback_source"] = lang_fb["feedback_source"]
                student["pronunciation_feedback"] = lang_fb.get("pronunciation_feedback")
                student["pronunciation_feedback_source"] = lang_fb.get("pronunciation_feedback_source")
            return {
                "mode": "teacher_student",
                "source_audio": str(audio),
                "duration_sec": split["duration_sec"],
                "teacher": teacher,
                "student": student,
                "dialogue": dialogue,
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
            "source_audio": str(audio),
            "duration_sec": split["duration_sec"],
            "speakers": speakers,
        }


def main():
    p = argparse.ArgumentParser(description="2-speaker speaking evaluation")
    p.add_argument("--audio", required=True)
    p.add_argument("--config", default=str(PRONUNCIATION_CONFIG))
    p.add_argument("--pronunciation-ckpt", default=None)
    p.add_argument("--no-feedback", action="store_true")
    p.add_argument("--lang", choices=["vi", "en"], default="vi")
    p.add_argument("--output", default=None)
    p.add_argument("--device", default=None)
    args = p.parse_args()

    pipe = SpeakingPipeline(
        args.config,
        args.device,
        args.pronunciation_ckpt,
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
