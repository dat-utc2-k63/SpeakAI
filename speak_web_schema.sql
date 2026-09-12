-- ==============================================================================
-- SpeakAI Web Platform - Complete Database Schema (Latest from Supabase)
-- Project: SpeakAI (https://kngkckshvgaqeiatryqy.supabase.co)
-- Version: 2.1 (Sync with Supabase Live DB - Gemini 3.7 Flash Evaluation & Dual Mode)
-- Hướng dẫn: Toàn bộ bảng, cột, storage và quyền hạn được đồng bộ chuẩn xác 100%.
-- ==============================================================================

-- ==============================================================================
-- 1. EXTENSIONS
-- ==============================================================================
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ==============================================================================
-- 2. CORE TABLES & COLUMNS
-- ==============================================================================

-- 2.1. TABLE: profiles
-- Thông tin tài khoản người dùng (Admin, Giáo viên, Học viên) và mẫu giọng nói
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
-- Chấm điểm hội thoại giáo viên - học sinh (Two Speaker Diarization)
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
-- Lưu URL GPU backend Cloudflare & Cấu hình Gemini 3.7 Flash API
create table if not exists public.global_settings (
  id integer primary key default 1,
  api_url text,
  gemini_api_key text,
  gemini_api_url text default 'https://revidapi.com/v1/chat/completions',
  gemini_model text default 'gemini-3.7-flash',
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Đảm bảo các cột luôn tồn tại kể cả khi bảng đã tạo trước đó
alter table public.global_settings add column if not exists api_url text;
alter table public.global_settings add column if not exists gemini_api_key text;
alter table public.global_settings add column if not exists gemini_api_url text default 'https://revidapi.com/v1/chat/completions';
alter table public.global_settings add column if not exists gemini_model text default 'gemini-3.7-flash';

insert into public.global_settings (id, api_url, gemini_api_url, gemini_model)
values (1, '', 'https://revidapi.com/v1/chat/completions', 'gemini-3.7-flash')
on conflict (id) do update set
  gemini_api_url = coalesce(public.global_settings.gemini_api_url, 'https://revidapi.com/v1/chat/completions'),
  gemini_model = coalesce(public.global_settings.gemini_model, 'gemini-3.7-flash');

-- 2.4. TABLE: question_sets
-- Bộ đề thi / luyện tập speaking (VSTEP, TOEIC, IELTS, General)
create table if not exists public.question_sets (
  id uuid default gen_random_uuid() primary key,
  teacher_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  description text,
  level text check (level in ('beginner', 'intermediate', 'advanced')) default 'intermediate',
  exam_type text check (exam_type in ('general', 'vstep', 'toeic', 'ielts')) default 'general',
  time_limit integer default 0,
  is_published boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.question_sets add column if not exists exam_type text check (exam_type in ('general', 'vstep', 'toeic', 'ielts')) default 'general';
alter table public.question_sets add column if not exists time_limit integer default 0;

-- 2.5. TABLE: questions
-- Câu hỏi speaking chi tiết kèm thời gian chuẩn bị & thời gian trả lời
create table if not exists public.questions (
  id uuid default gen_random_uuid() primary key,
  set_id uuid references public.question_sets(id) on delete cascade not null,
  order_num integer not null default 1,
  part_title text,
  question_text text not null,
  reference_text text,
  hint text,
  prep_time integer default 15,
  response_time integer default 45,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.questions add column if not exists part_title text;
alter table public.questions add column if not exists prep_time integer default 15;
alter table public.questions add column if not exists response_time integer default 45;

-- 2.6. TABLE: practice_sessions
-- Phiên luyện tập (Practice) hoặc thi thử (Exam) của Học viên
create table if not exists public.practice_sessions (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references public.profiles(id) on delete cascade not null,
  set_id uuid references public.question_sets(id) on delete cascade not null,
  mode text check (mode in ('practice', 'exam')) default 'practice',
  status text default 'in_progress' check (status in ('in_progress', 'completed', 'reviewed')),
  score_total double precision,
  score_accuracy double precision,
  score_fluency double precision,
  score_prosodic double precision,
  score_grammar double precision,
  score_context double precision,
  exam_band text,
  started_at timestamp with time zone default timezone('utc'::text, now()) not null,
  completed_at timestamp with time zone
);
alter table public.practice_sessions add column if not exists mode text check (mode in ('practice', 'exam')) default 'practice';
alter table public.practice_sessions add column if not exists exam_band text;
alter table public.practice_sessions add column if not exists score_grammar double precision;
alter table public.practice_sessions add column if not exists score_context double precision;

-- 2.7. TABLE: practice_answers
-- Bài ghi âm và kết quả chấm điểm từng câu (Điểm âm học + Điểm ngữ pháp + Điểm ngữ cảnh)
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
  score_grammar double precision,
  score_context double precision,
  result_json jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.practice_answers add column if not exists score_grammar double precision;
alter table public.practice_answers add column if not exists score_context double precision;

-- ==============================================================================
-- 3. STORAGE BUCKET: speakai-audio
-- ==============================================================================
insert into storage.buckets (id, name, public)
values ('speakai-audio', 'speakai-audio', true)
on conflict (id) do update set public = true;

-- Mở quyền truy cập tự do cho Storage speakai-audio
drop policy if exists "Public Access Storage speakai-audio" on storage.objects;
create policy "Public Access Storage speakai-audio"
  on storage.objects for all
  using (bucket_id = 'speakai-audio')
  with check (bucket_id = 'speakai-audio');

-- ==============================================================================
-- 4. BẢO MẬT & QUYỀN HẠN (WITHOUT RLS - TẮT RLS TRÊN TẤT CẢ BẢNG)
-- Giúp thao tác trực tiếp mượt mà từ Frontend, không lo bị chặn quyền
-- ==============================================================================
alter table public.profiles disable row level security;
alter table public.assessments disable row level security;
alter table public.global_settings disable row level security;
alter table public.question_sets disable row level security;
alter table public.questions disable row level security;
alter table public.practice_sessions disable row level security;
alter table public.practice_answers disable row level security;

-- Dọn sạch các policy cũ nếu có để tránh xung đột
drop policy if exists "Public profiles are viewable by authenticated users" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update own profile or admin can update all" on public.profiles;
drop policy if exists "Admin or owner can delete profiles" on public.profiles;
drop policy if exists "Teachers can view their students" on public.profiles;

drop policy if exists "Teachers can insert assessments" on public.assessments;
drop policy if exists "Users can view relevant assessments" on public.assessments;
drop policy if exists "Teachers can update their own assessments" on public.assessments;
drop policy if exists "Teachers can delete their own assessments" on public.assessments;

drop policy if exists "Allow select global_settings for all" on public.global_settings;
drop policy if exists "Allow update global_settings for admin and authenticated" on public.global_settings;

drop policy if exists "Anyone authenticated can view published sets" on public.question_sets;
drop policy if exists "Teachers can view own sets" on public.question_sets;
drop policy if exists "Teachers can create sets" on public.question_sets;
drop policy if exists "Teachers can update any question set" on public.question_sets;
drop policy if exists "Teachers can delete their own sets" on public.question_sets;

drop policy if exists "Anyone can view questions of visible sets" on public.questions;
drop policy if exists "Teachers can manage questions" on public.questions;

drop policy if exists "Students can manage own practice sessions" on public.practice_sessions;
drop policy if exists "Teachers can view practice sessions of their students" on public.practice_sessions;

drop policy if exists "Students manage own practice answers" on public.practice_answers;
drop policy if exists "Teachers can view practice answers of their students" on public.practice_answers;

-- ==============================================================================
-- 5. INDEXES TỐI ƯU HIỆU SUẤT TRUY VẤN
-- ==============================================================================
create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_profiles_email on public.profiles(email);
create index if not exists idx_profiles_teacher_id on public.profiles(teacher_id);

create index if not exists idx_assessments_student_id on public.assessments(student_id);
create index if not exists idx_assessments_teacher_id on public.assessments(teacher_id);
create index if not exists idx_assessments_created_at on public.assessments(created_at desc);

create index if not exists idx_question_sets_teacher_id on public.question_sets(teacher_id);
create index if not exists idx_question_sets_published on public.question_sets(is_published);
create index if not exists idx_question_sets_exam_type on public.question_sets(exam_type);

create index if not exists idx_questions_set_id on public.questions(set_id);
create index if not exists idx_questions_order on public.questions(set_id, order_num);

create index if not exists idx_practice_sessions_student on public.practice_sessions(student_id);
create index if not exists idx_practice_sessions_set on public.practice_sessions(set_id);
create index if not exists idx_practice_sessions_mode on public.practice_sessions(mode);
create index if not exists idx_practice_sessions_status on public.practice_sessions(status);

create index if not exists idx_practice_answers_session on public.practice_answers(session_id);
create index if not exists idx_practice_answers_question on public.practice_answers(question_id);

-- HOÀN TẤT THIẾT LẬP DATABASE SCHEMA
