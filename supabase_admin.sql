-- Tạo bảng global_settings
CREATE TABLE IF NOT EXISTS public.global_settings (
    id int4 PRIMARY KEY DEFAULT 1,
    api_url text
);

-- Bật RLS
ALTER TABLE public.global_settings ENABLE ROW LEVEL SECURITY;

-- Cho phép tất cả mọi người đọc (SELECT) global_settings
DROP POLICY IF EXISTS "Allow public select on global_settings" ON public.global_settings;
CREATE POLICY "Allow public select on global_settings" 
ON public.global_settings 
FOR SELECT 
USING (true);

-- Chỉ admin mới được quyền UPDATE, INSERT, DELETE
DROP POLICY IF EXISTS "Allow admin all on global_settings" ON public.global_settings;
CREATE POLICY "Allow admin all on global_settings" 
ON public.global_settings 
FOR ALL 
USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
);

-- Khởi tạo dòng đầu tiên nếu chưa có
INSERT INTO public.global_settings (id, api_url)
VALUES (1, '')
ON CONFLICT (id) DO NOTHING;

-- Bổ sung Policy cho bảng profiles để Admin có thể SELECT/UPDATE/DELETE mọi profile
-- Mặc định người dùng chỉ xem được profile của mình hoặc của giáo viên liên quan.
-- Ta thêm policy cho role='admin'
DROP POLICY IF EXISTS "Admin full access on profiles" ON public.profiles;
CREATE POLICY "Admin full access on profiles"
ON public.profiles
FOR ALL
USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
);
