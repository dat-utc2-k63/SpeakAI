-- ==============================================================================
-- SpeakAI Web Platform - Seed Data (Bộ đề & Câu hỏi luyện tập / thi thử mẫu)
-- Project: SpeakAI (https://kngkckshvgaqeiatryqy.supabase.co)
-- Formats: VSTEP (B1-B2-C1), IELTS (Band 7.0+), TOEIC Speaking, General English
-- Instructions: Run this script in Supabase SQL Editor AFTER running speak_web_schema.sql.
-- Note: Tự động gán cho Giáo viên đầu tiên trong hệ thống, chống trùng lặp khi chạy lại.
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

  -- ============================================================================
  -- 1. BỘ ĐỀ 1: VSTEP SPEAKING (B1 - B2 - C1)
  -- ============================================================================
  if not exists (select 1 from public.question_sets where title = 'Đề thi thử VSTEP Speaking B1-B2-C1 (Đề chuẩn số 1)') then
    insert into public.question_sets (teacher_id, title, description, level, exam_type, time_limit, is_published)
    values (
      v_teacher_id,
      'Đề thi thử VSTEP Speaking B1-B2-C1 (Đề chuẩn số 1)',
      'Đề thi chuẩn cấu trúc VSTEP Speaking gồm 3 phần: Tương tác xã hội (Part 1), Thảo luận giải pháp (Part 2), và Phát triển chủ đề (Part 3).',
      'intermediate',
      'vstep',
      12,
      true
    ) returning id into v_set_id;

    insert into public.questions (set_id, order_num, part_title, question_text, prep_time, response_time, hint, reference_text)
    values
    (
      v_set_id, 1, 'Part 1: Social Interaction',
      'Let''s talk about your hometown. Where is your hometown located, and what is it most famous for?',
      10, 30,
      'Nêu vị trí địa lý, đặc sản, danh lam thắng cảnh hoặc nét văn hóa đặc trưng. Dùng các từ như: situated in, renowned for, bustling, tranquil atmosphere.',
      'I was born and raised in Da Nang, a vibrant coastal city located in central Vietnam. It is renowned for its stunning sandy beaches, the iconic Dragon Bridge, and hospitable people. It is widely considered one of the most livable cities in our country.'
    ),
    (
      v_set_id, 2, 'Part 1: Social Interaction',
      'What do you like most about living in your city or hometown?',
      10, 30,
      'Nêu 1-2 điểm bạn yêu thích: con người thân thiện, đồ ăn ngon, không khí trong lành, chi phí hợp lý. Cấu trúc: What appeals to me most is..., Another great aspect is...',
      'What appeals to me most is the harmonious balance between modern infrastructure and natural scenery. The local residents are exceptionally warm-hearted, and the seafood here is both fresh and affordable.'
    ),
    (
      v_set_id, 3, 'Part 1: Social Interaction',
      'Let''s talk about hobbies. How do you usually spend your weekends or free time?',
      10, 30,
      'Nêu hoạt động giải trí (đọc sách, thể thao, nghe nhạc, đi cà phê với bạn bè) và lý do. Dùng: unwind, recharge my batteries, quality time.',
      'In my spare time, I usually play badminton with my colleagues to stay in shape. On Sunday afternoons, I enjoy reading personal development books at a quiet coffee shop to recharge my batteries after a demanding work week.'
    ),
    (
      v_set_id, 4, 'Part 2: Solution Discussion',
      'Situation: You are planning a two-day weekend getaway with your close friends. There are three options: going to a beach resort, camping in a national park, or visiting a historic mountain town. Which option do you think is best, and why do you reject the other two?',
      60, 90,
      'Cấu trúc 3 bước: 1) Chọn phương án tốt nhất & đưa ra 2 lý do; 2) Bác bỏ 2 phương án còn lại (quá đông đúc, tốn kém, hoặc thiếu an toàn); 3) Kết luận ngắn gọn.',
      'Among the three suggested options, I firmly believe that camping in a national park is the most suitable choice for our weekend trip. Firstly, it provides a fantastic opportunity for us to immerse ourselves in nature and strengthen our friendship through outdoor activities like setting up tents and cooking barbecues. Secondly, camping is remarkably cost-effective compared to staying at a luxury beach resort, which can be overcrowded and expensive during peak seasons. As for the historic mountain town, while culturally enriching, the long traveling distance would make a two-day trip exhausting. Therefore, camping is the ideal plan for our group.'
    ),
    (
      v_set_id, 5, 'Part 3: Topic Development',
      'Topic: Online learning has revolutionized modern education. Discuss its benefits in terms of flexibility, access to quality resources, and cost reduction. You may also add your own idea.',
      60, 120,
      'Mở bài nêu luận điểm. Phát triển 3 ý chính với từ nối: First and foremost (linh hoạt thời gian/không gian), Furthermore (tiếp cận tài liệu toàn cầu), In addition (tiết kiệm chi phí đi lại/học phí). Kết bài tóm tắt.',
      'It is undeniable that online learning has transformed the landscape of modern education in profound ways. First and foremost, the greatest advantage lies in its unmatched flexibility. Students can easily tailor their study schedules around work and family commitments, attending lectures at their own pace from anywhere in the world. Furthermore, e-learning democratizes education by granting learners direct access to top-tier academic resources and distinguished professors from prestigious global universities. In addition, online courses substantially diminish expenses such as commuting, campus accommodation, and printed textbooks. Ultimately, by combining cost efficiency with accessibility, digital learning empowers lifelong education for everyone.'
    ),
    (
      v_set_id, 6, 'Part 3: Follow-up Question',
      'Do you think artificial intelligence and online learning will completely replace traditional teachers and schools in the coming decades?',
      15, 45,
      'Khẳng định quan điểm (AI hỗ trợ đắc lực nhưng không thay thế hoàn toàn được yếu tố cảm xúc, truyền cảm hứng và kỹ năng xã hội).',
      'In my view, while artificial intelligence will certainly reshape the educational environment, it can never entirely replace human teachers. Teaching is not merely about transferring information; it involves empathy, ethical guidance, and motivating students. An AI system cannot replicate the emotional connection and personal encouragement that an inspirational teacher brings to the classroom.'
    );
  end if;

  -- ============================================================================
  -- 2. BỘ ĐỀ 2: IELTS SPEAKING (Band 7.0+ Target)
  -- ============================================================================
  if not exists (select 1 from public.question_sets where title = 'IELTS Speaking Simulation Test (Band 7.0+ Target)') then
    insert into public.question_sets (teacher_id, title, description, level, exam_type, time_limit, is_published)
    values (
      v_teacher_id,
      'IELTS Speaking Simulation Test (Band 7.0+ Target)',
      'Bài thi thử toàn diện theo chuẩn Cambridge IELTS với đầy đủ 3 phần: Part 1 (Q&A), Part 2 (Long Turn Cue Card 2 phút), và Part 3 (Thảo luận chuyên sâu 2 chiều).',
      'advanced',
      'ielts',
      14,
      true
    ) returning id into v_set_id;

    insert into public.questions (set_id, order_num, part_title, question_text, prep_time, response_time, hint, reference_text)
    values
    (
      v_set_id, 1, 'Part 1: Work & Studies',
      'Do you currently work or are you studying? What motivated you to choose this field?',
      5, 30,
      'Nêu chuyên ngành / công việc hiện tại và niềm đam mê hoặc cơ hội phát triển nghề nghiệp.',
      'Currently, I am working as a software developer at an international tech firm. What genuinely inspired me to pursue this career is the creative problem-solving aspect; creating practical applications that simplify people''s daily lives is immensely rewarding.'
    ),
    (
      v_set_id, 2, 'Part 1: Transportation',
      'How do you usually commute to work or school, and what could be done to improve public transit in your city?',
      5, 30,
      'Phương tiện thường dùng, ưu nhược điểm, và đề xuất (tăng chuyến, metro, giá vé ưu đãi).',
      'I commute primarily by motorbike due to its agility during rush hours. However, to relieve urban traffic congestion, the municipal government should invest heavily in expanding the subway network and making bus schedules more punctual.'
    ),
    (
      v_set_id, 3, 'Part 2: Long Turn (Cue Card)',
      'Describe an environmental initiative or project in your area that you believe is effective. You should say: what the project is, who is involved, how it works, and explain why you consider it effective.',
      60, 120,
      'Bám sát 4 gợi ý trong Cue Card. Dùng từ vựng C1: grassroots movement, circular economy, raise environmental consciousness, tangible impact.',
      'I would like to talk about a community-led initiative called ''Green Neighborhood'' that was launched in my district last year. It is a grassroots campaign organized by young environmental volunteers alongside local residential committees. The core mechanism involves establishing neighborhood recycling hubs where citizens can trade sorted plastic waste and discarded electronics for potted plants and organic grocery vouchers. What makes this initiative exceptionally successful is that it incentivizes sustainable behavior rather than merely lecturing people. Within six months, the program has diverted tons of non-biodegradable waste from landfills and cultivated a palpable sense of eco-responsibility across all generations.'
    ),
    (
      v_set_id, 4, 'Part 3: Environmental Policies',
      'To what extent should governments penalize corporations that pollute the environment versus rewarding eco-friendly businesses?',
      15, 60,
      'Phân tích cả 2 khía cạnh: cây gậy (phạt nặng để răn đe) và củ cà rốt (ưu đãi thuế để khuyến khích đầu tư xanh).',
      'I believe governments ought to strike a judicious balance between punitive measures and positive incentives. On one hand, enforcing heavy carbon taxes and stringent fines is crucial to deter negligent corporations from treating nature as an unpaid waste dump. On the other hand, granting subsidies and tax exemptions to green startups stimulates innovation in renewable energy and sustainable manufacturing.'
    ),
    (
      v_set_id, 5, 'Part 3: Global Cooperation',
      'Do you believe developing nations should adhere to the same carbon reduction targets as industrialized countries?',
      15, 60,
      'Đề cập đến nguyên tắc trách nhiệm chung nhưng có phân hóa (historical emissions, economic capability, technology transfer).',
      'From my perspective, the principle of ''common but differentiated responsibilities'' must be respected. Industrialized nations have historically contributed the lion''s share of cumulative greenhouse emissions, so they possess greater financial and technological capability to decarbonize rapidly. While developing nations must also curb emissions, developed countries have a moral duty to provide technological transfer and climate financing.'
    );
  end if;

  -- ============================================================================
  -- 3. BỘ ĐỀ 3: TOEIC SPEAKING (ETS Simulator)
  -- ============================================================================
  if not exists (select 1 from public.question_sets where title = 'TOEIC Speaking Official Test Format (ETS Simulator)') then
    insert into public.question_sets (teacher_id, title, description, level, exam_type, time_limit, is_published)
    values (
      v_teacher_id,
      'TOEIC Speaking Official Test Format (ETS Simulator)',
      'Mô phỏng bài thi TOEIC Speaking thực tế của ETS bao gồm: Đọc đoạn văn (Read Aloud), Miêu tả tranh (Describe a Picture), Trả lời câu hỏi nhanh và Trình bày quan điểm (Express Opinion).',
      'intermediate',
      'toeic',
      20,
      true
    ) returning id into v_set_id;

    insert into public.questions (set_id, order_num, part_title, question_text, prep_time, response_time, hint, reference_text)
    values
    (
      v_set_id, 1, 'Q1-2: Read a Text Aloud',
      'Attention, valued shoppers. Welcome to Metro Department Store''s annual summer clearance sale. Today only, enjoy discounts of up to fifty percent on all designer clothing, footwear, and home accessories on the third floor. Customer service representatives are available to assist you near the main entrance.',
      45, 45,
      'Phát âm rõ ràng, ngắt nghỉ đúng chỗ, chú ý ngữ điệu liệt kê (lên giọng ở các mục đầu, xuống giọng ở mục cuối).',
      'Attention, valued shoppers. Welcome to Metro Department Store''s annual summer clearance sale. Today only, enjoy discounts of up to fifty percent on all designer clothing, footwear, and home accessories on the third floor. Customer service representatives are available to assist you near the main entrance.'
    ),
    (
      v_set_id, 2, 'Q1-2: Read a Text Aloud',
      'Good morning, this is Sarah Jenkins with your local traffic update on Metro Radio. Highway 101 north is experiencing heavy congestion due to ongoing road maintenance near exit 24. Commuters traveling toward downtown are advised to use alternative routes such as Maple Avenue to avoid delays.',
      45, 45,
      'Đọc to rõ ràng, nhấn trọng âm các từ khóa: traffic update, heavy congestion, road maintenance, alternative routes.',
      'Good morning, this is Sarah Jenkins with your local traffic update on Metro Radio. Highway 101 north is experiencing heavy congestion due to ongoing road maintenance near exit 24. Commuters traveling toward downtown are advised to use alternative routes such as Maple Avenue to avoid delays.'
    ),
    (
      v_set_id, 3, 'Q3-4: Describe a Picture',
      'Describe the picture: A modern office conference room where four business professionals are sitting around a wooden table. A woman in a navy blazer is presenting a quarterly sales chart on a large digital monitor.',
      45, 30,
      'Cấu trúc: In this picture, I can see..., In the center..., On the left/right..., In the background..., Overall, it seems like...',
      'This picture captures a collaborative meeting inside a modern conference room. In the center, a professional woman in a navy suit is standing beside a large digital monitor, gesturing toward a sales chart. Three colleagues are seated around a wooden table, taking notes on their laptops and listening attentively. The room is brightly lit with large glass windows in the background.'
    ),
    (
      v_set_id, 4, 'Q5-7: Respond to Questions',
      'How often do you dine out at restaurants, and what kind of cuisine do you enjoy most?',
      3, 15,
      'Trả lời trực tiếp tần suất (once or twice a week) và loại món ăn yêu thích kèm 1 lý do ngắn gọn.',
      'I typically dine out about twice a week with my friends. I am particularly fond of Japanese cuisine, especially sushi and ramen, because the ingredients are fresh and beautifully presented.'
    ),
    (
      v_set_id, 5, 'Q5-7: Respond to Questions',
      'If a new shopping mall opened near your home, what store or facility would you visit first, and why?',
      3, 30,
      'Nêu cơ sở muốn đến (bookstore, supermarket, cinema, gym) và đưa ra 2 lý do chi tiết.',
      'If a new shopping center opened in my neighborhood, the first place I would check out is definitely the bookstore. I love browsing the latest bestseller releases in a quiet ambiance, and it is a wonderful place to purchase stationery and gifts.'
    ),
    (
      v_set_id, 6, 'Q11: Express an Opinion',
      'Do you agree or disagree with the following statement: ''Companies should encourage all employees to take frequent short breaks during the workday to boost overall productivity''? Support your opinion with specific reasons.',
      45, 60,
      'Khẳng định đồng ý: 1) Giảm căng thẳng và mỏi mắt; 2) Duy trì sự tỉnh táo và khả năng sáng tạo; 3) Ngăn ngừa kiệt sức (burnout).',
      'I wholeheartedly agree that companies should encourage employees to take short, regular breaks throughout the day. First, prolonged periods of staring at computer screens cause severe eye strain and mental fatigue, which inadvertently leads to careless mistakes. Stepping away for five minutes allows the brain to rest and refocus. Second, brief breaks stimulate creativity; some of our best ideas emerge when we are not under immediate pressure. In the long run, this practice prevents burnout and fosters a much healthier, more productive working culture.'
    );
  end if;

  -- ============================================================================
  -- 4. BỘ ĐỀ 4: GENERAL ENGLISH (Daily English Mastery)
  -- ============================================================================
  if not exists (select 1 from public.question_sets where title = 'Giao tiếp & Luyện phát âm chuẩn Mỹ (Daily English Mastery)') then
    insert into public.question_sets (teacher_id, title, description, level, exam_type, time_limit, is_published)
    values (
      v_teacher_id,
      'Giao tiếp & Luyện phát âm chuẩn Mỹ (Daily English Mastery)',
      'Bộ câu hỏi rèn luyện phản xạ phát âm chuẩn IPA, ngữ điệu tự nhiên và trôi chảy trong các tình huống giao tiếp đời sống hàng ngày.',
      'beginner',
      'general',
      0,
      true
    ) returning id into v_set_id;

    insert into public.questions (set_id, order_num, part_title, question_text, prep_time, response_time, hint, reference_text)
    values
    (
      v_set_id, 1, 'Personal Introduction',
      'Introduce yourself: What is your name, where do you live, and what is something unique about you?',
      15, 45,
      'Giới thiệu tên, nơi ở, tính cách hoặc sở thích đặc biệt.',
      'Hello, my name is Alex. I currently reside in Hanoi, the historic capital of Vietnam. Something unique about me is my passion for landscape photography; I love waking up at dawn on weekends to capture the morning mist over West Lake.'
    ),
    (
      v_set_id, 2, 'Favorite Books & Movies',
      'Tell me about a movie or book that left a deep impression on you. Why did you find it so memorable?',
      15, 45,
      'Nêu tên tác phẩm, nội dung tóm tắt trong 1 câu, và bài học cuộc sống hoặc cảm xúc đọng lại.',
      'One movie that left an indelible impression on me is ''The Pursuit of Happyness'' starring Will Smith. It chronicles a father''s relentless determination to build a decent life for his son despite extreme poverty. It taught me that perseverance and resilience can conquer life''s harshest adversities.'
    ),
    (
      v_set_id, 3, 'Overcoming Challenges',
      'Describe a difficult challenge you faced recently and how you managed to overcome it.',
      15, 60,
      'Nêu khó khăn (áp lực công việc, học ngoại ngữ, cân bằng thời gian), giải pháp đã thực hiện và bài học rút ra.',
      'Recently, I struggled with public speaking anxiety when I had to deliver a project presentation to senior executives. To overcome this fear, I rehearsed in front of a mirror repeatedly and practiced deep breathing techniques right before going on stage. Ultimately, the presentation was a resounding success, proving that thorough preparation is the ultimate antidote to self-doubt.'
    );
  end if;

end $$;
