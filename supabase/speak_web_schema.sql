-- ==============================================================================
-- SpeakAI Web Platform - RBAC, RLS & Classroom Management Schema (v5.0)
-- Project: SpeakAI (configure SUPABASE_URL in `.env`)
-- Mô tả: File SQL duy nhất, idempotent (chạy an toàn nhiều lần trên Supabase SQL Editor).
--        Bao gồm toàn bộ 13 bảng (7 bảng lõi + 6 bảng quản lý lớp học v5.0),
--        BẬT RLS 100%, Trigger chống leo thang quyền & backfill từ profiles.teacher_id.
-- ==============================================================================

-- ==============================================================================
-- 1. EXTENSIONS & PRIVATE SECURITY SCHEMA
-- ==============================================================================
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

create schema if not exists private;

-- ==============================================================================
-- 2. CORE TABLES
-- ==============================================================================

-- 2.1. TABLE: profiles
-- Tài khoản người dùng (Admin, Giáo viên, Học viên), trạng thái kích hoạt & dữ liệu giọng nói
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'student' check (role in ('admin', 'teacher', 'student')),
  status text not null default 'active' check (status in ('pending', 'active', 'suspended')),
  full_name text not null,
  email text not null,
  phone text,
  voice_sample_url text,
  voice_embeddings jsonb,
  voice_enrolled boolean not null default false,
  teacher_id uuid references public.profiles(id) on delete set null,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

-- Đồng bộ cột mới nếu chạy trên database đã tồn tại
alter table public.profiles
  add column if not exists status text not null default 'active',
  add column if not exists student_code text,
  add column if not exists date_of_birth date,
  add column if not exists entry_level text,
  add column if not exists target_band numeric(3,1),
  add column if not exists guardian_name text,
  add column if not exists guardian_phone text,
  add column if not exists enrolled_at timestamp with time zone not null default timezone('utc'::text, now()),
  add column if not exists enrollment_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_status_check' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_status_check check (status in ('pending', 'active', 'suspended'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_entry_level_check' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_entry_level_check
      check (entry_level is null or entry_level in ('beginner', 'intermediate', 'advanced'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_target_band_check' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_target_band_check
      check (target_band is null or (target_band >= 1.0 and target_band <= 9.0));
  end if;
end $$;

create unique index if not exists idx_profiles_student_code_unique
  on public.profiles (lower(student_code))
  where student_code is not null;

-- Gán mã học viên mặc định cho các học viên đã tồn tại nhưng chưa có mã
update public.profiles
set student_code = 'HV-' || to_char(coalesce(created_at, timezone('utc'::text, now())), 'YYYY') || '-' || upper(substring(replace(id::text, '-', ''), 1, 5))
where role = 'student'
  and nullif(trim(coalesce(student_code, '')), '') is null;

-- 2.2. TABLE: assessments
-- Chấm điểm hội thoại Giáo viên - Học viên (Two-Speaker Diarization)
create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid references public.profiles(id) on delete set null,
  student_id uuid references public.profiles(id) on delete cascade,
  audio_url text,
  status text not null default 'pending',
  score_total double precision,
  score_accuracy double precision,
  score_fluency double precision,
  score_prosodic double precision,
  score_grammar double precision,
  score_context double precision,
  score_lexical double precision,
  result_json jsonb,
  llm_feedback text,
  teacher_note text,
  saved boolean not null default false,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

alter table public.assessments
  add column if not exists teacher_note text;

-- 2.3. TABLE: global_settings
-- Cấu hình hệ thống (GPU Backend URL & AI Evaluator / LLM API — Key LLM chỉ Admin/Service Role đọc)
create table if not exists public.global_settings (
  id integer primary key default 1,
  api_url text,
  llm_api_key text,
  llm_api_url text default 'https://revidapi.com/v1/chat/completions',
  llm_model text default 'deepseek-v4.1-flash',
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Đồng bộ cột mới nếu chạy trên database đã tồn tại
alter table public.global_settings
  add column if not exists llm_api_key text,
  add column if not exists llm_api_url text default 'https://revidapi.com/v1/chat/completions',
  add column if not exists llm_model text default 'deepseek-v4.1-flash';

-- Tự động migrate dữ liệu cũ nếu trước đó dùng cột gemini_*
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'global_settings' and column_name = 'gemini_api_key') then
    update public.global_settings
    set llm_api_key = coalesce(llm_api_key, gemini_api_key),
        llm_api_url = coalesce(nullif(llm_api_url, ''), gemini_api_url, 'https://revidapi.com/v1/chat/completions'),
        llm_model = coalesce(nullif(llm_model, ''), case when gemini_model = 'gemini-3.8-flash' then 'deepseek-v4.1-flash' else gemini_model end, 'deepseek-v4.1-flash')
    where id = 1;
  end if;
end $$;

insert into public.global_settings (id, api_url, llm_api_url, llm_model)
values (1, '', 'https://revidapi.com/v1/chat/completions', 'deepseek-v4.1-flash')
on conflict (id) do nothing;

-- 2.4. TABLE: question_sets
-- Bộ đề thi / luyện tập Speaking (General, VSTEP, TOEIC, IELTS)
create table if not exists public.question_sets (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  level text not null default 'intermediate' check (level in ('beginner', 'intermediate', 'advanced')),
  exam_type text not null default 'general' check (exam_type in ('general', 'vstep', 'toeic', 'ielts')),
  time_limit integer not null default 0,
  is_published boolean not null default false,
  allowed_teacher_ids uuid[] not null default '{}',
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

-- 2.5. TABLE: questions
-- Chi tiết từng câu hỏi trong bộ đề kèm thời gian chuẩn bị & trả lời
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.question_sets(id) on delete cascade,
  order_num integer not null default 1,
  part_title text,
  question_text text not null,
  reference_text text,
  hint text,
  prep_time integer not null default 15,
  response_time integer not null default 45,
  task_type text not null default 'short_qa',
  image_url text,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

-- 2.6. TABLE: practice_sessions
-- Phiên luyện tập (Practice) hoặc thi thử (Exam) của Học viên + đánh giá duyệt bài của Giáo viên
create table if not exists public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  set_id uuid not null references public.question_sets(id) on delete cascade,
  mode text not null default 'practice' check (mode in ('practice', 'exam')),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'reviewed')),
  score_total double precision,
  score_accuracy double precision,
  score_fluency double precision,
  score_prosodic double precision,
  score_grammar double precision,
  score_context double precision,
  score_lexical double precision,
  exam_band text,
  teacher_comment text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamp with time zone,
  started_at timestamp with time zone not null default timezone('utc'::text, now()),
  completed_at timestamp with time zone
);

alter table public.practice_sessions
  add column if not exists teacher_comment text,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamp with time zone;

-- 2.7. TABLE: practice_answers
-- Bài ghi âm và điểm số chi tiết từng câu trả lời của Học viên
create table if not exists public.practice_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.practice_sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  audio_url text,
  transcript text,
  score_total double precision,
  score_accuracy double precision,
  score_fluency double precision,
  score_prosodic double precision,
  score_grammar double precision,
  score_context double precision,
  score_lexical double precision,
  result_json jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

-- ==============================================================================
-- 3. PRIVATE RBAC HELPER FUNCTIONS (SECURITY DEFINER, NO PUBLIC API EXPOSURE)
-- ==============================================================================
create or replace function private.is_service_context()
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    current_user in ('postgres', 'supabase_admin', 'service_role')
    or coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') = 'service_role';
$$;

create or replace function private.is_active_teacher_id(p_teacher_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles t
    where t.id = p_teacher_id
      and t.role = 'teacher'
      and t.status = 'active'
  );
$$;

create or replace function private.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create or replace function private.current_user_status()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select status from public.profiles where id = (select auth.uid());
$$;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and status = 'active'
  );
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
      and status = 'active'
  );
$$;

create or replace function private.is_active_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role = 'teacher'
      and status = 'active'
  );
$$;

create or replace function private.is_teacher_of(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles s
    join public.profiles t on t.id = (select auth.uid())
    where s.id = p_student_id
      and s.teacher_id = t.id
      and t.role = 'teacher'
      and t.status = 'active'
  );
