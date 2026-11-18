import { randomBytes } from 'node:crypto';
import { getServerEnv } from './env';

export type FetchLike = typeof fetch;

export interface AdminUsersDependencies {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
}

function jsonResponse(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function generateStudentCode(): string {
  const year = new Date().getFullYear();
  const suffix = randomBytes(3).toString('hex').slice(0, 5).toUpperCase();
  return `HV-${year}-${suffix}`;
}

async function verifyAdminCaller(
  req: Request,
  fetchImpl: FetchLike,
  supabaseUrl: string,
  supabaseAnonKey: string,
  serviceRoleKey: string,
): Promise<{ ok: true; adminId: string } | { ok: false; response: Response }> {
  const authHeader = String(req.headers.get('authorization') || '');
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const jwt = match ? match[1].trim() : '';
  if (!jwt) {
    return {
      ok: false,
      response: jsonResponse(401, {
        success: false,
        error: 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.',
      }),
    };
  }

  let authUser: { id?: string } | null = null;
  try {
    const userRes = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${jwt}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!userRes.ok) {
      return {
        ok: false,
        response: jsonResponse(401, {
          success: false,
          error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
        }),
      };
    }
    authUser = (await userRes.json()) as { id?: string };
  } catch {
    return {
      ok: false,
      response: jsonResponse(502, {
        success: false,
        error: 'Không thể xác thực tài khoản lúc này. Vui lòng thử lại.',
      }),
    };
  }

  if (!authUser?.id) {
    return {
      ok: false,
      response: jsonResponse(401, {
        success: false,
        error: 'Không xác định được danh tính người dùng.',
      }),
    };
  }

  const profileKey = serviceRoleKey || supabaseAnonKey;
  const profileBearer = serviceRoleKey || jwt;
  let profile: { id: string; role: string; status: string } | null = null;

  try {
    const profRes = await fetchImpl(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}&select=id,role,status&limit=1`,
      {
        method: 'GET',
        headers: {
          apikey: profileKey,
          Authorization: `Bearer ${profileBearer}`,
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (profRes.ok) {
      const rows = (await profRes.json()) as Array<{ id: string; role: string; status: string }>;
      profile = rows[0] || null;
    }
  } catch {
    return {
      ok: false,
      response: jsonResponse(502, {
        success: false,
        error: 'Không thể kiểm tra quyền quản trị. Vui lòng thử lại.',
      }),
    };
  }

  if (!profile || profile.role !== 'admin' || profile.status !== 'active') {
    return {
      ok: false,
      response: jsonResponse(403, {
        success: false,
        error: 'Chỉ Quản trị viên / Giáo vụ mới có quyền thực hiện thao tác này.',
      }),
    };
  }

  if (!serviceRoleKey) {
    return {
      ok: false,
      response: jsonResponse(503, {
        success: false,
        error:
          'Máy chủ web chưa được cấu hình SUPABASE_SERVICE_ROLE_KEY trong tệp web/.env.local. Vui lòng bổ sung khóa này để kích hoạt tính năng cấp tài khoản & đặt lại mật khẩu.',
      }),
    };
  }

  return { ok: true, adminId: authUser.id };
}

function translateAdminAuthError(raw?: string): string {
  const m = String(raw || '').toLowerCase();
  if (m.includes('already been registered') || m.includes('already exists') || m.includes('duplicate')) {
    if (m.includes('student_code')) return 'Mã học viên này đã tồn tại trong hệ thống.';
    return 'Email này đã được sử dụng cho một tài khoản khác.';
  }
  if (m.includes('invalid email') || m.includes('unable to validate email')) {
    return 'Địa chỉ email không hợp lệ.';
  }
  if (m.includes('password') && m.includes('6')) {
    return 'Mật khẩu phải có ít nhất 6 ký tự.';
  }
  return raw || 'Không thể hoàn tất thao tác. Vui lòng thử lại.';
}

export async function handleAdminCreateUser(
  req: Request,
  deps: AdminUsersDependencies = {},
): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Phương thức không được hỗ trợ.' });
  }

  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const env = getServerEnv(deps.env);
  const supabaseUrl = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supabaseAnonKey = String(env.SUPABASE_ANON_KEY || '').trim();
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(500, {
      success: false,
      error: 'Thiếu cấu hình kết nối cơ sở dữ liệu trên máy chủ.',
    });
  }

  const authCheck = await verifyAdminCaller(req, fetchImpl, supabaseUrl, supabaseAnonKey, serviceRoleKey);
  if (!authCheck.ok) return authCheck.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { success: false, error: 'Dữ liệu gửi lên không hợp lệ.' });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const fullName = String(body.full_name || '').trim();
  const phone = String(body.phone || '').trim() || null;
  const roleRaw = String(body.role || 'student').trim().toLowerCase();
  const role: 'student' | 'teacher' = roleRaw === 'teacher' ? 'teacher' : 'student';

  if (!fullName) {
    return jsonResponse(400, { success: false, error: 'Vui lòng nhập họ và tên.' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse(400, { success: false, error: 'Địa chỉ email không hợp lệ.' });
  }
  if (password.length < 6) {
    return jsonResponse(400, { success: false, error: 'Mật khẩu ban đầu phải có ít nhất 6 ký tự.' });
  }

  // Enrollment fields (only for students)
  let studentCode: string | null = null;
  let dateOfBirth: string | null = null;
  let entryLevel: 'beginner' | 'intermediate' | 'advanced' | null = null;
  let targetBand: number | null = null;
  let guardianName: string | null = null;
  let guardianPhone: string | null = null;
  let enrollmentNote: string | null = null;

  if (role === 'student') {
    const rawCode = String(body.student_code || '').trim();
    studentCode = rawCode || generateStudentCode();

    const rawDob = String(body.date_of_birth || '').trim();
    if (rawDob) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDob)) {
        return jsonResponse(400, { success: false, error: 'Ngày sinh không đúng định dạng.' });
      }
      dateOfBirth = rawDob;
    }

    const rawLevel = String(body.entry_level || '').trim().toLowerCase();
    if (rawLevel) {
      if (!['beginner', 'intermediate', 'advanced'].includes(rawLevel)) {
        return jsonResponse(400, { success: false, error: 'Trình độ đầu vào không hợp lệ.' });
      }
      entryLevel = rawLevel as 'beginner' | 'intermediate' | 'advanced';
    }

    if (body.target_band !== undefined && body.target_band !== null && String(body.target_band).trim() !== '') {
      const parsed = Number(body.target_band);
      if (Number.isNaN(parsed) || parsed < 1.0 || parsed > 9.0) {
        return jsonResponse(400, {
          success: false,
          error: 'Mục tiêu Band IELTS phải nằm trong khoảng từ 1.0 đến 9.0.',
        });
      }
      targetBand = Math.round(parsed * 2) / 2;
    }

    guardianName = String(body.guardian_name || '').trim() || null;
    guardianPhone = String(body.guardian_phone || '').trim() || null;
    enrollmentNote = String(body.enrollment_note || '').trim() || null;
  }

  // 1. Create Supabase Auth user (auto-confirmed, immediately ready to log in)
  let createdAuthUserId = '';
  try {
    const createAuthRes = await fetchImpl(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
        },
        app_metadata: {
          role,
        },
      }),
      signal: AbortSignal.timeout(15000),
    });

    const authPayload = (await createAuthRes.json().catch(() => ({}))) as {
      id?: string;
      msg?: string;
      message?: string;
      error_description?: string;
    };

    if (!createAuthRes.ok || !authPayload.id) {
      return jsonResponse(createAuthRes.status >= 400 && createAuthRes.status < 500 ? 400 : 502, {
        success: false,
        error: translateAdminAuthError(
          authPayload.msg || authPayload.message || authPayload.error_description,
        ),
      });
    }

    createdAuthUserId = authPayload.id;
  } catch {
    return jsonResponse(502, {
      success: false,
      error: 'Không thể kết nối để tạo tài khoản lúc này. Vui lòng thử lại.',
    });
  }

  // 2. Insert profile row with enrollment metadata
  const profileRow: Record<string, unknown> = {
    id: createdAuthUserId,
    role,
    status: 'active',
    full_name: fullName,
    email,
    phone,
    teacher_id: null,
    voice_enrolled: false,
    enrolled_at: new Date().toISOString(),
  };

  if (role === 'student') {
    profileRow.student_code = studentCode;
    profileRow.date_of_birth = dateOfBirth;
    profileRow.entry_level = entryLevel;
    profileRow.target_band = targetBand;
    profileRow.guardian_name = guardianName;
    profileRow.guardian_phone = guardianPhone;
    profileRow.enrollment_note = enrollmentNote;
  }

  try {
    const insertRes = await fetchImpl(`${supabaseUrl}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(profileRow),
      signal: AbortSignal.timeout(15000),
    });

    if (!insertRes.ok) {
      const errBody = (await insertRes.json().catch(() => ({}))) as {
        message?: string;
        details?: string;
      };
      // Rollback Auth user to prevent orphan records
      await fetchImpl(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(createdAuthUserId)}`, {
        method: 'DELETE',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        signal: AbortSignal.timeout(10000),
      }).catch(() => {});

      const errMsg = errBody.message || errBody.details || '';
      if (errMsg.toLowerCase().includes('column') && errMsg.toLowerCase().includes('does not exist')) {
        return jsonResponse(500, {
          success: false,
          error:
            'Cơ sở dữ liệu chưa được cập nhật các cột thông tin ghi danh mới. Vui lòng chạy lại tệp speak_web_schema.sql trên Supabase.',
        });
      }

      return jsonResponse(400, {
        success: false,
        error: translateAdminAuthError(errMsg),
      });
    }

    const inserted = (await insertRes.json()) as Array<Record<string, unknown>>;
    return jsonResponse(201, {
      success: true,
      user: inserted[0] || profileRow,
    });
  } catch {
    await fetchImpl(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(createdAuthUserId)}`, {
      method: 'DELETE',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      signal: AbortSignal.timeout(10000),
    }).catch(() => {});

    return jsonResponse(502, {
      success: false,
      error: 'Lỗi lưu hồ sơ người dùng. Vui lòng thử lại.',
    });
  }
}

