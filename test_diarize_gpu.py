import os
import sys
import time
from pathlib import Path
import torch

# ThÃªm thÆ° má»¥c speaker-diarize vÃ o sys.path Ä‘á»ƒ cÃ³ thá»ƒ import
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "speaker-diarize"))

from speaker_diarize.pipeline import TwoSpeakerSplitter
from speaker_diarize.embedding import ERes2NetEmbedder

def run_test(audio_path: str):
    print("=== KIá»‚M TRA QUÃ TRÃŒNH DIARIZE TRÃŠN GPU ===")
    
    # Kiá»ƒm tra GPU
    if torch.cuda.is_available():
        print(f"[Info] Sá»­ dá»¥ng GPU: {torch.cuda.get_device_name(0)}")
        device = "cuda"
    else:
        print("[Cáº£nh bÃ¡o] KhÃ´ng tÃ¬m tháº¥y GPU, sáº½ cháº¡y báº±ng CPU!")
        device = "cpu"

    audio_file = Path(audio_path)
    if not audio_file.exists():
        print(f"[Lá»—i] KhÃ´ng tÃ¬m tháº¥y file Ã¢m thanh: {audio_path}")
        print("Vui lÃ²ng sá»­a biáº¿n AUDIO_PATH trong file test_diarize_gpu.py thÃ nh Ä‘Æ°á» ng dáº«n file thá»±c táº¿.")
        return

    print("\n[1] Ä ang khá»Ÿi táº¡o mÃ´ hÃ¬nh ERes2Net-Large...")
    start_init = time.time()
    
    # Khá»Ÿi táº¡o bá»™ trÃ­ch xuáº¥t ERes2Net-Large
    embedder = ERes2NetEmbedder(device=device)
    
    # Khá»Ÿi táº¡o bá»™ chia 2 ngÆ°á» i nÃ³i (TwoSpeakerSplitter) trÃªn GPU
    # Ghi chÃº: DeepFilterNet tá»± Ä‘á»™ng dÃ¹ng GPU náº¿u PyTorch nháº­n diá»‡n Ä‘Æ°á»£c CUDA.
    splitter = TwoSpeakerSplitter(
        device=device,
        embedder=embedder,
        cluster_window_sec=1.5,     # Kích thước cửa sổ trượt để gom cụm (K-Means)
        boundary_window_sec=0.5,    # Cửa sổ quét ranh giới nhỏ (0.5s) để bắt trọn các từ ngắn
        min_speech_sec=0.25,        # Thời lượng tiếng nói tối thiểu trong 1 cửa sổ 0.5s
        min_segment_sec=0.3,        # Lọc bỏ các tiếng động/thở cực ngắn (<0.3s)
        merge_gap_sec=0.5,          # Nối các đoạn của cùng 1 người nếu cách nhau dưới 0.5s
        step_sec=0.25,              # Trượt dày hơn để lấy được nhiều mẫu thuần khiết
        boundary_step_sec=0.05      # Quét cực kỳ chi tiết (50ms/lần)
    )
    print(f"Khá»Ÿi táº¡o xong! ({time.time() - start_init:.2f}s)\n")

    print(f"[2] Ä ang xá»­ lÃ½ file: {audio_file.name}")
    print("QuÃ¡ trÃ¬nh nÃ y bao gá»“m: Khá»­ nhiá»…u DeepFilterNet -> Adaptive Leveling -> ERes2Net-Large Embedding -> PhÃ¢n tÃ¡ch...")
    
    # Danh sÃ¡ch cÃ¡c file tham chiáº¿u
    teacher_refs = [
        "d:/SpeakAI-Eval/sample_audio/teacher_ref.wav",
        "d:/SpeakAI-Eval/sample_audio/teacher_ref1.wav",
        "d:/SpeakAI-Eval/sample_audio/teacher_ref2.wav",
        "d:/SpeakAI-Eval/sample_audio/teacher_ref3.wav",
        "d:/SpeakAI-Eval/sample_audio/teacher_ref4.wav",
    ]
    student_refs = [
        "d:/SpeakAI-Eval/sample_audio/student_ref.wav",
        "d:/SpeakAI-Eval/sample_audio/student_ref1.wav",
        "d:/SpeakAI-Eval/sample_audio/student_ref2.wav",
        "d:/SpeakAI-Eval/sample_audio/student_ref3.wav",
    ]
    
    print("\n[2.1] TrÃ­ch xuáº¥t Ä‘áº·c trÆ°ng (Embedding) giá»ng máº«u...")
    import numpy as np
    
    teacher_embs = []
    for ref in teacher_refs:
        if Path(ref).exists():
            emb = splitter._embed_reference(ref, apply_denoise=False)
            teacher_embs.append(emb)
    
    student_embs = []
    for ref in student_refs:
        if Path(ref).exists():
            emb = splitter._embed_reference(ref, apply_denoise=False)
            student_embs.append(emb)
            
    teacher_emb = np.mean(teacher_embs, axis=0) if teacher_embs else None
    student_emb = np.mean(student_embs, axis=0) if student_embs else None
    
    if teacher_emb is not None:
        teacher_emb /= np.linalg.norm(teacher_emb)
    if student_emb is not None:
        student_emb /= np.linalg.norm(student_emb)
        
    start_infer = time.time()
    # Cháº¡y toÃ n bá»™ quÃ¡ trÃ¬nh tÃ¡ch
    result = splitter.split_file(
        input_path=audio_file,
        teacher_embedding=teacher_emb,
        student_embedding=student_emb,
        apply_denoise=False
    )
    infer_time = time.time() - start_infer
    print(f"\nPhÃ¢n tÃ¡ch xong! Thá» i gian xá»­ lÃ½: {infer_time:.2f}s")
    print(f"Tá»•ng thá» i lÆ°á»£ng audio gá»‘c: {result.duration_sec:.2f}s")
    
    print("\n[3] Káº¾T QUáº¢ DIARIZATION:")
    for seg in result.segments:
        print(f"[{seg.start:05.2f}s - {seg.end:05.2f}s] {seg.speaker} (Confidence: {seg.confidence:.2f})")
    
    print("\n[4] FILE Káº¾T QUáº¢:")
    if result.denoised_path:
        print(f"- File Ã¢m thanh gá»‘c (Ä‘Ã£ khá»­ nhiá»…u/cÃ¢n báº±ng): {result.denoised_path}")
    print(f"- File giá»ng GiÃ¡o viÃªn: {result.teacher_path}")
    print(f"- File giá»ng Há»c sinh:  {result.student_path}")
    print(f"- File CSV cháº¥m Ä‘iá»ƒm (Cosine Score): d:\\SpeakAI-Eval\\sample_audio\\conversation_split\\conversation_cosine_scores.csv")

if __name__ == "__main__":
    # Thay Ä‘á»•i Ä‘Æ°á»ng dáº«n nÃ y thÃ nh file ghi Ã¢m thá»±c táº¿ báº¡n muá»‘n test
    # (CÃ³ thá»ƒ truyá»n tá»« dÃ²ng lá»‡nh hoáº·c sá»­a trá»±c tiáº¿p á»Ÿ Ä‘Ã¢y)
    if len(sys.argv) > 1:
        AUDIO_PATH = sys.argv[1]
    else:
        # File máº·c Ä‘á»‹nh Ä‘á»ƒ test (náº¿u chÆ°a cÃ³ thÃ¬ báº¡n tá»± Ä‘á»•i láº¡i nhÃ©)
        AUDIO_PATH = "d:/SpeakAI-Eval/sample_audio/conversation.wav"
        
    run_test(AUDIO_PATH)
