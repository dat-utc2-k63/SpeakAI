import numpy as np
import torch
import warnings

# Tắt cảnh báo librosa/modelscope
warnings.filterwarnings("ignore")

SAMPLE_RATE = 16000

class ERes2NetEmbedder:
    """Wrap ModelScope ERes2NetV2 for speaker embeddings."""

    def __init__(self, device: str = "cuda", model_id: str = "d:/SpeakAI-Eval/speaker-diarize/pretrained_models/speech_eres2net_large_200k_sv_zh-cn_16k-common") -> None:
        self.device = device if torch.cuda.is_available() else "cpu"
        self.model_id = model_id
        from modelscope.pipelines import pipeline
        
        # Initialize pipeline
        print(f"[{model_id.split('/')[-1]}] Đang tải mô hình từ ModelScope...")
        self.sv_pipeline = pipeline(
            task='speaker-verification',
            model=model_id,
            device=self.device
        )
        print(f"[{model_id.split('/')[-1]}] Tải mô hình thành công!")

    def embed(self, audio: np.ndarray | torch.Tensor, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
        if isinstance(audio, np.ndarray):
            wav = audio.astype(np.float32)
        else:
            wav = audio.cpu().numpy().astype(np.float32)

        # Đảm bảo là mảng 1D
        while wav.ndim > 1:
            wav = wav[0]
            
        if len(wav) < int(0.2 * SAMPLE_RATE):
            raise ValueError("Audio too short for embedding (need >= 0.2s)")

        # Thử cách đưa qua file tạm để tương thích tốt nhất với pipeline
        import soundfile as sf
        import tempfile
        import os
        
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_path = f.name
        try:
            sf.write(temp_path, wav, sample_rate)
            res = self.sv_pipeline([temp_path], output_emb=True)
            if isinstance(res, dict) and 'embs' in res:
                vec = res['embs']
            elif isinstance(res, dict) and 'text' in res:
                # Fallback if the pipeline returns text dict
                vec = res.get('embs', res)
            else:
                vec = res
                
            if isinstance(vec, list):
                vec = np.array(vec)
            vec = np.squeeze(vec).astype(np.float32)
            norm = np.linalg.norm(vec)
            if norm > 0:
                vec /= norm
            return vec
        finally:
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except:
                    pass
