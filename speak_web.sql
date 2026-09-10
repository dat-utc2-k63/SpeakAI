-- ==============================================================================
-- SpeakAI Web Platform - Supabase Database Schema & Migration Script
-- Project: SpeakAI (https://kngkckshvgaqeiatryqy.supabase.co)
-- ==============================================================================

-- 1. EXTENSIONS
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- 2. TABLE: profiles
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

-- 3. TABLE: assessments
-- Lưu lịch sử chấm điểm bài nói, transcript Whisper, điểm thành phần và LLM feedback
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

-- 4. TABLE: global_settings
-- Lưu cấu hình hệ thống dùng chung (ví dụ URL backend GPU / Cloudflare Tunnel / Ngrok)
create table if not exists public.global_settings (
  id integer primary key default 1,
  api_url text,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Khởi tạo bản ghi cấu hình mặc định (id = 1) nếu chưa có
insert into public.global_settings (id, api_url)
values (1, '')
on conflict (id) do nothing;

-- 5. STORAGE BUCKET: speakai-audio
-- Bucket lưu trữ file ghi âm học viên, file hội thoại và file mẫu giọng nói
insert into storage.buckets (id, name, public)
values ('speakai-audio', 'speakai-audio', true)
on conflict (id) do update set public = true;

-- 6. INDEXES TỐI ƯU TRUY VẤN
create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_profiles_email on public.profiles(email);
create index if not exists idx_profiles_teacher_id on public.profiles(teacher_id);
create index if not exists idx_assessments_student_id on public.assessments(student_id);
create index if not exists idx_assessments_teacher_id on public.assessments(teacher_id);
create index if not exists idx_assessments_created_at on public.assessments(created_at desc);
create index if not exists idx_assessments_saved on public.assessments(saved);

-- 7. ROW LEVEL SECURITY (RLS) & ACCESS POLICIES
alter table public.profiles enable row level security;
alter table public.assessments enable row level security;
alter table public.global_settings enable row level security;

-- Policies cho bảng profiles
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

-- Policies cho bảng assessments
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

-- Policies cho bảng global_settings
drop policy if exists "Allow select global_settings for all" on public.global_settings;
create policy "Allow select global_settings for all"
  on public.global_settings for select
  using (true);

drop policy if exists "Allow update global_settings for admin and authenticated" on public.global_settings;
create policy "Allow update global_settings for admin and authenticated"
  on public.global_settings for all
  using (true)
  with check (true);

-- Storage Policies cho speakai-audio bucket
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
