from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks
import uuid
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
import uvicorn
import shutil
import json
import numpy as np
import subprocess
import time
import re
import os

# 1. Khởi động Cloudflare Quick Tunnel
def start_cloudflare_tunnel(port=8000):
    print('Starting Cloudflare Quick Tunnel...')
    cmd = f'cloudflared tunnel --url http://127.0.0.1:{port}'
        
    process = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    url = None
        
    for _ in range(20):
        line = process.stdout.readline()
        match = re.search(r'https://[a-zA-Z0-9-]+\.trycloudflare\.com', line)
        if match:
            url = match.group(0)
            break
        time.sleep(0.5)
    return url

PUBLIC_URL = start_cloudflare_tunnel(8000)
print('\n' + '='*80)
print(f'🚀 API IS LIVE AT: {PUBLIC_URL}')
print('=> COPY LINK NÀY VÀ DÁN VÀO CẤU HÌNH TRÊN WEBSITE CỦA BẠN!')
print('='*80 + '\n')

# 2. Khởi tạo FastAPI App
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

# Phục vụ file audio tĩnh từ Colab để Website có thể nghe lại
os.makedirs('/tmp/SpeakAI_Audio', exist_ok=True)
app.mount('/audio', StaticFiles(directory='/tmp/SpeakAI_Audio'), name='audio')

tasks = {}

@app.post('/extract_embedding')
def extract_embedding_api(audio: UploadFile = File(...)):
    try:
        temp_id = str(uuid.uuid4())
        raw_audio_path = f'/tmp/SpeakAI_Audio/{temp_id}_raw_{audio.filename}'
        with open(raw_audio_path, 'wb') as f:
            shutil.copyfileobj(audio.file, f)
        
        # Convert to standard WAV using ffmpeg
        audio_path = f'/tmp/SpeakAI_Audio/{temp_id}_converted.wav'
        os.system(f'ffmpeg -y -i \"{raw_audio_path}\" -ar 16000 -ac 1 \"{audio_path}\" -loglevel quiet')
        
        # Tải audio
        from speaker_diarize.audio_io import load_audio
        waveform, sr = load_audio(audio_path)
        
        from speaker_diarize.denoise import denoise_with_deepfilternet, level_audio_to_target
        # Khử nhiễu & Cân bằng âm lượng
        waveform, sr = denoise_with_deepfilternet(waveform, sr)
        waveform = level_audio_to_target(waveform, sr)
            
        # Tính toán embedding bằng extract_embedder trên cuda:0
        emb = extract_embedder.embed(waveform, sr)
        
        # Xóa file tạm
        if os.path.exists(audio_path):
            os.remove(audio_path)
            
        return JSONResponse({'success': True, 'embedding': emb.tolist()})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)

@app.post('/assess_start')
def assess_start_api(background_tasks: BackgroundTasks, audio: UploadFile = File(...), teacher_embeddings_json: str = Form(...), student_embeddings_json: str = Form(...), score_teacher: bool = Form(False), skip_feedback: bool = Form(False)):
    try:
        task_id = str(uuid.uuid4())
        tasks[task_id] = {'status': 'processing', 'step': 'Đang tải file âm thanh lên server...', 'result': None, 'llm_feedback': None}
        
        raw_conv_path = f'/tmp/SpeakAI_Audio/{task_id}_raw_{audio.filename}'
        with open(raw_conv_path, 'wb') as f:
            shutil.copyfileobj(audio.file, f)
        
        conv_path = f'/tmp/SpeakAI_Audio/{task_id}_converted.wav'
        os.system(f'ffmpeg -y -i \"{raw_conv_path}\" -ar 16000 -ac 1 \"{conv_path}\" -loglevel quiet')
        
        background_tasks.add_task(process_assessment, task_id, conv_path, teacher_embeddings_json, student_embeddings_json, score_teacher, skip_feedback)
        return JSONResponse({'success': True, 'task_id': task_id})
    except Exception as e:
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)

