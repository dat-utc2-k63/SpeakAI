"""FastAPI backend for SpeakAI pronunciation assessment.

When running on Kaggle: pipeline, extract_embedder, generate_turn_feedback,
generate_overall_summary are expected to be defined in the notebook's global
scope BEFORE this file is executed (%run or exec).

When running standalone: those globals must be defined or the relevant
endpoints will return a 503 error.
"""

from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks
import uuid
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from pathlib import Path
import uvicorn
import shutil
import json
import numpy as np
import subprocess
import threading
import time
import re
import os


# ── Cloudflare Tunnel ──────────────────────────────────────────────────
def start_cloudflare_tunnel(port=8000):
    """Start a Cloudflare Quick Tunnel and return the public URL."""
    print('Starting Cloudflare Quick Tunnel...')
    cmd = f'cloudflared tunnel --url http://127.0.0.1:{port}'
    try:
        process = subprocess.Popen(
            cmd, shell=True,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
    except FileNotFoundError:
        print('❌ cloudflared not found. Skipping tunnel.')
        return None

    url = None
    for _ in range(20):
        line = process.stdout.readline()
        match = re.search(r'https://[a-zA-Z0-9-]+\.trycloudflare\.com', line)
        if match:
            url = match.group(0)
            break
        time.sleep(0.5)
    return url


def _update_supabase_url(public_url: str) -> None:
    """Push the tunnel URL to Supabase global_settings."""
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_KEY')

    # If not set in env vars, try Kaggle Secrets
    if not supabase_url or not supabase_key:
        try:
            from kaggle_secrets import UserSecretsClient
            secrets = UserSecretsClient()
            supabase_url = supabase_url or secrets.get_secret('SUPABASE_URL')
            supabase_key = supabase_key or secrets.get_secret('SUPABASE_KEY')
        except Exception:
            pass

    # Default fallback to project Supabase config (matching web/js/supabase.js)
    if not supabase_url:
        supabase_url = 'https://kngkckshvgaqeiatryqy.supabase.co'
    if not supabase_key:
        supabase_key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtuZ2tja3NodmdhcWVpYXRyeXF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MzAxMjYsImV4cCI6MjEwMzEwNjEyNn0.tDs7-9R0h3YHQF78uGGMSWtUXTOOE5y0XYD5mYk_KAM'
    try:
        import requests
        r = requests.patch(
            f"{supabase_url}/rest/v1/global_settings?id=eq.1",
            headers={
                "apikey": supabase_key,
                "Authorization": f"Bearer {supabase_key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            json={"api_url": public_url},
            timeout=10,
        )
        if r.status_code in [200, 204]:
            print("✅ Đã tự động cập nhật API URL lên Supabase!")
        else:
            print(f"❌ Lỗi cập nhật Supabase: {r.text}")
    except Exception as e:
        print(f"❌ Lỗi cập nhật Supabase: {e}")


# ── Resolve globals from notebook context ──────────────────────────────
# These are set by the Kaggle Run notebook before this file is executed.
# When missing, the API endpoints return 503.
def _get_global(name):
    """Resolve a global defined in the notebook context (builtins or globals)."""
    import builtins
    return getattr(builtins, name, None) or globals().get(name)


# ── FastAPI App ────────────────────────────────────────────────────────
PUBLIC_URL = None  # Set at startup when tunnel is active
SERVER_START_TIME = time.time()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

# Serve recorded audio files
os.makedirs('/tmp/SpeakAI_Audio', exist_ok=True)
app.mount('/audio', StaticFiles(directory='/tmp/SpeakAI_Audio'), name='audio')

tasks = {}

# ── GPU Concurrency Control ────────────────────────────────────────────
# Chỉ cho phép 1 task GPU chạy tại 1 thời điểm để tránh tràn VRAM (CUDA OOM)
# Các task khác sẽ nằm trong hàng đợi, đảm bảo ổn định cho trung tâm nhiều học viên
_gpu_semaphore = threading.Semaphore(1)
_gpu_active_task = None  # Track task đang chạy trên GPU
_gpu_queue_count = 0  # Số task đang chờ trong hàng đợi


@app.post('/extract_embedding')
def extract_embedding_api(audio: UploadFile = File(...)):
    try:
        embedder = _get_global('extract_embedder')
        if embedder is None:
            return JSONResponse(
                {'success': False, 'error': 'extract_embedder not initialized'},
                status_code=503,
            )

        temp_id = str(uuid.uuid4())
        raw_audio_path = f'/tmp/SpeakAI_Audio/{temp_id}_raw_{audio.filename}'
        with open(raw_audio_path, 'wb') as f:
            shutil.copyfileobj(audio.file, f)

        # Convert to standard WAV using ffmpeg
        audio_path = f'/tmp/SpeakAI_Audio/{temp_id}_converted.wav'
        os.system(f'ffmpeg -y -i \"{raw_audio_path}\" -ar 16000 -ac 1 \"{audio_path}\" -loglevel quiet')

        # Load audio
        from speaker_diarize.audio_io import load_audio
        waveform, sr = load_audio(audio_path)

        from speaker_diarize.denoise import denoise_with_deepfilternet, level_audio_to_target
        waveform, sr = denoise_with_deepfilternet(waveform, sr)
        waveform = level_audio_to_target(waveform, sr)

        emb = embedder.embed(waveform, sr)

        # Clean up
        for p in (raw_audio_path, audio_path):
            if os.path.exists(p):
                os.remove(p)

        return JSONResponse({'success': True, 'embedding': emb.tolist()})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)


@app.post('/assess_start')
def assess_start_api(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    teacher_embeddings_json: str = Form("[]"),
    student_embeddings_json: str = Form("[]"),
    score_teacher: bool = Form(False),
    diarize: str = Form("true"),
    reference_text: Optional[str] = Form(None),
    task_type: Optional[str] = Form(None),
):
    try:
        task_id = str(uuid.uuid4())
        tasks[task_id] = {
            'status': 'processing',
            'step': 'Đang tải file âm thanh lên server...',
            'result': None,
            'llm_feedback': None,
        }

        raw_conv_path = f'/tmp/SpeakAI_Audio/{task_id}_raw_{audio.filename}'
        with open(raw_conv_path, 'wb') as f:
            shutil.copyfileobj(audio.file, f)

        conv_path = f'/tmp/SpeakAI_Audio/{task_id}_converted.wav'
        os.system(f'ffmpeg -y -i \"{raw_conv_path}\" -ar 16000 -ac 1 \"{conv_path}\" -loglevel quiet')

        is_diarize = str(diarize).strip().lower() not in ('false', '0', 'no', 'none', 'f')
        is_score_teacher = str(score_teacher).strip().lower() in ('true', '1', 'yes', 't')
        background_tasks.add_task(
            process_assessment,
            task_id, conv_path,
            teacher_embeddings_json, student_embeddings_json,
            is_score_teacher, is_diarize,
            reference_text, task_type,
        )
        return JSONResponse({'success': True, 'task_id': task_id})
    except Exception as e:
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)


