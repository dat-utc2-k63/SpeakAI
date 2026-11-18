-- ==============================================================================
-- SpeakAI — Clean Reset Database (Giữ lại Admin + global_settings, xóa sạch dữ liệu nghiệp vụ)
-- ==============================================================================
-- HƯỚNG DẪN CHẠY TRÊN SUPABASE SQL EDITOR:
--   Bước 1: Chạy file `supabase/speak_web_schema.sql` trước (để cập nhật đủ 13 bảng,
--           8 cột thông tin ghi danh mới và khóa RLS/Trigger chống tự đăng ký).
--   Bước 2: Chạy file `supabase/clean_reset_data.sql` này 1 lần duy nhất để dọn trắng
--           toàn bộ dữ liệu test cũ (lớp học, buổi học, điểm danh, bài tập, bộ đề,
--           bài luyện tập, chấm 1-1, phân tích EN/VI và mọi tài khoản không phải Admin).
--
-- LƯU Ý AN TOÀN:
--   - Giữ nguyên 100% tài khoản Quản trị viên (role = 'admin', status = 'active').
--   - Giữ nguyên 100% cấu hình `public.global_settings` (đường dẫn AI & Gemini Key).
--   - Nếu muốn dọn thêm file ghi âm cũ trên Storage, vào Supabase Dashboard -> Storage
--     và xóa thủ công trong các bucket (Supabase không cho DELETE trực tiếp bảng storage.objects).
-- ==============================================================================

begin;

do $$
declare
  v_admin_ids uuid[];
  v_admin_count integer;
begin
  -- 1. Kiểm tra an toàn: bắt buộc phải có ít nhất 1 Admin đang hoạt động trước khi dọn
  select array_agg(id)
  into v_admin_ids
  from public.profiles
  where role = 'admin'
    and status = 'active';

  v_admin_count := coalesce(array_length(v_admin_ids, 1), 0);

  if v_admin_count < 1 then
    raise exception 'Hủy thao tác dọn dữ liệu: Không tìm thấy tài khoản Quản trị viên (admin + active) nào để giữ lại.';
  end if;

  -- 2. Xóa sạch toàn bộ dữ liệu nghiệp vụ theo đúng thứ tự khóa ngoại (từ bảng con -> bảng cha)
  delete from public.practice_answers;
  delete from public.practice_sessions;
  delete from public.lesson_attendance;
  delete from public.assignments;
  delete from public.classroom_analyses;
  delete from public.assessments;
  delete from public.lessons;
  delete from public.class_members;
  delete from public.classes;
  delete from public.questions;
  delete from public.question_sets;

  -- 3. Xóa toàn bộ tài khoản không phải Admin (Học viên test, Giáo viên test, tài khoản chờ duyệt/khóa)
  --    Xóa cả trong `public.profiles` và `auth.users` để giải phóng hoàn toàn email cũ
  delete from public.profiles
  where not (id = any(v_admin_ids));

  delete from auth.users
  where not (id = any(v_admin_ids));

  -- 4. Chuẩn hóa nhẹ hồ sơ Admin được giữ lại (xóa teacher_id cũ nếu có)
  update public.profiles
  set teacher_id = null
  where id = any(v_admin_ids);

  raise notice 'Đã dọn sạch toàn bộ dữ liệu nghiệp vụ. Giữ lại % tài khoản Admin và nguyên vẹn global_settings.', v_admin_count;
end $$;

commit;

-- Làm mới cache PostgREST
notify pgrst, 'reload schema';

-- ==============================================================================
-- BẢNG KIỂM TRA KẾT QUẢ SAU KHI DỌN DỮ LIỆU
-- ==============================================================================
select 'profiles (Admin giữ lại)' as bang, count(*) as so_dong from public.profiles
union all select 'auth.users (Admin giữ lại)', count(*) from auth.users
union all select 'global_settings (Giữ nguyên)', count(*) from public.global_settings
union all select 'classes', count(*) from public.classes
union all select 'class_members', count(*) from public.class_members
union all select 'lessons', count(*) from public.lessons
union all select 'lesson_attendance', count(*) from public.lesson_attendance
union all select 'assignments', count(*) from public.assignments
union all select 'question_sets', count(*) from public.question_sets
union all select 'questions', count(*) from public.questions
union all select 'practice_sessions', count(*) from public.practice_sessions
union all select 'practice_answers', count(*) from public.practice_answers
union all select 'assessments', count(*) from public.assessments
union all select 'classroom_analyses', count(*) from public.classroom_analyses;

-- Xem danh sách tài khoản Admin được giữ lại
select id, full_name, email, role, status, created_at
from public.profiles
order by created_at asc;
