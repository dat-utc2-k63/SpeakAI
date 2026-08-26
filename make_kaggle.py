"""
Script sinh SpeakAI-Colab.ipynb - standalone, audio đã upload, không L2-MDD, không HuggingFace config.
%%writefile luôn phải là dòng ĐẦU TIÊN của cell → mkdir tách thành cell riêng.
"""
import json
import os

ROOT = "d:/SpeakAI-Eval"

INCLUDE_FILES = [
    "paths.py",
    "configs/pronunciation.yaml",
    "data/audio_preprocess.py",
    "data/audio_info.py",
    "data/cmudict.py",
    "data/silence_split.py",
    "models/__init__.py",
    "models/checkpoint_utils.py",
    "models/ctc_aligner.py",
    "models/multitask_heads.py",
    "models/phoneme_graph.py",
    "models/pronunciation_model.py",
    "models/pronunciation_scorer.py",
    "models/transformer_encoder.py",
    "models/wavlm_encoder.py",
    "infer/__init__.py",
    "infer/device_utils.py",
    "infer/ensure_models.py",
    "infer/lang_id.py",
    "infer/load_progress.py",
    "infer/pipeline.py",
    "infer/pronunciation.py",
    "infer/transcribe.py",
    "ecapa-diarize/ecapa_diarize/__init__.py",
    "ecapa-diarize/ecapa_diarize/audio_io.py",
    "ecapa-diarize/ecapa_diarize/clustering.py",
    "ecapa-diarize/ecapa_diarize/embedding.py",
    "ecapa-diarize/ecapa_diarize/paths.py",
    "ecapa-diarize/ecapa_diarize/pipeline.py",
    "ecapa-diarize/ecapa_diarize/segmentation.py",
]

# pronunciation.yaml sạch: bỏ HF, dùng cuda cứng
YAML_CLEAN = """\
# Pronunciation Assessment — Kaggle Edition (GPU only, no HuggingFace auto-download)
project:
  seed: 42
  device: cuda

paths:
  transformer_models_dir: transformer_models
  pronunciation_checkpoint: transformer_models/pronunciation.pt
  checkpoint_dir: checkpoints
  log_dir: logs
  cmudict_path: null

audio_preprocess:
  sample_rate: 16000
  peak_normalize: true
  target_peak: 0.95
  highpass_hz: 80.0
  denoise: true
  denoise_prop: 0.75
  speech_normalize: true
  speech_thresh_db: -35.0
  vad_frame_ms: 25.0
  vad_hop_ms: 10.0

inference:
  device: cuda
  max_audio_duration_sec: 3600
  max_duration_sec: null
  max_upload_mb: 300

asr:
  model_name: pretrained_models/whisper-large-v3-turbo
  language: en
  device: cuda
  torch_dtype: float16
  max_new_tokens: 440
  lang_id:
    enabled: true
    drop_languages: [vi, vie, vietnamese]
    min_confidence: 0.45
    text_vi_regex: true

wavlm:
  model_name: pretrained_models/wavlm-large
  freeze: true
  use_lora: false

transformer:
  num_layers: 3
  num_heads: 8
  ff_dim: 2048
  dropout: 0.1
  max_seq_len: 800

ctc_align:
  use_wavlm_ctc_head: true

phoneme_graph:
  hidden_dim: 256
  num_gat_layers: 2
  num_heads: 4
  dropout: 0.1
  edge_types:
    sequential: true
    same_word: true
    same_syllable: false

multitask:
  hidden_dim: 256
  dropout: 0.1
  utterance_aspects: [accuracy, fluency, completeness, prosodic, total]
  word_aspects: [accuracy, stress, total]
  phoneme_aspects: [accuracy]
  score_scale: 5.0

scorer:
  weights:
    utterance_total: 0.4
    word_total: 0.3
    phoneme_accuracy: 0.3
  phoneme_low_threshold: 1.2

sentence_split:
  min_silence_sec: 0.35
  silence_thresh_db: -40
  min_segment_sec: 0.2
  max_segment_sec: null
  padding_sec: 0.1
  trim_edges: false
  trim_min_sec: 0.05
  diarization_merge_gap_sec: 0.2
"""

