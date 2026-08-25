"""Diarization pipeline using ECAPA-TDNN."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import noisereduce as nr

from ecapa_diarize.audio_io import load_audio, save_audio
from ecapa_diarize.clustering import TwoSpeakerClusterer, batch_cluster_two
from ecapa_diarize.embedding import EcapaEmbedder
from ecapa_diarize.segmentation import SileroVAD, SlidingWindowBuffer, SpeechWindow

LABELS = ("Speaker A", "Speaker B")
ROLE_TEACHER = "Teacher"
ROLE_STUDENT = "Student"


@dataclass
class DiarizationSegment:
    start: float
    end: float
    speaker: str
    confidence: float


@dataclass
class SplitResult:
    segments: list[DiarizationSegment]
    duration_sec: float
    teacher_cluster: int | None = None
    teacher_segments: list[DiarizationSegment] | None = None
    student_segments: list[DiarizationSegment] | None = None
    teacher_path: Path | None = None
    student_path: Path | None = None


class TwoSpeakerSplitter:
    """Diarize a 2-speaker recording and export separate audio tracks."""

    def __init__(
        self,
        device: str = "cpu",
        embedder: EcapaEmbedder | None = None,
        vad: SileroVAD | None = None,
        window_sec: float = 0.8,
        step_sec: float = 0.1,
    ) -> None:
        self.embedder = embedder or EcapaEmbedder(device=device)
        self.vad = vad or SileroVAD()
        self.buffer = SlidingWindowBuffer(window_sec=window_sec, step_sec=step_sec)

    def split_file(
        self,
        input_path: str | Path,
        output_dir: str | Path | None = None,
        *,
        teacher_reference_path: str | Path | None = None,
        teacher_embedding: np.ndarray | None = None,
        student_embedding: np.ndarray | None = None,
    ) -> SplitResult:
        input_path = Path(input_path)

        teacher_emb = teacher_embedding
        if teacher_emb is None and teacher_reference_path:
            teacher_emb = self._embed_reference(teacher_reference_path)
        elif teacher_emb is not None:
            pass

        audio, sr = load_audio(input_path)
        
        # Khử nhiễu nhẹ trước khi xử lý (prop_decrease=0.5 để không làm méo đặc trưng giọng nói)
        audio = nr.reduce_noise(y=audio, sr=sr, prop_decrease=0.5)

        segments, teacher_cluster = self._diarize(
            audio, sr, teacher_emb=teacher_emb, student_emb=student_embedding
        )

        teacher_segments = [s for s in segments if s.speaker == ROLE_TEACHER] if teacher_cluster is not None else None
        student_segments = [s for s in segments if s.speaker == ROLE_STUDENT] if teacher_cluster is not None else None

        teacher_path = student_path = None
        if teacher_segments is not None and student_segments is not None:
            teacher_track = np.zeros_like(audio)
            student_track = np.zeros_like(audio)
            for s in teacher_segments:
                teacher_track[int(s.start * sr):int(s.end * sr)] = audio[int(s.start * sr):int(s.end * sr)]
            for s in student_segments:
                student_track[int(s.start * sr):int(s.end * sr)] = audio[int(s.start * sr):int(s.end * sr)]
            
            out_dir = input_path.parent / f"{input_path.stem}_split"
            out_dir.mkdir(parents=True, exist_ok=True)
            teacher_path = out_dir / f"{input_path.stem}_teacher.wav"
            student_path = out_dir / f"{input_path.stem}_student.wav"
            save_audio(teacher_path, teacher_track, sr)
            save_audio(student_path, student_track, sr)

        return SplitResult(
            segments=segments,
            duration_sec=len(audio) / sr,
            teacher_cluster=teacher_cluster,
            teacher_segments=teacher_segments,
            student_segments=student_segments,
            teacher_path=teacher_path,
            student_path=student_path,
        )

    def _embed_reference(self, reference_path: str | Path) -> np.ndarray:
        audio, _ = load_audio(reference_path)
        embs: list[np.ndarray] = []
        for window in self.buffer.iter_windows(audio):
            if not self.vad.is_speech(window.audio):
                continue
            try:
                embs.append(self.embedder.embed(window.audio))
            except ValueError:
                continue
        if embs:
            vec = np.mean(embs, axis=0).astype(np.float32)
        else:
            vec = self.embedder.embed(audio)
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec /= norm
        return vec

    def _diarize(
        self,
        audio: np.ndarray,
        sample_rate: int,
        teacher_emb: np.ndarray | None = None,
        student_emb: np.ndarray | None = None,
    ) -> tuple[list[DiarizationSegment], int | None]:
        windows: list[SpeechWindow] = []
        embeddings: list[np.ndarray] = []

        for window in self.buffer.iter_windows(audio):
            if not self.vad.is_speech(window.audio):
                continue
            try:
                embeddings.append(self.embedder.embed(window.audio))
                windows.append(window)
            except ValueError:
                continue

        if not windows:
            raise ValueError("Không phát hiện giọng nói trong file audio.")

        labels = batch_cluster_two(embeddings)
        centers = self._cluster_centers(embeddings, labels)

        teacher_cluster: int | None = None
        if teacher_emb is not None or student_emb is not None:
            sim_t0 = float(np.dot(centers[0], teacher_emb)) if teacher_emb is not None else 0.0
            sim_t1 = float(np.dot(centers[1], teacher_emb)) if teacher_emb is not None else 0.0
            sim_s0 = float(np.dot(centers[0], student_emb)) if student_emb is not None else 0.0
            sim_s1 = float(np.dot(centers[1], student_emb)) if student_emb is not None else 0.0

            score_a = sim_t0 + sim_s1
            score_b = sim_t1 + sim_s0

            teacher_cluster = 0 if score_a >= score_b else 1


        n = len(audio)
        votes_a = np.zeros(n, dtype=np.float32)
        votes_b = np.zeros(n, dtype=np.float32)

        for window, emb, label in zip(windows, embeddings, labels):
            confidence = float(np.clip(np.dot(emb, centers[label]), 0.0, 1.0))
            s, e = window.start_sample, window.end_sample
            if label == 0:
                votes_a[s:e] += confidence
            else:
                votes_b[s:e] += confidence

        stamps = self.vad.get_timestamps(audio, sample_rate=sample_rate)
        is_speech = np.zeros(n, dtype=bool)
        for stamp in stamps:
            is_speech[stamp["start"]:stamp["end"]] = True
            
        pred_a = (votes_a >= votes_b) & (votes_a > 0) & is_speech
        pred_b = (votes_b > votes_a) & is_speech
        
        def get_blocks(mask):
            mask_int = np.concatenate(([0], mask.astype(int), [0]))
            diff = np.diff(mask_int)
            starts = np.where(diff == 1)[0]
            ends = np.where(diff == -1)[0]
            return starts, ends
            
        starts_a, ends_a = get_blocks(pred_a)
        starts_b, ends_b = get_blocks(pred_b)
        
        raw_segments = []
        for s, e in zip(starts_a, ends_a):
            raw_segments.append({
                "start": float(s) / sample_rate,
                "end": float(e) / sample_rate,
                "cluster": 0
            })
        for s, e in zip(starts_b, ends_b):
            raw_segments.append({
                "start": float(s) / sample_rate,
                "end": float(e) / sample_rate,
                "cluster": 1
            })
            
        raw_segments.sort(key=lambda x: x["start"])
        
        merged_segments = []
        for seg in raw_segments:
            if not merged_segments:
                merged_segments.append(seg)
                continue
                
            last = merged_segments[-1]
            if last["cluster"] == seg["cluster"] and (seg["start"] - last["end"] < 0.5):
                last["end"] = seg["end"]
            elif (seg["end"] - seg["start"] < 0.2):
                continue
            else:
                merged_segments.append(seg)
                
        final_segments = []
        for s in merged_segments:
            if s["end"] - s["start"] < 0.2:
                continue
            
            if teacher_cluster is not None:
                role = ROLE_TEACHER if s["cluster"] == teacher_cluster else ROLE_STUDENT
            else:
                role = LABELS[s["cluster"]]
                
            final_segments.append(DiarizationSegment(
                start=s["start"], end=s["end"], speaker=role, confidence=1.0
            ))

        return final_segments, teacher_cluster

    @staticmethod
    def _cluster_centers(embeddings: list[np.ndarray], labels: list[int]) -> list[np.ndarray]:
        centers = []
        for k in (0, 1):
            members = [embeddings[i] for i, lb in enumerate(labels) if lb == k]
            if not members:
                centers.append(TwoSpeakerClusterer._normalize(embeddings[0]))
            else:
                c = np.mean(members, axis=0)
                centers.append(TwoSpeakerClusterer._normalize(c))
        return centers
