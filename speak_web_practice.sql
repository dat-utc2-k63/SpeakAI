-- ==============================================================================
-- SpeakAI Web Platform - Speaking Practice & Exam (VSTEP / TOEIC / IELTS) Migration
-- Run this in Supabase SQL Editor
-- ==============================================================================

-- 1. TABLE: question_sets
-- Bộ đề thi / luyện tập speaking do Teacher tạo
create table if not exists public.question_sets (
  id uuid default gen_random_uuid() primary key,
  teacher_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  description text,
  level text check (level in ('beginner', 'intermediate', 'advanced')) default 'intermediate',
  exam_type text check (exam_type in ('general', 'vstep', 'toeic', 'ielts')) default 'general',
  time_limit integer default 0, -- tổng thời gian (phút), 0 = không giới hạn
  is_published boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. TABLE: questions
-- Câu hỏi speaking trong bộ đề
create table if not exists public.questions (
  id uuid default gen_random_uuid() primary key,
  set_id uuid references public.question_sets(id) on delete cascade not null,
  order_num integer not null default 1,
  part_title text, -- ví dụ: "Part 1: Social Interaction", "Q1-2: Read Aloud"
  question_text text not null,
  reference_text text,
  hint text,
  prep_time integer default 15, -- thời gian chuẩn bị (giây) cho Exam mode
  response_time integer default 45, -- thời gian trả lời tối đa (giây) cho Exam mode
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. TABLE: practice_sessions
-- Phiên luyện tập hoặc thi thử của Student
create table if not exists public.practice_sessions (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references public.profiles(id) on delete cascade not null,
  set_id uuid references public.question_sets(id) on delete cascade not null,
  mode text check (mode in ('practice', 'exam')) default 'practice', -- 'practice' (luyện tập tự do) | 'exam' (thi thử có tính giờ)
  status text default 'in_progress' check (status in ('in_progress', 'completed', 'reviewed')),
  score_total double precision,
  score_accuracy double precision,
  score_fluency double precision,
  score_prosodic double precision,
  exam_band text, -- Band điểm quy đổi (ví dụ: "VSTEP B2", "IELTS Band 6.5", "TOEIC 150")
  started_at timestamp with time zone default timezone('utc'::text, now()) not null,
  completed_at timestamp with time zone
);

-- 4. TABLE: practice_answers
-- Bài ghi âm trả lời từng câu hỏi
create table if not exists public.practice_answers (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references public.practice_sessions(id) on delete cascade not null,
  question_id uuid references public.questions(id) on delete cascade not null,
  audio_url text,
  transcript text,
  score_total double precision,
  score_accuracy double precision,
  score_fluency double precision,
  score_prosodic double precision,
  result_json jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ==============================================================================
-- Cập nhật cột nếu bảng đã tồn tại từ trước (Safe ALTER TABLE)
-- ==============================================================================
alter table public.question_sets add column if not exists exam_type text check (exam_type in ('general', 'vstep', 'toeic', 'ielts')) default 'general';
alter table public.question_sets add column if not exists time_limit integer default 0;

alter table public.questions add column if not exists part_title text;
alter table public.questions add column if not exists prep_time integer default 15;
alter table public.questions add column if not exists response_time integer default 45;

alter table public.practice_sessions add column if not exists mode text check (mode in ('practice', 'exam')) default 'practice';
alter table public.practice_sessions add column if not exists exam_band text;

-- 5. INDEXES
create index if not exists idx_question_sets_teacher_id on public.question_sets(teacher_id);
create index if not exists idx_question_sets_published on public.question_sets(is_published);
create index if not exists idx_question_sets_level on public.question_sets(level);
create index if not exists idx_question_sets_exam_type on public.question_sets(exam_type);
create index if not exists idx_questions_set_id on public.questions(set_id);
create index if not exists idx_questions_order on public.questions(set_id, order_num);
create index if not exists idx_practice_sessions_student on public.practice_sessions(student_id);
create index if not exists idx_practice_sessions_set on public.practice_sessions(set_id);
create index if not exists idx_practice_sessions_mode on public.practice_sessions(mode);
create index if not exists idx_practice_sessions_status on public.practice_sessions(status);
create index if not exists idx_practice_answers_session on public.practice_answers(session_id);
create index if not exists idx_practice_answers_question on public.practice_answers(question_id);

-- 6. ROW LEVEL SECURITY (RLS)
alter table public.question_sets enable row level security;
alter table public.questions enable row level security;
alter table public.practice_sessions enable row level security;
alter table public.practice_answers enable row level security;

-- Policies: question_sets
drop policy if exists "Teacher manages own question sets" on public.question_sets;
create policy "Teacher manages own question sets"
  on public.question_sets for all
  using (
    auth.uid() = teacher_id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    auth.uid() = teacher_id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "Students can view published question sets" on public.question_sets;
create policy "Students can view published question sets"
  on public.question_sets for select
  using (is_published = true);

-- Policies: questions
drop policy if exists "Questions follow parent set access" on public.questions;
create policy "Questions follow parent set access"
  on public.questions for select
  using (
    exists (
      select 1 from public.question_sets qs
      where qs.id = set_id
      and (qs.teacher_id = auth.uid() or qs.is_published = true
           or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
    )
  );

drop policy if exists "Teacher manages questions in own sets" on public.questions;
create policy "Teacher manages questions in own sets"
  on public.questions for all
  using (
    exists (
      select 1 from public.question_sets qs
      where qs.id = set_id
      and (qs.teacher_id = auth.uid()
           or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
    )
  )
  with check (
    exists (
      select 1 from public.question_sets qs
      where qs.id = set_id
      and (qs.teacher_id = auth.uid()
           or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
    )
  );

-- Policies: practice_sessions
drop policy if exists "Students manage own practice sessions" on public.practice_sessions;
create policy "Students manage own practice sessions"
  on public.practice_sessions for all
  using (auth.uid() = student_id)
  with check (auth.uid() = student_id);

drop policy if exists "Teachers can view practice sessions of their students" on public.practice_sessions;
create policy "Teachers can view practice sessions of their students"
  on public.practice_sessions for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = student_id and p.teacher_id = auth.uid()
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Policies: practice_answers
drop policy if exists "Students manage own practice answers" on public.practice_answers;
create policy "Students manage own practice answers"
  on public.practice_answers for all
  using (
    exists (
      select 1 from public.practice_sessions ps
      where ps.id = session_id and ps.student_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.practice_sessions ps
      where ps.id = session_id and ps.student_id = auth.uid()
    )
  );

drop policy if exists "Teachers can view practice answers of their students" on public.practice_answers;
create policy "Teachers can view practice answers of their students"
  on public.practice_answers for select
  using (
    exists (
      select 1 from public.practice_sessions ps
      join public.profiles p on p.id = ps.student_id
      where ps.id = session_id
      and (p.teacher_id = auth.uid()
           or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
    )
  );
