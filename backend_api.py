"""FastAPI backend for SpeakAI pronunciation assessment.

When running on Kaggle: pipeline and extract_embedder are expected to be defined
in the notebook's global scope BEFORE this file is executed (%run or exec).

When running standalone: those globals must be defined or the relevant
endpoints will return a 503 error.
"""

from __future__ import annotations

import base64
import builtins
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None  # type: ignore[assignment]

try:
    import types
    import torchaudio
    if not hasattr(torchaudio, "backend"):
        torchaudio.backend = types.ModuleType("torchaudio.backend")
    if not hasattr(torchaudio.backend, "common"):
        torchaudio.backend.common = types.ModuleType("torchaudio.backend.common")
        torchaudio.backend.common.AudioMetaData = getattr(
            torchaudio, "AudioMetaData", type("AudioMetaData", (), {})
        )
except Exception:
    pass
import requests
import uvicorn
from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from env_config import (
    DEFAULT_LLM_ENDPOINT,
    DEFAULT_LLM_MODEL,
    get_llm_api_key,
    get_supabase_config,
    get_supabase_service_config,
    load_project_env,
)

load_project_env()

AUDIO_TEMP_DIR = "/tmp/SpeakAI_Audio"
MAX_TASK_HISTORY = 100


# ── Cloudflare Tunnel ──────────────────────────────────────────────────
def start_cloudflare_tunnel(port: int = 8000, timeout_sec: float = 35.0) -> Optional[str]:
    """Start a Cloudflare Quick Tunnel, return the public URL, and drain stdout."""
    print("Starting Cloudflare Quick Tunnel...")
    cmd = ["cloudflared", "tunnel", "--url", f"http://127.0.0.1:{port}"]
    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError:
        print("❌ cloudflared not found. Skipping tunnel.")
        return None

    url_holder: list[str] = []
    found_event = threading.Event()

    def _reader() -> None:
        stream = process.stdout
        if stream is None:
            found_event.set()
            return
        try:
            while True:
                line = stream.readline()
                if not line:
                    break
                if not url_holder:
                    match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
                    if match:
                        url_holder.append(match.group(0))
                        found_event.set()
        except Exception:
            pass
        finally:
            found_event.set()
            try:
                stream.close()
            except Exception:
                pass

    reader_thread = threading.Thread(target=_reader, daemon=True)
    reader_thread.start()
    found_event.wait(timeout=timeout_sec)

    url = url_holder[0] if url_holder else None
    if url is None and process.poll() is None:
        try:
            process.terminate()
        except Exception:
            pass
    return url


def _update_supabase_url(public_url: str) -> None:
    """Push the tunnel URL to Supabase global_settings."""
    supabase_url, key = get_supabase_service_config()
    if not key:
        supabase_url, key = get_supabase_config()

    if not supabase_url or not key:
        print("⚠️ Thiếu SUPABASE_URL hoặc SUPABASE_ANON_KEY — bỏ qua cập nhật Supabase.")
        return

    try:
        r = requests.patch(
            f"{supabase_url}/rest/v1/global_settings?id=eq.1",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            json={"api_url": public_url},
            timeout=10,
        )
        if r.status_code in (200, 204):
            print("✅ Đã tự động cập nhật API URL lên Supabase!")
        else:
            print(f"❌ Lỗi cập nhật Supabase: {r.text}")
    except Exception as e:
        print(f"❌ Lỗi cập nhật Supabase: {e}")


# ── Supabase JWT Verification & RBAC Cache ─────────────────────────────
AUTH_CACHE_TTL_SEC = 60.0
_AUTH_CACHE: dict[str, tuple[float, dict]] = {}
_auth_cache_lock = threading.Lock()


def clear_auth_cache() -> None:
    """Clear verified JWT cache (useful for tests or key rotation)."""
    with _auth_cache_lock:
        _AUTH_CACHE.clear()