$$;

create or replace function private.can_read_question_set(p_set_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.question_sets qs
    join public.profiles me on me.id = (select auth.uid())
    where qs.id = p_set_id
      and me.status = 'active'
      and (
        me.role = 'admin'
        or qs.teacher_id = me.id
        or (me.role = 'teacher' and me.id = any(qs.allowed_teacher_ids))
        or qs.is_published = true
      )
  );
$$;

create or replace function private.can_edit_question_set(p_set_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.question_sets qs
    join public.profiles me on me.id = (select auth.uid())
    where qs.id = p_set_id
      and me.status = 'active'
      and (
        me.role = 'admin'
        or qs.teacher_id = me.id
        or (me.role = 'teacher' and me.id = any(qs.allowed_teacher_ids))
      )
  );
$$;

create or replace function private.is_question_set_owner_or_admin(p_set_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.question_sets qs
    join public.profiles me on me.id = (select auth.uid())
    where qs.id = p_set_id
      and me.status = 'active'
      and (me.role = 'admin' or qs.teacher_id = me.id)
  );
$$;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- ==============================================================================
-- 4. SECURITY TRIGGERS (ANTI-PRIVILEGE ESCALATION & IMMUTABILITY)
-- ==============================================================================

-- 4.1. Bảo vệ bảng profiles khi INSERT / UPDATE (SECURITY INVOKER để giữ nguyên caller role)
create or replace function private.protect_profiles_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Tự động đồng bộ cờ voice_enrolled dựa theo voice_embeddings hoặc voice_sample_url
  if (
    (new.voice_embeddings is not null and jsonb_typeof(new.voice_embeddings) = 'array' and jsonb_array_length(new.voice_embeddings) > 0)
    or coalesce(nullif(trim(new.voice_sample_url), ''), '') <> ''
  ) then
    new.voice_enrolled := true;
  end if;

  -- Chuẩn hóa mã học viên & tự sinh nếu tạo mới học viên chưa có mã
  if tg_op = 'INSERT' then
    new.student_code := nullif(trim(coalesce(new.student_code, '')), '');
    if new.role = 'student' and new.student_code is null then
      new.student_code := 'HV-' || to_char(timezone('utc'::text, now()), 'YYYY') || '-' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 5));
    end if;
    new.enrolled_at := coalesce(new.enrolled_at, timezone('utc'::text, now()));
  elsif tg_op = 'UPDATE' then
    new.student_code := nullif(trim(coalesce(new.student_code, '')), '');
  end if;

  -- Cho phép PostgreSQL SQL Editor / service_role thao tác quản trị hệ thống
  if private.is_service_context() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Khóa hoàn toàn tự đăng ký công khai: chỉ Admin/Giáo vụ mới có quyền tạo hồ sơ người dùng
    if not private.is_admin() then
      raise exception 'Chỉ Quản trị viên / Giáo vụ mới có quyền tạo tài khoản người dùng.';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if not private.is_admin() then
      if new.role is distinct from old.role then
        raise exception 'Bạn không có quyền thay đổi vai trò tài khoản.';
      end if;
      if new.status is distinct from old.status then
        raise exception 'Bạn không có quyền thay đổi trạng thái tài khoản.';
      end if;
      if new.teacher_id is distinct from old.teacher_id then
        raise exception 'Chỉ Quản trị viên mới được phân công hoặc chuyển lớp.';
      end if;
      if new.id is distinct from old.id or new.email is distinct from old.email then
        raise exception 'Không thể thay đổi định danh hoặc email hồ sơ tại đây.';
      end if;
      if new.student_code is distinct from old.student_code
         or new.date_of_birth is distinct from old.date_of_birth
         or new.entry_level is distinct from old.entry_level
         or new.target_band is distinct from old.target_band
         or new.guardian_name is distinct from old.guardian_name
         or new.guardian_phone is distinct from old.guardian_phone
         or new.enrolled_at is distinct from old.enrolled_at
         or new.enrollment_note is distinct from old.enrollment_note then
        raise exception 'Chỉ Quản trị viên / Giáo vụ mới có quyền chỉnh sửa thông tin ghi danh học viên.';
      end if;
    else
      if old.id = (select auth.uid()) and (new.role is distinct from 'admin' or new.status is distinct from 'active') then
        raise exception 'Không thể tự hạ quyền hoặc tự khóa tài khoản Admin đang đăng nhập.';
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_profiles_write on public.profiles;
create trigger trg_protect_profiles_write
before insert or update on public.profiles
for each row execute function private.protect_profiles_write();

-- 4.2. Bảo vệ quyền sở hữu & phân quyền cộng tác viên trên question_sets
create or replace function private.protect_question_sets_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_service_context() or private.is_admin() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.teacher_id is distinct from old.teacher_id then
      raise exception 'Không được phép chuyển quyền chủ sở hữu bộ đề.';
    end if;
    if new.allowed_teacher_ids is distinct from old.allowed_teacher_ids then
      if old.teacher_id <> (select auth.uid()) then
        raise exception 'Chỉ chủ sở hữu bộ đề hoặc Admin mới được thay đổi danh sách cộng tác viên.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_question_sets_write on public.question_sets;
create trigger trg_protect_question_sets_write
before update on public.question_sets
for each row execute function private.protect_question_sets_write();

-- 4.3. Khóa tính toàn vẹn điểm số & nhận xét trên practice_sessions
create or replace function private.protect_practice_sessions_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_service_context() or private.is_admin() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.student_id = (select auth.uid()) then
      if old.status <> 'in_progress' then
        raise exception 'Bài làm đã hoàn thành, không thể chỉnh sửa điểm số hoặc trạng thái.';
      end if;
      if new.status not in ('in_progress', 'completed') then
        raise exception 'Học viên không được phép chuyển trạng thái bài làm sang "%".', new.status;
      end if;
      new.teacher_comment := old.teacher_comment;
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_practice_sessions_write on public.practice_sessions;
create trigger trg_protect_practice_sessions_write
before update on public.practice_sessions
for each row execute function private.protect_practice_sessions_write();

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ==============================================================================
-- 5. SAFE PUBLIC RPC FUNCTIONS
-- ==============================================================================

-- 5.1. Lấy danh sách Giáo viên đang active để Học viên chọn khi đăng ký (An toàn cho anon)
create or replace function public.get_signup_teachers()
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name
  from public.profiles p
  where p.role = 'teacher'
    and p.status = 'active'
  order by p.full_name asc;
$$;

revoke all on function public.get_signup_teachers() from public, anon;
grant execute on function public.get_signup_teachers() to authenticated;

