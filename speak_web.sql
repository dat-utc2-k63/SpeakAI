-- Tạo bảng lưu thông tin người dùng (Học viên & Giáo viên)
create table if not exists profiles (
  id uuid references auth.users not null primary key,
  role text not null,
  full_name text not null,
  email text not null,
  phone text,
  voice_sample_url text,
  voice_embeddings jsonb,
  voice_enrolled boolean default false,
  teacher_id uuid references profiles(id),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Tạo bảng lưu lịch sử chấm điểm
create table if not exists assessments (
  id uuid default uuid_generate_v4() primary key,
  teacher_id uuid references profiles(id),
  student_id uuid references profiles(id),
  audio_url text,
  status text,
  score_total float,
  score_accuracy float,
  score_fluency float,
  score_prosodic float,
  result_json jsonb,
  llm_feedback text,
  saved boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