# models/__init__.py không có L2-MDD
MODELS_INIT_CLEAN = """\
from .wavlm_encoder import WavLMEncoder
from .transformer_encoder import TaskTransformerEncoder
from .ctc_aligner import CTCAligner
from .phoneme_graph import PhonemeGraphNetwork
from .multitask_heads import MultiTaskHeads
from .pronunciation_scorer import PronunciationScorer
from .pronunciation_model import PronunciationAssessmentModel

__all__ = [
    "WavLMEncoder", "TaskTransformerEncoder", "CTCAligner",
    "PhonemeGraphNetwork", "MultiTaskHeads", "PronunciationScorer",
    "PronunciationAssessmentModel",
]
"""

OVERRIDES = {
    "configs/pronunciation.yaml": YAML_CLEAN,
    "models/__init__.py": MODELS_INIT_CLEAN,
}

def read_file(rel_path):
    abs_path = os.path.join(ROOT, rel_path.replace("/", os.sep))
    if not os.path.exists(abs_path):
        return None
    try:
        with open(abs_path, "r", encoding="utf-8") as f:
            return f.read()
    except UnicodeDecodeError:
        with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()

def code_cell(source_lines):
    return {
        "cell_type": "code",
        "metadata": {},
        "execution_count": None,
        "outputs": [],
        "source": source_lines,
    }

def md_cell(lines):
    return {"cell_type": "markdown", "metadata": {}, "source": lines}

def writefile_cells(rel_path, content, base_dir="/kaggle/working/SpeakAI-Eval"):
    """
    Trả về 1 hoặc 2 cells:
    - Nếu cần mkdir: cell code Python cho mkdir TRƯỚC
    - Luôn cell %%writefile với magic là DÒNG ĐẦU TIÊN tuyệt đối
    """
    colab_path = f"{base_dir}/{rel_path}"
    parent = os.path.dirname(colab_path)
    
    result = []
    # Cell mkdir riêng biệt nếu cần
    if parent and parent != base_dir:
        result.append(code_cell([f"import os; os.makedirs('{parent}', exist_ok=True)"]))
    
    # Cell writefile: %%writefile PHẢI là dòng đầu tiên
    wf_lines = [f"%%writefile {colab_path}\n"]
    file_lines = content.split("\n")
    for i, line in enumerate(file_lines):
        if i < len(file_lines) - 1:
            wf_lines.append(line + "\n")
        else:
            wf_lines.append(line)  # dòng cuối không có 

    result.append(code_cell(wf_lines))
    return result


# =============================================================================
# 1. SETUP NOTEBOOK
# =============================================================================
setup_cells = [
    md_cell([
        "# SpeakAI-Eval — Setup Environment on Kaggle\n",
        "**Yêu cầu:** Thêm dataset `tnguynthnh142/speakai-models` vào Notebook.\n",
    ]),
]

setup_cells.append(code_cell([
    "import os\n",
    "TARGET_DIR = '/kaggle/working/SpeakAI-Eval'\n",
    "os.makedirs(f'{TARGET_DIR}/configs', exist_ok=True)\n",
    "os.makedirs(f'{TARGET_DIR}/data', exist_ok=True)\n",
    "os.makedirs(f'{TARGET_DIR}/models', exist_ok=True)\n",
    "os.makedirs(f'{TARGET_DIR}/infer', exist_ok=True)\n",
    "os.makedirs(f'{TARGET_DIR}/ecapa-diarize/ecapa_diarize', exist_ok=True)\n",
    "os.makedirs(f'{TARGET_DIR}/pretrained_models', exist_ok=True)\n",
    "os.makedirs(f'{TARGET_DIR}/transformer_models', exist_ok=True)\n",
    "os.makedirs(f'{TARGET_DIR}/hf_cache', exist_ok=True)\n",
    "print('Directories created on Kaggle.')"
]))

setup_cells.append(md_cell(["---\n", "### Tải ECAPA Model (Offline)"]))
for rel_path in INCLUDE_FILES:
    content = OVERRIDES.get(rel_path) or read_file(rel_path)
    if content is None:
        print(f"WARN: khong tim thay {rel_path}")
        continue
    for cell in writefile_cells(rel_path, content, base_dir="/kaggle/working/SpeakAI-Eval"):
        setup_cells.append(cell)