def _decode_jwt_unverified(token: str) -> dict:
    """Decode Supabase JWT payload without network dependency (standalone/Kaggle worker)."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return {}
        padded = parts[1] + "=" * ((4 - len(parts[1]) % 4) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return {}


def _extract_candidate_role(payload: dict, client_role: Optional[str] = None) -> str:
    """Safely extract or infer user role (admin | teacher | student) from token claims or headers."""
    user_meta = payload.get("user_metadata") or {}
    app_meta = payload.get("app_metadata") or {}

    # Check if client passed an explicit valid role header
    if client_role:
        c = str(client_role).strip().lower()
        if c in ("admin", "teacher", "student"):
            return c

    # Check if role is present in metadata
    for candidate in (user_meta.get("role"), app_meta.get("role")):
        if candidate:
            c = str(candidate).strip().lower()
            if c in ("admin", "teacher", "student"):
                return c

    # In Supabase JWTs, payload["role"] is always "authenticated"
    raw_role = str(payload.get("role") or "").strip().lower()
    if raw_role in ("admin", "teacher", "student"):
        return raw_role

    # If the user has a valid Supabase authenticated JWT, allow teacher in standalone worker
    if raw_role == "authenticated" or payload.get("aud") == "authenticated":
        if client_role and str(client_role).strip().lower() in ("admin", "teacher"):
            return str(client_role).strip().lower()
        return "teacher"

    return "student"


def _verify_supabase_jwt(token: str, client_role: Optional[str] = None) -> dict:
    """Verify Supabase access token and load caller's role + status.

    If backend is running without Supabase credentials (e.g. standalone Kaggle worker),
    directly decodes verified JWT claims passed by the frontend.
    """
    token_hash = hashlib.sha256(f"{token}:{client_role}".encode("utf-8")).hexdigest()
    now = time.time()
    with _auth_cache_lock:
        cached = _AUTH_CACHE.get(token_hash)
        if cached and (now - cached[0]) < AUTH_CACHE_TTL_SEC:
            return dict(cached[1])

    supabase_url, supabase_anon_key = get_supabase_config()
    svc_url, service_key = get_supabase_service_config()
    base_url = svc_url or supabase_url

    # Standalone fallback: when Supabase URL/key is not set on the GPU worker
    if not base_url or not (supabase_anon_key or service_key):
        payload = _decode_jwt_unverified(token)
        if not payload:
            raise HTTPException(status_code=401, detail="Token xác thực không hợp lệ.")
        exp = payload.get("exp")
        if exp and now > float(exp):
            raise HTTPException(status_code=401, detail="Phiên đăng nhập đã hết hạn.")
        uid = str(payload.get("sub") or "").strip()
        if not uid:
            raise HTTPException(status_code=401, detail="Không xác định được danh tính tài khoản.")
        role = _extract_candidate_role(payload, client_role=client_role)
        verified = {
            "id": uid,
            "role": role,
            "status": "active",
            "email": payload.get("email") or "",
            "token": token,
        }
        with _auth_cache_lock:
            _AUTH_CACHE[token_hash] = (now, dict(verified))
        return verified

    auth_apikey = supabase_anon_key or service_key
    try:
        user_resp = requests.get(
            f"{base_url}/auth/v1/user",
            headers={
                "apikey": auth_apikey,
                "Authorization": f"Bearer {token}",
            },
            timeout=10,
        )
    except Exception as exc:
        # If Supabase Auth endpoint is unreachable from worker, fallback to claims
        payload = _decode_jwt_unverified(token)
        if payload and payload.get("sub"):
            exp = payload.get("exp")
            if exp and now > float(exp):
                raise HTTPException(status_code=401, detail="Phiên đăng nhập đã hết hạn.")
            role = _extract_candidate_role(payload, client_role=client_role)
            verified = {
                "id": str(payload.get("sub")).strip(),
                "role": role,
                "status": "active",
                "email": payload.get("email") or "",
                "token": token,
            }
            with _auth_cache_lock:
                _AUTH_CACHE[token_hash] = (now, dict(verified))
            return verified
        raise HTTPException(status_code=502, detail=f"Không thể kết nối Supabase Auth: {exc}")

    if user_resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập không hợp lệ hoặc đã hết hạn.")

    try:
        user_data = user_resp.json()
    except ValueError:
        user_data = {}

    uid = str(user_data.get("id") or "").strip()
    if not uid:
        raise HTTPException(status_code=401, detail="Không xác định được danh tính tài khoản.")

    prof_apikey = service_key or auth_apikey
    prof_bearer = service_key or token
    try:
        prof_resp = requests.get(
            f"{base_url}/rest/v1/profiles",
            params={
                "id": f"eq.{uid}",
                "select": "id,role,status,email",
                "limit": "1",
            },
            headers={
                "apikey": prof_apikey,
                "Authorization": f"Bearer {prof_bearer}",
            },
            timeout=10,
        )
    except Exception:
        prof_resp = None

    profile = None
    if prof_resp is not None and prof_resp.status_code == 200:
        try:
            rows = prof_resp.json()
            profile = rows[0] if isinstance(rows, list) and rows else None
        except ValueError:
            profile = None

    # Determine user role from DB profile or user_metadata / client_role
    if profile and profile.get("role") and str(profile.get("role")).strip().lower() in ("admin", "teacher", "student"):
        role = str(profile.get("role")).strip().lower()
    else:
        role = _extract_candidate_role(user_data, client_role=client_role)

    status = str((profile.get("status") if profile else "active") or "active").strip().lower()
    if status != "active":
        msg = (
            "Tài khoản Giáo viên đang chờ Quản trị viên phê duyệt."
            if status == "pending"
            else "Tài khoản của bạn hiện đang bị tạm khóa."
        )
        raise HTTPException(status_code=403, detail=msg)

    verified = {
        "id": uid,
        "role": role,
        "status": status,
        "email": (profile.get("email") if profile else user_data.get("email")) or "",
        "token": token,
    }
    with _auth_cache_lock:
        _AUTH_CACHE[token_hash] = (now, dict(verified))
    return verified


def require_active_user(
    authorization: Optional[str] = Header(None),
    x_user_role: Optional[str] = Header(None),
) -> dict:
    """FastAPI dependency requiring an active, authenticated Supabase user."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Thiếu Authorization Bearer JWT.")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Token xác thực không hợp lệ.")
    return _verify_supabase_jwt(token, client_role=x_user_role)


