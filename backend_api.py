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
    """Push the tunnel URL to Supabase global_settings (if env vars set)."""
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_KEY')
    if not supabase_url or not supabase_key:
        print('⚠️ SUPABASE_URL / SUPABASE_KEY not set — skipping auto-update.')
        return
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
    skip_feedback: bool = Form(False),
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
            is_score_teacher, skip_feedback, is_diarize,
            reference_text, task_type,
        )
        return JSONResponse({'success': True, 'task_id': task_id})
    except Exception as e:
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)


@app.post('/assess_practice')
def assess_practice_api(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    skip_feedback: bool = Form(True),
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
            False, skip_feedback, False,
            reference_text, task_type,
        )
        return JSONResponse({'success': True, 'task_id': task_id})
    except Exception as e:
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)


def process_assessment(
    task_id, conv_path,
    teacher_embeddings_json, student_embeddings_json,
    score_teacher, skip_feedback,
    diarize=True, reference_text=None, task_type=None,
):
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

        # Generate LLM feedback
        gen_turn_fb = _get_global('generate_turn_feedback')
        gen_overall = _get_global('generate_overall_summary')

        if skip_feedback:
            tasks[task_id]['step'] = 'Bỏ qua LLM Feedback...'
            llm_feedback = 'Không có phản hồi (bỏ qua bởi người dùng).'
        else:
            tasks[task_id]['step'] = 'Đang tạo Feedback cho từng lượt nói...'
            teacher_ctx = 'Không có'
            for turn in raw_result.get('dialogue', {}).get('turns', []):
                if turn['role'].upper() == 'TEACHER':
                    teacher_ctx = turn['transcript']
                elif turn['role'].upper() == 'STUDENT':
                    tf = turn.get('transformer_feedback', {})
                    l2_note = turn.get('l2_mdd_feedback')
                    turn_parts = []
                    if tf and tf.get('summary'):
                        turn_parts.append(tf['summary'])
                        if tf.get('tips'):
                            turn_parts.extend(tf['tips'][:2])
                    elif gen_turn_fb:
                        fb = gen_turn_fb(
                            teacher_text=teacher_ctx,
                            student_text=turn['transcript'],
                            score=turn.get('scores', {}).get('accuracy', 0),
                            errors=turn.get('errors', {}),
                            l2_note=l2_note,
                        )
                        if fb:
                            turn_parts.append(fb)

                    if l2_note and not any(l2_note in p for p in turn_parts):
                        turn_parts.append(f"💡 {l2_note}")

                    turn['llm_feedback'] = '\n'.join(turn_parts)

            tasks[task_id]['step'] = 'Đang tạo Feedback tổng hợp...'
            if gen_overall:
                llm_feedback = gen_overall(raw_result)
            else:
                llm_feedback = 'Feedback generator not available.'

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
        tasks[task_id]['llm_feedback'] = llm_feedback
        tasks[task_id]['status'] = 'completed'
    except Exception as e:
        print(f'API Error in task {task_id}: {e}')
        import traceback
        traceback.print_exc()
        tasks[task_id]['status'] = 'error'
        tasks[task_id]['error'] = str(e)


@app.get('/assess_status/{task_id}')
def assess_status(task_id: str):
    if task_id not in tasks:
        return JSONResponse({'success': False, 'error': 'Task not found'}, status_code=404)
    return JSONResponse({'success': True, 'data': jsonable_encoder(tasks[task_id])})


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