-- 5.2. Học viên xem thông tin cơ bản Giáo viên phụ trách lớp mình (không lộ embeddings/phone)
create or replace function public.get_my_teacher_info()
returns table (id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.full_name, t.email
  from public.profiles s
  join public.profiles t on t.id = s.teacher_id
  where s.id = (select auth.uid())
    and t.role = 'teacher'
    and t.status = 'active';
$$;

revoke all on function public.get_my_teacher_info() from public, anon;
grant execute on function public.get_my_teacher_info() to authenticated;

-- 5.3. Giáo viên / Admin lấy danh sách đồng nghiệp active để chia sẻ quyền chỉnh sửa bộ đề
create or replace function public.get_collaborator_teachers()
returns table (id uuid, full_name text, email text, role text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.is_active_teacher() or private.is_admin()) then
    raise exception 'Chỉ Giáo viên hoặc Quản trị viên đang hoạt động mới có quyền xem danh sách cộng tác viên.';
  end if;

  return query
  select p.id, p.full_name, p.email, p.role
  from public.profiles p
  where p.status = 'active'
    and p.role in ('teacher', 'admin')
    and p.id <> (select auth.uid())
  order by p.full_name asc;
end;
$$;

revoke all on function public.get_collaborator_teachers() from public, anon;
grant execute on function public.get_collaborator_teachers() to authenticated;

-- 5.4. Lấy cấu hình runtime công khai (TUYỆT ĐỐI KHÔNG TRẢ llm_api_key)
drop function if exists public.get_public_runtime_config();
create or replace function public.get_public_runtime_config()
returns table (api_url text, llm_api_url text, llm_model text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    gs.api_url,
    coalesce(gs.llm_api_url, 'https://revidapi.com/v1/chat/completions') as llm_api_url,
    coalesce(gs.llm_model, 'deepseek-v4.1-flash') as llm_model
  from public.global_settings gs
  where gs.id = 1;
$$;

revoke all on function public.get_public_runtime_config() from public;
grant execute on function public.get_public_runtime_config() to anon, authenticated;

-- 5.5. Admin cập nhật Role, Status (duyệt/khóa) & phân lớp Teacher cho User
create or replace function public.admin_update_user(
  p_user_id uuid,
  p_role text,
  p_status text,
  p_teacher_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles%rowtype;
  v_other_active_admins integer;
  v_final_teacher_id uuid;
begin
  if not private.is_admin() then
    raise exception 'Chỉ Quản trị viên (Admin) mới có quyền cập nhật phân quyền người dùng.';
  end if;

  if p_role not in ('admin', 'teacher', 'student') then
    raise exception 'Vai trò không hợp lệ: %', p_role;
  end if;

  if p_status not in ('pending', 'active', 'suspended') then
    raise exception 'Trạng thái không hợp lệ: %', p_status;
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if not found then
    raise exception 'Không tìm thấy người dùng.';
  end if;

  if p_user_id = (select auth.uid()) and (p_role <> 'admin' or p_status <> 'active') then
    raise exception 'Không thể tự hạ quyền hoặc tự khóa tài khoản Admin đang đăng nhập.';
  end if;

  if v_target.role = 'admin' and v_target.status = 'active' and (p_role <> 'admin' or p_status <> 'active') then
    select count(*) into v_other_active_admins
    from public.profiles
    where role = 'admin' and status = 'active' and id <> p_user_id;
    if v_other_active_admins < 1 then
      raise exception 'Hệ thống phải có ít nhất 1 Quản trị viên đang hoạt động.';
    end if;
  end if;

  if p_role = 'student' then
    if p_teacher_id is not null then
      if not exists (
        select 1 from public.profiles t
        where t.id = p_teacher_id and t.role = 'teacher' and t.status = 'active'
      ) then
        raise exception 'Giáo viên phụ trách được chọn không hợp lệ hoặc chưa kích hoạt.';
      end if;
    end if;
    v_final_teacher_id := p_teacher_id;
  else
    v_final_teacher_id := null;
  end if;

  update public.profiles
  set role = p_role,
      status = p_status,
      teacher_id = v_final_teacher_id
  where id = p_user_id
  returning * into v_target;

  return jsonb_build_object(
    'id', v_target.id,
    'role', v_target.role,
    'status', v_target.status,
    'teacher_id', v_target.teacher_id
  );
end;
$$;

revoke all on function public.admin_update_user(uuid, text, text, uuid) from public, anon;
grant execute on function public.admin_update_user(uuid, text, text, uuid) to authenticated;

-- 5.6. Admin xóa hoàn toàn tài khoản User (auth.users + cascade)
create or replace function public.delete_user_by_admin(user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles%rowtype;
  v_other_active_admins integer;
begin
  if not private.is_admin() then
    raise exception 'Chỉ admin mới có quyền xoá user.';
  end if;

  if user_id = (select auth.uid()) then
    raise exception 'Không thể tự xoá tài khoản Admin đang đăng nhập.';
  end if;

  select * into v_target from public.profiles where id = user_id;
  if found and v_target.role = 'admin' and v_target.status = 'active' then
    select count(*) into v_other_active_admins
    from public.profiles
    where role = 'admin' and status = 'active' and id <> user_id;
    if v_other_active_admins < 1 then
      raise exception 'Không thể xoá Quản trị viên cuối cùng của hệ thống.';
    end if;
  end if;

  delete from public.assessments where student_id = user_id or teacher_id = user_id;
  delete from auth.users where id = user_id;
end;
$$;

revoke all on function public.delete_user_by_admin(uuid) from public, anon;
grant execute on function public.delete_user_by_admin(uuid) to authenticated;

-- 5.7. Giáo viên duyệt & ghi nhận xét bài Luyện tập / Thi thử của học viên
create or replace function public.teacher_review_session(
  p_session_id uuid,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sess public.practice_sessions%rowtype;
  v_is_set_owner boolean;
  v_now timestamp with time zone := timezone('utc'::text, now());
begin
  if not (private.is_active_teacher() or private.is_admin()) then
    raise exception 'Chỉ Giáo viên hoặc Quản trị viên mới có quyền duyệt bài.';
  end if;

  select * into v_sess from public.practice_sessions where id = p_session_id;
  if not found then
    raise exception 'Không tìm thấy phiên làm bài.';
  end if;

  if v_sess.status not in ('completed', 'reviewed') then
    raise exception 'Học viên chưa hoàn thành phiên làm bài này.';
  end if;

  select exists (
    select 1 from public.question_sets qs
    where qs.id = v_sess.set_id and qs.teacher_id = (select auth.uid())
  ) into v_is_set_owner;

  if not (private.is_admin() or private.is_teacher_of(v_sess.student_id) or v_is_set_owner) then
    raise exception 'Bạn không có quyền nhận xét bài làm của học viên lớp khác.';
  end if;

  update public.practice_sessions
  set status = 'reviewed',
      teacher_comment = nullif(trim(coalesce(p_comment, '')), ''),
      reviewed_by = (select auth.uid()),
      reviewed_at = v_now
  where id = p_session_id
  returning * into v_sess;

  return jsonb_build_object(
    'id', v_sess.id,
    'status', v_sess.status,
    'teacher_comment', v_sess.teacher_comment,
    'reviewed_by', v_sess.reviewed_by,
    'reviewed_at', v_sess.reviewed_at
  );
end;
$$;

revoke all on function public.teacher_review_session(uuid, text) from public, anon;
grant execute on function public.teacher_review_session(uuid, text) to authenticated;

-- 5.8. Nhân bản bộ đề đồng nghiệp về kho cá nhân (Teacher / Admin)
create or replace function public.clone_question_set(p_source_set_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src public.question_sets%rowtype;
  v_new_id uuid;
begin
  if not (private.is_active_teacher() or private.is_admin()) then
    raise exception 'Chỉ Giáo viên hoặc Quản trị viên mới có quyền nhân bản bộ đề.';
  end if;

  if not private.can_read_question_set(p_source_set_id) then
    raise exception 'Bạn không có quyền truy cập bộ đề nguồn này.';
  end if;

  select * into v_src from public.question_sets where id = p_source_set_id;
  if not found then
    raise exception 'Không tìm thấy bộ đề nguồn.';
  end if;

  insert into public.question_sets (
    teacher_id, title, description, level, exam_type, time_limit, is_published, allowed_teacher_ids
  )
  values (
    (select auth.uid()),
    v_src.title || ' (Bản sao)',
    v_src.description,
    v_src.level,
    v_src.exam_type,
    v_src.time_limit,
    false,
    '{}'
  )
  returning id into v_new_id;

  insert into public.questions (
    set_id, order_num, part_title, question_text, reference_text, hint,
    prep_time, response_time, task_type, image_url
  )
  select
    v_new_id, q.order_num, q.part_title, q.question_text, q.reference_text, q.hint,
    q.prep_time, q.response_time, q.task_type, q.image_url
  from public.questions q
  where q.set_id = p_source_set_id
  order by q.order_num asc;

  return v_new_id;
end;
$$;

revoke all on function public.clone_question_set(uuid) from public, anon;
grant execute on function public.clone_question_set(uuid) to authenticated;

-- ==============================================================================
-- 6. ROW LEVEL SECURITY (ENABLE RLS ON ALL 7 PUBLIC TABLES)
-- ==============================================================================
revoke all on table
  public.profiles,
  public.assessments,
  public.question_sets,
  public.questions,
  public.practice_sessions,
  public.practice_answers
from anon;

-- 6.1. profiles
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_admin())
    or (teacher_id = (select auth.uid()) and (select private.is_active_teacher()))
  );

drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_insert_admin_only" on public.profiles;
create policy "profiles_insert_admin_only"
  on public.profiles for insert
  to authenticated
  with check ((select private.is_admin()));

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin"
  on public.profiles for update
  to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_admin())
  )
  with check (
    id = (select auth.uid())
    or (select private.is_admin())
  );

drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_delete_admin"
  on public.profiles for delete
  to authenticated
  using (
    (select private.is_admin())
    and id <> (select auth.uid())
  );

-- 6.2. global_settings (Tắt RLS để GPU runner / Kaggle / Web client tự do đọc & cập nhật api_url)
alter table public.global_settings disable row level security;
grant all on table public.global_settings to anon, authenticated, service_role;

-- 6.3. question_sets
-- Lưu ý: Dùng kiểm tra cột trực tiếp (KHÔNG gọi hàm STABLE truy vấn ngược lại bảng question_sets)
-- để lệnh INSERT ... RETURNING * (.insert(...).select()) nhìn thấy ngay dòng vừa tạo.
alter table public.question_sets enable row level security;

drop policy if exists "question_sets_select" on public.question_sets;
create policy "question_sets_select"
  on public.question_sets for select
  to authenticated
  using (
    (select private.is_active_user())
    and (
      (select private.is_admin())
      or teacher_id = (select auth.uid())
      or ((select private.is_active_teacher()) and (select auth.uid()) = any(allowed_teacher_ids))
      or is_published = true
    )
  );

drop policy if exists "question_sets_insert" on public.question_sets;
create policy "question_sets_insert"
  on public.question_sets for insert
  to authenticated
  with check (
    ((select private.is_active_teacher()) or (select private.is_admin()))
    and (teacher_id = (select auth.uid()) or (select private.is_admin()))
  );

drop policy if exists "question_sets_update" on public.question_sets;
create policy "question_sets_update"
  on public.question_sets for update
  to authenticated
  using (
    (select private.is_admin())
    or (
      (select private.is_active_teacher())
      and (
        teacher_id = (select auth.uid())
        or (select auth.uid()) = any(allowed_teacher_ids)
      )
    )
  )
  with check (
    (select private.is_admin())
    or (
      (select private.is_active_teacher())
      and (
        teacher_id = (select auth.uid())
        or (select auth.uid()) = any(allowed_teacher_ids)
      )
    )
  );

drop policy if exists "question_sets_delete" on public.question_sets;
create policy "question_sets_delete"
  on public.question_sets for delete
  to authenticated
  using (
    (select private.is_admin())
    or ((select private.is_active_teacher()) and teacher_id = (select auth.uid()))
  );

-- 6.4. questions
alter table public.questions enable row level security;

drop policy if exists "questions_select" on public.questions;
create policy "questions_select"
  on public.questions for select
  to authenticated
  using ((select private.can_read_question_set(set_id)));

drop policy if exists "questions_insert" on public.questions;
create policy "questions_insert"
  on public.questions for insert
  to authenticated
  with check ((select private.can_edit_question_set(set_id)));

drop policy if exists "questions_update" on public.questions;
create policy "questions_update"
  on public.questions for update
  to authenticated
  using ((select private.can_edit_question_set(set_id)))
  with check ((select private.can_edit_question_set(set_id)));

drop policy if exists "questions_delete" on public.questions;
create policy "questions_delete"
  on public.questions for delete
  to authenticated
  using ((select private.can_edit_question_set(set_id)));

-- 6.5. assessments
alter table public.assessments enable row level security;

drop policy if exists "assessments_select" on public.assessments;
create policy "assessments_select"
  on public.assessments for select
  to authenticated
  using (
    (select private.is_admin())
    or (teacher_id = (select auth.uid()) and (select private.is_active_teacher()))
    or (student_id = (select auth.uid()) and saved = true and (select private.is_active_user()))
  );

drop policy if exists "assessments_insert" on public.assessments;
create policy "assessments_insert"
  on public.assessments for insert
  to authenticated
  with check (
    (select private.is_active_teacher())
    and teacher_id = (select auth.uid())
    and (select private.is_teacher_of(student_id))
  );

drop policy if exists "assessments_update" on public.assessments;
create policy "assessments_update"
  on public.assessments for update
  to authenticated
  using (
    (select private.is_admin())
    or (teacher_id = (select auth.uid()) and (select private.is_active_teacher()))
  )
  with check (
    (select private.is_admin())
    or (teacher_id = (select auth.uid()) and (select private.is_active_teacher()))
  );

drop policy if exists "assessments_delete" on public.assessments;
create policy "assessments_delete"
  on public.assessments for delete
  to authenticated
  using (
    (select private.is_admin())
    or (teacher_id = (select auth.uid()) and (select private.is_active_teacher()))
  );

-- 6.6. practice_sessions
alter table public.practice_sessions enable row level security;

drop policy if exists "practice_sessions_select" on public.practice_sessions;
create policy "practice_sessions_select"
  on public.practice_sessions for select
  to authenticated
  using (
    (student_id = (select auth.uid()) and (select private.is_active_user()))
    or (select private.is_admin())
    or (select private.is_teacher_of(student_id))
    or exists (
      select 1 from public.question_sets qs
      where qs.id = set_id
        and qs.teacher_id = (select auth.uid())
        and (select private.is_active_teacher())
    )
  );

drop policy if exists "practice_sessions_insert" on public.practice_sessions;
create policy "practice_sessions_insert"
  on public.practice_sessions for insert
  to authenticated
  with check (
    (select private.current_user_role()) = 'student'
    and (select private.is_active_user())
    and student_id = (select auth.uid())
    and exists (
      select 1 from public.question_sets qs
      where qs.id = set_id and qs.is_published = true
    )
  );

drop policy if exists "practice_sessions_update" on public.practice_sessions;
create policy "practice_sessions_update"
  on public.practice_sessions for update
  to authenticated
  using (
    (student_id = (select auth.uid()) and (select private.is_active_user()) and status = 'in_progress')
    or (select private.is_admin())
  )
  with check (
    (student_id = (select auth.uid()) and (select private.is_active_user()) and status in ('in_progress', 'completed'))
    or (select private.is_admin())
  );

drop policy if exists "practice_sessions_delete" on public.practice_sessions;
create policy "practice_sessions_delete"
  on public.practice_sessions for delete
  to authenticated
  using (
    (student_id = (select auth.uid()) and status = 'in_progress')
    or (select private.is_admin())
  );

-- 6.7. practice_answers
alter table public.practice_answers enable row level security;

drop policy if exists "practice_answers_select" on public.practice_answers;
create policy "practice_answers_select"
  on public.practice_answers for select
  to authenticated
  using (
    exists (
      select 1 from public.practice_sessions ps
      where ps.id = session_id
        and (
          (ps.student_id = (select auth.uid()) and (select private.is_active_user()))
          or (select private.is_admin())
          or (select private.is_teacher_of(ps.student_id))
          or exists (
            select 1 from public.question_sets qs
            where qs.id = ps.set_id
              and qs.teacher_id = (select auth.uid())
              and (select private.is_active_teacher())
          )
        )
    )
  );

drop policy if exists "practice_answers_insert" on public.practice_answers;
create policy "practice_answers_insert"
  on public.practice_answers for insert
  to authenticated
  with check (
    exists (
      select 1 from public.practice_sessions ps
      where ps.id = session_id
        and ps.student_id = (select auth.uid())
        and ps.status = 'in_progress'
        and (select private.is_active_user())
    )
  );

drop policy if exists "practice_answers_update" on public.practice_answers;
create policy "practice_answers_update"
  on public.practice_answers for update
  to authenticated
  using (
    exists (
      select 1 from public.practice_sessions ps
      where ps.id = session_id
        and ps.student_id = (select auth.uid())
        and ps.status = 'in_progress'
        and (select private.is_active_user())
    )
  )
  with check (
    exists (
      select 1 from public.practice_sessions ps
      where ps.id = session_id
        and ps.student_id = (select auth.uid())
        and ps.status = 'in_progress'
        and (select private.is_active_user())
    )
  );

drop policy if exists "practice_answers_delete" on public.practice_answers;
create policy "practice_answers_delete"
  on public.practice_answers for delete
  to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1 from public.practice_sessions ps
      where ps.id = session_id
        and ps.student_id = (select auth.uid())
        and ps.status = 'in_progress'
    )
  );

