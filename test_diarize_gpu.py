import os
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')
import time
from pathlib import Path
import torch

# Them thu muc speaker-diarize vao sys.path de import
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "speaker-diarize"))

from speaker_diarize.pipeline import TwoSpeakerSplitter
from speaker_diarize.embedding import ERes2NetEmbedder

def run_test(audio_path: str, teacher_ref: str = None, student_ref: str = None):
    print("=== KIEM TRA QUA TRINH DIARIZE TREN GPU ===")
    
    # Kiem tra GPU
    if torch.cuda.is_available():
        print(f"[Info] Su dung GPU: {torch.cuda.get_device_name(0)}")
        device = "cuda"
    else:
        print("[Canh bao] Khong tim thay GPU, se chay bang CPU!")
        device = "cpu"

    audio_file = Path(audio_path)
    if not audio_file.exists():
        print(f"[Loi] Khong tim thay file am thanh: {audio_path}")
        return

    print("\n[1] Dang khoi tao mo hinh ERes2Net-Large...")
    start_init = time.time()
    
    embedder = ERes2NetEmbedder(device=device)
    splitter = TwoSpeakerSplitter(
        device=device,
        embedder=embedder,
        vad_threshold_db=-42.0,
        cluster_window_sec=1.5,
        boundary_window_sec=0.5,
        min_speech_sec=0.25,
        min_segment_sec=0.3,
        merge_gap_sec=0.5,
        consecutive_merge_gap_sec=2.5,
        step_sec=0.25,
        boundary_step_sec=0.05,
        min_similarity_threshold=0.40
    )
    print(f"Khoi tao xong! ({time.time() - start_init:.2f}s)\n")

    print(f"[2] Dang xu ly file: {audio_file.name}")
    print("Qua trinh nay bao gom: Khu nhieu DeepFilterNet -> Adaptive Leveling -> ERes2Net-Large Embedding -> Phan tach...")
    
    teacher_refs = [teacher_ref] if teacher_ref else [
        "d:/SpeakAI-Eval/sample_audio/teacherr.m4a",
        "d:/SpeakAI-Eval/sample_audio/teacher_ref.wav",
        "d:/SpeakAI-Eval/sample_audio/teacher_ref1.wav",
    ]
    student_refs = [student_ref] if student_ref else [
        "d:/SpeakAI-Eval/sample_audio/studentt.m4a",
        "d:/SpeakAI-Eval/sample_audio/student_ref.wav",
        "d:/SpeakAI-Eval/sample_audio/student_ref1.wav",
    ]
    
    print("\n[2.1] Trich xuat dac trung (Embedding) giong mau...")
    import numpy as np
    
    teacher_embs = []
    for ref in teacher_refs:
        if ref and Path(ref).exists():
            print(f"  + Teacher ref: {ref}")
            emb = splitter._embed_reference(ref)
            teacher_embs.append(emb)
    
    student_embs = []
    for ref in student_refs:
        if ref and Path(ref).exists():
            print(f"  + Student ref: {ref}")
            emb = splitter._embed_reference(ref)
            student_embs.append(emb)
            
    teacher_emb = np.mean(teacher_embs, axis=0) if teacher_embs else None
    student_emb = np.mean(student_embs, axis=0) if student_embs else None
    
    if teacher_emb is not None:
        teacher_emb /= np.linalg.norm(teacher_emb)
    if student_emb is not None:
        student_emb /= np.linalg.norm(student_emb)
        
    start_infer = time.time()
    result = splitter.split_file(
        input_path=audio_file,
        teacher_embedding=teacher_emb,
        student_embedding=student_emb
    )
    infer_time = time.time() - start_infer
    print(f"\nPhan tach xong! Thoi gian xu ly: {infer_time:.2f}s")
    print(f"Tong thoi luong audio goc: {result.duration_sec:.2f}s")
    
    print("\n[3] KET QUA DIARIZATION:")
    for seg in result.segments:
        ts = f", T_score: {seg.teacher_score:.3f}" if seg.teacher_score is not None else ""
        ss = f", S_score: {seg.student_score:.3f}" if seg.student_score is not None else ""
        print(f"[{seg.start:05.2f}s - {seg.end:05.2f}s] {seg.speaker} (Confidence: {seg.confidence:.2f}{ts}{ss})")
    
    t_count = len(result.teacher_segments) if result.teacher_segments else 0
    s_count = len(result.student_segments) if result.student_segments else 0
    print(f"\n=> Teacher segments: {t_count}, Student segments: {s_count}")

    print("\n[4] FILE KET QUA:")
    print(f"- File giong Giao vien: {result.teacher_path}")
    print(f"- File giong Hoc sinh:  {result.student_path}")


if __name__ == "__main__":
    audio_path = "d:/SpeakAI-Eval/sample_audio/audio_test4.m4a"
    student_path = "d:/SpeakAI-Eval/sample_audio/studentt.m4a"
    teacher_path = "d:/SpeakAI-Eval/sample_audio/teacherr.m4a"
    
    if len(sys.argv) > 1:
        audio_path = sys.argv[1]
    if len(sys.argv) > 2:
        student_path = sys.argv[2]
    if len(sys.argv) > 3:
        teacher_path = sys.argv[3]
        
    print(f"Chay test voi:\n- Audio: {audio_path}\n- Student: {student_path}\n- Teacher: {teacher_path}\n")
    run_test(audio_path, teacher_ref=teacher_path, student_ref=student_path)