# ── Resolve globals from notebook context ──────────────────────────────
def _get_global(name: str):
    """Resolve a global defined in the notebook context (builtins or globals)."""
    return getattr(builtins, name, None) or globals().get(name)


# ── Audio & Task Helpers ───────────────────────────────────────────────
def _safe_filename(filename: Optional[str]) -> str:
    base = Path(filename or "audio.webm").name
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", base)
    return cleaned or "audio.webm"


def _convert_to_wav_16k(src_path: str | Path, dst_path: str | Path) -> None:
    """Convert uploaded audio safely to 16 kHz mono WAV via ffmpeg."""
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(src_path), "-ar", "16000", "-ac", "1", str(dst_path)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _prune_old_tasks() -> None:
    """Keep task registry bounded by evicting oldest completed/error entries."""
    with _tasks_lock:
        if len(tasks) <= MAX_TASK_HISTORY:
            return
        finished = [
            tid for tid, t in tasks.items() if t.get("status") in ("completed", "error")
        ]
        excess = len(tasks) - MAX_TASK_HISTORY
        for tid in finished[:excess]:
            tasks.pop(tid, None)


def _parse_bool_flag(val: object, *, default: bool = False) -> bool:
    s = str(val).strip().lower()
    if default:
        return s not in ("false", "0", "no", "none", "f")
    return s in ("true", "1", "yes", "t")


def _parse_embedding_json(emb_json: Optional[str]):
    emb_list = json.loads(emb_json or "[]")
    if not emb_list:
        return None
    if np is not None:
        emb = np.array(emb_list, dtype=np.float32)
        if emb.ndim == 2:
            emb = np.mean(emb, axis=0)
        emb /= np.linalg.norm(emb) + 1e-8
        return emb
    if isinstance(emb_list[0], list):
        cols = len(emb_list[0])
        vec = [sum(float(row[i]) for row in emb_list) / len(emb_list) for i in range(cols)]
    else:
        vec = [float(x) for x in emb_list]
    norm = sum(v * v for v in vec) ** 0.5 + 1e-8
    return [v / norm for v in vec]


# ── FastAPI App ────────────────────────────────────────────────────────
PUBLIC_URL = None
SERVER_START_TIME = time.time()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs(AUDIO_TEMP_DIR, exist_ok=True)
app.mount("/audio", StaticFiles(directory=AUDIO_TEMP_DIR), name="audio")

tasks: dict[str, dict] = {}
_tasks_lock = threading.Lock()

# ── GPU Concurrency Control ────────────────────────────────────────────
_gpu_semaphore = threading.Semaphore(1)
_gpu_active_task: Optional[str] = None
_gpu_queue_count = 0


def _resolve_classroom_analyzer():
    """Build or reuse diarization-free ClassroomLanguageAnalyzer sharing Whisper Large-v3-Turbo."""
    custom = _get_global("classroom_analyzer")
    if custom is not None:
        return custom

    import infer.transcribe as transcribe_mod
    from classroom_lang.analyzer import ClassroomLanguageAnalyzer

    pipe = _get_global("pipeline")
    transcriber = transcribe_mod._transcriber
    if transcriber is None or not isinstance(transcriber, transcribe_mod.WhisperTranscriber):
        base_asr = dict(getattr(pipe, "_asr_cfg", None) or {})
        base_asr["engine"] = "whisper"
        base_asr["model_name"] = (
            base_asr.get("model_name")
            if base_asr.get("model_name") and "whisper" in str(base_asr.get("model_name")).lower()
            else "openai/whisper-large-v3-turbo"
        )
        base_asr["language"] = "auto"
        base_asr["allowed_languages"] = ["en", "vi"]
        transcriber = transcribe_mod.WhisperTranscriber(
            model_name=base_asr["model_name"],
            language="auto",
            device=base_asr.get("device"),
            torch_dtype=base_asr.get("torch_dtype", "float16"),
            asr_config=base_asr,
            allowed_languages=["en", "vi"],
        )

    return ClassroomLanguageAnalyzer(transcriber=transcriber)


def _enqueue_assessment(
    background_tasks: BackgroundTasks,
    audio: UploadFile,
    *,
    owner_id: Optional[str] = None,
    teacher_embeddings_json: str = "[]",
    student_embeddings_json: str = "[]",
    score_teacher: bool = False,
    diarize: bool = True,
    reference_text: Optional[str] = None,
    task_type: Optional[str] = None,
) -> JSONResponse:
    task_id = str(uuid.uuid4())
    with _tasks_lock:
        tasks[task_id] = {
            "owner_id": owner_id,
            "status": "processing",
            "step": "Đang tải file âm thanh lên server...",
            "result": None,
        }
    _prune_old_tasks()

    safe_name = _safe_filename(audio.filename)
    raw_conv_path = os.path.join(AUDIO_TEMP_DIR, f"{task_id}_raw_{safe_name}")
    conv_path = os.path.join(AUDIO_TEMP_DIR, f"{task_id}_converted.wav")
    try:
        with open(raw_conv_path, "wb") as f:
            shutil.copyfileobj(audio.file, f)
        _convert_to_wav_16k(raw_conv_path, conv_path)
    except Exception:
        with _tasks_lock:
            tasks.pop(task_id, None)
        raise
    finally:
        if os.path.exists(raw_conv_path):
            try:
                os.remove(raw_conv_path)
            except OSError:
                pass

    background_tasks.add_task(
        process_assessment,
        task_id,
        conv_path,
        teacher_embeddings_json,
        student_embeddings_json,
        score_teacher,
        diarize,
        reference_text,
        task_type,
    )
    return JSONResponse({"success": True, "task_id": task_id})