@app.post('/assess_practice')
def assess_practice_api(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    reference_text: Optional[str] = Form(None),
    task_type: Optional[str] = Form(None),
):
    try:
        task_id = str(uuid.uuid4())
        tasks[task_id] = {
            'status': 'processing',
            'step': 'Đang tải file âm thanh lên server...',
            'result': None,
            'llm_feedback': None,
        }

        raw_conv_path = f'/tmp/SpeakAI_Audio/{task_id}_raw_{audio.filename}'
        with open(raw_conv_path, 'wb') as f:
            shutil.copyfileobj(audio.file, f)

        conv_path = f'/tmp/SpeakAI_Audio/{task_id}_converted.wav'
        os.system(f'ffmpeg -y -i \"{raw_conv_path}\" -ar 16000 -ac 1 \"{conv_path}\" -loglevel quiet')

        background_tasks.add_task(
            process_assessment,
            task_id, conv_path,
            "[]", "[]",
            False, False,
            reference_text, task_type,
        )
        return JSONResponse({'success': True, 'task_id': task_id})
    except Exception as e:
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)


def process_assessment(
    task_id, conv_path,
    teacher_embeddings_json, student_embeddings_json,
    score_teacher,
    diarize=True, reference_text=None, task_type=None,
):
    global _gpu_active_task, _gpu_queue_count
    task_start_time = time.time()

    # Đợi GPU semaphore — nếu có task khác đang chạy, task này sẽ xếp hàng
    _gpu_queue_count += 1
    queue_pos = _gpu_queue_count
    if not _gpu_semaphore.acquire(blocking=False):
        tasks[task_id]['step'] = f'Đang chờ GPU (vị trí {queue_pos} trong hàng đợi)...'
        print(f'[Queue] Task {task_id[:8]} đang chờ GPU (vị trí {queue_pos})...')
        _gpu_semaphore.acquire()  # Block đợi tới lượt
    _gpu_active_task = task_id
    _gpu_queue_count = max(0, _gpu_queue_count - 1)
    gpu_wait_time = time.time() - task_start_time
    if gpu_wait_time > 0.5:
        print(f'[Queue] Task {task_id[:8]} đã chờ GPU {gpu_wait_time:.1f}s')

    try:
        pipe = _get_global('pipeline')
        if pipe is None:
            tasks[task_id]['status'] = 'error'
            tasks[task_id]['error'] = 'pipeline not initialized'
            return

        if not diarize:
            if task_type == 'read_aloud' and reference_text:
                tasks[task_id]['step'] = 'Đang chấm điểm Read Aloud trực tiếp bằng văn bản mẫu (Không dùng Whisper ASR)...'
            else:
                tasks[task_id]['step'] = 'Đang phân tích phát âm trực tiếp (Single Speaker, không Diarization)...'
            raw_result = pipe.assess_single_speaker(
                conv_path,
                reference_text=reference_text,
                task_type=task_type,
            )
        else:
            tasks[task_id]['step'] = 'Đang phân tích embeddings...'

            # Parse teacher embeddings
            t_emb_list = json.loads(teacher_embeddings_json or "[]")
            if t_emb_list:
                teacher_emb = np.array(t_emb_list, dtype=np.float32)
                if len(teacher_emb.shape) == 2:
                    teacher_emb = np.mean(teacher_emb, axis=0)
                teacher_emb /= (np.linalg.norm(teacher_emb) + 1e-8)
            else:
                teacher_emb = None

            # Parse student embeddings
            s_emb_list = json.loads(student_embeddings_json or "[]")
            if s_emb_list:
                student_emb = np.array(s_emb_list, dtype=np.float32)
                if len(student_emb.shape) == 2:
                    student_emb = np.mean(student_emb, axis=0)
                student_emb /= (np.linalg.norm(student_emb) + 1e-8)
            else:
                student_emb = None

            tasks[task_id]['step'] = 'Đang tách lời (Diarization) & Phân tích phát âm (2 models)...'
            raw_result = pipe.assess_conversation(
                conv_path,
                teacher_embedding=teacher_emb,
                student_embedding=student_emb,
                score_teacher=score_teacher,
            )

        # Extract combined audio paths from diarization
        diar = raw_result.get('diarization', {})
        if raw_result.get('teacher') and diar.get('teacher'):
            raw_result['teacher']['full_audio'] = str(diar['teacher'])
        if raw_result.get('student') and diar.get('student'):
            raw_result['student']['full_audio'] = str(diar['student'])

        # Convert local paths to public URLs & sanitize Path objects
        def convert_paths_to_urls(node):
            if isinstance(node, dict):
                for k, v in list(node.items()):
                    if isinstance(v, (os.PathLike, Path)):
                        v = str(v)
                        node[k] = v
                    if (k in ('audio', 'full_audio')) and isinstance(v, str) and v.startswith('/tmp/SpeakAI_Audio/'):
                        rel_path = v.replace('/tmp/SpeakAI_Audio/', '')
                        node[k] = f'{PUBLIC_URL}/audio/{rel_path}'
                    else:
                        convert_paths_to_urls(v)
            elif isinstance(node, list):
                for i in range(len(node)):
                    if isinstance(node[i], (os.PathLike, Path)):
                        node[i] = str(node[i])
                    convert_paths_to_urls(node[i])

        if PUBLIC_URL:
            convert_paths_to_urls(raw_result)

        # Clean up original audio (diarization already split into teacher/student)
        if diarize and os.path.exists(conv_path):
            os.remove(conv_path)

        tasks[task_id]['result'] = raw_result
        tasks[task_id]['llm_feedback'] = None
        total_time = time.time() - task_start_time
        tasks[task_id]['step'] = f'Hoàn tất phân tích âm học ({total_time:.1f}s).'
        tasks[task_id]['processing_time_sec'] = round(total_time, 2)
        tasks[task_id]['status'] = 'completed'
        print(f'[Perf] Task {task_id[:8]} hoàn tất trong {total_time:.1f}s')
    except Exception as e:
        print(f'API Error in task {task_id}: {e}')
        import traceback
        traceback.print_exc()
        tasks[task_id]['status'] = 'error'
        tasks[task_id]['error'] = str(e)
    finally:
        # Giải phóng GPU semaphore và dọn VRAM cache
        _gpu_active_task = None
        _gpu_semaphore.release()
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass


