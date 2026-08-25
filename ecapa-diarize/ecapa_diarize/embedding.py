"""ECAPA-TDNN speaker embedding via SpeechBrain."""

from __future__ import annotations

from typing import Union

import numpy as np
import torch

from ecapa_diarize.paths import ECAPA_DIR

SAMPLE_RATE = 16000
EMBEDDING_DIM = 192


class EcapaEmbedder:
    """Wrap SpeechBrain ECAPA-TDNN for 192-dim speaker embeddings."""

    def __init__(self, device: str = "cpu") -> None:
        if not (ECAPA_DIR / "hyperparams.yaml").exists():
            raise FileNotFoundError(
                f"Model chưa có tại {ECAPA_DIR}. "
                "Chạy: python scripts/download_models.py"
            )
        from speechbrain.inference.speaker import SpeakerRecognition
        from speechbrain.utils.fetching import LocalStrategy

        import tempfile
        import os
        cache_dir = os.path.join(tempfile.gettempdir(), "ecapa_cache")
        os.makedirs(cache_dir, exist_ok=True)

        self.device = device
        self._model = SpeakerRecognition.from_hparams(
            source=str(ECAPA_DIR),
            savedir=cache_dir,
            run_opts={"device": device},
            local_strategy=LocalStrategy.COPY,
        )

    def embed(self, audio: Union[np.ndarray, torch.Tensor], sample_rate: int = SAMPLE_RATE) -> np.ndarray:
        wav = self._to_tensor(audio, sample_rate)
        if wav.numel() < int(0.3 * SAMPLE_RATE):
            raise ValueError("Audio too short for embedding (need >= 0.3s)")

        with torch.no_grad():
            emb = self._model.encode_batch(wav)
        vec = emb.squeeze().cpu().numpy().astype(np.float32)
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec /= norm
        return vec

    def _to_tensor(self, audio: Union[np.ndarray, torch.Tensor], sample_rate: int) -> torch.Tensor:
        if isinstance(audio, np.ndarray):
            wav = torch.from_numpy(audio.astype(np.float32))
        else:
            wav = audio.float()

        if wav.dim() == 1:
            wav = wav.unsqueeze(0)
        elif wav.dim() == 2 and wav.shape[0] > 1:
            wav = wav.mean(dim=0, keepdim=True)

        if sample_rate != SAMPLE_RATE:
            import torchaudio

            wav = torchaudio.functional.resample(wav, sample_rate, SAMPLE_RATE)

        return wav.to(self.device)
