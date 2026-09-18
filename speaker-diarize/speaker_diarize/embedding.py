import numpy as np
import torch
import torchaudio
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


def _compute_fbank(wav: np.ndarray, sample_rate: int = SAMPLE_RATE, n_mels: int = 80) -> torch.Tensor:
    """Tính log-Mel filterbank features trực tiếp trong RAM (không ghi file đĩa).
    
    ERes2Net sử dụng 80-dimensional fbank features tại 16kHz.
    Output shape: (1, n_mels, num_frames) — sẵn sàng cho model forward.
    """
    waveform = torch.from_numpy(wav).unsqueeze(0)  # (1, samples)
    
    # Tính Mel spectrogram giống cách ModelScope pipeline xử lý nội bộ
    fbank = torchaudio.compliance.kaldi.fbank(
        waveform,
        num_mel_bins=n_mels,
        sample_frequency=sample_rate,
        frame_length=25.0,
        frame_shift=10.0,
        window_type='hamming',
        use_energy=False,
    )  # (num_frames, n_mels)
    
    # Chuẩn hoá CMVN (Cepstral Mean and Variance Normalization)
    fbank = fbank - fbank.mean(dim=0, keepdim=True)
    
    return fbank.unsqueeze(0)  # (1, num_frames, n_mels)