setup_cells.append(md_cell(["---\n", "### Tải model ECAPA-TDNN và Copy Models"]))
setup_cells.append(code_cell([
    "import subprocess, sys\n",
    "subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'huggingface_hub'], check=True)\n",
    "from huggingface_hub import hf_hub_download\n",
    "import os, re\n",
    "\n",
    "TARGET_DIR = '/kaggle/working/SpeakAI-Eval'\n",
    "ECAPA_MODEL_DIR = f'{TARGET_DIR}/ecapa-diarize/pretrained_models/spkrec-ecapa-voxceleb'\n",
    "os.makedirs(ECAPA_MODEL_DIR, exist_ok=True)\n",
    "\n",
    "if not os.path.exists(f'{ECAPA_MODEL_DIR}/embedding_model.ckpt'):\n",
    "    print('Downloading ECAPA model to Kaggle...')\n",
    "    for fname in ['embedding_model.ckpt', 'classifier.ckpt', 'mean_var_norm_emb.ckpt',\n",
    "                  'label_encoder.txt', 'hyperparams.yaml', 'config.json']:\n",
    "        hf_hub_download(\n",
    "            repo_id='speechbrain/spkrec-ecapa-voxceleb',\n",
    "            filename=fname,\n",
    "            local_dir=ECAPA_MODEL_DIR,\n",
    "        )\n",
    "    print('Download done!')\n",
    "else:\n",
    "    print('ECAPA model already exists.')\n",
    "\n",
    "print('ALL SETUP COMPLETED!')"
]))

setup_cells.append(md_cell(["---\n", "### Tải LLM Qwen, Whisper, WavLM và Silero VAD vào Kaggle"]))
setup_cells.append(code_cell([
    "import os\n",
    "import torch\n",
    "from huggingface_hub import snapshot_download\n",
    "\n",
    "TARGET_DIR = '/kaggle/working/SpeakAI-Eval'\n",
    "WHISPER_DIR = f'{TARGET_DIR}/pretrained_models/whisper-large-v3-turbo'\n",
    "QWEN_DIR = f'{TARGET_DIR}/pretrained_models/Qwen2.5-3B-Instruct'\n",
    "WAVLM_DIR = f'{TARGET_DIR}/pretrained_models/wavlm-large'\n",
    "LANG_ID_DIR = f'{TARGET_DIR}/pretrained_models/lang-id-voxlingua107-ecapa'\n",
    "TORCH_HUB_DIR = f'{TARGET_DIR}/ecapa-diarize/pretrained_models/torch_hub'\n",
    "\n",
    "print('Downloading Silero VAD (offline caching)...')\n",
    "os.makedirs(TORCH_HUB_DIR, exist_ok=True)\n",
    "torch.hub.set_dir(TORCH_HUB_DIR)\n",
    "torch.hub.load('snakers4/silero-vad', 'silero_vad', trust_repo=True)\n",
    "\n",
    "print('Downloading Whisper model (offline caching)...')\n",
    "snapshot_download(repo_id='openai/whisper-large-v3-turbo', local_dir=WHISPER_DIR, ignore_patterns=['*.h5', '*.ot', '*.msgpack'], local_dir_use_symlinks=False)\n",
    "\n",
    "print('Downloading WavLM model (offline caching)...')\n",
    "snapshot_download(repo_id='microsoft/wavlm-large', local_dir=WAVLM_DIR, ignore_patterns=['*.h5', '*.ot', '*.msgpack'], local_dir_use_symlinks=False)\n",
    "\n",
    "print('Downloading Lang-ID model (offline caching)...')\n",
    "snapshot_download(repo_id='speechbrain/lang-id-voxlingua107-ecapa', local_dir=LANG_ID_DIR, ignore_patterns=['*.h5', '*.ot', '*.msgpack'], local_dir_use_symlinks=False)\n",
    "\n",
    "print('Downloading Qwen LLM (offline caching)...')\n",
    "snapshot_download(repo_id='Qwen/Qwen2.5-3B-Instruct', local_dir=QWEN_DIR, ignore_patterns=['*.h5', '*.ot', '*.msgpack'], local_dir_use_symlinks=False)\n",
    "print('Offline models ready!')\n"
]))

# =============================================================================
# 2. RUN NOTEBOOK
# =============================================================================
run_cells = []
run_cells.append(md_cell([
    "# SpeakAI-Eval — Inference (Run Only)\n",
    "\n",
    "Notebook này chỉ cần gọi lên và chạy. Đảm bảo bạn đã chạy **Setup Notebook** trước đó.\n",
    "Mã nguồn, models và HF cache sẽ được đọc thẳng từ Kaggle Dataset."
]))



