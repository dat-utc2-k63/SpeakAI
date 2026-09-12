-- ==============================================================================
-- SpeakAI Web Platform - Complete Database Schema
-- Project: SpeakAI (https://kngkckshvgaqeiatryqy.supabase.co)
-- Version: 2.0 (Dual-mode Practice & Exam: VSTEP / TOEIC / IELTS / General)
-- Instructions: Run this entire script in Supabase SQL Editor to set up schema.
-- ==============================================================================

-- ==============================================================================
-- 1. EXTENSIONS
-- ==============================================================================
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ==============================================================================
-- 2. CORE TABLES
-- ==============================================================================

-- 2.1. TABLE: profiles
-- Lưu thông tin tài khoản người dùng (Admin, Giáo viên, Học viên) và mẫu giọng nói (voice enrollment)
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade not null primary key,
  role text not null check (role in ('admin', 'teacher', 'student')),
  full_name text not null,
  email text not null,
  phone text,
  voice_sample_url text,
  voice_embeddings jsonb,
  voice_enrolled boolean default false,
  teacher_id uuid references public.profiles(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2.2. TABLE: assessments
-- Lưu lịch sử chấm điểm hội thoại (2 người nói - Two Speaker Diarization), transcript Whisper, điểm số và phản hồi
create table if not exists public.assessments (
  id uuid default gen_random_uuid() primary key,
  teacher_id uuid references public.profiles(id) on delete set null,
  student_id uuid references public.profiles(id) on delete cascade,
  audio_url text,
  status text default 'pending',
  score_total double precision,
  score_accuracy double precision,
  score_fluency double precision,
  score_prosodic double precision,
  result_json jsonb,
  llm_feedback text,
  saved boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2.3. TABLE: global_settings
-- Lưu cấu hình hệ thống dùng chung (ví dụ URL backend GPU / Cloudflare Tunnel)
create table if not exists public.global_settings (
  id integer primary key default 1,
  api_url text,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

insert into public.global_settings (id, api_url)
values (1, '')
on conflict (id) do nothing;

-- 2.4. TABLE: question_sets
-- Bộ đề thi / luyện tập speaking do Giáo viên tạo (hỗ trợ VSTEP, TOEIC, IELTS, General)
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

-- 2.5. TABLE: questions
-- Chi tiết từng câu hỏi speaking trong bộ đề kèm thời gian chuẩn bị & trả lời
create table if not exists public.questions (
  id uuid default gen_random_uuid() primary key,
  set_id uuid references public.question_sets(id) on delete cascade not null,
  order_num integer not null default 1,
  part_title text, -- ví dụ: "Part 1: Social Interaction", "Q1-2: Read Aloud"
  question_text text not null,
  reference_text text, -- Câu trả lời mẫu phát âm chuẩn
  hint text, -- Gợi ý từ vựng / cấu trúc trả lời
  prep_time integer default 15, -- thời gian chuẩn bị (giây) cho Exam mode
  response_time integer default 45, -- thời gian trả lời tối đa (giây) cho Exam mode
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2.6. TABLE: practice_sessions
-- Phiên luyện tập (Practice) hoặc thi thử (Exam Mock Test) của Học viên
create table if not exists public.practice_sessions (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references public.profiles(id) on delete cascade not null,
  set_id uuid references public.question_sets(id) on delete cascade not null,
  mode text check (mode in ('practice', 'exam')) default 'practice', -- 'practice' (luyện tự do) | 'exam' (thi chuẩn)
  status text default 'in_progress' check (status in ('in_progress', 'completed', 'reviewed')),
  score_total double precision,
  score_accuracy double precision,
  score_fluency double precision,
  score_prosodic double precision,
  exam_band text, -- Quy đổi Band điểm chuẩn (ví dụ: "VSTEP B2", "IELTS Band 6.5", "TOEIC 160")
  started_at timestamp with time zone default timezone('utc'::text, now()) not null,
  completed_at timestamp with time zone
);

-- 2.7. TABLE: practice_answers
-- Bài ghi âm và kết quả chấm điểm từng câu hỏi đơn lẻ (Single-speaker fast path)
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
-- 3. MIGRATION NÂNG CẤP AN TOÀN (Safe Column Alters)
-- ==============================================================================
alter table public.question_sets add column if not exists exam_type text check (exam_type in ('general', 'vstep', 'toeic', 'ielts')) default 'general';
alter table public.question_sets add column if not exists time_limit integer default 0;

alter table public.questions add column if not exists part_title text;
alter table public.questions add column if not exists prep_time integer default 15;
alter table public.questions add column if not exists response_time integer default 45;

alter table public.practice_sessions add column if not exists mode text check (mode in ('practice', 'exam')) default 'practice';
alter table public.practice_sessions add column if not exists exam_band text;

-- ==============================================================================
-- 4. STORAGE BUCKET: speakai-audio
-- ==============================================================================
insert into storage.buckets (id, name, public)
values ('speakai-audio', 'speakai-audio', true)
on conflict (id) do update set public = true;

-- ==============================================================================
-- 5. INDEXES TỐI ƯU HIỆU SUẤT TRUY VẤN
-- ==============================================================================
create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_profiles_email on public.profiles(email);
create index if not exists idx_profiles_teacher_id on public.profiles(teacher_id);

create index if not exists idx_assessments_student_id on public.assessments(student_id);
create index if not exists idx_assessments_teacher_id on public.assessments(teacher_id);
create index if not exists idx_assessments_created_at on public.assessments(created_at desc);
create index if not exists idx_assessments_saved on public.assessments(saved);

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

-- ==============================================================================
-- 6. ROW LEVEL SECURITY (RLS) & ACCESS POLICIES
-- ==============================================================================
alter table public.profiles enable row level security;
alter table public.assessments enable row level security;
alter table public.global_settings enable row level security;
alter table public.question_sets enable row level security;
alter table public.questions enable row level security;
alter table public.practice_sessions enable row level security;
alter table public.practice_answers enable row level security;

-- 6.1. Policies: profiles
drop policy if exists "Public profiles are viewable by authenticated users" on public.profiles;
create policy "Public profiles are viewable by authenticated users"
  on public.profiles for select
  using (true);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id or auth.role() = 'anon');

drop policy if exists "Users can update own profile or admin can update all" on public.profiles;
create policy "Users can update own profile or admin can update all"
  on public.profiles for update
  using (
    auth.uid() = id 
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "Admin or owner can delete profiles" on public.profiles;
create policy "Admin or owner can delete profiles"
  on public.profiles for delete
  using (
    auth.uid() = id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- 6.2. Policies: assessments
drop policy if exists "Assessments viewable by student, teacher or admin" on public.assessments;
create policy "Assessments viewable by student, teacher or admin"
  on public.assessments for select
  using (
    auth.uid() = student_id
    or auth.uid() = teacher_id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    or auth.role() = 'anon'
  );

drop policy if exists "Authenticated users can insert assessments" on public.assessments;
create policy "Authenticated users can insert assessments"
  on public.assessments for insert
  with check (true);

drop policy if exists "Teacher, student or admin can update assessments" on public.assessments;
create policy "Teacher, student or admin can update assessments"
  on public.assessments for update
  using (
    auth.uid() = student_id
    or auth.uid() = teacher_id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "Teacher or admin can delete assessments" on public.assessments;
create policy "Teacher or admin can delete assessments"
  on public.assessments for delete
  using (
    auth.uid() = teacher_id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- 6.3. Policies: global_settings
drop policy if exists "Allow select global_settings for all" on public.global_settings;
create policy "Allow select global_settings for all"
  on public.global_settings for select
  using (true);

drop policy if exists "Allow update global_settings for admin and authenticated" on public.global_settings;
create policy "Allow update global_settings for admin and authenticated"
  on public.global_settings for all
  using (true)
  with check (true);

-- 6.4. Policies: question_sets (Giáo viên có thể xem và tùy chỉnh bộ đề của nhau, bảo toàn quyền tác giả)
drop policy if exists "Teacher manages own question sets" on public.question_sets;
drop policy if exists "Teachers and admins manage all question sets" on public.question_sets;
drop policy if exists "Students can view published question sets" on public.question_sets;

create policy "Teachers and admins manage all question sets"
  on public.question_sets for all
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
  );

create policy "Students can view published question sets"
  on public.question_sets for select
  using (is_published = true);

-- 6.5. Policies: questions (Giáo viên quản lý toàn bộ câu hỏi trong các bộ đề)
drop policy if exists "Questions follow parent set access" on public.questions;
drop policy if exists "Teacher manages questions in own sets" on public.questions;
drop policy if exists "Teachers manage all questions" on public.questions;
drop policy if exists "Students can view published questions" on public.questions;

create policy "Teachers manage all questions"
  on public.questions for all
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
  );

create policy "Students can view published questions"
  on public.questions for select
  using (
    exists (
      select 1 from public.question_sets qs
      where qs.id = set_id and qs.is_published = true
    )
  );

-- 6.6. Policies: practice_sessions
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

-- 6.7. Policies: practice_answers
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

-- 6.8. Storage Policies: speakai-audio
drop policy if exists "Allow public read access on speakai-audio" on storage.objects;
create policy "Allow public read access on speakai-audio"
  on storage.objects for select
  using (bucket_id = 'speakai-audio');

drop policy if exists "Allow upload to speakai-audio" on storage.objects;
create policy "Allow upload to speakai-audio"
  on storage.objects for insert
  with check (bucket_id = 'speakai-audio');

drop policy if exists "Allow update on speakai-audio" on storage.objects;
create policy "Allow update on speakai-audio"
  on storage.objects for update
  using (bucket_id = 'speakai-audio');

drop policy if exists "Allow delete on speakai-audio" on storage.objects;
create policy "Allow delete on speakai-audio"
  on storage.objects for delete
  using (bucket_id = 'speakai-audio');