class ERes2NetEmbedder:
    """Wrap ModelScope ERes2NetV2 for speaker embeddings.
    
    Hỗ trợ 3 chế độ inference:
    - embed_direct(): Truyền tensor trực tiếp vào model (NHANH NHẤT, không I/O đĩa)
    - embed_batch():  Gom nhiều audio windows thành 1 batch GPU forward (TỐI ƯU cho diarize)
    - embed():        Phương thức gốc qua ModelScope pipeline + file tạm (FALLBACK)
    """

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

        # ── Trích xuất raw PyTorch model từ ModelScope pipeline để dùng embed_direct/embed_batch ──
        self._raw_model = None
        try:
            model_obj = getattr(self.sv_pipeline, 'model', None)
            if model_obj is not None:
                # ModelScope wraps the actual nn.Module inside model.model hoặc trực tiếp
                inner = getattr(model_obj, 'model', model_obj)
                if hasattr(inner, 'forward') and callable(inner.forward):
                    self._raw_model = inner
                    self._raw_model.eval()
                    print(f"[{name}] ✅ Raw PyTorch model extracted — embed_direct/embed_batch enabled (zero I/O)")
        except Exception as e:
            print(f"[{name}] ⚠️ Could not extract raw model ({e}), falling back to file-based embed()")

    @staticmethod
    def _to_wav(audio: np.ndarray | torch.Tensor) -> np.ndarray:
        """Chuyển đổi input thành mảng 1D float32."""
        if isinstance(audio, torch.Tensor):
            wav = audio.cpu().numpy().astype(np.float32)
        else:
            wav = audio.astype(np.float32)
        while wav.ndim > 1:
            wav = wav[0]
        return wav

    @staticmethod
    def _normalize_vec(vec: np.ndarray) -> np.ndarray:
        """L2-normalize embedding vector."""
        vec = np.squeeze(vec).astype(np.float32)
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec /= norm
        return vec

    @torch.inference_mode()
    def embed_direct(self, audio: np.ndarray | torch.Tensor, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
        """Trích xuất speaker embedding KHÔNG qua file I/O.
        
        Tính fbank features trực tiếp trong RAM rồi forward qua raw model.
        Nhanh gấp ~10-20 lần so với embed() vì loại bỏ hoàn toàn disk I/O.
        Nếu raw model không khả dụng, tự động fallback về embed().
        """
        if self._raw_model is None:
            return self.embed(audio, sample_rate)

        wav = self._to_wav(audio)
        if len(wav) < int(0.2 * SAMPLE_RATE):
            raise ValueError("Audio too short for embedding (need >= 0.2s)")

        fbank = _compute_fbank(wav, sample_rate)  # (1, num_frames, n_mels)
        fbank = fbank.to(self.device)

        output = self._raw_model(fbank)
        
        # ERes2Net trả về embedding tensor — có thể là tuple hoặc tensor trực tiếp
        if isinstance(output, (tuple, list)):
            emb = output[0]
        elif isinstance(output, dict):
            emb = output.get('embs', output.get('embedding', list(output.values())[0]))
        else:
            emb = output
        
        if isinstance(emb, torch.Tensor):
            vec = emb.detach().cpu().numpy()
        else:
            vec = np.array(emb)
        
        return self._normalize_vec(vec)

    @torch.inference_mode()
    def embed_batch(self, audio_list: list[np.ndarray], sample_rate: int = SAMPLE_RATE) -> list[np.ndarray]:
        """Trích xuất embeddings cho NHIỀU audio windows cùng lúc (Batch GPU Inference).
        
        Gom tất cả windows thành 1 batch tensor, forward qua GPU 1 lần duy nhất.
        Hiệu quả gấp N lần so với gọi embed() N lần (giảm CUDA kernel launch overhead).
        
        Args:
            audio_list: Danh sách các audio numpy arrays (mỗi cái là 1 window).
            sample_rate: Sample rate (mặc định 16kHz).
        
        Returns:
            Danh sách các L2-normalized embedding vectors (512-D mỗi cái).
        """
        if not audio_list:
            return []
        
        # Nếu raw model không khả dụng, fallback gọi từng cái
        if self._raw_model is None:
            return [self.embed(a, sample_rate) for a in audio_list]

        # Tính fbank cho tất cả windows
        fbanks = []
        valid_indices = []
        for i, audio in enumerate(audio_list):
            wav = self._to_wav(audio)
            if len(wav) < int(0.2 * SAMPLE_RATE):
                continue
            fb = _compute_fbank(wav, sample_rate)  # (1, num_frames, n_mels)
            fbanks.append(fb)
            valid_indices.append(i)
        
        if not fbanks:
            return []

        # Pad tất cả fbanks về cùng chiều dài (num_frames có thể khác nhau giữa các windows)
        max_frames = max(fb.shape[1] for fb in fbanks)
        n_mels = fbanks[0].shape[2]
        
        # Chia thành các mini-batch để tránh tràn VRAM với file audio rất dài
        BATCH_SIZE = 64
        all_embeddings = [None] * len(audio_list)
        
        for batch_start in range(0, len(fbanks), BATCH_SIZE):
            batch_fbanks = fbanks[batch_start:batch_start + BATCH_SIZE]
            batch_indices = valid_indices[batch_start:batch_start + BATCH_SIZE]
            
            batch_max_frames = max(fb.shape[1] for fb in batch_fbanks)
            padded = torch.zeros(len(batch_fbanks), batch_max_frames, n_mels)
            for j, fb in enumerate(batch_fbanks):
                padded[j, :fb.shape[1], :] = fb.squeeze(0)
            
            padded = padded.to(self.device)
            output = self._raw_model(padded)
            
            # Trích xuất embeddings từ output
            if isinstance(output, (tuple, list)):
                embs_tensor = output[0]
            elif isinstance(output, dict):
                embs_tensor = output.get('embs', output.get('embedding', list(output.values())[0]))
            else:
                embs_tensor = output
            
            if isinstance(embs_tensor, torch.Tensor):
                embs_np = embs_tensor.detach().cpu().numpy()
            else:
                embs_np = np.array(embs_tensor)
            
            # Gán kết quả vào đúng vị trí
            if embs_np.ndim == 1:
                # Single embedding returned for entire batch — fallback to sequential
                for idx in batch_indices:
                    all_embeddings[idx] = self.embed_direct(audio_list[idx], sample_rate)
            else:
                for j, idx in enumerate(batch_indices):
                    all_embeddings[idx] = self._normalize_vec(embs_np[j])
        
        # Lọc bỏ None (windows quá ngắn)
        return [e for e in all_embeddings if e is not None]

    def embed(self, audio: np.ndarray | torch.Tensor, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
        """Phương thức gốc: trích xuất embedding qua ModelScope pipeline + file tạm.
        
        Chậm hơn embed_direct() do phải ghi/đọc file đĩa, nhưng đảm bảo tương thích 100%
        với mọi phiên bản ModelScope. Dùng làm fallback khi embed_direct() không khả dụng.
        """
        wav = self._to_wav(audio)
        if len(wav) < int(0.2 * SAMPLE_RATE):
            raise ValueError("Audio too short for embedding (need >= 0.2s)")

        # Thử embed_direct trước, fallback về file I/O nếu thất bại
        if self._raw_model is not None:
            try:
                return self.embed_direct(audio, sample_rate)
            except Exception:
                pass

        import soundfile as sf
        import tempfile
        
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
            return self._normalize_vec(vec)
        finally:
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except:
                    pass
