import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient, supabase } from './supabase';
import { translateAuthError } from './utils';
import type {
  AccountStatus,
  Profile,
  PublicRuntimeConfig,
  QuestionLevel,
  UserRole,
} from './types';

export async function getPublicRuntimeConfig(): Promise<PublicRuntimeConfig | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_public_runtime_config');
  if (error) {
    console.warn('Lỗi lấy cấu hình hệ thống công khai:', error.message);
    return null;
  }
  return Array.isArray(data) ? (data[0] as PublicRuntimeConfig) || null : (data as PublicRuntimeConfig) || null;
}

export async function signIn({ email, password }: { email: string; password: string }) {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut(): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

export async function getAccessToken(): Promise<string> {
  const session = await getSession();
  return session?.access_token || '';
}

let cachedUserRole: string | null = null;

export function setCachedUserRole(role: string | null) {
  cachedUserRole = role;
}

export async function getAuthHeaders(role?: string): Promise<Record<string, string>> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const effectiveRole = role || cachedUserRole;
  if (effectiveRole) {
    headers['X-User-Role'] = effectiveRole;
  }
  return headers;
}

export async function getProfile(userId: string): Promise<Profile> {
  const client = getSupabaseClient();
  const { data, error } = await client.from('profiles').select('*').eq('id', userId).single();
  if (error) throw error;
  if (data?.role) {
    setCachedUserRole(data.role);
  }
  return data as Profile;
}

export async function updateProfile(userId: string, updates: Partial<Profile>): Promise<Profile> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function changeMyPassword(
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const client = getSupabaseClient();
  if (!currentPassword) {
    throw new Error('Vui lòng nhập mật khẩu hiện tại.');
  }
  if (!newPassword || newPassword.length < 6) {
    throw new Error('Mật khẩu mới phải có ít nhất 6 ký tự.');
  }
  if (newPassword === currentPassword) {
    throw new Error('Mật khẩu mới phải khác mật khẩu hiện tại.');
  }

  const { error: verifyErr } = await client.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (verifyErr) {
    throw new Error('Mật khẩu hiện tại không chính xác.');
  }

  const { error: updateErr } = await client.auth.updateUser({ password: newPassword });
  if (updateErr) {
    throw new Error(translateAuthError(updateErr.message));
  }
}

export interface AdminCreateUserParams {
  email: string;
  password: string;
  full_name: string;
  phone?: string;
  role: 'student' | 'teacher';
  student_code?: string;
  date_of_birth?: string;
  entry_level?: QuestionLevel | '';
  target_band?: number | '' | null;
  guardian_name?: string;
  guardian_phone?: string;
  enrollment_note?: string;
}

export async function adminCreateUser(params: AdminCreateUserParams): Promise<Profile> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(params),
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    user?: Profile;
    error?: string;
  };
  if (!res.ok || !json.success || !json.user) {
    throw new Error(json.error || 'Không thể tạo tài khoản mới.');
  }
  return json.user;
}

export async function adminResetUserPassword(userId: string, newPassword: string): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/admin/users/reset-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ user_id: userId, new_password: newPassword }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
  };
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Không thể đặt lại mật khẩu.');
  }
}

export interface StudentEnrollmentUpdates {
  full_name?: string;
  phone?: string | null;
  student_code?: string | null;
  date_of_birth?: string | null;
  entry_level?: QuestionLevel | null;
  target_band?: number | null;
  guardian_name?: string | null;
  guardian_phone?: string | null;
  enrollment_note?: string | null;
}

export async function adminUpdateStudentEnrollment(
  userId: string,
  updates: StudentEnrollmentUpdates,
): Promise<Profile> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function updateGlobalGpuUrl(apiUrl: string): Promise<{ api_url?: string }> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('global_settings')
    .upsert({
      id: 1,
      api_url: apiUrl.trim(),
      updated_at: new Date().toISOString(),
    })
    .select('id, api_url, updated_at')
    .single();
  if (error) throw error;
  return data as { api_url?: string };
}

export async function adminUpdateUser(
  userId: string,
  { role, status, teacherId = null }: { role: UserRole; status: AccountStatus; teacherId?: string | null },
) {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('admin_update_user', {
    p_user_id: userId,
    p_role: role,
    p_status: status,
    p_teacher_id: teacherId || null,
  });
  if (error) throw error;
  return data;
}

export async function deleteUserByAdmin(userId: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.rpc('delete_user_by_admin', { user_id: userId });
  if (error) throw error;
}
