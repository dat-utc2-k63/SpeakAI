"""Sync public-safe frontend configuration from centralized `.env` to `web/.env.local`.

Usage:
    python scripts/sync_secrets.py
    python scripts/sync_secrets.py --check
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from env_config import DEFAULT_ENV_FILE, get_frontend_config, load_project_env

TARGET_ENV_LOCAL = ROOT / "web" / ".env.local"


def _quote_env(value: str) -> str:
    clean = str(value or "").replace("\r", "").replace("\n", "")
    escaped = clean.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def render_env_local(cfg: dict[str, str]) -> str:
    lines = [
        "# ============================================================",
        "# AUTO-GENERATED FROM .env BY scripts/sync_secrets.py",
        "# Chỉ chứa biến NEXT_PUBLIC_* công khai — KHÔNG commit lên Git!",
        "# ============================================================",
        f'NEXT_PUBLIC_SUPABASE_URL={_quote_env(cfg.get("SUPABASE_URL", ""))}',
        f'NEXT_PUBLIC_SUPABASE_ANON_KEY={_quote_env(cfg.get("SUPABASE_ANON_KEY", ""))}',
        f'NEXT_PUBLIC_DEFAULT_LLM_ENDPOINT={_quote_env(cfg.get("DEFAULT_LLM_ENDPOINT", ""))}',
        f'NEXT_PUBLIC_DEFAULT_LLM_MODEL={_quote_env(cfg.get("DEFAULT_LLM_MODEL", ""))}',
        f'NEXT_PUBLIC_SPEAKAI_API_URL={_quote_env(cfg.get("SPEAKAI_API_URL", ""))}',
        f'SUPABASE_SERVICE_ROLE_KEY={_quote_env(cfg.get("SUPABASE_SERVICE_ROLE_KEY", ""))}',
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync centralized .env public config to web/.env.local")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate that SUPABASE_URL and SUPABASE_ANON_KEY are configured (non-placeholder).",
    )
    args = parser.parse_args()

    has_env = load_project_env()
    cfg = get_frontend_config()

    url = cfg.get("SUPABASE_URL", "")
    key = cfg.get("SUPABASE_ANON_KEY", "")
    missing = (
        not url
        or not key
        or "your-project-ref" in url
        or "your-supabase-anon-key" in key
    )

    if args.check:
        if missing:
            print("❌ Chưa cấu hình đủ SUPABASE_URL và SUPABASE_ANON_KEY trong .env / biến môi trường.", file=sys.stderr)
            return 1
        print(f"✅ Env config hợp lệ ({DEFAULT_ENV_FILE if has_env else 'process env'}).")
        return 0

    TARGET_ENV_LOCAL.parent.mkdir(parents=True, exist_ok=True)
    TARGET_ENV_LOCAL.write_text(render_env_local(cfg), encoding="utf-8")

    rel = TARGET_ENV_LOCAL.relative_to(ROOT).as_posix()
    if missing:
        print(f"⚠️ Đã tạo {rel}, nhưng SUPABASE_URL hoặc SUPABASE_ANON_KEY vẫn đang trống/placeholder.")
        print("   Hãy điền vào file .env rồi chạy lại: python scripts/sync_secrets.py")
    else:
        print(f"✅ Đã đồng bộ cấu hình công khai từ .env -> {rel}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
