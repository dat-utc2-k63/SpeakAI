import sys
from pathlib import Path
sys.path.insert(0, 'd:/SpeakAI-Eval/speaker-diarize')

import torch
import torch.nn.functional as F
import numpy as np
from speaker_diarize.embedding import ERes2NetEmbedder
from speaker_diarize.audio_io import load_audio

def get_embedding(path, embedder):
    wav_np, sr = load_audio(path)
    
    # BỎ QUA DeepFilterNet VÀ Cân bằng giọng
    # wav_np, sr = denoise_with_deepfilternet(wav_np, sr)
    # wav_np = level_audio_to_target(wav_np, sr)
    
    emb = embedder.embed(wav_np, sr) 
    return torch.from_numpy(emb)

if __name__ == "__main__":
    embedder = ERes2NetEmbedder(device='cpu')
    
    files = [
        'd:/SpeakAI-Eval/sample_audio/teacher_ref.wav',
        'd:/SpeakAI-Eval/sample_audio/teacher_ref1.wav',
        'd:/SpeakAI-Eval/sample_audio/teacher_ref2.wav',
        'd:/SpeakAI-Eval/sample_audio/teacher_ref3.wav',
        'd:/SpeakAI-Eval/sample_audio/teacher_ref4.wav'
    ]
    
    embeddings = []
    for f in files:
        emb = get_embedding(f, embedder)
        if emb.dim() > 1:
            emb = emb.squeeze()
        emb = F.normalize(emb.float(), p=2, dim=-1)
        embeddings.append(emb)
        print(f"Extracted embedding for {Path(f).name}")

    print("\n--- Cosine Similarity Matrix (RAW AUDIO) ---")
    for i in range(len(files)):
        for j in range(i+1, len(files)):
            sim = torch.cosine_similarity(embeddings[i].unsqueeze(0), embeddings[j].unsqueeze(0))
            print(f"{Path(files[i]).name} vs {Path(files[j]).name}: {sim.item():.4f}")
