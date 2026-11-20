"""Centralized secret and environment configuration loader for SpeakAI-Eval.

All Python scripts, backend API endpoints, and the frontend config sync script
read credentials from one source of truth:
  1. `<repo>/.env` (loaded into process environment without overriding real env vars)
  2. Process environment variables (`os.environ`)
  3. Kaggle Secrets (`kaggle_secrets.UserSecretsClient`) when running inside Kaggle

Private backend keys (e.g. `HF_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `LLM_API_KEY`) stay strictly
server-side and are NEVER exported to `web/.env.local`.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, Tuple

ROOT = Path(__file__).resolve().parent
DEFAULT_ENV_FILE = ROOT / ".env"

DEFAULT_LLM_ENDPOINT = "https://revidapi.com/v1/chat/completions"
DEFAULT_LLM_MODEL = "deepseek-v4.1-flash"

_ENV_LOADED = False


def _parse_env_file_fallback(path: Path, *, override: bool = False) -> None:
    """Minimal `.env` parser when `python-dotenv` is unavailable."""
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if override or key not in os.environ:
            os.environ[key] = value


def load_project_env(env_path: str | Path | None = None, *, override: bool = False) -> bool:
    """Load environment variables from `.env` if present. Safe to call repeatedly."""
    global _ENV_LOADED
    path = Path(env_path) if env_path is not None else DEFAULT_ENV_FILE
    if _ENV_LOADED and env_path is None and not override:
        return path.is_file()

    if path.is_file():
        try:
            from dotenv import load_dotenv

            load_dotenv(dotenv_path=path, override=override)
        except ImportError:
            _parse_env_file_fallback(path, override=override)

    if env_path is None:
        _ENV_LOADED = True
    return path.is_file()


def get_secret(name: str, default: str = "", *, aliases: Tuple[str, ...] = ()) -> str:
    """Resolve a secret from `.env` / environment variables / Kaggle Secrets."""
    load_project_env()
    candidates = (name, *aliases)

    for key in candidates:
        val = (os.getenv(key) or "").strip()
        if val:
            return val

    try:
        from kaggle_secrets import UserSecretsClient

        client = UserSecretsClient()
        for key in candidates:
            try:
                val = (client.get_secret(key) or "").strip()
                if val:
                    return val
            except Exception:
                continue
    except Exception:
        pass

    return default


def get_supabase_config() -> Tuple[str, str]:
    """Return `(supabase_url, supabase_key)` with zero hardcoded fallbacks."""
    url = get_secret("SUPABASE_URL").rstrip("/")
    key = get_secret(
        "SUPABASE_ANON_KEY",
        aliases=("SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    )
    return url, key


def get_supabase_service_config() -> Tuple[str, str]:
    """Return `(supabase_url, supabase_service_role_key)` strictly for server-side callers."""
    url = get_secret("SUPABASE_URL").rstrip("/")
    service_key = get_secret("SUPABASE_SERVICE_ROLE_KEY")
    return url, service_key


def get_llm_api_key() -> str:
    """Return optional server-side fallback LLM API key."""
    return get_secret(
        "LLM_API_KEY",
        aliases=("SPEAKAI_LLM_API_KEY",),
    )


def get_hf_token() -> str:
    """Return optional HuggingFace token from centralized env/Kaggle secrets."""
    return get_secret("HF_TOKEN", aliases=("HUGGINGFACE_HUB_TOKEN", "HUGGINGFACE_TOKEN"))


def get_frontend_config() -> Dict[str, str]:
    """Return public and server-safe settings for Next.js configuration."""
    load_project_env()
    llm_endpoint = get_secret("DEFAULT_LLM_ENDPOINT", default=DEFAULT_LLM_ENDPOINT)
    llm_model = get_secret("DEFAULT_LLM_MODEL", default=DEFAULT_LLM_MODEL)
    return {
        "SUPABASE_URL": get_secret("SUPABASE_URL").rstrip("/"),
        "SUPABASE_ANON_KEY": get_secret("SUPABASE_ANON_KEY", aliases=("SUPABASE_KEY",)),
        "SUPABASE_SERVICE_ROLE_KEY": get_secret("SUPABASE_SERVICE_ROLE_KEY"),
        "DEFAULT_LLM_ENDPOINT": llm_endpoint,
        "DEFAULT_LLM_MODEL": llm_model,
        "SPEAKAI_API_URL": get_secret("SPEAKAI_API_URL").rstrip("/"),
    }