-- ==============================================================================
-- 7. STORAGE BUCKET & OWNER-SCOPED POLICIES (speakai-audio)
-- ==============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('speakai-audio', 'speakai-audio', true, 314572800, null)
on conflict (id) do update set
  public = true,
  file_size_limit = 314572800,
  allowed_mime_types = null;

drop policy if exists "speakai_audio_select" on storage.objects;
create policy "speakai_audio_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'speakai-audio');

drop policy if exists "speakai_audio_insert" on storage.objects;
create policy "speakai_audio_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'speakai-audio'
    and (
      (
        (storage.foldername(name))[1] = 'voice_samples'
        and (storage.foldername(name))[2] = (select auth.uid())::text
        and (select private.is_active_user())
      )
      or (
        (storage.foldername(name))[1] = 'conversations'
        and (storage.foldername(name))[2] = (select auth.uid())::text
        and ((select private.is_active_teacher()) or (select private.is_admin()))
      )
      or (
        (storage.foldername(name))[1] = 'practice'
        and (storage.foldername(name))[2] = (select auth.uid())::text
        and (select private.current_user_role()) = 'student'
        and (select private.is_active_user())
      )
    )
  );

drop policy if exists "speakai_audio_update" on storage.objects;
create policy "speakai_audio_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'speakai-audio'
    and (
      (select private.is_admin())
      or (
        (storage.foldername(name))[1] in ('voice_samples', 'conversations', 'practice')
        and (storage.foldername(name))[2] = (select auth.uid())::text
      )
    )
  )
  with check (
    bucket_id = 'speakai-audio'
    and (
      (select private.is_admin())
      or (
        (storage.foldername(name))[1] in ('voice_samples', 'conversations', 'practice')
        and (storage.foldername(name))[2] = (select auth.uid())::text
      )
    )
  );