run_cells.append(code_cell([
    "# Cài đặt thư viện\n",
    "import subprocess, sys, os\n",
    "pkgs = [\n",
    "    'torch>=2.1.0', 'torchaudio>=2.1.0', 'torch-geometric>=2.4.0',\n",
    "    'transformers>=4.36.0', 'peft>=0.7.0', 'pyyaml>=6.0.1',\n",
    "    'numpy>=1.24.0', 'soundfile>=0.12.1', 'nltk>=3.8.1',\n",
    "    'noisereduce>=3.0.0', 'python-dotenv>=1.0.0',\n",
    "    'speechbrain>=1.0.0', 'huggingface_hub>=0.23.0', 'silero-vad>=6.2.1',\n",
    "    'accelerate>=0.26.0', 'fastapi', 'uvicorn', 'python-multipart',\n",
    "]\n",
    "subprocess.run([sys.executable, '-m', 'pip', 'install', '-q'] + pkgs, check=True)\n",
    "print('Libraries installed!')\n",
    "if not os.path.exists('/usr/local/bin/cloudflared'):\n",
    "    print('Downloading cloudflared...')\n",
    "    subprocess.run('wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O /usr/local/bin/cloudflared', shell=True, check=True)\n",
    "    subprocess.run('chmod +x /usr/local/bin/cloudflared', shell=True, check=True)\n",
]))

