"""Resolve and load transformer checkpoints from transformer_models/."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional, Union

import torch
import torch.nn as nn

PathLike = Union[str, Path]

DEFAULT_MODEL_DIR = Path("transformer_models")
PRONUNCIATION_NAMES = ("pronunciation.pt", "best_model.pt")
MDD_NAMES = ("l2_mdd.pt", "best_model.pt")


def _first_existing(base: Path, names: tuple[str, ...]) -> Optional[Path]:
    for name in names:
        p = base / name
        if p.is_file():
            return p
    return None


def _download_pronunciation_from_hub(config: Dict[str, Any]) -> Optional[Path]:
    paths = config.get("paths", {})
    repo_id = paths.get("pronunciation_hf_repo")
    if not repo_id:
        return None

    filename = paths.get("pronunciation_hf_filename", "pronunciation.pt")
    model_dir = Path(paths.get("transformer_models_dir", DEFAULT_MODEL_DIR))
    model_dir.mkdir(parents=True, exist_ok=True)
    target = model_dir / filename

    from huggingface_hub import hf_hub_download

    hf_hub_download(repo_id=repo_id, filename=filename, local_dir=str(model_dir))
    return target if target.is_file() else None


def resolve_checkpoint(
    config: Dict[str, Any],
    *,
    model: str,
    explicit: Optional[PathLike] = None,
) -> Path:
    """model: pronunciation | l2_mdd"""
    if explicit:
        p = Path(explicit)
        if p.is_file():
            return p
        raise FileNotFoundError(f"Checkpoint not found: {p}")

    paths = config.get("paths", {})
    key = "pronunciation_checkpoint" if model == "pronunciation" else "l2_mdd_checkpoint"
    configured = paths.get(key)
    if configured and Path(configured).is_file():
        return Path(configured)

    model_dir = Path(paths.get("transformer_models_dir", DEFAULT_MODEL_DIR))
    names = PRONUNCIATION_NAMES if model == "pronunciation" else MDD_NAMES
    found = _first_existing(model_dir, names)
    if found:
        return found

    legacy_dir = Path(
        paths.get("checkpoint_dir", "checkpoints" if model == "pronunciation" else "checkpoints/l2_mdd")
    )
    legacy = legacy_dir / "best_model.pt"
    if legacy.is_file():
        return legacy

    if model == "pronunciation":
        downloaded = _download_pronunciation_from_hub(config)
        if downloaded:
            return downloaded
        found = _first_existing(model_dir, names)
        if found:
            return found

    expected = ", ".join(names)
    raise FileNotFoundError(
        f"No {model} checkpoint. Place weights in {model_dir}/ ({expected}) "
        f"or set paths.{key} in config."
    )


def load_state_dict(path: PathLike, device: Union[str, torch.device] = "cpu") -> dict:
    st = torch.load(path, map_location=device, weights_only=False)
    if isinstance(st, dict) and "model_state_dict" in st:
        return st["model_state_dict"]
    return st


def load_model_weights(
    model: nn.Module,
    config: Dict[str, Any],
    *,
    model_kind: str,
    explicit: Optional[PathLike] = None,
    device: Union[str, torch.device] = "cpu",
    strict: bool = True,
) -> Path:
    path = resolve_checkpoint(config, model=model_kind, explicit=explicit)
    model.load_state_dict(load_state_dict(path, device), strict=strict)
    return path