drop policy if exists "speakai_audio_delete" on storage.objects;
create policy "speakai_audio_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'speakai-audio'
    and (
      (select private.is_admin())
      or (
        (storage.foldername(name))[1] in ('voice_samples', 'conversations', 'practice')
        and (storage.foldername(name))[2] = (select auth.uid())::text
      )
    )
  );

drop policy if exists "speakai_audio_bucket_select" on storage.buckets;
create policy "speakai_audio_bucket_select"
  on storage.buckets for select
  to authenticated
  using (id = 'speakai-audio');

-- ==============================================================================
-- 8. PERFORMANCE & RLS INDEXES
-- ==============================================================================
create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_profiles_status on public.profiles(status);
create index if not exists idx_profiles_role_status on public.profiles(role, status);
create index if not exists idx_profiles_email on public.profiles(email);
create index if not exists idx_profiles_teacher_id on public.profiles(teacher_id);

create index if not exists idx_assessments_student_id on public.assessments(student_id);
create index if not exists idx_assessments_teacher_id on public.assessments(teacher_id);
create index if not exists idx_assessments_teacher_saved on public.assessments(teacher_id, saved);
create index if not exists idx_assessments_student_saved on public.assessments(student_id, saved);
create index if not exists idx_assessments_created_at on public.assessments(created_at desc);

create index if not exists idx_question_sets_teacher_id on public.question_sets(teacher_id);
create index if not exists idx_question_sets_published on public.question_sets(is_published);
create index if not exists idx_question_sets_exam_type on public.question_sets(exam_type);
create index if not exists idx_question_sets_level on public.question_sets(level);
create index if not exists idx_question_sets_allowed_teachers on public.question_sets using gin (allowed_teacher_ids);

create index if not exists idx_questions_set_id on public.questions(set_id);
create index if not exists idx_questions_order on public.questions(set_id, order_num);

create index if not exists idx_practice_sessions_student on public.practice_sessions(student_id);
create index if not exists idx_practice_sessions_student_status on public.practice_sessions(student_id, status);
create index if not exists idx_practice_sessions_set on public.practice_sessions(set_id);
create index if not exists idx_practice_sessions_mode on public.practice_sessions(mode);
create index if not exists idx_practice_sessions_status on public.practice_sessions(status);
create index if not exists idx_practice_sessions_reviewed_by on public.practice_sessions(reviewed_by);

create index if not exists idx_practice_answers_session on public.practice_answers(session_id);
create index if not exists idx_practice_answers_question on public.practice_answers(question_id);

-- ==============================================================================
-- SpeakAI Web Platform - Classroom Management Migration (v5.0)
-- Phase 1 + 2 + 3: Classes, Class Members, Lessons, Attendance, Assignments,
--                  Classroom EN/VI Analyses, Backfill from profiles.teacher_id,
--                  Upgraded RBAC/RLS Policies & Performance Indexes.
-- Idempotent: Có thể chạy an toàn nhiều lần trên Supabase SQL Editor.
-- ==============================================================================

-- ==============================================================================
-- 1. NEW TABLES
-- ==============================================================================

-- 1.1. classes (Lớp học — Chỉ Admin tạo/sửa/xóa)
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  description text,
  course_type text not null default 'ielts' check (course_type in ('general', 'vstep', 'toeic', 'ielts')),
  target_band numeric(3,1) check (target_band is null or (target_band >= 1.0 and target_band <= 9.0)),
  schedule_text text,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  start_date date,
  end_date date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

-- 1.2. class_members (Thành viên lớp: Giáo viên chính, Trợ giảng, Học viên)
create table if not exists public.class_members (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'student' check (member_role in ('lead_teacher', 'assistant', 'student')),
  status text not null default 'active' check (status in ('active', 'completed', 'dropped')),
  joined_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (class_id, user_id)
);

