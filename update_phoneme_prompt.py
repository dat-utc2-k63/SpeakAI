for f in ['make_colab.py', 'make_kaggle.py']:
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    old_str = '    "2. Điểm cần khắc phục: Giải thích thật rõ ràng các lỗi phát âm (từ/âm vị cụ thể) và hướng dẫn cách sửa chi tiết.\\n",\n'
    new_str = '    "2. Điểm cần khắc phục: Giải thích thật rõ ràng các lỗi phát âm (từ/âm vị cụ thể) và hướng dẫn cách sửa chi tiết. (LƯU Ý: Phải sử dụng CHÍNH XÁC ký hiệu âm vị Phoneme gốc mà hệ thống trả về, KHÔNG tự ý phiên âm sang tiếng Việt như âm \'O\', âm \'R\').\\n",\n'
    
    new_content = content.replace(old_str, new_str)
    
    with open(f, 'w', encoding='utf-8') as file:
        file.write(new_content)
    print(f'Updated phoneme prompt in {f}')