export async function handleAdminResetPassword(
  req: Request,
  deps: AdminUsersDependencies = {},
): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Phương thức không được hỗ trợ.' });
  }

  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const env = getServerEnv(deps.env);
  const supabaseUrl = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supabaseAnonKey = String(env.SUPABASE_ANON_KEY || '').trim();
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(500, {
      success: false,
      error: 'Thiếu cấu hình kết nối cơ sở dữ liệu trên máy chủ.',
    });
  }

  const authCheck = await verifyAdminCaller(req, fetchImpl, supabaseUrl, supabaseAnonKey, serviceRoleKey);
  if (!authCheck.ok) return authCheck.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { success: false, error: 'Dữ liệu gửi lên không hợp lệ.' });
  }

  const userId = String(body.user_id || '').trim();
  const newPassword = String(body.new_password || '');

  if (!userId) {
    return jsonResponse(400, { success: false, error: 'Thiếu mã tài khoản cần đặt lại mật khẩu.' });
  }
  if (newPassword.length < 6) {
    return jsonResponse(400, { success: false, error: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });
  }

  // Verify target user exists and prevent resetting another admin's password
  try {
    const targetRes = await fetchImpl(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,role,full_name&limit=1`,
      {
        method: 'GET',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!targetRes.ok) {
      return jsonResponse(502, { success: false, error: 'Không thể kiểm tra tài khoản mục tiêu.' });
    }
    const rows = (await targetRes.json()) as Array<{ id: string; role: string; full_name: string }>;
    const target = rows[0];
    if (!target) {
      return jsonResponse(404, { success: false, error: 'Không tìm thấy tài khoản.' });
    }
    if (target.role === 'admin' && target.id !== authCheck.adminId) {
      return jsonResponse(403, {
        success: false,
        error: 'Không thể đặt lại mật khẩu của tài khoản Quản trị viên khác.',
      });
    }
  } catch {
    return jsonResponse(502, { success: false, error: 'Lỗi kiểm tra tài khoản mục tiêu.' });
  }

  try {
    const updateRes = await fetchImpl(
      `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        method: 'PUT',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: newPassword }),
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!updateRes.ok) {
      const errJson = (await updateRes.json().catch(() => ({}))) as {
        msg?: string;
        message?: string;
      };
      return jsonResponse(400, {
        success: false,
        error: translateAdminAuthError(errJson.msg || errJson.message),
      });
    }

    return jsonResponse(200, { success: true });
  } catch {
    return jsonResponse(502, {
      success: false,
      error: 'Không thể đặt lại mật khẩu lúc này. Vui lòng thử lại.',
    });
  }
}