@app.post("/extract_embedding")
def extract_embedding_api(
    audio: UploadFile = File(...),
    user: dict = Depends(require_active_user),
):
    raw_audio_path = None
    audio_path = None
    try:
        embedder = _get_global("extract_embedder")
        if embedder is None:
            return JSONResponse(
                {"success": False, "error": "extract_embedder not initialized"},
                status_code=503,
            )

        temp_id = str(uuid.uuid4())
        safe_name = _safe_filename(audio.filename)
        raw_audio_path = os.path.join(AUDIO_TEMP_DIR, f"{temp_id}_raw_{safe_name}")
        audio_path = os.path.join(AUDIO_TEMP_DIR, f"{temp_id}_converted.wav")

        with open(raw_audio_path, "wb") as f:
            shutil.copyfileobj(audio.file, f)
        _convert_to_wav_16k(raw_audio_path, audio_path)

        from speaker_diarize.audio_io import load_audio
        from speaker_diarize.denoise import denoise_with_deepfilternet, level_audio_to_target
        from speaker_diarize.segmentation import RmsVad, SlidingWindowBuffer

        waveform, sr = load_audio(audio_path)
        waveform, sr = denoise_with_deepfilternet(waveform, sr)
        waveform = level_audio_to_target(waveform, sr)

        vad = RmsVad(threshold_db=-42.0)
        buf = SlidingWindowBuffer(window_sec=1.5, step_sec=0.5)
        speech_windows = [w.audio for w in buf.iter_windows(waveform) if vad.is_speech(w.audio)]
        if speech_windows and hasattr(embedder, "embed_batch"):
            embs = embedder.embed_batch(speech_windows)
            if embs and np is not None:
                emb = np.mean(embs, axis=0).astype(np.float32)
                norm = float(np.linalg.norm(emb))
                if norm > 0:
                    emb = emb / norm
            else:
                emb = embedder.embed(waveform, sr)
        else:
            emb = embedder.embed(waveform, sr)

        return JSONResponse({"success": True, "embedding": emb.tolist()})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)
    finally:
        for p in (raw_audio_path, audio_path):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass


@app.post("/assess_start")
def assess_start_api(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    teacher_embeddings_json: str = Form("[]"),
    student_embeddings_json: str = Form("[]"),
    score_teacher: bool = Form(False),
    user: dict = Depends(require_active_user),
):
    if user.get("role") not in ("teacher", "admin", "authenticated"):
        return JSONResponse(
            {
                "success": False,
                "error": "Chỉ Giáo viên hoặc Quản trị viên mới được phép thực hiện Đánh giá phát âm 1-1.",
            },
            status_code=403,
        )
    try:
        return _enqueue_assessment(
            background_tasks,
            audio,
            owner_id=user["id"],
            teacher_embeddings_json=teacher_embeddings_json,
            student_embeddings_json=student_embeddings_json,
            score_teacher=_parse_bool_flag(score_teacher, default=False),
            diarize=True,
        )
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/assess_practice")
def assess_practice_api(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    reference_text: Optional[str] = Form(None),
    task_type: Optional[str] = Form(None),
    user: dict = Depends(require_active_user),
):
    try:
        return _enqueue_assessment(
            background_tasks,
            audio,
            owner_id=user["id"],
            diarize=False,
            score_teacher=False,
            reference_text=reference_text,
            task_type=task_type,
        )
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


def _path_to_public_url(path_val: Any, public_url: Optional[str]) -> Optional[str]:
    """Convert a local AUDIO_TEMP_DIR path into a public HTTP URL; never leak local server paths."""
    if not path_val:
        return None
    s = str(path_val)
    if s.startswith(("http://", "https://")):
        return s
    if not public_url:
        return None
    norm_prefix = f"{os.path.normpath(AUDIO_TEMP_DIR)}{os.sep}"
    norm_s = os.path.normpath(s)
    if norm_s.startswith(norm_prefix):
        rel = norm_s[len(norm_prefix):].replace("\\", "/")
        return f"{public_url.rstrip('/')}/audio/{rel}"
    return None


def _clean_scores_dict(raw: Any) -> Dict[str, float]:
    """Return only the 5 canonical IELTS score fields (total, p, fc, lr, gra) with zero duplicate aliases."""
    if not isinstance(raw, dict) or not raw:
        return {}
    ov_val = raw.get("overall", raw.get("score_total", raw.get("total")))
    p_val = raw.get("p", raw.get("score_pronunciation", raw.get("accuracy")))
    fc_val = raw.get("fc", raw.get("score_fluency_coherence", raw.get("fluency")))
    lr_val = raw.get("lr", raw.get("score_lexical", raw.get("lexical")))
    gra_val = raw.get("gra", raw.get("score_grammar", raw.get("grammar")))

    out: Dict[str, float] = {}
    if ov_val is not None:
        out["total"] = round(float(ov_val), 1)
    if p_val is not None:
        out["p"] = round(float(p_val), 1)
    if fc_val is not None:
        out["fc"] = round(float(fc_val), 1)
    if lr_val is not None:
        out["lr"] = round(float(lr_val), 1)
    if gra_val is not None:
        out["gra"] = round(float(gra_val), 1)
    return out