run_cells.append(md_cell(["---\n", "## Khởi tạo Pipeline từ Kaggle Input"]))
run_cells.append(code_cell([
    "import sys, os\n",
    "SOURCE_DIR = None\n",
    "MODEL_DIR = None\n",
    "PRONUNCIATION_PATH = None\n",
    "for root, dirs, files in os.walk('/kaggle/input'):\n",
    "    if 'pretrained_models' in dirs and 'wavlm-large' in os.listdir(os.path.join(root, 'pretrained_models')):\n",
    "        MODEL_DIR = root\n",
    "    if 'infer' in dirs and 'ecapa-diarize' in dirs:\n",
    "        SOURCE_DIR = root\n",
    "    if 'pronunciation.pt' in files:\n",
    "        PRONUNCIATION_PATH = os.path.join(root, 'pronunciation.pt')\n",
    "if not MODEL_DIR:\n",
    "    raise FileNotFoundError(\"Không tìm thấy thư mục 'pretrained_models/wavlm-large' trong dataset model.\")\n",
    "if not SOURCE_DIR:\n",
    "    raise FileNotFoundError(\"Không tìm thấy source code (infer, ecapa-diarize) trong dataset setup.\")\n",
    "if not PRONUNCIATION_PATH:\n",
    "    raise FileNotFoundError(\"Không tìm thấy file 'pronunciation.pt' (mô hình speechocean) trong bất kỳ dataset nào.\")\n",
    "sys.path.insert(0, SOURCE_DIR)\n",
    "sys.path.insert(0, f'{SOURCE_DIR}/ecapa-diarize')\n",
    "os.chdir(SOURCE_DIR)\n",
    "\n",
    "# Lưu cache HuggingFace vào MODEL_DIR (nếu có thể) hoặc /kaggle/working\n",
    "os.environ['HF_HOME'] = '/kaggle/working/hf_cache'\n",
    "\n",
    "# VÁ LỖI KAGGLE DATASET READ-ONLY (monkey-patch)\n",
    "import ecapa_diarize.embedding\n",
    "import tempfile\n",
    "original_init = ecapa_diarize.embedding.EcapaEmbedder.__init__\n",
    "def patched_init(self, device=\"cpu\"):\n",
    "    from speechbrain.inference.speaker import SpeakerRecognition\n",
    "    from speechbrain.utils.fetching import LocalStrategy\n",
    "    from ecapa_diarize.paths import ECAPA_DIR\n",
    "    cache_dir = os.path.join(tempfile.gettempdir(), \"ecapa_cache\")\n",
    "    os.makedirs(cache_dir, exist_ok=True)\n",
    "    self.device = device\n",
    "    import re\n",
    "    hp_path = f'{ECAPA_DIR}/hyperparams.yaml'\n",
    "    with open(hp_path, 'r', encoding='utf-8') as f:\n",
    "        content = f.read()\n",
    "    content = re.sub(r'pretrained_path:\\s*.*', f'pretrained_path: {ECAPA_DIR}', content)\n",
    "    tmp_hp = f'{cache_dir}/hyperparams.yaml'\n",
    "    with open(tmp_hp, 'w', encoding='utf-8') as f:\n",
    "        f.write(content)\n",
    "    self._model = SpeakerRecognition.from_hparams(\n",
    "        source=str(ECAPA_DIR),\n",
    "        hparams_file=tmp_hp,\n",
    "        savedir=cache_dir,\n",
    "        run_opts={\"device\": device},\n",
    "        local_strategy=LocalStrategy.COPY,\n",
    "    )\n",
    "ecapa_diarize.embedding.EcapaEmbedder.__init__ = patched_init\n",
    "\n",
    "import torch, yaml\n",
    "from infer.pipeline import SpeakingPipeline\n",
    "from transformers import AutoModelForCausalLM, AutoTokenizer\n",
    "\n",
    "print('Patching config dynamically...')\n",
    "with open(f'{SOURCE_DIR}/configs/pronunciation.yaml', 'r') as f:\n",
    "    cfg = yaml.safe_load(f)\n",
    "cfg['asr']['model_name'] = f'{MODEL_DIR}/pretrained_models/whisper-large-v3-turbo'\n",
    "cfg['wavlm']['model_name'] = f'{MODEL_DIR}/pretrained_models/wavlm-large'\n",
    "cfg['paths']['pronunciation_checkpoint'] = PRONUNCIATION_PATH\n",
    "os.makedirs('/kaggle/working/tmp_configs', exist_ok=True)\n",
    "tmp_config = '/kaggle/working/tmp_configs/pronunciation.yaml'\n",
    "with open(tmp_config, 'w') as f:\n",
    "    yaml.dump(cfg, f)\n",
    "\n",
    "print('Patching transcribe.py dynamically...')\n",
    "import infer.transcribe\n",
    "def patched_load_asr_config():\n",
    "    with open(tmp_config, encoding='utf-8') as f:\n",
    "        return yaml.safe_load(f).get('asr') or {}\n",
    "infer.transcribe._load_asr_config = patched_load_asr_config\n",
    "\n",
    "print('Loading Pipeline models on GPU...')\n",
    "pipeline = SpeakingPipeline(config_path=tmp_config, device='cuda')\n",
    "print('Pipeline ready!')\n",
    "\n",
    "model_name = f'{MODEL_DIR}/pretrained_models/Qwen2.5-3B-Instruct'\n",
    "print(f'Loading LLM from Kaggle: {model_name}')\n",
    "tokenizer = AutoTokenizer.from_pretrained(model_name)\n",
    "llm_model = AutoModelForCausalLM.from_pretrained(\n",
    "    model_name,\n",
    "    torch_dtype=torch.float16,\n",
    "    device_map='cuda'\n",
    ")\n",
    "print(f'LLM Ready on {llm_model.device}!')\n"
]))

