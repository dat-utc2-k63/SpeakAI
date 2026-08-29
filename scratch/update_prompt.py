import sys
import re

with open(r'd:\SpeakAI-Eval\make_kaggle.py', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add student_turn_idx
old_loop = """    "    for turn in dialogue_turns:\\n",
    "        speaker = turn.get('role', '').upper()\\n",
    "        transcript = turn.get('transcript', '')\\n",
    "        if speaker == 'TEACHER':\\n",
    "            conversation_text += f'Giáo viên: {transcript}\\\\n'\\n",
    "        elif speaker == 'STUDENT':\\n",
    "            turn_score = turn.get('scores', {}).get('accuracy', 0)\\n",
    "            conversation_text += f'Học viên: {transcript} (Điểm phát âm: {turn_score:.1f}/10)\\\\n'\\n",
    "            errors = turn.get('errors', {})\\n","""

new_loop = """    "    student_turn_idx = 1\\n",
    "    for turn in dialogue_turns:\\n",
    "        speaker = turn.get('role', '').upper()\\n",
    "        transcript = turn.get('transcript', '')\\n",
    "        if speaker == 'TEACHER':\\n",
    "            conversation_text += f'Giáo viên: {transcript}\\\\n'\\n",
    "        elif speaker == 'STUDENT':\\n",
    "            turn_score = turn.get('scores', {}).get('accuracy', 0)\\n",
    "            conversation_text += f'Học viên (Lượt {student_turn_idx}): {transcript} (Điểm phát âm: {turn_score:.1f}/10)\\\\n'\\n",
    "            student_turn_idx += 1\\n",
    "            errors = turn.get('errors', {})\\n","""

content = content.replace(old_loop, new_loop)

# 2. Update prompt
old_prompt = """    "    prompt = f\\\"\\\"\\\"Bạn là một giáo viên chuyên đánh giá phát âm và giao tiếp tiếng Anh.\\\\n",
    "Dưới đây là đoạn hội thoại giữa Giáo viên và Học viên, cùng với kết quả phân tích phát âm của Học viên. Hãy viết một bài nhận xét TỔNG HỢP (Overall Feedback) thật chi tiết, rõ ràng và có cấu trúc dễ đọc.\\\\n",
    "\\\\n",
    "--- ĐOẠN HỘI THOẠI ---\\\\n",
    "{conversation_text}\\\\n",
    "--- ĐIỂM SỐ TRUNG BÌNH CỦA HỌC VIÊN (Thang 10) ---\\\\n",
    "Tổng quan: {overall_total:.1f}\\\\n",
    "Chính xác (Accuracy): {total_acc:.1f}\\\\n",
    "Trôi chảy (Fluency): {total_flu:.1f}\\\\n",
    "Ngữ điệu (Prosody): {total_pro:.1f}\\\\n",
    "\\\\n",
    "--- LỖI PHÁT ÂM ĐÁNG CHÚ Ý CẦN SỬA ---\\\\n",
    "Từ phát âm sai nhiều: {bad_words_str}\\\\n",
    "Âm vị (Phoneme) sai nhiều: {bad_ph_str}\\\\n",
    "\\\\n",
    "Yêu cầu nhận xét (bằng tiếng Việt, định dạng Markdown đẹp, rõ ràng):\\\\n",
    "1. Đánh giá chung: Học viên làm tốt ở đâu (khen ngợi), giao tiếp có tự nhiên và đúng ngữ cảnh không? Ngữ pháp sử dụng có đúng không? (LƯU Ý: Chỉ liệt kê lỗi sai ngữ pháp, KHÔNG viết lại những câu đã chính xác để tránh dài dòng).\\\\n",
    "2. Điểm cần khắc phục: Giải thích thật rõ ràng các lỗi phát âm. (LƯU Ý QUAN TRỌNG: Phải ghi CHÍNH XÁC ký hiệu Âm vị (Phoneme) gốc bằng tiếng Anh mà hệ thống đã cung cấp (ví dụ /æ/, /ə/, /tʃ/), tuyệt đối KHÔNG tự ý bóp méo, phiên âm sang tiếng Việt hay gọi chung chung là 'âm O', 'âm R'). Hướng dẫn cách sửa chi tiết.\\\\n",
    "3. Lời khuyên & Động viên: Đề xuất cách luyện tập để cải thiện.\\\\n",
    "Không nhắc đến 'Completeness'.\\\\n",
    "\\\"\\\"\\\"\\n","""

new_prompt = """    "    prompt = f\\\"\\\"\\\"Bạn là một giáo viên chuyên đánh giá phát âm và giao tiếp tiếng Anh.\\\\n",
    "Dưới đây là đoạn hội thoại giữa Giáo viên và Học viên, cùng với kết quả phân tích phát âm của Học viên.\\\\n",
    "\\\\n",
    "--- ĐOẠN HỘI THOẠI ---\\\\n",
    "{conversation_text}\\\\n",
    "--- ĐIỂM SỐ TRUNG BÌNH CỦA HỌC VIÊN (Thang 10) ---\\\\n",
    "Tổng quan: {overall_total:.1f}\\\\n",
    "Chính xác (Accuracy): {total_acc:.1f}\\\\n",
    "Trôi chảy (Fluency): {total_flu:.1f}\\\\n",
    "Ngữ điệu (Prosody): {total_pro:.1f}\\\\n",
    "\\\\n",
    "--- LỖI PHÁT ÂM ĐÁNG CHÚ Ý CẦN SỬA ---\\\\n",
    "Từ phát âm sai nhiều: {bad_words_str}\\\\n",
    "Âm vị (Phoneme) sai nhiều: {bad_ph_str}\\\\n",
    "\\\\n",
    "Yêu cầu nhận xét (bằng tiếng Việt, định dạng Markdown đẹp, rõ ràng):\\\\n",
    "1. TỪNG LƯỢT NÓI CỦA HỌC VIÊN: Lần lượt nhận xét ngắn gọn từng Lượt (Lượt 1, Lượt 2,...) về phát âm, ngữ pháp, ngữ cảnh. Đưa ra khuyến nghị sửa lại nếu có lỗi. Nếu lượt đó tốt (phát âm chuẩn, đúng ngữ pháp), chỉ cần viết ngắn gọn 'Tốt', khen ngợi đơn giản, không viết dài.\\\\n",
    "2. TỔNG KẾT: Một đoạn ngắn gọn tổng hợp lại điểm mạnh, điểm yếu chung và hướng dẫn sửa lỗi phát âm cụ thể theo ký hiệu âm vị đã cung cấp (ví dụ /æ/, /ə/). Tuyệt đối KHÔNG tự ý bóp méo, phiên âm sang tiếng Việt hay gọi chung chung là 'âm O', 'âm R'.\\\\n",
    "Không nhắc đến 'Completeness'.\\\\n",
    "\\\"\\\"\\\"\\n","""

content = content.replace(old_prompt, new_prompt)

with open(r'd:\SpeakAI-Eval\make_kaggle.py', 'w', encoding='utf-8') as f:
    f.write(content)

print('Success!' if new_prompt in content and new_loop in content else 'Failed!')
