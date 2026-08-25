import { supabase } from './supabase.js';

// =========================================================
// AUTH MODULE
// =========================================================

/**
 * Lấy danh sách teachers để hiển thị trong dropdown khi student đăng ký
 */
export async function fetchTeachers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'teacher')
    .order('full_name');
  if (error) throw error;
  return data;
}

/**
 * Đăng ký tài khoản mới
 */
export async function signUp({ email, password, fullName, phone, role, teacherId, voiceUrl, voiceEmbeddings }) {
  // 1. Tạo auth user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email, password
  });
  if (authError) {
      if (authError.message.includes('User already registered') || authError.status === 400) {
          throw new Error('Email này đã từng được sử dụng (có thể do lỗi đăng ký nửa chừng trước đó). Vui lòng sang tab Đăng nhập, hoặc dùng một Email khác!');
      }
      throw authError;
  }

  // 2. Tạo profile
  const user = authData.user;
  if (user) {
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        role: role,
        full_name: fullName,
        email: email,
        phone: phone || null,
        teacher_id: teacherId || null,
        voice_enrolled: !!voiceUrl,
        voice_sample_url: voiceUrl || null,
        voice_embeddings: voiceEmbeddings || null
      });
    if (profileError) throw profileError;
  }
  return authData;
}

/**
 * Đăng nhập
 */
export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/**
 * Đăng xuất
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Lấy user session hiện tại
 */
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/**
 * Lấy profile của user hiện tại
 */
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Cập nhật profile
 */
export async function updateProfile(userId, updates) {
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