-- 1.3. lessons (Buổi học theo lộ trình lớp)
create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  lesson_no integer not null default 1 check (lesson_no >= 1),
  title text not null,
  scheduled_at timestamp with time zone,
  summary_notes text,
  status text not null default 'planned' check (status in ('planned', 'completed', 'cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

-- 1.4. lesson_attendance (Điểm danh từng buổi học)
create table if not exists public.lesson_attendance (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'present' check (status in ('present', 'absent', 'late', 'excused')),
  note text,
  marked_by uuid references public.profiles(id) on delete set null,
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (lesson_id, student_id)
);

-- 1.5. assignments (Bài tập Speaking giao theo lớp có hạn nộp & giới hạn lượt)
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete set null,
  set_id uuid not null references public.question_sets(id) on delete cascade,
  title text not null,
  instructions text,
  mode text not null default 'practice' check (mode in ('practice', 'exam')),
  due_at timestamp with time zone,
  max_attempts integer not null default 0 check (max_attempts >= 0),
  min_band_target numeric(3,1) check (min_band_target is null or (min_band_target >= 1.0 and min_band_target <= 9.0)),
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

-- 1.6. classroom_analyses (Lưu kết quả phân tích EN/VI + timeline JSON theo tiết dạy)
create table if not exists public.classroom_analyses (
  id uuid primary key default gen_random_uuid(),
  class_id uuid references public.classes(id) on delete set null,
  lesson_id uuid references public.lessons(id) on delete set null,
  teacher_id uuid references public.profiles(id) on delete set null,
  file_name text not null,
  en_percent double precision not null default 0,
  vi_percent double precision not null default 0,
  en_time_percent double precision,
  vi_time_percent double precision,
  speech_ratio_percent double precision,
  total_audio_sec double precision,
  total_words integer not null default 0,
  result_json jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

-- ==============================================================================
-- 2. ADDITIVE COLUMNS ON EXISTING TABLES (NON-BREAKING)
-- ==============================================================================
alter table public.assessments
  add column if not exists class_id uuid references public.classes(id) on delete set null,
  add column if not exists lesson_id uuid references public.lessons(id) on delete set null;

alter table public.practice_sessions
  add column if not exists assignment_id uuid references public.assignments(id) on delete set null,
  add column if not exists class_id uuid references public.classes(id) on delete set null,
  add column if not exists is_late boolean not null default false;

-- ==============================================================================
-- 3. IDEMPOTENT BACKFILL FROM LEGACY profiles.teacher_id
--    Tự động gom học viên đã gắn teacher_id vào 1 lớp mặc định cho mỗi giáo viên
-- ==============================================================================
do $$
declare
  rec record;
  v_code text;
  v_class_id uuid;
begin
  for rec in
    select distinct t.id as teacher_id, t.full_name as teacher_name
    from public.profiles s
    join public.profiles t on t.id = s.teacher_id
    where s.role = 'student'
      and t.role = 'teacher'
  loop
    v_code := 'LEGACY-' || upper(substr(replace(rec.teacher_id::text, '-', ''), 1, 6));

    select id into v_class_id
    from public.classes
    where code = v_code
    limit 1;

    if v_class_id is null then
      insert into public.classes (
        name, code, description, course_type, status, created_by
      )
      values (
        'Lớp mặc định - ' || rec.teacher_name,
        v_code,
        'Lớp tự động chuyển đổi từ danh sách học viên phụ trách trước đây.',
        'ielts',
        'active',
        rec.teacher_id
      )
      returning id into v_class_id;
    end if;

    insert into public.class_members (class_id, user_id, member_role, status)
    values (v_class_id, rec.teacher_id, 'lead_teacher', 'active')
    on conflict (class_id, user_id) do nothing;

    insert into public.class_members (class_id, user_id, member_role, status)
    select v_class_id, s.id, 'student', 'active'
    from public.profiles s
    where s.role = 'student'
      and s.teacher_id = rec.teacher_id
    on conflict (class_id, user_id) do nothing;
  end loop;
end $$;

-- ==============================================================================
-- 4. UPGRADED PRIVATE RBAC HELPERS (SECURITY DEFINER, NON-EXPOSED SCHEMA)
-- ==============================================================================
create or replace function private.is_class_teacher(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.class_members cm
    join public.profiles p on p.id = cm.user_id
    where cm.class_id = p_class_id
      and cm.user_id = (select auth.uid())
      and cm.member_role in ('lead_teacher', 'assistant')
      and cm.status = 'active'
      and p.status = 'active'
      and p.role in ('teacher', 'admin')
  );
$$;

create or replace function private.is_class_student(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.class_members cm
    join public.profiles p on p.id = cm.user_id
    where cm.class_id = p_class_id
      and cm.user_id = (select auth.uid())
      and cm.member_role = 'student'
      and cm.status = 'active'
      and p.status = 'active'
  );
$$;

create or replace function private.is_class_member(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.class_members cm
    join public.profiles p on p.id = cm.user_id
    where cm.class_id = p_class_id
      and cm.user_id = (select auth.uid())
      and cm.status in ('active', 'completed')
      and p.status = 'active'
  );
$$;

-- Nâng cấp is_teacher_of: hỗ trợ đồng thời class_members (đa lớp + trợ giảng) & legacy teacher_id
create or replace function private.is_teacher_of(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles t
    where t.id = (select auth.uid())
      and t.role = 'teacher'
      and t.status = 'active'
      and (
        exists (
          select 1
          from public.class_members cm_t
          join public.class_members cm_s
            on cm_s.class_id = cm_t.class_id
          where cm_t.user_id = t.id
            and cm_t.member_role in ('lead_teacher', 'assistant')
            and cm_t.status = 'active'
            and cm_s.user_id = p_student_id
            and cm_s.member_role = 'student'
            and cm_s.status in ('active', 'completed')
        )
        or exists (
          select 1
          from public.profiles s
          where s.id = p_student_id
            and s.teacher_id = t.id
        )
      )
  );
$$;

-- Kiểm tra giáo viên có cùng lớp với thành viên khác (để xem tên giáo viên/trợ giảng cùng lớp)
create or replace function private.shares_class_as_teacher(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.class_members cm_me
    join public.class_members cm_other on cm_other.class_id = cm_me.class_id
    join public.profiles me on me.id = cm_me.user_id
    where cm_me.user_id = (select auth.uid())
      and cm_me.member_role in ('lead_teacher', 'assistant')
      and cm_me.status = 'active'
      and me.status = 'active'
      and cm_other.user_id = p_user_id
  );
$$;

-- Kiểm tra học viên có được giao bộ đề p_set_id trong bất kỳ lớp nào đang học hay không
create or replace function private.is_question_set_assigned_to_me(p_set_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.assignments a
    join public.class_members cm on cm.class_id = a.class_id
    join public.profiles me on me.id = cm.user_id
    where a.set_id = p_set_id
      and cm.user_id = (select auth.uid())
      and cm.member_role = 'student'
      and cm.status in ('active', 'completed')
      and me.status = 'active'
  );
$$;

-- Nâng cấp can_read_question_set để bao gồm cả bộ đề riêng được giao qua assignment
create or replace function private.can_read_question_set(p_set_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.question_sets qs
    join public.profiles me on me.id = (select auth.uid())
    where qs.id = p_set_id
      and me.status = 'active'
      and (
        me.role = 'admin'
        or qs.teacher_id = me.id
        or (me.role = 'teacher' and me.id = any(qs.allowed_teacher_ids))
        or qs.is_published = true
        or private.is_question_set_assigned_to_me(qs.id)
      )
  );
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ==============================================================================
-- 5. INTEGRITY TRIGGERS (ASSIGNMENT ATTEMPTS, MODE LOCK & SERVER-SIDE is_late)
-- ==============================================================================
create or replace function private.protect_practice_sessions_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_asg public.assignments%rowtype;
  v_used_attempts integer;
begin
  if private.is_service_context() or private.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.assignment_id is not null then
      select * into v_asg from public.assignments where id = new.assignment_id;
      if not found then
        raise exception 'Bài tập được giao không tồn tại.';
      end if;

      if not private.is_class_student(v_asg.class_id) then
        raise exception 'Bạn không phải học viên đang theo học lớp của bài tập này.';
      end if;

      -- Ép đúng thông tin lớp, bộ đề và chế độ theo cấu hình bài tập
      new.class_id := v_asg.class_id;
      new.set_id := v_asg.set_id;
      new.mode := v_asg.mode;

      -- Kiểm tra số lượt làm tối đa (chỉ đếm các lượt đã hoàn thành / đã duyệt)
      if v_asg.max_attempts > 0 then
        select count(*) into v_used_attempts
        from public.practice_sessions ps
        where ps.assignment_id = v_asg.id
          and ps.student_id = new.student_id
          and ps.status in ('completed', 'reviewed');

        if v_used_attempts >= v_asg.max_attempts then
          raise exception 'Bạn đã dùng hết %/% lượt làm cho bài tập này.', v_used_attempts, v_asg.max_attempts;
        end if;
      end if;

      new.is_late := (v_asg.due_at is not null and timezone('utc'::text, now()) > v_asg.due_at);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.student_id = (select auth.uid()) then
      if old.status <> 'in_progress' then
        raise exception 'Bài làm đã hoàn thành, không thể chỉnh sửa điểm số hoặc trạng thái.';
      end if;
      if new.status not in ('in_progress', 'completed') then
        raise exception 'Học viên không được phép chuyển trạng thái bài làm sang "%".', new.status;
      end if;
      new.teacher_comment := old.teacher_comment;
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
      new.assignment_id := old.assignment_id;
      new.class_id := old.class_id;

      -- Tính cờ nộp trễ chính xác theo thời điểm hoàn tất trên server
      if new.status = 'completed' and old.assignment_id is not null then
        select * into v_asg from public.assignments where id = old.assignment_id;
        if found and v_asg.due_at is not null then
          new.is_late := (coalesce(new.completed_at, timezone('utc'::text, now())) > v_asg.due_at);
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_practice_sessions_write on public.practice_sessions;
create trigger trg_protect_practice_sessions_write
before insert or update on public.practice_sessions
for each row execute function private.protect_practice_sessions_write();

-- ==============================================================================
-- 6. SAFE PUBLIC RPCs FOR CLASSROOM MANAGEMENT
-- ==============================================================================

-- 6.1. Học viên / Giáo viên lấy danh sách Giáo viên & Trợ giảng của một lớp (không lộ phone/embeddings)
create or replace function public.get_class_teachers(p_class_id uuid)
returns table (
  user_id uuid,
  full_name text,
  email text,
  member_role text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id as user_id, p.full_name, p.email, cm.member_role
  from public.class_members cm
  join public.profiles p on p.id = cm.user_id
  where cm.class_id = p_class_id
    and cm.member_role in ('lead_teacher', 'assistant')
    and cm.status = 'active'
    and (
      private.is_admin()
      or private.is_class_member(p_class_id)
    )
  order by case when cm.member_role = 'lead_teacher' then 0 else 1 end, p.full_name asc;
$$;

revoke all on function public.get_class_teachers(uuid) from public, anon;
grant execute on function public.get_class_teachers(uuid) to authenticated;

-- 6.2. Cập nhật teacher_review_session: hỗ trợ duyệt bài của học viên thuộc lớp giáo viên/trợ giảng phụ trách
create or replace function public.teacher_review_session(
  p_session_id uuid,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sess public.practice_sessions%rowtype;
  v_is_set_owner boolean;
  v_is_cls_teacher boolean := false;
  v_now timestamp with time zone := timezone('utc'::text, now());
begin
  if not (private.is_active_teacher() or private.is_admin()) then
    raise exception 'Chỉ Giáo viên hoặc Quản trị viên mới có quyền duyệt bài.';
  end if;

  select * into v_sess from public.practice_sessions where id = p_session_id;
  if not found then
    raise exception 'Không tìm thấy phiên làm bài.';
  end if;

  if v_sess.status not in ('completed', 'reviewed') then
    raise exception 'Học viên chưa hoàn thành phiên làm bài này.';
  end if;

  select exists (
    select 1 from public.question_sets qs
    where qs.id = v_sess.set_id and qs.teacher_id = (select auth.uid())
  ) into v_is_set_owner;

  if v_sess.class_id is not null then
    v_is_cls_teacher := private.is_class_teacher(v_sess.class_id);
  end if;

  if not (private.is_admin() or v_is_cls_teacher or private.is_teacher_of(v_sess.student_id) or v_is_set_owner) then
    raise exception 'Bạn không có quyền nhận xét bài làm của học viên lớp khác.';
  end if;

  update public.practice_sessions
  set status = 'reviewed',
      teacher_comment = nullif(trim(coalesce(p_comment, '')), ''),
      reviewed_by = (select auth.uid()),
      reviewed_at = v_now
  where id = p_session_id
  returning * into v_sess;

  return jsonb_build_object(
    'id', v_sess.id,
    'status', v_sess.status,
    'teacher_comment', v_sess.teacher_comment,
    'reviewed_by', v_sess.reviewed_by,
    'reviewed_at', v_sess.reviewed_at
  );
end;
$$;

revoke all on function public.teacher_review_session(uuid, text) from public, anon;
grant execute on function public.teacher_review_session(uuid, text) to authenticated;

-- ==============================================================================
-- 7. EXPLICIT GRANTS + ROW LEVEL SECURITY ON ALL NEW & UPDATED TABLES
-- ==============================================================================
revoke all on table
  public.classes,
  public.class_members,
  public.lessons,
  public.lesson_attendance,
  public.assignments,
  public.classroom_analyses
from anon;

grant select, insert, update, delete on table
  public.classes,
  public.class_members,
  public.lessons,
  public.lesson_attendance,
  public.assignments,
  public.classroom_analyses
to authenticated;

-- 7.1. classes (Chỉ Admin tạo/sửa/xóa; thành viên lớp được xem)
alter table public.classes enable row level security;

drop policy if exists "classes_select" on public.classes;
create policy "classes_select"
  on public.classes for select
  to authenticated
  using (
    (select private.is_admin())
    or (select private.is_class_member(id))
  );

drop policy if exists "classes_insert_admin" on public.classes;
create policy "classes_insert_admin"
  on public.classes for insert
  to authenticated
  with check ((select private.is_admin()));

drop policy if exists "classes_update_admin" on public.classes;
create policy "classes_update_admin"
  on public.classes for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists "classes_delete_admin" on public.classes;
create policy "classes_delete_admin"
  on public.classes for delete
  to authenticated
  using ((select private.is_admin()));

-- 7.2. class_members (Chỉ Admin thêm/sửa/gỡ; học viên xem bản ghi của mình; GV/Trợ giảng xem danh sách lớp mình)
alter table public.class_members enable row level security;

drop policy if exists "class_members_select" on public.class_members;
create policy "class_members_select"
  on public.class_members for select
  to authenticated
  using (
    (select private.is_admin())
    or (user_id = (select auth.uid()) and (select private.is_active_user()))
    or (select private.is_class_teacher(class_id))
  );

drop policy if exists "class_members_insert_admin" on public.class_members;
create policy "class_members_insert_admin"
  on public.class_members for insert
  to authenticated
  with check ((select private.is_admin()));

drop policy if exists "class_members_update_admin" on public.class_members;
create policy "class_members_update_admin"
  on public.class_members for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists "class_members_delete_admin" on public.class_members;
create policy "class_members_delete_admin"
  on public.class_members for delete
  to authenticated
  using ((select private.is_admin()));

-- 7.3. lessons (Admin & GV/Trợ giảng lớp quản lý; thành viên lớp xem)
alter table public.lessons enable row level security;

drop policy if exists "lessons_select" on public.lessons;
create policy "lessons_select"
  on public.lessons for select
  to authenticated
  using (
    (select private.is_admin())
    or (select private.is_class_member(class_id))
  );

drop policy if exists "lessons_insert" on public.lessons;
create policy "lessons_insert"
  on public.lessons for insert
  to authenticated
  with check (
    (select private.is_admin())
    or (select private.is_class_teacher(class_id))
  );

drop policy if exists "lessons_update" on public.lessons;
create policy "lessons_update"
  on public.lessons for update
  to authenticated
  using (
    (select private.is_admin())
    or (select private.is_class_teacher(class_id))
  )
  with check (
    (select private.is_admin())
    or (select private.is_class_teacher(class_id))
  );

drop policy if exists "lessons_delete" on public.lessons;
create policy "lessons_delete"
  on public.lessons for delete
  to authenticated
  using (
    (select private.is_admin())
    or (select private.is_class_teacher(class_id))
  );

-- 7.4. lesson_attendance (Admin & GV/Trợ giảng điểm danh; học viên xem điểm danh của chính mình)
alter table public.lesson_attendance enable row level security;

drop policy if exists "lesson_attendance_select" on public.lesson_attendance;
create policy "lesson_attendance_select"
  on public.lesson_attendance for select
  to authenticated
  using (
    (select private.is_admin())
    or (student_id = (select auth.uid()) and (select private.is_active_user()))
    or exists (
      select 1 from public.lessons l
      where l.id = lesson_id
        and (select private.is_class_teacher(l.class_id))
    )
  );

drop policy if exists "lesson_attendance_insert" on public.lesson_attendance;
create policy "lesson_attendance_insert"
  on public.lesson_attendance for insert
  to authenticated
  with check (
    (select private.is_admin())
    or exists (
      select 1 from public.lessons l
      where l.id = lesson_id
        and (select private.is_class_teacher(l.class_id))
    )
  );

drop policy if exists "lesson_attendance_update" on public.lesson_attendance;
create policy "lesson_attendance_update"
  on public.lesson_attendance for update
  to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1 from public.lessons l
      where l.id = lesson_id
        and (select private.is_class_teacher(l.class_id))
    )
  )
  with check (
    (select private.is_admin())
    or exists (
      select 1 from public.lessons l
      where l.id = lesson_id
        and (select private.is_class_teacher(l.class_id))
    )
  );

drop policy if exists "lesson_attendance_delete" on public.lesson_attendance;
create policy "lesson_attendance_delete"
  on public.lesson_attendance for delete
  to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1 from public.lessons l
      where l.id = lesson_id
        and (select private.is_class_teacher(l.class_id))
    )
  );

-- 7.5. assignments (Admin & GV/Trợ giảng giao/sửa/xóa; thành viên lớp xem)
alter table public.assignments enable row level security;

drop policy if exists "assignments_select" on public.assignments;
create policy "assignments_select"
  on public.assignments for select
  to authenticated
  using (
    (select private.is_admin())
    or (select private.is_class_member(class_id))
  );

drop policy if exists "assignments_insert" on public.assignments;
create policy "assignments_insert"
  on public.assignments for insert
  to authenticated
  with check (
    (select private.is_admin())
    or (
      (select private.is_class_teacher(class_id))
      and (select private.can_read_question_set(set_id))
    )
  );

drop policy if exists "assignments_update" on public.assignments;
create policy "assignments_update"
  on public.assignments for update
  to authenticated
  using (
    (select private.is_admin())
    or (select private.is_class_teacher(class_id))
  )
  with check (
    (select private.is_admin())
    or (select private.is_class_teacher(class_id))
  );

drop policy if exists "assignments_delete" on public.assignments;
create policy "assignments_delete"
  on public.assignments for delete
  to authenticated
  using (
    (select private.is_admin())
    or (select private.is_class_teacher(class_id))
  );

-- 7.6. classroom_analyses (Lưu lịch sử phân tích EN/VI — Admin & GV/Trợ giảng lớp)
alter table public.classroom_analyses enable row level security;

drop policy if exists "classroom_analyses_select" on public.classroom_analyses;
create policy "classroom_analyses_select"
  on public.classroom_analyses for select
  to authenticated
  using (
    (select private.is_admin())
    or (teacher_id = (select auth.uid()) and (select private.is_active_teacher()))
    or (class_id is not null and (select private.is_class_teacher(class_id)))
  );

drop policy if exists "classroom_analyses_insert" on public.classroom_analyses;
create policy "classroom_analyses_insert"
  on public.classroom_analyses for insert
  to authenticated
  with check (
    (select private.is_admin())
    or (
      (select private.is_active_teacher())
      and teacher_id = (select auth.uid())
      and (class_id is null or (select private.is_class_teacher(class_id)))
    )
  );

drop policy if exists "classroom_analyses_update" on public.classroom_analyses;
create policy "classroom_analyses_update"
  on public.classroom_analyses for update
  to authenticated
  using (
    (select private.is_admin())
    or (teacher_id = (select auth.uid()) and (select private.is_active_teacher()))
  )
  with check (
    (select private.is_admin())
    or (teacher_id = (select auth.uid()) and (select private.is_active_teacher()))
  );

drop policy if exists "classroom_analyses_delete" on public.classroom_analyses;
create policy "classroom_analyses_delete"
  on public.classroom_analyses for delete
  to authenticated
  using (
    (select private.is_admin())
    or (teacher_id = (select auth.uid()) and (select private.is_active_teacher()))
  );

-- 7.7. Nâng cấp policies các bảng hiện có để tương thích đa lớp & bài tập lớp
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_admin())
    or (select private.is_teacher_of(id))
    or (select private.shares_class_as_teacher(id))
  );

