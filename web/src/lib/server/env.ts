import fs from 'node:fs';
import path from 'node:path';

let cachedFallback: Record<string, string> | null = null;

function readRepoEnvFallback(): Record<string, string> {
  if (cachedFallback) return cachedFallback;
  const result: Record<string, string> = {};
  const candidates = [
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const lineRaw of raw.split(/\r?\n/)) {
      const line = lineRaw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const eqIdx = line.indexOf('=');
      const key = line.slice(0, eqIdx).trim();
      if (!key || result[key]) continue;
      let val = line.slice(eqIdx + 1).trim();
      if (
        val.length >= 2 &&
        ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      ) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
  }
  cachedFallback = result;
  return result;
}

export function getServerEnv(customEnv?: Record<string, string | undefined>): Record<string, string | undefined> {
  if (customEnv) return customEnv;
  const fallback = readRepoEnvFallback();
  return {
    ...fallback,
    ...process.env,
    SUPABASE_URL: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || fallback.SUPABASE_URL,
    SUPABASE_ANON_KEY:
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_KEY ||
      fallback.SUPABASE_ANON_KEY ||
      fallback.SUPABASE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || fallback.SUPABASE_SERVICE_ROLE_KEY,
    LLM_API_KEY:
      process.env.LLM_API_KEY ||
      process.env.SPEAKAI_LLM_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.SPEAKAI_GEMINI_API_KEY ||
      fallback.LLM_API_KEY ||
      fallback.GEMINI_API_KEY,
    DEFAULT_LLM_ENDPOINT:
      process.env.DEFAULT_LLM_ENDPOINT ||
      process.env.NEXT_PUBLIC_DEFAULT_LLM_ENDPOINT ||
      process.env.DEFAULT_GEMINI_ENDPOINT ||
      process.env.NEXT_PUBLIC_DEFAULT_GEMINI_ENDPOINT ||
      fallback.DEFAULT_LLM_ENDPOINT ||
      fallback.DEFAULT_GEMINI_ENDPOINT,
    DEFAULT_LLM_MODEL:
      process.env.DEFAULT_LLM_MODEL ||
      process.env.NEXT_PUBLIC_DEFAULT_LLM_MODEL ||
      process.env.DEFAULT_GEMINI_MODEL ||
      process.env.NEXT_PUBLIC_DEFAULT_GEMINI_MODEL ||
      fallback.DEFAULT_LLM_MODEL ||
      fallback.DEFAULT_GEMINI_MODEL,
    GEMINI_API_KEY:
      process.env.LLM_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.SPEAKAI_GEMINI_API_KEY ||
      fallback.LLM_API_KEY ||
      fallback.GEMINI_API_KEY,
    DEFAULT_GEMINI_ENDPOINT:
      process.env.DEFAULT_LLM_ENDPOINT ||
      process.env.DEFAULT_GEMINI_ENDPOINT ||
      process.env.NEXT_PUBLIC_DEFAULT_LLM_ENDPOINT ||
      process.env.NEXT_PUBLIC_DEFAULT_GEMINI_ENDPOINT ||
      fallback.DEFAULT_LLM_ENDPOINT ||
      fallback.DEFAULT_GEMINI_ENDPOINT,
    DEFAULT_GEMINI_MODEL:
      process.env.DEFAULT_LLM_MODEL ||
      process.env.DEFAULT_GEMINI_MODEL ||
      process.env.NEXT_PUBLIC_DEFAULT_LLM_MODEL ||
      process.env.NEXT_PUBLIC_DEFAULT_GEMINI_MODEL ||
      fallback.DEFAULT_LLM_MODEL ||
      fallback.DEFAULT_GEMINI_MODEL,
  };
}

