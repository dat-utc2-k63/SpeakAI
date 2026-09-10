import numpy as np
import torch
import warnings

# Tắt cảnh báo librosa/modelscope
warnings.filterwarnings("ignore")

SAMPLE_RATE = 16000

import os
HUB_MODEL_ID = "damo/speech_eres2net_large_200k_sv_zh-cn_16k-common"
DEFAULT_MODEL_ID = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pretrained_models", "speech_eres2net_large_200k_sv_zh-cn_16k-common")

def resolve_eres2net_model(model_id: str | None = None) -> str:
    """
    Xác định đường dẫn checkpoint hợp lệ cho ERes2Net:
    1. Nếu model_id được truyền vào và thư mục chứa pretrained_eres2net.pt (> 10MB) -> Dùng model_id.
    2. Nếu thư mục mặc định trong speaker-diarize chứa pretrained_eres2net.pt (> 10MB) -> Dùng mặc định.
    3. Tìm kiếm trong /kaggle/working và /kaggle/input xem có thư mục chứa pretrained_eres2net.pt (> 10MB) -> Dùng thư mục đó.
    4. Nếu không có tại local, tự động tải/cache qua snapshot_download('damo/speech_eres2net_large_200k_sv_zh-cn_16k-common').
    """
    # 1. Kiểm tra model_id truyền vào
    if model_id and os.path.isdir(model_id):
        pt_path = os.path.join(model_id, "pretrained_eres2net.pt")
        cfg_path = os.path.join(model_id, "configuration.json")
        if os.path.isfile(pt_path) and os.path.getsize(pt_path) > 10_000_000 and os.path.isfile(cfg_path):
            return model_id

    # 2. Kiểm tra thư mục local mặc định
    if os.path.isdir(DEFAULT_MODEL_ID):
        pt_path = os.path.join(DEFAULT_MODEL_ID, "pretrained_eres2net.pt")
        cfg_path = os.path.join(DEFAULT_MODEL_ID, "configuration.json")
        if os.path.isfile(pt_path) and os.path.getsize(pt_path) > 10_000_000 and os.path.isfile(cfg_path):
            return DEFAULT_MODEL_ID

    # 3. Tim kiem trong Kaggle directories (/kaggle/working, /kaggle/input)
    for search_root in ["/kaggle/working", "/kaggle/input"]:
        if os.path.exists(search_root):
            for root, dirs, files in os.walk(search_root):
                if "pretrained_eres2net.pt" in files and "configuration.json" in files:
                    pt_path = os.path.join(root, "pretrained_eres2net.pt")
                    if os.path.getsize(pt_path) > 10_000_000:
                        print(f"[ERes2Net] Found valid checkpoint at: {root}")
                        return root

    # 4. Tai tu ModelScope Hub
    try:
        from modelscope.hub.snapshot_download import snapshot_download
        print(f"[ERes2Net] Local checkpoint missing or incomplete. Downloading {HUB_MODEL_ID} from ModelScope...")
        cache_dir = snapshot_download(HUB_MODEL_ID)
        print(f"[ERes2Net] Model downloaded successfully to: {cache_dir}")
        return cache_dir
    except Exception as e:
        print(f"[ERes2Net] Warning during download ({e}), using Hub ID directly: {HUB_MODEL_ID}")
        return HUB_MODEL_ID

class ERes2NetEmbedder:
    """Wrap ModelScope ERes2NetV2 for speaker embeddings."""

    def __init__(self, device: str = "cuda", model_id: str | None = None) -> None:
        self.device = device if torch.cuda.is_available() else "cpu"
        resolved_model = resolve_eres2net_model(model_id)
        self.model_id = resolved_model
        from modelscope.pipelines import pipeline
        
        # Initialize pipeline
        name = resolved_model.replace("\\", "/").rstrip("/").split("/")[-1]
        print(f"[{name}] Loading ERes2Net model from '{resolved_model}'...")
        self.sv_pipeline = pipeline(
            task='speaker-verification',
            model=resolved_model,
            device=self.device
        )
        print(f"[{name}] ERes2Net model loaded successfully on {self.device}!")

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