@app.get('/assess_status/{task_id}')
def assess_status(task_id: str):
    if task_id not in tasks:
        return JSONResponse({'success': False, 'error': 'Task not found'}, status_code=404)
    return JSONResponse({'success': True, 'data': jsonable_encoder(tasks[task_id])})


@app.get('/health')
def health_check():
    """Server health check — monitoring uptime, GPU status, queue."""
    uptime_sec = time.time() - SERVER_START_TIME
    gpu_info = {'available': False}
    try:
        import torch
        if torch.cuda.is_available():
            gpu_info = {
                'available': True,
                'device_name': torch.cuda.get_device_name(0),
                'memory_allocated_mb': round(torch.cuda.memory_allocated(0) / 1024 / 1024, 1),
                'memory_reserved_mb': round(torch.cuda.memory_reserved(0) / 1024 / 1024, 1),
                'memory_total_mb': round(torch.cuda.get_device_properties(0).total_mem / 1024 / 1024, 1),
            }
    except Exception:
        pass
    
    active_tasks = sum(1 for t in tasks.values() if t.get('status') == 'processing')
    completed_tasks = sum(1 for t in tasks.values() if t.get('status') == 'completed')
    error_tasks = sum(1 for t in tasks.values() if t.get('status') == 'error')
    
    return JSONResponse({
        'status': 'healthy',
        'uptime_sec': round(uptime_sec, 1),
        'uptime_human': f'{int(uptime_sec // 3600)}h {int((uptime_sec % 3600) // 60)}m',
        'gpu': gpu_info,
        'gpu_queue_waiting': _gpu_queue_count,
        'gpu_active_task': _gpu_active_task[:8] if _gpu_active_task else None,
        'tasks_active': active_tasks,
        'tasks_completed': completed_tasks,
        'tasks_error': error_tasks,
        'public_url': PUBLIC_URL,
    })


if __name__ == '__main__':
    import asyncio

    # Start tunnel only when running as main script
    PUBLIC_URL = start_cloudflare_tunnel(8000)
    if PUBLIC_URL:
        _update_supabase_url(PUBLIC_URL)
        print('\n' + '=' * 80)
        print(f'🚀 API IS LIVE AT: {PUBLIC_URL}')
        print('=' * 80 + '\n')
    else:
        print('⚠️ Running without Cloudflare tunnel (localhost only)')

    is_in_notebook = False
    try:
        loop = asyncio.get_running_loop()
        if loop and loop.is_running():
            is_in_notebook = True
    except RuntimeError:
        is_in_notebook = False

    if is_in_notebook:
        import threading
        print("⚡ Phát hiện môi trường Jupyter / Kaggle (active event loop).")
        print(f"🚀 Đang khởi chạy Uvicorn trong background thread trên cổng 8000 (Public: {PUBLIC_URL})...")
        config = uvicorn.Config(app=app, host='0.0.0.0', port=8000, log_level='info')
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
        uvicorn.run(app, host='0.0.0.0', port=8000)