run_cells.append(md_cell(["---\n", "## Hàm Sinh Feedback Tổng Hợp bằng Qwen LLM"]))
run_cells.append(code_cell([
    "def generate_overall_feedback(result):\n",
    "    student_sents = result.get('student', {}).get('sentences', [])\n",
    "    if not student_sents:\n",
    "        return 'Không có dữ liệu học viên để đánh giá.'\n",
    "    \n",
    "    total_acc = sum(s.get('scores', {}).get('accuracy', 0) for s in student_sents) / len(student_sents)\n",
    "    total_flu = sum(s.get('scores', {}).get('fluency', 0) for s in student_sents) / len(student_sents)\n",
    "    total_pro = sum(s.get('scores', {}).get('prosodic', 0) for s in student_sents) / len(student_sents)\n",
    "    overall_total = (total_acc + total_flu + total_pro) / 3\n",
    "    \n",
    "    dialogue_turns = result.get('dialogue', {}).get('turns', [])\n",
    "    conversation_text = ''\n",
    "    bad_words_all = []\n",
    "    bad_ph_all = []\n",
    "    \n",
    "    for turn in dialogue_turns:\n",
    "        speaker = turn.get('role', '').upper()\n",
    "        transcript = turn.get('transcript', '')\n",
    "        if speaker == 'TEACHER':\n",
    "            conversation_text += f'Giáo viên: {transcript}\
'\n",
    "        elif speaker == 'STUDENT':\n",
    "            turn_score = turn.get('scores', {}).get('accuracy', 0)\n",
    "            conversation_text += f'Học viên: {transcript} (Điểm phát âm: {turn_score:.1f}/10)\
'\n",
    "            errors = turn.get('errors', {})\n",
    "            bad_words = [w for w in errors.get('words', []) if w.get('score', 10) < 7.0]\n",
    "            bad_ph = [p for p in errors.get('phonemes', []) if p.get('score', 10) < 7.0]\n",
    "            bad_words_all.extend([f\"{w['word']} ({w.get('score',0):.1f})\" for w in bad_words])\n",
    "            bad_ph_all.extend([f\"{p['phoneme']} ({p.get('score',0):.1f})\" for p in bad_ph])\n",
    "    \n",
    "    bad_words_str = ', '.join(list(dict.fromkeys(bad_words_all))[:15]) or 'Không có'\n",
    "    bad_ph_str = ', '.join(list(dict.fromkeys(bad_ph_all))[:15]) or 'Không có'\n",
    "    \n",
    "    prompt = f\"\"\"Bạn là một giáo viên chuyên đánh giá phát âm và giao tiếp tiếng Anh.\\n",
    "Dưới đây là đoạn hội thoại giữa Giáo viên và Học viên, cùng với kết quả phân tích phát âm của Học viên. Hãy viết một bài nhận xét TỔNG HỢP (Overall Feedback) thật chi tiết, rõ ràng và có cấu trúc dễ đọc.\\n",
    "\\n",
    "--- ĐOẠN HỘI THOẠI ---\\n",
    "{conversation_text}\\n",
    "--- ĐIỂM SỐ TRUNG BÌNH CỦA HỌC VIÊN (Thang 10) ---\\n",
    "Tổng quan: {overall_total:.1f}\\n",
    "Chính xác (Accuracy): {total_acc:.1f}\\n",
    "Trôi chảy (Fluency): {total_flu:.1f}\\n",
    "Ngữ điệu (Prosody): {total_pro:.1f}\\n",
    "\\n",
    "--- LỖI PHÁT ÂM ĐÁNG CHÚ Ý CẦN SỬA ---\\n",
    "Từ phát âm sai nhiều: {bad_words_str}\\n",
    "Âm vị (Phoneme) sai nhiều: {bad_ph_str}\\n",
    "\\n",
    "Yêu cầu nhận xét (bằng tiếng Việt, định dạng Markdown đẹp, rõ ràng):\\n",
    "1. Đánh giá chung: Học viên làm tốt ở đâu (khen ngợi), giao tiếp có tự nhiên và đúng ngữ cảnh không? Ngữ pháp sử dụng có đúng không? (LƯU Ý: Chỉ liệt kê lỗi sai ngữ pháp, KHÔNG viết lại những câu đã chính xác để tránh dài dòng).\\n",
    "2. Điểm cần khắc phục: Giải thích thật rõ ràng các lỗi phát âm (từ/âm vị cụ thể) và hướng dẫn cách sửa chi tiết.\\n",
    "3. Lời khuyên & Động viên: Đề xuất cách luyện tập để cải thiện.\\n",
    "Không nhắc đến 'Completeness'.\\n",
    "\"\"\"\n",
    "    messages = [\n",
    "        {'role': 'system', 'content': 'Bạn là giáo viên tiếng Anh tận tâm, chuyên môn cao.'},\n",
    "        {'role': 'user', 'content': prompt}\n",
    "    ]\n",
    "    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)\n",
    "    model_inputs = tokenizer([text], return_tensors='pt').to(llm_model.device)\n",
    "    \n",
    "    generated_ids = llm_model.generate(**model_inputs, max_new_tokens=512)\n",
    "    generated_ids = [output_ids[len(input_ids):] for input_ids, output_ids in zip(model_inputs.input_ids, generated_ids)]\n",
    "    \n",
    "    response = tokenizer.batch_decode(generated_ids, skip_special_tokens=True)[0]\n",
    "    return response\n"
]))