drop policy if exists "question_sets_select" on public.question_sets;
create policy "question_sets_select"
  on public.question_sets for select
  to authenticated
  using (
    (select private.is_active_user())
    and (
      (select private.is_admin())
      or teacher_id = (select auth.uid())
      or ((select private.is_active_teacher()) and (select auth.uid()) = any(allowed_teacher_ids))
      or is_published = true
      or (select private.is_question_set_assigned_to_me(id))
    )
  );

drop policy if exists "assessments_select" on public.assessments;
create policy "assessments_select"
  on public.assessments for select
  to authenticated
  using (
    (select private.is_admin())
    or (teacher_id = (select auth.uid()) and (select private.is_active_teacher()))
    or (class_id is not null and (select private.is_class_teacher(class_id)))
    or (student_id = (select auth.uid()) and saved = true and (select private.is_active_user()))
  );

drop policy if exists "practice_sessions_select" on public.practice_sessions;
create policy "practice_sessions_select"
  on public.practice_sessions for select
  to authenticated
  using (
    (student_id = (select auth.uid()) and (select private.is_active_user()))
    or (select private.is_admin())
    or (class_id is not null and (select private.is_class_teacher(class_id)))
    or (select private.is_teacher_of(student_id))
    or exists (
      select 1 from public.question_sets qs
      where qs.id = set_id
        and qs.teacher_id = (select auth.uid())
        and (select private.is_active_teacher())
    )
  );

