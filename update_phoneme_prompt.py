import os

# Delete colab files
files_to_delete = ['make_colab.py', 'SpeakAI-Colab-Setup.ipynb', 'SpeakAI-Colab-Run.ipynb']
for f in files_to_delete:
    if os.path.exists(f):
        os.remove(f)
        print(f"Deleted {f}")

# Update make_kaggle.py
with open('make_kaggle.py', 'r', encoding='utf-8') as f:
    content = f.read()

old_str = "    \"2. Điểm cần khắc phục: Giải thích thật rõ ràng các lỗi phát âm (từ/âm vị cụ thể) và hướng dẫn cách sửa chi tiết.\\n\","
new_str = "    \"2. Điểm cần khắc phục: Giải thích thật rõ ràng các lỗi phát âm. (LƯU Ý QUAN TRỌNG: Phải ghi CHÍNH XÁC ký hiệu Âm vị (Phoneme) gốc bằng tiếng Anh mà hệ thống đã cung cấp (ví dụ /æ/, /ə/, /tʃ/), tuyệt đối KHÔNG tự ý bóp méo, phiên âm sang tiếng Việt hay gọi chung chung là 'âm O', 'âm R'). Hướng dẫn cách sửa chi tiết.\\n\","

if old_str in content:
    content = content.replace(old_str, new_str)
    with open('make_kaggle.py', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Updated make_kaggle.py")
else:
    print("Could not find the target string in make_kaggle.py")
