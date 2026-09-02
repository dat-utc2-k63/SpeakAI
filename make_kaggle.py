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
    "speaker-diarize/speaker_diarize/__init__.py",
    "speaker-diarize/speaker_diarize/audio_io.py",
    "speaker-diarize/speaker_diarize/clustering.py",
    "speaker-diarize/speaker_diarize/denoise.py",
    "speaker-diarize/speaker_diarize/embedding.py",
    "speaker-diarize/speaker_diarize/pipeline.py",
    "speaker-diarize/speaker_diarize/segmentation.py",
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
  model_name: pretrained_models/whisper-large-v3
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
    "os.makedirs(f'{TARGET_DIR}/speaker-diarize/speaker_diarize', exist_ok=True)\n",
    "os.makedirs(f'{TARGET_DIR}/pretrained_models', exist_ok=True)\n",
    "os.makedirs(f'{TARGET_DIR}/transformer_models', exist_ok=True)\n",
    "os.makedirs(f'{TARGET_DIR}/hf_cache', exist_ok=True)\n",
    "print('Directories created on Kaggle.')"
]))

setup_cells.append(md_cell(["---\n", "### Tải Source Code (Offline)"]))
for rel_path in INCLUDE_FILES:
    content = OVERRIDES.get(rel_path) or read_file(rel_path)
    if content is None:
        print(f"WARN: khong tim thay {rel_path}")
        continue
    for cell in writefile_cells(rel_path, content, base_dir="/kaggle/working/SpeakAI-Eval"):
        setup_cells.append(cell)

setup_cells.append(md_cell(["---\n", "### Tải model Speaker Diarization (ERes2Net-Large)"]))
setup_cells.append(code_cell([
    "import subprocess, sys, os\n",
    "try:\n",
    "    import numpy\n",
    "    np_ver = numpy.__version__\n",
    "except: np_ver = '2.0.2'\n",
    "print('Installing Rust (required for DeepFilterNet on Python 3.12)...')\n",
    "os.system(\"curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y\")\n",
    "os.environ['PATH'] = f\"/root/.cargo/bin:{os.environ.get('PATH', '')}\"\n",
    "subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'huggingface_hub', 'addict', 'modelscope', 'deepfilternet'], check=True)\n",
    "subprocess.run([sys.executable, '-m', 'pip', 'install', '-U', '-q', f'numpy=={np_ver}'], check=True)\n",
    "import os, re, shutil\n",
    "\n",
    "TARGET_DIR = '/kaggle/working/SpeakAI-Eval'\n",
    "ERES_MODEL_DIR = f'{TARGET_DIR}/speaker-diarize/pretrained_models/speech_eres2net_large_200k_sv_zh-cn_16k-common'\n",
    "\n",
    "if not os.path.exists(f'{ERES_MODEL_DIR}/model.onnx') and not os.path.exists(f'{ERES_MODEL_DIR}/pytorch_model.bin'):\n",
    "    print('Downloading ERes2Net-Large to Kaggle via Git...')\n",
    "    if os.path.exists(ERES_MODEL_DIR):\n",
    "        shutil.rmtree(ERES_MODEL_DIR)\n",
    "    os.system('git lfs install')\n",
    "    os.system(f'git clone https://www.modelscope.cn/damo/speech_eres2net_large_200k_sv_zh-cn_16k-common.git {ERES_MODEL_DIR}')\n",
    "    print('Download done!')\n",
    "else:\n",
    "    print('ERes2Net-Large model already exists.')\n",
    "\n",
    "print('ALL SETUP COMPLETED!')"
]))

