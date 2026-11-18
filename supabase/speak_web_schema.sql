-- ==============================================================================
-- SpeakAI Web Platform - RBAC & RLS Production Schema (v4.0)
-- Project: SpeakAI (configure SUPABASE_URL in `.env`)
-- Mô tả: Cấu trúc DB chuẩn hóa phân quyền 3 vai trò (admin / teacher / student),
--        BẬT RLS 100% trên toàn bộ bảng & Storage, có Trigger chống leo thang quyền.
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
  add column if not exists status text not null default 'active';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_status_check' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_status_check check (status in ('pending', 'active', 'suspended'));
  end if;
end $$;

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
-- Cấu hình hệ thống (GPU Backend URL & AI Evaluator API — Key AI chỉ Admin/Service Role đọc)
create table if not exists public.global_settings (
  id integer primary key default 1,
  api_url text,
  gemini_api_key text,
  gemini_api_url text default 'https://revidapi.com/v1/chat/completions',
  gemini_model text default 'gemini-3.8-flash',
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

insert into public.global_settings (id, api_url, gemini_api_url, gemini_model)
values (1, '', 'https://revidapi.com/v1/chat/completions', 'gemini-3.8-flash')
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

  -- Cho phép PostgreSQL SQL Editor / service_role thao tác quản trị hệ thống
  if private.is_service_context() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not private.is_admin() then
      if new.id <> (select auth.uid()) then
        raise exception 'Không thể tạo hồ sơ cho người dùng khác.';
      end if;
      if new.role not in ('student', 'teacher') then
        raise exception 'Không được phép tự đăng ký vai trò "%".', new.role;
      end if;
      if new.role = 'teacher' then
        -- Giáo viên tự đăng ký luôn ở trạng thái chờ Admin phê duyệt
        new.status := 'pending';
        new.teacher_id := null;
      else
        new.status := 'active';
        if new.teacher_id is not null and not private.is_active_teacher_id(new.teacher_id) then
          raise exception 'Giáo viên được chọn không tồn tại hoặc chưa được kích hoạt.';
        end if;
      end if;
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

revoke all on function public.get_signup_teachers() from public;
grant execute on function public.get_signup_teachers() to anon, authenticated;

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

-- 5.4. Lấy cấu hình runtime công khai (TUYỆT ĐỐI KHÔNG TRẢ gemini_api_key)
create or replace function public.get_public_runtime_config()
returns table (api_url text, gemini_api_url text, gemini_model text)
language sql
stable
security definer
set search_path = ''
as $$
  select gs.api_url, gs.gemini_api_url, gs.gemini_model
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
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (
    id = (select auth.uid())
    and role in ('student', 'teacher')
  );

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
-- 9. RELOAD POSTGREST SCHEMA CACHE
-- ==============================================================================
notify pgrst, 'reload schema';
