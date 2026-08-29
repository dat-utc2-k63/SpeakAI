import numpy as np
import torch
import warnings

try:
    from df.enhance import enhance, init_df, load_audio as df_load_audio, save_audio
    _df_model, _df_state = None, None
except ImportError:
    pass

def _get_df_model():
    global _df_model, _df_state
    if _df_model is None or _df_state is None:
        _df_model, _df_state, _ = init_df()
    return _df_model, _df_state

def denoise_with_deepfilternet(audio: np.ndarray, sr: int) -> tuple[np.ndarray, int]:
    try:
        model, df_state = _get_df_model()
        if audio.ndim == 1:
            audio = audio[np.newaxis, :]
        audio_tensor = torch.from_numpy(audio).float()
        
        enhanced = enhance(model, df_state, audio_tensor)
        return enhanced.squeeze().numpy(), df_state.sr()
    except Exception as e:
        warnings.warn(f"DeepFilterNet failed, returning original audio: {e}")
        return audio, sr

def level_audio_to_target(audio: np.ndarray, sr: int, target_db: float = -20.0) -> np.ndarray:
    rms = np.sqrt(np.mean(audio**2))
    if rms == 0:
        return audio
    current_db = 20 * np.log10(rms + 1e-9)
    gain = 10 ** ((target_db - current_db) / 20)
    return audio * gain