setup_cells.append(md_cell(["---\n", "### Tải LLM Qwen, Whisper, WavLM, DeepFilterNet vào Kaggle"]))
setup_cells.append(code_cell([
    "import os\n",
    "import torch\n",
    "import shutil\n",
    "from huggingface_hub import snapshot_download\n",
    "os.environ['HF_HUB_CACHE'] = '/tmp/hf_cache'\n",
    "\n",
    "TARGET_DIR = '/kaggle/working/SpeakAI-Eval'\n",
    "WHISPER_DIR = f'{TARGET_DIR}/pretrained_models/whisper-large-v3'\n",
    "WAVLM_DIR = f'{TARGET_DIR}/pretrained_models/wavlm-large'\n",
    "LANG_ID_DIR = f'{TARGET_DIR}/pretrained_models/lang-id-voxlingua107-ecapa'\n",
    "\n",
    "def download_model(repo_id, local_dir, ignore_patterns):\n",
    "    if not os.path.exists(local_dir):\n",
    "        snapshot_download(repo_id=repo_id, local_dir=local_dir, ignore_patterns=ignore_patterns, local_dir_use_symlinks=False)\n",
    "        shutil.rmtree('/tmp/hf_cache', ignore_errors=True)\n",
    "        shutil.rmtree('/root/.cache/huggingface', ignore_errors=True)\n",
    "    else:\n",
    "        print(f'{repo_id} already exists.')\n",
    "\n",
    "print('Downloading DeepFilterNet model (offline caching)...')\n",
    "import torchaudio\n",
    "import sys, types\n",
    "if not hasattr(torchaudio, 'backend'):\n",
    "    torchaudio.backend = types.ModuleType('torchaudio.backend')\n",
    "    sys.modules['torchaudio.backend'] = torchaudio.backend\n",
    "if not hasattr(torchaudio.backend, 'common'):\n",
    "    torchaudio.backend.common = types.ModuleType('torchaudio.backend.common')\n",
    "    sys.modules['torchaudio.backend.common'] = torchaudio.backend.common\n",
    "    torchaudio.backend.common.AudioMetaData = getattr(torchaudio, 'AudioMetaData', type('AudioMetaData', (), {}))\n",
    "from df.enhance import init_df\n",
    "init_df()\n",
    "shutil.rmtree('/tmp/hf_cache', ignore_errors=True)\n",
    "shutil.rmtree('/root/.cache/huggingface', ignore_errors=True)\n",
    "\n",
    "print('Downloading Whisper model (offline caching)...')\n",
    "download_model('openai/whisper-large-v3', WHISPER_DIR, ['*.h5', '*.ot', '*.msgpack', 'pytorch_model.bin', '*.onnx', '*.mlmodel', '*coreml*', '*.tflite', '*.pb', '*.ckpt'])\n",
    "\n",
    "print('Downloading WavLM model (offline caching)...')\n",
    "download_model('microsoft/wavlm-large', WAVLM_DIR, ['*.h5', '*.ot', '*.msgpack', '*.onnx', '*.mlmodel', '*coreml*', '*.tflite', '*.pb', '*.ckpt'])\n",
    "\n",
    "print('Downloading Lang-ID model (offline caching)...')\n",
    "download_model('speechbrain/lang-id-voxlingua107-ecapa', LANG_ID_DIR, ['*.h5', '*.ot', '*.msgpack', '*.onnx', '*.mlmodel', '*coreml*', '*.tflite', '*.pb'])\n",
    "\n",
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
    "try:\n",
    "    import numpy\n",
    "    np_ver = numpy.__version__\n",
    "except: np_ver = '2.0.2'\n",
    "print('Installing Rust (required for DeepFilterNet on Python 3.12)...')\n",
    "os.system(\"curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y\")\n",
    "os.environ['PATH'] = f\"/root/.cargo/bin:{os.environ.get('PATH', '')}\"\n",
    "pkgs = [\n",
    "    'torch>=2.1.0', 'torchaudio>=2.1.0', 'torch-geometric>=2.4.0',\n",
    "    'transformers>=4.36.0', 'peft>=0.7.0', 'pyyaml>=6.0.1',\n",
    "    'numpy>=1.24.0', 'soundfile>=0.12.1', 'nltk>=3.8.1',\n",
    "    'python-dotenv>=1.0.0', 'deepfilternet', 'addict', 'modelscope',\n",
    "    'speechbrain>=1.0.0', 'huggingface_hub>=0.23.0',\n",
    "    'accelerate>=0.26.0', 'fastapi', 'uvicorn', 'python-multipart',\n",
    "]\n",
    "subprocess.run([sys.executable, '-m', 'pip', 'install', '-q'] + pkgs, check=True)\n",
    "subprocess.run([sys.executable, '-m', 'pip', 'install', '-U', '-q', f'numpy=={np_ver}'], check=True)\n",
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
    "for search_dir in ['/kaggle/working', '/kaggle/input']:\n",
    "    for root, dirs, files in os.walk(search_dir):\n",
    "        if 'pretrained_models' in dirs and 'wavlm-large' in os.listdir(os.path.join(root, 'pretrained_models')):\n",
    "            if MODEL_DIR is None: MODEL_DIR = root\n",
    "        if 'infer' in dirs and 'speaker-diarize' in dirs:\n",
    "            if SOURCE_DIR is None: SOURCE_DIR = root\n",
    "        if 'pronunciation.pt' in files:\n",
    "            if PRONUNCIATION_PATH is None: PRONUNCIATION_PATH = os.path.join(root, 'pronunciation.pt')\n",
    "if not MODEL_DIR:\n",
    "    raise FileNotFoundError(\"Không tìm thấy thư mục 'pretrained_models/wavlm-large' trong dataset model.\")\n",
    "if not SOURCE_DIR:\n",
    "    raise FileNotFoundError(\"Không tìm thấy source code (infer, speaker-diarize) trong dataset setup.\")\n",
    "if not PRONUNCIATION_PATH:\n",
    "    raise FileNotFoundError(\"Không tìm thấy file 'pronunciation.pt' (mô hình speechocean) trong bất kỳ dataset nào.\")\n",
    "sys.path.insert(0, SOURCE_DIR)\n",
    "sys.path.insert(0, f'{SOURCE_DIR}/speaker-diarize')\n",
    "os.chdir(SOURCE_DIR)\n",
    "\n",
    "# Lưu cache HuggingFace vào MODEL_DIR (nếu có thể) hoặc /kaggle/working\n",
    "os.environ['HF_HOME'] = '/kaggle/working/hf_cache'\n",
    "\n",
    "import torch, yaml\n",
    "from infer.pipeline import SpeakingPipeline\n",
    "from transformers import AutoModelForCausalLM, AutoTokenizer\n",
    "\n",
    "print('Patching config dynamically...')\n",
    "with open(f'{SOURCE_DIR}/configs/pronunciation.yaml', 'r') as f:\n",
    "    cfg = yaml.safe_load(f)\n",
    "cfg['asr']['model_name'] = f'{MODEL_DIR}/pretrained_models/whisper-large-v3'\n",
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
    "print('Loading Pipeline models on GPU 1 (cuda:1)...')\n",
    "pipeline = SpeakingPipeline(config_path=tmp_config, device='cuda:1')\n",
    "print('Pipeline ready!')\n",
    "\n",
    "print('Loading Registration Model on GPU 0 (cuda:0)...')\n",
    "from speaker_diarize.embedding import ERes2NetEmbedder\n",
    "extract_embedder = ERes2NetEmbedder(device='cuda:0')\n",
    "print('Registration Embedder ready!')\n",
    "\n",
    "print('Setup complete!')\n"
]))

