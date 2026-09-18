"""Diarization pipeline using ERes2Net-Large.

Tối ưu hiệu năng:
- Batch GPU inference cho cả clustering pass và boundary refinement pass
- Sử dụng embed_direct() / embed_batch() thay vì file I/O
- Giảm số lần gọi model đáng kể nhờ gom batch
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from speaker_diarize.audio_io import load_audio, save_audio
from speaker_diarize.clustering import TwoSpeakerClusterer, batch_cluster_two
from speaker_diarize.embedding import ERes2NetEmbedder
from speaker_diarize.segmentation import RmsVad, SlidingWindowBuffer, SpeechWindow

LABELS = ("Speaker A", "Speaker B")
ROLE_TEACHER = "Teacher"
ROLE_STUDENT = "Student"


@dataclass
class DiarizationSegment:
    start: float
    end: float
    speaker: str
    confidence: float
    teacher_score: float | None = None
    student_score: float | None = None


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
        embedder: ERes2NetEmbedder | None = None,
        vad: RmsVad | None = None,
        vad_threshold_db: float = -42.0,
        cluster_window_sec: float = 1.5,
        boundary_window_sec: float = 0.5,
        min_speech_sec: float = 0.25,
        min_segment_sec: float = 0.3,
        merge_gap_sec: float = 0.5,
        consecutive_merge_gap_sec: float = 2.5,
        step_sec: float = 0.5,
        boundary_step_sec: float = 0.1,
        min_similarity_threshold: float = 0.40,
    ) -> None:
        self.embedder = embedder or ERes2NetEmbedder(device=device)
        self.vad = vad or RmsVad(threshold_db=vad_threshold_db)
        self.min_segment_sec = min_segment_sec
        self.merge_gap_sec = merge_gap_sec
        self.consecutive_merge_gap_sec = consecutive_merge_gap_sec
        self.min_similarity_threshold = min_similarity_threshold
        self.buffer = SlidingWindowBuffer(window_sec=cluster_window_sec, step_sec=step_sec)
        self.boundary_buffer = SlidingWindowBuffer(
            window_sec=boundary_window_sec, 
            step_sec=boundary_step_sec, 
            min_speech_sec=min_speech_sec
        )

    def split_file(
        self,
        input_path: str | Path,
        output_dir: str | Path | None = None,
        *,
        teacher_reference_path: str | Path | None = None,
        teacher_embedding: np.ndarray | None = None,
        student_embedding: np.ndarray | None = None,
        apply_denoise: bool = True,
    ) -> SplitResult:
        input_path = Path(input_path)

        teacher_emb = teacher_embedding
        if teacher_emb is None and teacher_reference_path:
            teacher_emb = self._embed_reference(teacher_reference_path)
        elif teacher_emb is not None:
            pass

        audio, sr = load_audio(input_path)

        diarize_audio = audio
        if apply_denoise:
            from speaker_diarize.denoise import denoise_with_deepfilternet, level_audio_to_target
            print("[Info] Applying DeepFilterNet denoise and leveling for accurate VAD segmentation...")
            diarize_audio, _ = denoise_with_deepfilternet(audio, sr)
            diarize_audio = level_audio_to_target(diarize_audio, sr)

        segments, teacher_cluster = self._diarize(
            diarize_audio, sr, teacher_emb=teacher_emb, student_emb=student_embedding
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
            
            if output_dir is not None:
                out_dir = Path(output_dir)
            else:
                out_dir = input_path.parent / f"{input_path.stem}_split"
            out_dir.mkdir(parents=True, exist_ok=True)
            teacher_path = out_dir / f"{input_path.stem}_teacher.wav"
            student_path = out_dir / f"{input_path.stem}_student.wav"
            csv_path = out_dir / f"{input_path.stem}_cosine_scores.csv"
            
            save_audio(teacher_path, teacher_track, sr)
            save_audio(student_path, student_track, sr)
            
            # Lưu file CSV hiển thị điểm cosine
            with open(csv_path, "w", encoding="utf-8") as f:
                f.write("Start,End,Assigned_Speaker,Teacher_Score,Student_Score\n")
                for s in segments:
                    ts = f"{s.teacher_score:.4f}" if s.teacher_score is not None else "N/A"
                    ss = f"{s.student_score:.4f}" if s.student_score is not None else "N/A"
                    f.write(f"{s.start:.2f},{s.end:.2f},{s.speaker},{ts},{ss}\n")

        return SplitResult(
            segments=segments,
            duration_sec=len(audio) / sr,
            teacher_cluster=teacher_cluster,
            teacher_segments=teacher_segments,
            student_segments=student_segments,
            teacher_path=teacher_path,
            student_path=student_path,
        )

    def _embed_reference(self, reference_path: str | Path, apply_denoise: bool = True) -> np.ndarray:
        """Trích xuất embedding tham chiếu cho 1 giọng nói (dùng embed_batch cho tốc độ)."""
        audio, sr = load_audio(reference_path)
        
        if apply_denoise:
            from speaker_diarize.denoise import denoise_with_deepfilternet, level_audio_to_target
            audio, _ = denoise_with_deepfilternet(audio, sr)
            audio = level_audio_to_target(audio, sr)
            
        # Lọc windows có giọng nói
        speech_windows = [w for w in self.buffer.iter_windows(audio) if self.vad.is_speech(w.audio)]

        if speech_windows:
            # Batch inference: gom tất cả windows → 1 lần GPU forward
            audio_list = [w.audio for w in speech_windows]
            embs = self.embedder.embed_batch(audio_list)
        
        if speech_windows and embs:
            vec = np.mean(embs, axis=0).astype(np.float32)
        else:
            vec = self.embedder.embed_direct(audio)
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
        t0 = time.time()

        # ════════════════════════════════════════════════════════════════════
        # Pass 1: Clustering — Gom speech windows → Batch GPU Inference
        # ════════════════════════════════════════════════════════════════════
        all_cluster_windows = self.buffer.iter_windows(audio)
        speech_cluster_windows = [w for w in all_cluster_windows if self.vad.is_speech(w.audio)]

        if not speech_cluster_windows:
            raise ValueError("Không phát hiện giọng nói trong file audio.")

        # Batch inference: gom tất cả speech windows → 1 lần GPU forward
        cluster_audio_list = [w.audio for w in speech_cluster_windows]
        cluster_embeddings = self.embedder.embed_batch(cluster_audio_list)

        # Loại bỏ windows mà embedding extraction thất bại (quá ngắn)
        windows: list[SpeechWindow] = []
        embeddings: list[np.ndarray] = []
        for w, emb in zip(speech_cluster_windows, cluster_embeddings):
            if emb is not None:
                windows.append(w)
                embeddings.append(emb)

        if not windows:
            raise ValueError("Không phát hiện giọng nói trong file audio.")

        t1 = time.time()
        print(f"[Diarize] Pass 1 Clustering: {len(windows)} windows embedded in {t1 - t0:.2f}s (batch)")

        teacher_cluster: int | None = None
        if teacher_emb is not None and student_emb is not None:
            # Dual reference mode: directly use reference embeddings as centroids
            teacher_cluster = 0
            centers = [teacher_emb, student_emb]
            print("\n[Diarization: Dual Reference Mode]")
            print(f"- Giáo viên (Teacher) reference embedding loaded (norm={np.linalg.norm(teacher_emb):.2f})")
            print(f"- Học sinh (Student)  reference embedding loaded (norm={np.linalg.norm(student_emb):.2f})")
        else:
            labels = batch_cluster_two(embeddings)
            centers = self._cluster_centers(embeddings, labels)
            n_clusters = len(set(labels))

            if n_clusters == 1:
                teacher_cluster = 0 if (teacher_emb is not None or student_emb is not None) else None
            elif teacher_emb is not None or student_emb is not None:
                sim_t0 = float(np.dot(centers[0], teacher_emb)) if teacher_emb is not None else 0.0
                sim_t1 = float(np.dot(centers[1], teacher_emb)) if teacher_emb is not None else 0.0
                sim_s0 = float(np.dot(centers[0], student_emb)) if student_emb is not None else 0.0
                sim_s1 = float(np.dot(centers[1], student_emb)) if student_emb is not None else 0.0

                score_a = sim_t0 + sim_s1
                score_b = sim_t1 + sim_s0

                teacher_cluster = 0 if score_a >= score_b else 1
                print(f"\n[Mapping Similarity]")
                print(f"- Giao vien (Teacher) so voi Cluster 0: {sim_t0:.3f}, Cluster 1: {sim_t1:.3f}")
                print(f"- Hoc sinh (Student)  so voi Cluster 0: {sim_s0:.3f}, Cluster 1: {sim_s1:.3f}")
                print(f"=> Quyet dinh: Gan Giao vien = Cluster {teacher_cluster}, Hoc sinh = Cluster {1 - teacher_cluster}")
            else:
                teacher_cluster = None

        # ════════════════════════════════════════════════════════════════════
        # Pass 2: Boundary Refinement — Batch GPU Inference
        # ════════════════════════════════════════════════════════════════════
        t2 = time.time()
        all_boundary_windows = self.boundary_buffer.iter_windows(audio)
        speech_boundary_windows = [w for w in all_boundary_windows if self.vad.is_speech(w.audio, min_ratio=0.1)]

        n = len(audio)
        votes_a = np.zeros(n, dtype=np.float32)
        votes_b = np.zeros(n, dtype=np.float32)

        if speech_boundary_windows:
            # Batch inference: gom tất cả boundary windows → 1 lần GPU forward
            boundary_audio_list = [w.audio for w in speech_boundary_windows]
            boundary_embeddings = self.embedder.embed_batch(boundary_audio_list)

            for w, emb in zip(speech_boundary_windows, boundary_embeddings):
                if emb is None:
                    continue
                conf_a = float(np.clip(np.dot(emb, centers[0]), 0.0, 1.0))
                conf_b = float(np.clip(np.dot(emb, centers[1]), 0.0, 1.0))
                
                label = 0 if conf_a >= conf_b else 1
                
                s, e = w.start_sample, w.end_sample
                if label == 0:
                    votes_a[s:e] += conf_a
                else:
                    votes_b[s:e] += conf_b

        t3 = time.time()
        print(f"[Diarize] Pass 2 Boundary: {len(speech_boundary_windows)} windows embedded in {t3 - t2:.2f}s (batch)")

        stamps = self.vad.get_timestamps(audio, sample_rate=sample_rate)
        is_speech = np.zeros(n, dtype=bool)
        pad_samples = int(0.2 * sample_rate)
        for stamp in stamps:
            s_idx = max(0, stamp["start"] - pad_samples)
            e_idx = min(n, stamp["end"] + pad_samples)
            is_speech[s_idx:e_idx] = True
            
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
        raw_segments = [s for s in raw_segments if (s["end"] - s["start"]) >= self.min_segment_sec]
        
        merged_segments = []
        for seg in raw_segments:
            if not merged_segments:
                merged_segments.append(seg)
                continue
                
            last = merged_segments[-1]
            if last["cluster"] == seg["cluster"] and (seg["start"] - last["end"] < self.merge_gap_sec):
                last["end"] = seg["end"]
            else:
                merged_segments.append(seg)

        # ════════════════════════════════════════════════════════════════════
        # Pass 3: 2nd-pass Refinement — Batch GPU Inference per segment
        # ════════════════════════════════════════════════════════════════════
        t4 = time.time()
        final_segments = []

        if teacher_emb is not None and student_emb is not None:
            # Gom tất cả segment chunks cần refinement → batch embed
            seg_chunks = []
            seg_chunk_window_map = []  # (seg_index, list_of_window_indices)

            for i, s in enumerate(merged_segments):
                chunk = audio[int(s["start"]*sample_rate) : int(s["end"]*sample_rate)]
                chunk_windows = [w for w in self.buffer.iter_windows(chunk) if self.vad.is_speech(w.audio)]
                
                if chunk_windows:
                    start_idx = len(seg_chunks)
                    for w in chunk_windows:
                        seg_chunks.append(w.audio)
                    seg_chunk_window_map.append((i, list(range(start_idx, len(seg_chunks)))))
                else:
                    # Không có speech windows → embed toàn bộ chunk
                    start_idx = len(seg_chunks)
                    seg_chunks.append(chunk)
                    seg_chunk_window_map.append((i, [start_idx]))

            # Batch inference cho tất cả chunks 1 lần
            all_chunk_embs = self.embedder.embed_batch(seg_chunks) if seg_chunks else []

            for seg_idx, window_indices in seg_chunk_window_map:
                s = merged_segments[seg_idx]
                t_score = None
                s_score = None

                try:
                    chunk_embs = [all_chunk_embs[j] for j in window_indices if j < len(all_chunk_embs) and all_chunk_embs[j] is not None]
                    
                    if chunk_embs:
                        seg_emb = np.mean(chunk_embs, axis=0)
                    else:
                        chunk = audio[int(s["start"]*sample_rate) : int(s["end"]*sample_rate)]
                        seg_emb = self.embedder.embed_direct(chunk)
                        
                    norm = np.linalg.norm(seg_emb)
                    if norm > 0: seg_emb /= norm
                    
                    t_score = float(np.dot(seg_emb, teacher_emb))
                    s_score = float(np.dot(seg_emb, student_emb))
                    
                    # Quyết định role dựa trên so sánh độ tương đồng giọng thực tế
                    role = ROLE_TEACHER if t_score >= s_score else ROLE_STUDENT
                    
                    # Lọc bỏ đoạn nhiễu/tạp âm không khớp với cả 2 người nói (< 0.40)
                    if max(t_score, s_score) < self.min_similarity_threshold:
                        continue
                        
                except (ValueError, IndexError):
                    role = ROLE_TEACHER if s["cluster"] == teacher_cluster else ROLE_STUDENT

                final_segments.append(DiarizationSegment(
                    start=s["start"], end=s["end"], speaker=role, confidence=1.0,
                    teacher_score=t_score, student_score=s_score
                ))
        else:
            # Không có dual reference → gán nhãn theo cluster trực tiếp (không cần embed thêm)
            for s in merged_segments:
                if teacher_cluster is not None:
                    role = ROLE_TEACHER if s["cluster"] == teacher_cluster else ROLE_STUDENT
                else:
                    role = LABELS[s["cluster"]]
                    
                final_segments.append(DiarizationSegment(
                    start=s["start"], end=s["end"], speaker=role, confidence=1.0,
                    teacher_score=None, student_score=None
                ))

        t5 = time.time()
        print(f"[Diarize] Pass 3 Refinement: {len(merged_segments)} segments refined in {t5 - t4:.2f}s (batch)")

        # Hậu xử lý: Gộp các lượt nói liền kề của cùng 1 người nếu người kia không nói xen vào
        merged_roles = []
        for seg in final_segments:
            if not merged_roles:
                merged_roles.append(seg)
                continue
            last = merged_roles[-1]
            gap = seg.start - last.end
            if last.speaker == seg.speaker and (gap <= self.consecutive_merge_gap_sec):
                d1 = max(0.01, last.end - last.start)
                d2 = max(0.01, seg.end - seg.start)
                last.end = seg.end
                if last.teacher_score is not None and seg.teacher_score is not None:
                    last.teacher_score = round((last.teacher_score * d1 + seg.teacher_score * d2) / (d1 + d2), 4)
                if last.student_score is not None and seg.student_score is not None:
                    last.student_score = round((last.student_score * d1 + seg.student_score * d2) / (d1 + d2), 4)
            else:
                merged_roles.append(seg)
        final_segments = merged_roles

        total_time = time.time() - t0
        print(f"[Diarize] ✅ Total diarization completed in {total_time:.2f}s ({len(final_segments)} segments)")
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
