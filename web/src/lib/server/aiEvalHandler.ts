import { getServerEnv } from './env';

const DEFAULT_ENDPOINT = 'https://revidapi.com/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-v4.1-flash';

export type FetchLike = typeof fetch;

export interface AiEvalDependencies {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
  };
}

function jsonResponse(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

export function createAiEvalOptionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function handleAiEvalRequest(req: Request, deps: AiEvalDependencies = {}): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return createAiEvalOptionsResponse();
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Method Not Allowed' });
  }

  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const env = getServerEnv(deps.env);

  const supabaseUrl = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supabaseAnonKey = String(env.SUPABASE_ANON_KEY || env.SUPABASE_KEY || '').trim();
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(500, {
      success: false,
      error: 'Thiếu cấu hình SUPABASE_URL hoặc SUPABASE_ANON_KEY trên server.',
    });
  }

  const authHeader = String(req.headers.get('authorization') || '');
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const jwt = match ? match[1].trim() : '';
  if (!jwt) {
    return jsonResponse(401, {
      success: false,
      error: 'Thiếu token xác thực (Authorization Bearer JWT).',
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { success: false, error: 'Payload JSON không hợp lệ.' });
  }

  const action = String(body?.action || '').trim();
  if (!['ping_test', 'eval_answer', 'eval_conversation'].includes(action)) {
    return jsonResponse(400, { success: false, error: `Action không hợp lệ: ${action}` });
  }

  // 1. Verify Supabase JWT
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
      return jsonResponse(401, {
        success: false,
        error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
      });
    }
    authUser = (await userRes.json()) as { id?: string };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse(502, { success: false, error: `Lỗi xác thực Supabase: ${msg}` });
  }

  if (!authUser?.id) {
    return jsonResponse(401, { success: false, error: 'Không xác định được danh tính người dùng.' });
  }

  // 2. Load caller profile (role + status)
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
    if (!profRes.ok) {
      return jsonResponse(403, { success: false, error: 'Không thể đọc hồ sơ phân quyền người dùng.' });
    }
    const rows = (await profRes.json()) as Array<{ id: string; role: string; status: string }>;
    profile = Array.isArray(rows) ? rows[0] || null : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse(502, { success: false, error: `Lỗi kiểm tra hồ sơ người dùng: ${msg}` });
  }

  if (!profile) {
    return jsonResponse(403, { success: false, error: 'Hồ sơ tài khoản không tồn tại.' });
  }

  if (profile.status !== 'active') {
    return jsonResponse(403, {
      success: false,
      error:
        profile.status === 'pending'
          ? 'Tài khoản đang chờ Quản trị viên phê duyệt.'
          : 'Tài khoản đang bị tạm khóa.',
    });
  }

  // 3. Enforce Action RBAC
  if (action === 'ping_test' && profile.role !== 'admin') {
    return jsonResponse(403, {
      success: false,
      error: 'Chỉ Quản trị viên mới được phép kiểm tra kết nối AI.',
    });
  }
  if (action === 'eval_conversation' && !['teacher', 'admin'].includes(profile.role)) {
    return jsonResponse(403, {
      success: false,
      error: 'Chỉ Giáo viên hoặc Quản trị viên mới được đánh giá hội thoại 1-1.',
    });
  }

  // 4. Load server-side AI API key from global_settings (with env fallback)
  let storedSettings: { gemini_api_key?: string; gemini_api_url?: string; gemini_model?: string } | null = null;
  const settingsBearer = serviceRoleKey || (profile.role === 'admin' ? jwt : '');
  const settingsApiKeyHeader = serviceRoleKey || supabaseAnonKey;

  if (settingsBearer) {
    try {
      const gsRes = await fetchImpl(
        `${supabaseUrl}/rest/v1/global_settings?id=eq.1&select=gemini_api_key,gemini_api_url,gemini_model&limit=1`,
        {
          method: 'GET',
          headers: {
            apikey: settingsApiKeyHeader,
            Authorization: `Bearer ${settingsBearer}`,
          },
          signal: AbortSignal.timeout(10000),
        },
      );
      if (gsRes.ok) {
        const gsRows = (await gsRes.json()) as Array<{
          gemini_api_key?: string;
          gemini_api_url?: string;
          gemini_model?: string;
        }>;
        storedSettings = Array.isArray(gsRows) ? gsRows[0] || null : null;
      }
    } catch {
      // Non-fatal fallback to env vars below
    }
  }

  const defaultEndpoint = String(
    storedSettings?.gemini_api_url || env.DEFAULT_GEMINI_ENDPOINT || DEFAULT_ENDPOINT,
  ).trim();
  const defaultModel = String(
    storedSettings?.gemini_model || env.DEFAULT_GEMINI_MODEL || DEFAULT_MODEL,
  ).trim();
  const storedApiKey = String(storedSettings?.gemini_api_key || env.GEMINI_API_KEY || '').trim();

  if (action === 'ping_test') {
    const draft =
      body?.draftConfig && typeof body.draftConfig === 'object'
        ? (body.draftConfig as Record<string, unknown>)
        : {};
    const testKey = String(draft.apiKey || storedApiKey || '').trim();
    const testUrl = String(draft.apiUrl || defaultEndpoint).trim();
    const testModel = String(draft.model || defaultModel).trim();

    if (!testKey) {
      return jsonResponse(400, { success: false, error: 'Chưa có AI API Key để kiểm tra.' });
    }

    try {
      const aiRes = await fetchImpl(testUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testKey}`,
          'x-api-key': testKey,
        },
        body: JSON.stringify({
          model: testModel,
          messages: [{ role: 'user', content: 'Ping test. Reply with "OK".' }],
          max_tokens: 16,
          enable_thinking: false,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!aiRes.ok) {
        const errText = await aiRes.text().catch(() => '');
        return jsonResponse(502, {
          success: false,
          error: `API Lỗi HTTP ${aiRes.status}: ${errText.slice(0, 200) || aiRes.statusText}`,
        });
      }
      const data = (await aiRes.json()) as { model?: string; choices?: Array<{ message?: { content?: string } }> };
      return jsonResponse(200, {
        success: true,
        model: data?.model || testModel,
        reply: String(data?.choices?.[0]?.message?.content || '').trim(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse(502, { success: false, error: `Không kết nối được AI API: ${msg}` });
    }
  }

  // 5. Handle eval_answer / eval_conversation
  if (!storedApiKey) {
    return jsonResponse(503, {
      success: false,
      code: 'AI_KEY_MISSING',
      error: 'Chưa cấu hình AI API Key trên hệ thống.',
    });
  }

  const rawMessages = body?.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length < 1 || rawMessages.length > 2) {
    return jsonResponse(400, {
      success: false,
      error: 'Danh sách messages không hợp lệ (chỉ chấp nhận 1-2 messages).',
    });
  }

  const safeMessages: Array<{ role: string; content: unknown }> = [];
  for (const msg of rawMessages) {
    if (!msg || typeof msg !== 'object') {
      return jsonResponse(400, { success: false, error: 'Cấu trúc message không hợp lệ.' });
    }
    const m = msg as { role?: string; content?: unknown };
    if (!m.role || !['system', 'user'].includes(m.role) || m.content == null) {
      return jsonResponse(400, { success: false, error: 'Cấu trúc message không hợp lệ.' });
    }
    safeMessages.push({ role: m.role, content: m.content });
  }

  const temperatureRaw = Number(body?.temperature);
  const temperature = Number.isFinite(temperatureRaw) ? Math.min(1, Math.max(0, temperatureRaw)) : 0.2;

  try {
    const upstreamRes = await fetchImpl(defaultEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${storedApiKey}`,
        'x-api-key': storedApiKey,
      },
      body: JSON.stringify({
        model: defaultModel,
        messages: safeMessages,
        temperature,
        max_tokens: 2048,
        enable_thinking: false,
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text().catch(() => '');
      return jsonResponse(502, {
        success: false,
        error: `Upstream AI API HTTP ${upstreamRes.status}: ${errText.slice(0, 200)}`,
      });
    }

    const data = (await upstreamRes.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = String(data?.choices?.[0]?.message?.content || '');
    return jsonResponse(200, {
      success: true,
      content,
      model: data?.model || defaultModel,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse(502, {
      success: false,
      error: `Lỗi gọi Upstream AI API: ${msg}`,
    });
  }
}