run_cells.append(md_cell(["---\n", "## Hàm Sinh Feedback Tổng Hợp bằng Qwen LLM"]))
run_cells.append(code_cell([
    "def generate_turn_feedback(teacher_text, student_text, score, errors):\n",
    "    bad_words = [w for w in errors.get('words', []) if w.get('score', 10) < 7.0]\n",
    "    bad_ph = [p for p in errors.get('phonemes', []) if p.get('score', 10) < 7.0]\n",
    "    bad_words_str = ', '.join([f\"{w['word']}\" for w in bad_words])\n",
    "    bad_ph_str = ', '.join([f\"{p['phoneme']}\" for p in bad_ph])\n",
    "    if bad_words_str or bad_ph_str:\n",
    "        return f\"⚠️ Cần cải thiện: Phát âm yếu các từ [{bad_words_str}]. Sai âm vị [{bad_ph_str}].\"\n",
    "    return \"\"\n",
    "\n",
    "def generate_overall_summary(result):\n",
    "    student_sents = result.get('student', {}).get('sentences', [])\n",
    "    if not student_sents:\n",
    "        return 'Không có dữ liệu.'\n",
    "    \n",
    "    total_acc = sum(s.get('scores', {}).get('accuracy', 0) for s in student_sents) / len(student_sents)\n",
    "    total_flu = sum(s.get('scores', {}).get('fluency', 0) for s in student_sents) / len(student_sents)\n",
    "    total_pro = sum(s.get('scores', {}).get('prosodic', 0) for s in student_sents) / len(student_sents)\n",
    "    overall_total = (total_acc + total_flu + total_pro) / 3\n",
    "    \n",
    "    prompt = f\"\"\"Dựa trên tổng điểm của cuộc hội thoại:\\n",
    "Tổng quan: {overall_total:.1f}/10\\n",
    "Chính xác (Accuracy): {total_acc:.1f}/10\\n",
    "Trôi chảy (Fluency): {total_flu:.1f}/10\\n",
    "Ngữ điệu (Prosody): {total_pro:.1f}/10\\n",
    "\\n",
    "Hãy viết tổng kết đánh giá chi tiết THEO ĐÚNG ĐỊNH DẠNG SAU (không dài dòng):\\n",
    "🌟 Điểm mạnh:\\n",
    "[1 câu nhận xét chung]\\n",
    "🎯 Cần cải thiện:\\n",
    "[1 điểm cần lưu ý nhất]\\n",
    "💪 Gợi ý luyện tập:\\n",
    "[1 gợi ý ngắn gọn]\"\"\"\n",
    "    return ''\n"
]))

run_cells.append(md_cell(["---\n", "## Khởi chạy Backend API (FastAPI + Cloudflare Tunnel)"]))
with open("backend_api.py", "r", encoding="utf-8") as f:
    backend_lines = f.readlines()
run_cells.append(code_cell(backend_lines))

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
