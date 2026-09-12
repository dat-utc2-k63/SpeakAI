-- ==============================================================================
-- SpeakAI Web Platform - Seed Data (Bộ đề & Câu hỏi đơn giản, không chứa gợi ý câu trả lời)
-- Project: SpeakAI (https://kngkckshvgaqeiatryqy.supabase.co)
-- Formats: VSTEP, IELTS, TOEIC, Giao tiếp hàng ngày (General English)
-- Instructions: Chạy script này trong Supabase SQL Editor sau khi chạy speak_web_schema.sql.
-- ==============================================================================

do $$
declare
  v_teacher_id uuid;
  v_set_id uuid;
begin
  -- 1. Tìm Giáo viên hoặc Admin làm người sở hữu bộ đề mẫu
  select id into v_teacher_id
  from public.profiles
  where role in ('teacher', 'admin')
  order by (case when role = 'teacher' then 1 else 2 end), created_at asc
  limit 1;

  if v_teacher_id is null then
    raise notice 'Chưa có tài khoản Teacher hoặc Admin trong bảng profiles. Hãy tạo tài khoản trước khi nạp data mẫu.';
    return;
  end if;

  raise notice 'Đang nạp bộ đề mẫu với teacher_id: %', v_teacher_id;

  -- 2. Xóa các bộ đề mẫu cũ (nếu có) để nạp lại bộ đề mới sạch gọn
  delete from public.question_sets 
  where title in (
    'Đề thi thử VSTEP Speaking B1-B2-C1 (Đề chuẩn số 1)',
    'IELTS Speaking Simulation Test (Band 7.0+ Target)',
    'TOEIC Speaking Official Test Format (ETS Simulator)',
    'Giao tiếp & Luyện phát âm chuẩn Mỹ (Daily English Mastery)',
    'VSTEP Speaking Cơ Bản (Dễ hiểu & Thực tế)',
    'IELTS Speaking Giao Tiếp Tự Nhiên (Band 6.0 - 6.5)',
    'TOEIC Speaking Căn Bản (Đọc & Phản xạ nhanh)',
    'Tiếng Anh Giao Tiếp Hàng Ngày (Dễ thực hành)'
  );

  -- ============================================================================
  -- 1. BỘ ĐỀ 1: VSTEP SPEAKING CƠ BẢN (Dễ hiểu, gần gũi)
  -- ============================================================================
  insert into public.question_sets (teacher_id, title, description, level, exam_type, time_limit, is_published)
  values (
    v_teacher_id,
    'VSTEP Speaking Cơ Bản (Dễ hiểu & Thực tế)',
    'Bộ đề thi thử VSTEP Speaking với cấu trúc 3 phần tiêu chuẩn, câu hỏi gần gũi và thực tế cho người học.',
    'intermediate',
    'vstep',
    10,
    true
  ) returning id into v_set_id;

  insert into public.questions (set_id, order_num, part_title, question_text, prep_time, response_time)
  values
  (
    v_set_id, 1, 'Part 1: Social Interaction',
    'Can you tell me about yourself? What is your name and where do you come from?',
    10, 30
  ),
  (
    v_set_id, 2, 'Part 1: Social Interaction',
    'What do you usually like to do in your free time?',
    10, 30
  ),
  (
    v_set_id, 3, 'Part 1: Social Interaction',
    'Do you prefer studying alone or studying in a group? Why?',
    10, 30
  ),
  (
    v_set_id, 4, 'Part 2: Solution Discussion',
    'Situation: You and your close friends want to celebrate passing an exam. You have three choices: eating at a restaurant, going to the cinema, or having a picnic in a park. Which option do you choose and why?',
    45, 60
  ),
  (
    v_set_id, 5, 'Part 3: Topic Development',
    'Topic: Reading books brings many benefits to young people. Discuss why reading books is good for you.',
    45, 90
  );

  -- ============================================================================
  -- 2. BỘ ĐỀ 2: IELTS SPEAKING GIAO TIẾP TỰ NHIÊN (Band 6.0 - 6.5)
  -- ============================================================================
  insert into public.question_sets (teacher_id, title, description, level, exam_type, time_limit, is_published)
  values (
    v_teacher_id,
    'IELTS Speaking Giao Tiếp Tự Nhiên (Band 6.0 - 6.5)',
    'Các chủ đề quen thuộc trong IELTS Speaking: Nơi ở, du lịch, người truyền cảm hứng và lợi ích của tiếng Anh.',
    'intermediate',
    'ielts',
    12,
    true
  ) returning id into v_set_id;

  insert into public.questions (set_id, order_num, part_title, question_text, prep_time, response_time)
  values
  (
    v_set_id, 1, 'Part 1: Accommodation',
    'Do you live in a house or an apartment? What do you like most about your home?',
    5, 30
  ),
  (
    v_set_id, 2, 'Part 1: Travel & Holidays',
    'Do you like traveling? What place would you like to visit on your next holiday?',
    5, 30
  ),
  (
    v_set_id, 3, 'Part 2: Long Turn (Cue Card)',
    'Describe a person you admire (a friend, teacher, or family member). You should say: who this person is, how you know them, and explain why you admire them.',
    60, 90
  ),
  (
    v_set_id, 4, 'Part 3: Discussion',
    'Why is learning English important for young people in the modern world?',
    10, 45
  );

  -- ============================================================================
  -- 3. BỘ ĐỀ 3: TOEIC SPEAKING CĂN BẢN (Đọc & Phản xạ nhanh)
  -- ============================================================================
  insert into public.question_sets (teacher_id, title, description, level, exam_type, time_limit, is_published)
  values (
    v_teacher_id,
    'TOEIC Speaking Căn Bản (Đọc & Phản xạ nhanh)',
    'Định dạng chuẩn TOEIC Speaking với các đoạn đọc ngắn, miêu tả bức tranh đơn giản và trả lời câu hỏi công sở thường gặp.',
    'beginner',
    'toeic',
    15,
    true
  ) returning id into v_set_id;

  insert into public.questions (set_id, order_num, part_title, question_text, prep_time, response_time)
  values
  (
    v_set_id, 1, 'Q1-2: Read a Text Aloud',
    'Welcome to Green Cafe. We offer fresh coffee, fruit smoothies, and homemade pastries. Please place your order at the counter. Thank you and have a wonderful day.',
    45, 45
  ),
  (
    v_set_id, 2, 'Q1-2: Read a Text Aloud',
    'Attention passengers. Flight VN 254 to Hanoi is now ready for boarding at Gate number 5. Please have your boarding pass and passport ready. Thank you.',
    45, 45
  ),
  (
    v_set_id, 3, 'Q3: Describe a Picture',
    'Describe the picture: Two people are sitting at a table in a modern cafe, drinking coffee and talking happily.',
    45, 30
  ),
  (
    v_set_id, 4, 'Q5-6: Respond to Questions',
    'What is your favorite dish, and how often do you eat it?',
    3, 15
  ),
  (
    v_set_id, 5, 'Q11: Express an Opinion',
    'Do you prefer working from home or working in an office? Why?',
    30, 45
  );

  -- ============================================================================
  -- 4. BỘ ĐỀ 4: TIẾNG ANH GIAO TIẾP HÀNG NGÀY (Dễ thực hành)
  -- ============================================================================
  insert into public.question_sets (teacher_id, title, description, level, exam_type, time_limit, is_published)
  values (
    v_teacher_id,
    'Tiếng Anh Giao Tiếp Hàng Ngày (Dễ thực hành)',
    'Các câu hỏi quen thuộc về thói quen buổi sáng, thời tiết, kế hoạch cuối tuần và phương pháp tự học tiếng Anh.',
    'beginner',
    'general',
    0,
    true
  ) returning id into v_set_id;

  insert into public.questions (set_id, order_num, part_title, question_text, prep_time, response_time)
  values
  (
    v_set_id, 1, 'Daily Routine',
    'What time do you usually wake up in the morning, and what is the first thing you do?',
    15, 30
  ),
  (
    v_set_id, 2, 'Weather & Seasons',
    'How is the weather today, and which season of the year do you like best?',
    15, 30
  ),
  (
    v_set_id, 3, 'Weekend Activities',
    'What are you planning to do this weekend?',
    15, 30
  ),
  (
    v_set_id, 4, 'Learning English',
    'How do you practice speaking English every day?',
    15, 30
  );

end $$;