def process_assessment(task_id, conv_path, teacher_embeddings_json, student_embeddings_json, score_teacher, skip_feedback):
    try:
        tasks[task_id]['step'] = 'Đang phân tích embeddings...'
        
        # Parse Embeddings của Giáo viên
        t_emb_list = json.loads(teacher_embeddings_json)
        teacher_emb = np.array(t_emb_list, dtype=np.float32)
        if len(teacher_emb.shape) == 2:
            teacher_emb = np.mean(teacher_emb, axis=0)
        teacher_emb /= np.linalg.norm(teacher_emb)

        # Parse Embeddings của Học viên
        s_emb_list = json.loads(student_embeddings_json)
        student_emb = np.array(s_emb_list, dtype=np.float32)
        if len(student_emb.shape) == 2:
            student_emb = np.mean(student_emb, axis=0)
        student_emb /= np.linalg.norm(student_emb)
        
        # Gọi Pipeline
        tasks[task_id]['step'] = 'Đang tách lời (Diarization) & Phân tích phát âm...'
        raw_result = pipeline.assess_conversation(
            conv_path,
            teacher_embedding=teacher_emb,
            student_embedding=student_emb,
            score_teacher=score_teacher
        )
        
        # Áp dụng phạt nặng điểm số để phản ánh thực tế
        def apply_penalty(node):
            if isinstance(node, dict):
                for k, v in node.items():
                    if k in ['accuracy', 'fluency', 'prosodic', 'score', 'completeness', 'total'] and isinstance(v, (int, float)) and v > 0:
                        node[k] = max(0.0, v - (10.0 - v) * 0.45)
                    else:
                        apply_penalty(v)
            elif isinstance(node, list):
                for item in node:
                    apply_penalty(item)
                    
        apply_penalty(raw_result)
        
        # Trích xuất file tổng hợp
        diar = raw_result.get('diarization', {})
        if raw_result.get('teacher') and diar.get('teacher'):
            raw_result['teacher']['full_audio'] = str(diar['teacher'])
        if raw_result.get('student') and diar.get('student'):
            raw_result['student']['full_audio'] = str(diar['student'])

        # Gọi LLM Feedback
        if skip_feedback:
            tasks[task_id]['step'] = 'Bỏ qua LLM Feedback...'
            llm_feedback = 'Không có phản hồi (bỏ qua bởi người dùng).'
        else:
            tasks[task_id]['step'] = 'Đang gọi LLM Qwen tạo Feedback cho từng lượt...'
            teacher_ctx = 'Không có'
            for turn in raw_result.get('dialogue', {}).get('turns', []):
                if turn['role'].upper() == 'TEACHER':
                    teacher_ctx = turn['transcript']
                elif turn['role'].upper() == 'STUDENT':
                    turn['llm_feedback'] = generate_turn_feedback(
                        teacher_text=teacher_ctx, 
                        student_text=turn['transcript'], 
                        score=turn.get('scores', {}).get('accuracy', 0), 
                        errors=turn.get('errors', {})
                    )
            
            tasks[task_id]['step'] = 'Đang gọi LLM Qwen tạo Feedback tổng hợp...'
            llm_feedback = generate_overall_summary(raw_result)
        
        # Chuyển đổi đường dẫn file cục bộ thành Public URL
        def convert_paths_to_urls(node):
            if isinstance(node, dict):
                for k, v in node.items():
                    if (k == 'audio' or k == 'full_audio') and isinstance(v, str) and v.startswith('/tmp/SpeakAI_Audio/'):
                        rel_path = v.replace('/tmp/SpeakAI_Audio/', '')
                        node[k] = f'{PUBLIC_URL}/audio/{rel_path}'
                    else:
                        convert_paths_to_urls(v)
            elif isinstance(node, list):
                for item in node:
                    convert_paths_to_urls(item)
                    
        convert_paths_to_urls(raw_result)
        
        # Xóa file audio tạm
        if os.path.exists(conv_path):
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
    return JSONResponse({'success': True, 'data': tasks[task_id]})

# Khởi chạy Uvicorn
config = uvicorn.Config(app, host='0.0.0.0', port=8000)
server = uvicorn.Server(config)
await server.serve()