drop policy if exists "practice_sessions_insert" on public.practice_sessions;
create policy "practice_sessions_insert"
  on public.practice_sessions for insert
  to authenticated
  with check (
    (select private.current_user_role()) = 'student'
    and (select private.is_active_user())
    and student_id = (select auth.uid())
    and (
      exists (
        select 1 from public.question_sets qs
        where qs.id = set_id and qs.is_published = true
      )
      or (
        assignment_id is not null
        and exists (
          select 1 from public.assignments a
          where a.id = assignment_id
            and a.set_id = set_id
            and (select private.is_class_student(a.class_id))
        )
      )
    )
  );

drop policy if exists "practice_answers_select" on public.practice_answers;
create policy "practice_answers_select"
  on public.practice_answers for select
  to authenticated
  using (
    exists (
      select 1 from public.practice_sessions ps
      where ps.id = session_id
        and (
          (ps.student_id = (select auth.uid()) and (select private.is_active_user()))
          or (select private.is_admin())
          or (ps.class_id is not null and (select private.is_class_teacher(ps.class_id)))
          or (select private.is_teacher_of(ps.student_id))
          or exists (
            select 1 from public.question_sets qs
            where qs.id = ps.set_id
              and qs.teacher_id = (select auth.uid())
              and (select private.is_active_teacher())
          )
        )
    )
  );

-- ==============================================================================
-- 8. PERFORMANCE & RLS INDEXES
-- ==============================================================================
create index if not exists idx_classes_status on public.classes(status);
create index if not exists idx_classes_course_type on public.classes(course_type);
create index if not exists idx_classes_created_at on public.classes(created_at desc);

create index if not exists idx_class_members_class_role_status
  on public.class_members(class_id, member_role, status);
create index if not exists idx_class_members_user_status
  on public.class_members(user_id, status);

create index if not exists idx_lessons_class_scheduled
  on public.lessons(class_id, scheduled_at desc, lesson_no desc);

create index if not exists idx_lesson_attendance_lesson on public.lesson_attendance(lesson_id);
create index if not exists idx_lesson_attendance_student on public.lesson_attendance(student_id);

create index if not exists idx_assignments_class_due on public.assignments(class_id, due_at desc);
create index if not exists idx_assignments_set_id on public.assignments(set_id);
create index if not exists idx_assignments_lesson_id on public.assignments(lesson_id);

create index if not exists idx_classroom_analyses_class_created
  on public.classroom_analyses(class_id, created_at desc);
create index if not exists idx_classroom_analyses_teacher_created
  on public.classroom_analyses(teacher_id, created_at desc);
create index if not exists idx_classroom_analyses_lesson
  on public.classroom_analyses(lesson_id);

create index if not exists idx_assessments_class_created
  on public.assessments(class_id, created_at desc);
create index if not exists idx_assessments_lesson
  on public.assessments(lesson_id);

create index if not exists idx_practice_sessions_assignment_student
  on public.practice_sessions(assignment_id, student_id, status);
create index if not exists idx_practice_sessions_class_status
  on public.practice_sessions(class_id, status);

-- ==============================================================================
-- 9. RELOAD POSTGREST SCHEMA CACHE
-- ==============================================================================
notify pgrst, 'reload schema';