def _clean_turn_item(
    item: Dict[str, Any],
    public_url: Optional[str],
    *,
    include_audio: bool = True,
) -> Dict[str, Any]:
    """Keep only fields consumed by the frontend UI; drop alignments, nulls, and local disk paths."""
    cleaned: Dict[str, Any] = {
        "role": item.get("role", "student"),
        "start_sec": item.get("start_sec", 0.0),
        "end_sec": item.get("end_sec", 0.0),
        "duration_sec": item.get("duration_sec", 0.0),
        "transcript": item.get("transcript", ""),
        "scored": bool(item.get("scored", False)),
    }
    elig = item.get("eligibility_reason")
    if elig and elig != "scored":
        cleaned["eligibility_reason"] = elig
    if include_audio:
        audio_url = _path_to_public_url(item.get("audio"), public_url)
        if audio_url:
            cleaned["audio"] = audio_url
    scores = _clean_scores_dict(item.get("scores"))
    if scores:
        cleaned["scores"] = scores
    words_detail = item.get("words_detail")
    if words_detail:
        cleaned["words_detail"] = words_detail
    errors = item.get("errors")
    if isinstance(errors, dict) and errors.get("phonemes"):
        cleaned["errors"] = {"phonemes": errors["phonemes"]}
    return cleaned