run_cells.append(md_cell(["---\n", "## Khởi chạy Backend API (FastAPI + Cloudflare Tunnel)"]))
run_cells.append(code_cell([
    "from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks\n",
    "import uuid\n",
    "from fastapi.middleware.cors import CORSMiddleware\n",
    "from fastapi.staticfiles import StaticFiles\n",
    "from fastapi.responses import JSONResponse\n",
    "import uvicorn\n",
    "import shutil\n",
    "import json\n",
    "import numpy as np\n",
    "import subprocess\n",
    "import time\n",
    "import re\n",
    "import os\n",
    "\n",
    "# 1. Khởi động Cloudflare Tunnel\n",
    "def start_cloudflare_tunnel(port=8000):\n",
    "    print('Starting Cloudflare Tunnel...')\n",
    "    cmd = f'cloudflared tunnel --url http://127.0.0.1:{port}'\n",
    "    process = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)\n",
    "    url = None\n",
    "    for _ in range(20):\n",
    "        line = process.stdout.readline()\n",
    "        match = re.search(r'https://[a-zA-Z0-9-]+\\.trycloudflare\\.com', line)\n",
    "        if match:\n",
    "            url = match.group(0)\n",
    "            break\n",
    "        time.sleep(0.5)\n",
    "    return url\n",
    "\n",
    "PUBLIC_URL = start_cloudflare_tunnel(8000)\n",
    "print('\
' + '='*80)\n",
    "print(f'🚀 API IS LIVE AT: {PUBLIC_URL}')\n",
    "print('=> COPY LINK NÀY VÀ DÁN VÀO CẤU HÌNH TRÊN WEBSITE CỦA BẠN!')\n",
    "print('='*80 + '\
')\n",
    "\n",
    "# 2. Khởi tạo FastAPI App\n",
    "app = FastAPI()\n",
    "app.add_middleware(\n",
    "    CORSMiddleware,\n",
    "    allow_origins=['*'],\n",
    "    allow_credentials=True,\n",
    "    allow_methods=['*'],\n",
    "    allow_headers=['*'],\n",
    ")\n",
    "\n",
    "# Phục vụ file audio tĩnh từ Colab để Website có thể nghe lại\n",
    "os.makedirs('/tmp/SpeakAI_Audio', exist_ok=True)\n",
    "app.mount('/audio', StaticFiles(directory='/tmp/SpeakAI_Audio'), name='audio')\n",
    "\n",
    "tasks = {}\n",
    "\n",
    "@app.post('/assess_start')\n",
    "def assess_start_api(background_tasks: BackgroundTasks, audio: UploadFile = File(...), teacher_embeddings_json: str = Form(...), student_embeddings_json: str = Form(...), score_teacher: bool = Form(False)):\n",
    "    try:\n",
    "        task_id = str(uuid.uuid4())\n",
    "        tasks[task_id] = {'status': 'processing', 'step': 'Đang tải file âm thanh lên server...', 'result': None, 'llm_feedback': None}\n",
    "        \n",
    "        conv_path = f'/tmp/SpeakAI_Audio/{task_id}_{audio.filename}'\n",
    "        with open(conv_path, 'wb') as f:\n",
    "            shutil.copyfileobj(audio.file, f)\n",
    "        \n",
    "        background_tasks.add_task(process_assessment, task_id, conv_path, teacher_embeddings_json, student_embeddings_json, score_teacher)\n",
    "        return JSONResponse({'success': True, 'task_id': task_id})\n",
    "    except Exception as e:\n",
    "        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)\n",
    "\n",
    "def process_assessment(task_id, conv_path, teacher_embeddings_json, student_embeddings_json, score_teacher):\n",
    "    try:\n",
    "        tasks[task_id]['step'] = 'Đang phân tích embeddings...'\n",
    "        \n",
    "        # Parse Embeddings của Giáo viên\n",
    "        t_emb_list = json.loads(teacher_embeddings_json)\n",
    "        teacher_emb = np.array(t_emb_list, dtype=np.float32)\n",
    "        if len(teacher_emb.shape) == 2:\n",
    "            teacher_emb = np.mean(teacher_emb, axis=0)\n",
    "        teacher_emb /= np.linalg.norm(teacher_emb)\n",
    "\n",
    "        # Parse Embeddings của Học viên\n",
    "        s_emb_list = json.loads(student_embeddings_json)\n",
    "        student_emb = np.array(s_emb_list, dtype=np.float32)\n",
    "        if len(student_emb.shape) == 2:\n",
    "            student_emb = np.mean(student_emb, axis=0)\n",
    "        student_emb /= np.linalg.norm(student_emb)\n",
    "        \n",
    "        # Gọi Pipeline\n",
    "        tasks[task_id]['step'] = 'Đang tách lời (Diarization) & Phân tích phát âm...'\n",
    "        raw_result = pipeline.assess_conversation(\n",
    "            conv_path,\n",
    "            teacher_embedding=teacher_emb,\n",
    "            student_embedding=student_emb,\n",
    "            score_teacher=score_teacher\n",
    "        )\n",
    "        \n",
    "        # Trích xuất file tổng hợp\n",
    "        diar = raw_result.get('diarization', {})\n",
    "        if raw_result.get('teacher') and diar.get('teacher'):\n",
    "            raw_result['teacher']['full_audio'] = str(diar['teacher'])\n",
    "        if raw_result.get('student') and diar.get('student'):\n",
    "            raw_result['student']['full_audio'] = str(diar['student'])\n",
    "\n",
    "        # Gọi LLM Feedback\n",
    "        tasks[task_id]['step'] = 'Đang gọi LLM Qwen tạo Feedback...'\n",
    "        llm_feedback = generate_overall_feedback(raw_result)\n",
    "        \n",
    "        # Chuyển đổi đường dẫn file cục bộ thành Public URL\n",
    "        def convert_paths_to_urls(node):\n",
    "            if isinstance(node, dict):\n",
    "                for k, v in node.items():\n",
    "                    if (k == 'audio' or k == 'full_audio') and isinstance(v, str) and v.startswith('/tmp/SpeakAI_Audio/'):\n",
    "                        rel_path = v.replace('/tmp/SpeakAI_Audio/', '')\n",
    "                        node[k] = f'{PUBLIC_URL}/audio/{rel_path}'\n",
    "                    else:\n",
    "                        convert_paths_to_urls(v)\n",
    "            elif isinstance(node, list):\n",
    "                for item in node:\n",
    "                    convert_paths_to_urls(item)\n",
    "                    \n",
    "        convert_paths_to_urls(raw_result)\n",
    "        \n",
    "        # Xóa file audio tạm\n",
    "        if os.path.exists(conv_path):\n",
    "            os.remove(conv_path)\n",
    "            \n",
    "        tasks[task_id]['result'] = raw_result\n",
    "        tasks[task_id]['llm_feedback'] = llm_feedback\n",
    "        tasks[task_id]['status'] = 'completed'\n",
    "    except Exception as e:\n",
    "        print(f'API Error in task {task_id}: {e}')\n",
    "        import traceback\n",
    "        traceback.print_exc()\n",
    "        tasks[task_id]['status'] = 'error'\n",
    "        tasks[task_id]['error'] = str(e)\n",
    "\n",
    "@app.get('/assess_status/{task_id}')\n",
    "def assess_status(task_id: str):\n",
    "    if task_id not in tasks:\n",
    "        return JSONResponse({'success': False, 'error': 'Task not found'}, status_code=404)\n",
    "    return JSONResponse({'success': True, 'data': tasks[task_id]})\n",
    "\n",
    "# Khởi chạy Uvicorn\n",
    "config = uvicorn.Config(app, host='0.0.0.0', port=8000)\n",
    "server = uvicorn.Server(config)\n",
    "await server.serve()\n"
]))

def save_notebook(cells, filename):
    notebook = {
        "cells": cells,
        "metadata": {
            "accelerator": "GPU",
            "colab": {"gpuType": "T4"},
            "kernelspec": {"display_name": "Python 3", "name": "python3"},
            "language_info": {"name": "python"},
        },
        "nbformat": 4,
        "nbformat_minor": 0,
    }
    out_path = os.path.join(ROOT.replace("/", os.sep), filename)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(notebook, f, indent=2, ensure_ascii=False)
    print(f"Done -> {out_path} ({len(cells)} cells)")

save_notebook(setup_cells, "SpeakAI-Kaggle-Setup.ipynb")
save_notebook(run_cells, "SpeakAI-Kaggle-Run.ipynb")
