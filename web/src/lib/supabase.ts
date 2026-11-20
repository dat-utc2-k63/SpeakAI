import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const APP_CONFIG = {
  SUPABASE_URL: (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, ''),
  SUPABASE_ANON_KEY: (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim(),
  DEFAULT_LLM_ENDPOINT:
    (process.env.NEXT_PUBLIC_DEFAULT_LLM_ENDPOINT || '').trim() ||
    'https://revidapi.com/v1/chat/completions',
  DEFAULT_LLM_MODEL:
    (process.env.NEXT_PUBLIC_DEFAULT_LLM_MODEL || '').trim() || 'deepseek-v4.1-flash',
  SPEAKAI_API_URL: (process.env.NEXT_PUBLIC_SPEAKAI_API_URL || '').trim().replace(/\/+$/, ''),
};

export const isSupabaseConfigured = Boolean(
  APP_CONFIG.SUPABASE_URL &&
  APP_CONFIG.SUPABASE_ANON_KEY &&
  !APP_CONFIG.SUPABASE_URL.includes('your-project-ref') &&
  !APP_CONFIG.SUPABASE_ANON_KEY.includes('your-supabase-anon-key'),
);

let clientInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error('Hệ thống đang bảo trì kết nối dữ liệu. Vui lòng thử lại sau.');
  }
  if (!clientInstance) {
    clientInstance = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY);
  }
  return clientInstance;
}

export const supabase: SupabaseClient | null = isSupabaseConfigured ? getSupabaseClient() : null;