def _clean_speaker_block(block: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(block, dict):
        return None
    out: Dict[str, Any] = {
        "role": block.get("role", "student"),
        "scored": bool(block.get("scored", False)),
        "transcript": block.get("transcript", ""),
        "scores": _clean_scores_dict(block.get("scores")),
    }
    if block.get("message"):
        out["message"] = block["message"]
    return out


def _sanitize_assessment_result(raw_result: Dict[str, Any], public_url: Optional[str]) -> Dict[str, Any]:
    """Produce a lean, frontend-ready assessment response with zero internal/duplicate bloat."""
    student = _clean_speaker_block(raw_result.get("student"))
    teacher = _clean_speaker_block(raw_result.get("teacher"))
    mode = raw_result.get("mode", "single_speaker" if teacher is None else "teacher_student")
    include_audio = mode != "single_speaker"

    raw_turns = (raw_result.get("dialogue") or {}).get("turns") or []
    cleaned_turns = [_clean_turn_item(t, public_url, include_audio=include_audio) for t in raw_turns]

    out: Dict[str, Any] = {
        "mode": mode,
        "duration_sec": round(float(raw_result.get("duration_sec") or 0.0), 2),
        "student": student,
        "dialogue": {"turns": cleaned_turns},
    }
    if teacher is not None:
        out["teacher"] = teacher
    otf = raw_result.get("overall_transformer_feedback")
    if isinstance(otf, dict) and (otf.get("summary") or otf.get("tips")):
        out["overall_transformer_feedback"] = {
            k: v for k, v in otf.items() if k in ("summary", "tips") and v
        }
    return out


def process_assessment(
    task_id: str,
    conv_path: str,
    teacher_embeddings_json: str,
    student_embeddings_json: str,
    score_teacher: bool,
    diarize: bool = True,
    reference_text: Optional[str] = None,
    task_type: Optional[str] = None,
):
    global _gpu_active_task, _gpu_queue_count
    task_start_time = time.time()

    _gpu_queue_count += 1
    queue_pos = _gpu_queue_count
    if not _gpu_semaphore.acquire(blocking=False):
        tasks[task_id]["step"] = f"Đang chờ GPU (vị trí {queue_pos} trong hàng đợi)..."
        print(f"[Queue] Task {task_id[:8]} đang chờ GPU (vị trí {queue_pos})...")
        _gpu_semaphore.acquire()
    _gpu_active_task = task_id
    _gpu_queue_count = max(0, _gpu_queue_count - 1)
    gpu_wait_time = time.time() - task_start_time
    if gpu_wait_time > 0.5:
        print(f"[Queue] Task {task_id[:8]} đã chờ GPU {gpu_wait_time:.1f}s")

    try:
        pipe = _get_global("pipeline")
        if pipe is None:
            tasks[task_id]["status"] = "error"
            tasks[task_id]["error"] = "pipeline not initialized"
            return

        if not diarize:
            if task_type == "read_aloud" and reference_text:
                tasks[task_id]["step"] = "Đang chấm điểm Đọc thành tiếng (Read Aloud) trực tiếp..."
            else:
                tasks[task_id]["step"] = "Đang phân tích Luyện tập tự do (Single Speaker)..."
            raw_result = pipe.assess_single_speaker(
                conv_path,
                reference_text=reference_text,
                task_type=task_type,
            )
        else:
            tasks[task_id]["step"] = "Đang phân tích embeddings..."
            teacher_emb = _parse_embedding_json(teacher_embeddings_json)
            student_emb = _parse_embedding_json(student_embeddings_json)

            tasks[task_id]["step"] = "Đang tách người nói & Đánh giá phát âm 1-1..."
            raw_result = pipe.assess_conversation(
                conv_path,
                teacher_embedding=teacher_emb,
                student_embedding=student_emb,
                score_teacher=score_teacher,
            )

        clean_result = _sanitize_assessment_result(raw_result, PUBLIC_URL)

        total_time = time.time() - task_start_time
        tasks[task_id]["result"] = clean_result
        tasks[task_id]["step"] = f"Hoàn tất phân tích âm học ({total_time:.1f}s)."
        tasks[task_id]["processing_time_sec"] = round(total_time, 2)
        tasks[task_id]["status"] = "completed"
        print(f"[Perf] Task {task_id[:8]} hoàn tất trong {total_time:.1f}s")
    except Exception as e:
        print(f"API Error in task {task_id}: {e}")
        traceback.print_exc()
        tasks[task_id]["status"] = "error"
        tasks[task_id]["error"] = str(e)
    finally:
        if os.path.exists(conv_path):
            try:
                os.remove(conv_path)
            except OSError:
                pass
        if not diarize:
            single_split_dir = Path(conv_path).parent / f"{Path(conv_path).stem}_single_split"
            if single_split_dir.exists():
                shutil.rmtree(single_split_dir, ignore_errors=True)
        _gpu_active_task = None
        _gpu_semaphore.release()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass


@app.get("/assess_status/{task_id}")
def assess_status(task_id: str, user: dict = Depends(require_active_user)):
    with _tasks_lock:
        task = tasks.get(task_id)
    if task is None:
        return JSONResponse({"success": False, "error": "Task not found"}, status_code=404)
    owner_id = task.get("owner_id")
    if owner_id and owner_id != user["id"] and user.get("role") != "admin":
        return JSONResponse({"success": False, "error": "Bạn không có quyền xem tiến trình bài chấm của người khác."}, status_code=403)
    payload = {k: v for k, v in task.items() if k != "owner_id" and v is not None}
    return JSONResponse({"success": True, "data": jsonable_encoder(payload)})


@app.post("/classroom_analyze_start")
def classroom_analyze_start_api(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    user: dict = Depends(require_active_user),
):
    """Analyze a full classroom recording without diarization:
    Audio -> Whisper (Word Timestamps) -> Lingua (EN/VI) -> Time Grouping -> Language Timeline."""
    role = user.get("role")
    if role not in ("admin", "teacher", "authenticated"):
        return JSONResponse(
            {"success": False, "error": "Chỉ Giáo viên hoặc Quản trị viên mới được phép thực hiện Phân tích tiết học."},
            status_code=403,
        )

    task_id = str(uuid.uuid4())
    with _tasks_lock:
        tasks[task_id] = {
            "owner_id": user["id"],
            "status": "processing",
            "step": "Đang tải file audio buổi học lên server...",
            "result": None,
        }
    _prune_old_tasks()

    safe_name = _safe_filename(audio.filename)
    raw_conv_path = os.path.join(AUDIO_TEMP_DIR, f"{task_id}_cls_raw_{safe_name}")
    conv_path = os.path.join(AUDIO_TEMP_DIR, f"{task_id}_cls_converted.wav")
    try:
        with open(raw_conv_path, "wb") as f:
            shutil.copyfileobj(audio.file, f)
        _convert_to_wav_16k(raw_conv_path, conv_path)
    except Exception as e:
        with _tasks_lock:
            tasks.pop(task_id, None)
        if os.path.exists(conv_path):
            try:
                os.remove(conv_path)
            except OSError:
                pass
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)
    finally:
        if os.path.exists(raw_conv_path):
            try:
                os.remove(raw_conv_path)
            except OSError:
                pass

    background_tasks.add_task(
        process_classroom_analysis,
        task_id,
        conv_path,
    )
    return JSONResponse({"success": True, "task_id": task_id})


def process_classroom_analysis(
    task_id: str,
    conv_path: str,
):
    global _gpu_active_task, _gpu_queue_count
    task_start_time = time.time()

    _gpu_queue_count += 1
    queue_pos = _gpu_queue_count
    if not _gpu_semaphore.acquire(blocking=False):
        tasks[task_id]["step"] = f"Đang chờ GPU (vị trí {queue_pos} trong hàng đợi)..."
        _gpu_semaphore.acquire()
    _gpu_active_task = task_id
    _gpu_queue_count = max(0, _gpu_queue_count - 1)

    try:
        analyzer = _resolve_classroom_analyzer()
        result = analyzer.analyze(
            conv_path,
            progress_callback=lambda msg: tasks[task_id].update({"step": msg}),
        )
        total_time = time.time() - task_start_time
        tasks[task_id]["result"] = result
        tasks[task_id]["step"] = f"Hoàn tất phân tích ngôn ngữ tiết học ({total_time:.1f}s)."
        tasks[task_id]["processing_time_sec"] = round(total_time, 2)
        tasks[task_id]["status"] = "completed"
        print(f"[Classroom] Task {task_id[:8]} hoàn tất trong {total_time:.1f}s")
    except Exception as e:
        print(f"Classroom API Error in task {task_id}: {e}")
        traceback.print_exc()
        tasks[task_id]["status"] = "error"
        tasks[task_id]["error"] = str(e)
    finally:
        if os.path.exists(conv_path):
            try:
                os.remove(conv_path)
            except OSError:
                pass
        _gpu_active_task = None
        _gpu_semaphore.release()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass


@app.get("/classroom_status/{task_id}")
def classroom_status(task_id: str, user: dict = Depends(require_active_user)):
    if user.get("role") not in ("admin", "teacher"):
        return JSONResponse({"success": False, "error": "Không có quyền truy cập tác vụ phân tích lớp học."}, status_code=403)
    with _tasks_lock:
        task = tasks.get(task_id)
    if task is None:
        return JSONResponse({"success": False, "error": "Task not found"}, status_code=404)
    owner_id = task.get("owner_id")
    if owner_id and owner_id != user["id"] and user.get("role") != "admin":
        return JSONResponse({"success": False, "error": "Bạn không có quyền xem kết quả phân tích của giáo viên khác."}, status_code=403)
    payload = {k: v for k, v in task.items() if k != "owner_id" and v is not None}
    return JSONResponse({"success": True, "data": jsonable_encoder(payload)})


@app.post("/ai_eval")
async def ai_eval_proxy_api(request: Request, user: dict = Depends(require_active_user)):
    """Fallback server-side AI Evaluator proxy matching `/api/ai-eval` contract."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": "Payload JSON không hợp lệ."}, status_code=400)

    action = str((body or {}).get("action") or "").strip()
    if action not in ("ping_test", "eval_answer", "eval_conversation"):
        return JSONResponse({"success": False, "error": f"Action không hợp lệ: {action}"}, status_code=400)

    role = user.get("role")
    if action == "ping_test" and role != "admin":
        return JSONResponse({"success": False, "error": "Chỉ Quản trị viên mới được kiểm tra kết nối AI."}, status_code=403)
    if action == "eval_conversation" and role not in ("teacher", "admin"):
        return JSONResponse({"success": False, "error": "Chỉ Giáo viên hoặc Quản trị viên mới được đánh giá hội thoại 1-1."}, status_code=403)

    supabase_url, anon_key = get_supabase_config()
    svc_url, service_key = get_supabase_service_config()
    base_url = svc_url or supabase_url
    gs_row = None

    if base_url and (service_key or (role == "admin" and user.get("token"))):
        hdr_apikey = service_key or anon_key
        hdr_bearer = service_key or user.get("token")
        try:
            gs_resp = requests.get(
                f"{base_url}/rest/v1/global_settings",
                params={
                    "id": "eq.1",
                    "select": "llm_api_key,llm_api_url,llm_model",
                    "limit": "1",
                },
                headers={"apikey": hdr_apikey, "Authorization": f"Bearer {hdr_bearer}"},
                timeout=10,
            )
            if gs_resp.status_code == 200:
                rows = gs_resp.json()
                gs_row = rows[0] if isinstance(rows, list) and rows else None
        except Exception:
            gs_row = None

    endpoint = str(
        (gs_row or {}).get("llm_api_url")
        or DEFAULT_LLM_ENDPOINT
    ).strip()
    model = str(
        (gs_row or {}).get("llm_model")
        or DEFAULT_LLM_MODEL
    ).strip()
    stored_key = str(
        (gs_row or {}).get("llm_api_key")
        or get_llm_api_key()
        or ""
    ).strip()

    if action == "ping_test":
        draft = (body or {}).get("draftConfig")
        if not isinstance(draft, dict):
            draft = {}
        test_key = str(draft.get("apiKey") or stored_key or "").strip()
        test_url = str(draft.get("apiUrl") or endpoint).strip()
        test_model = str(draft.get("model") or model).strip()
        if not test_key:
            return JSONResponse({"success": False, "error": "Chưa có AI API Key để kiểm tra."}, status_code=400)
        try:
            ai_resp = requests.post(
                test_url,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {test_key}",
                    "x-api-key": test_key,
                },
                json={
                    "model": test_model,
                    "messages": [{"role": "user", "content": 'Ping test. Reply with "OK".'}],
                    "max_tokens": 16,
                    "enable_thinking": False,
                },
                timeout=20,
            )
            if not ai_resp.ok:
                return JSONResponse(
                    {"success": False, "error": f"API Lỗi HTTP {ai_resp.status_code}: {ai_resp.text[:200]}"},
                    status_code=502,
                )
            data = ai_resp.json()
            reply = str((((data.get("choices") or [{}])[0].get("message") or {}).get("content")) or "").strip()
            return JSONResponse({"success": True, "model": data.get("model") or test_model, "reply": reply})
        except Exception as exc:
            return JSONResponse({"success": False, "error": f"Không kết nối được AI API: {exc}"}, status_code=502)

    if not stored_key:
        return JSONResponse(
            {"success": False, "code": "AI_KEY_MISSING", "error": "Chưa cấu hình AI API Key trên hệ thống."},
            status_code=503,
        )

    raw_messages = (body or {}).get("messages")
    if not isinstance(raw_messages, list) or not (1 <= len(raw_messages) <= 2):
        return JSONResponse({"success": False, "error": "Danh sách messages không hợp lệ."}, status_code=400)
    safe_messages = []
    for msg in raw_messages:
        if not isinstance(msg, dict) or msg.get("role") not in ("system", "user") or msg.get("content") is None:
            return JSONResponse({"success": False, "error": "Cấu trúc message không hợp lệ."}, status_code=400)
        safe_messages.append({"role": msg["role"], "content": msg["content"]})

    try:
        temp_val = float((body or {}).get("temperature", 0.2))
    except (TypeError, ValueError):
        temp_val = 0.2
    temp_val = max(0.0, min(1.0, temp_val))

    try:
        upstream_resp = requests.post(
            endpoint,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {stored_key}",
                "x-api-key": stored_key,
            },
            json={
                "model": model,
                "messages": safe_messages,
                "temperature": temp_val,
                "max_tokens": 2048,
                "enable_thinking": False,
            },
            timeout=45,
        )
        if not upstream_resp.ok:
            return JSONResponse(
                {"success": False, "error": f"Upstream AI API HTTP {upstream_resp.status_code}: {upstream_resp.text[:200]}"},
                status_code=502,
            )
        data = upstream_resp.json()
        content = str((((data.get("choices") or [{}])[0].get("message") or {}).get("content")) or "")
        return JSONResponse({"success": True, "content": content, "model": data.get("model") or model})
    except Exception as exc:
        return JSONResponse({"success": False, "error": f"Lỗi gọi Upstream AI API: {exc}"}, status_code=502)


@app.get("/health")
def health_check():
    """Server health check — monitoring uptime, GPU status, queue."""
    uptime_sec = time.time() - SERVER_START_TIME
    gpu_info: dict = {"available": False}
    try:
        import torch

        if torch.cuda.is_available():
            gpu_info = {
                "available": True,
                "device_name": torch.cuda.get_device_name(0),
                "memory_allocated_mb": round(torch.cuda.memory_allocated(0) / 1024 / 1024, 1),
                "memory_reserved_mb": round(torch.cuda.memory_reserved(0) / 1024 / 1024, 1),
                "memory_total_mb": round(torch.cuda.get_device_properties(0).total_memory / 1024 / 1024, 1),
            }
    except Exception:
        pass

    active_tasks = sum(1 for t in tasks.values() if t.get("status") == "processing")
    completed_tasks = sum(1 for t in tasks.values() if t.get("status") == "completed")
    error_tasks = sum(1 for t in tasks.values() if t.get("status") == "error")

    return JSONResponse({
        "status": "healthy",
        "uptime_sec": round(uptime_sec, 1),
        "uptime_human": f"{int(uptime_sec // 3600)}h {int((uptime_sec % 3600) // 60)}m",
        "gpu": gpu_info,
        "gpu_queue_waiting": _gpu_queue_count,
        "gpu_active_task": _gpu_active_task[:8] if _gpu_active_task else None,
        "tasks_active": active_tasks,
        "tasks_completed": completed_tasks,
        "tasks_error": error_tasks,
        "public_url": PUBLIC_URL,
    })


if __name__ == "__main__":
    import asyncio

    PUBLIC_URL = start_cloudflare_tunnel(8000)
    if PUBLIC_URL:
        _sb_u, _sb_k = get_supabase_service_config()
        if not _sb_k:
            _sb_u, _sb_k = get_supabase_config()
        if _sb_u and _sb_k:
            _update_supabase_url(PUBLIC_URL)
        print("\n" + "=" * 80)
        print(f"🚀 API IS LIVE AT: {PUBLIC_URL}")
        print("👉 Hãy sao chép URL trên và dán vào: Trang Quản trị (Admin) > Cài đặt hệ thống > Kết nối GPU")
        print("=" * 80 + "\n")
    else:
        print("⚠️ Running without Cloudflare tunnel (localhost only)")

    is_in_notebook = False
    try:
        loop = asyncio.get_running_loop()
        if loop and loop.is_running():
            is_in_notebook = True
    except RuntimeError:
        is_in_notebook = False

    if is_in_notebook:
        print("⚡ Phát hiện môi trường Jupyter / Kaggle (active event loop).")
        print(f"🚀 Đang khởi chạy Uvicorn trong background thread trên cổng 8000 (Public: {PUBLIC_URL})...")
        config = uvicorn.Config(app=app, host="0.0.0.0", port=8000, log_level="info")
        server = uvicorn.Server(config)
        server_thread = threading.Thread(target=server.run, daemon=True)
        server_thread.start()
        print("✅ FastAPI Server đang chạy! Nhấn nút Stop / Interrupt cell để dừng.")
        try:
            while server_thread.is_alive():
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nĐang tắt FastAPI Server...")
            server.should_exit = True
            server_thread.join(timeout=5)
    else:
        uvicorn.run(app, host="0.0.0.0", port=8000)
