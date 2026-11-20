import fs from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

function readRootPublicEnvFallback(): Record<string, string> {
  const candidates = [
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
  ];
  const parsed: Record<string, string> = {};
  const publicKeys = new Set([
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'DEFAULT_LLM_ENDPOINT',
    'DEFAULT_LLM_MODEL',
    'NEXT_PUBLIC_DEFAULT_LLM_ENDPOINT',
    'NEXT_PUBLIC_DEFAULT_LLM_MODEL',
    'SPEAKAI_API_URL',
    'NEXT_PUBLIC_SPEAKAI_API_URL',
  ]);

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf-8');
    for (const lineRaw of raw.split(/\r?\n/)) {
      const line = lineRaw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const eqIdx = line.indexOf('=');
      const key = line.slice(0, eqIdx).trim();
      if (!publicKeys.has(key) || parsed[key]) continue;
      let val = line.slice(eqIdx + 1).trim();
      if (
        val.length >= 2 &&
        ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      ) {
        val = val.slice(1, -1);
      }
      parsed[key] = val;
    }
  }
  return parsed;
}

const fallback = readRootPublicEnvFallback();

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: (
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      fallback.NEXT_PUBLIC_SUPABASE_URL ||
      fallback.SUPABASE_URL ||
      ''
    )
      .trim()
      .replace(/\/+$/, ''),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: (
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_KEY ||
      fallback.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      fallback.SUPABASE_ANON_KEY ||
      fallback.SUPABASE_KEY ||
      ''
    ).trim(),
    NEXT_PUBLIC_DEFAULT_LLM_ENDPOINT: (
      process.env.NEXT_PUBLIC_DEFAULT_LLM_ENDPOINT ||
      process.env.DEFAULT_LLM_ENDPOINT ||
      fallback.NEXT_PUBLIC_DEFAULT_LLM_ENDPOINT ||
      fallback.DEFAULT_LLM_ENDPOINT ||
      'https://revidapi.com/v1/chat/completions'
    ).trim(),
    NEXT_PUBLIC_DEFAULT_LLM_MODEL: (
      process.env.NEXT_PUBLIC_DEFAULT_LLM_MODEL ||
      process.env.DEFAULT_LLM_MODEL ||
      fallback.NEXT_PUBLIC_DEFAULT_LLM_MODEL ||
      fallback.DEFAULT_LLM_MODEL ||
      'deepseek-v4.1-flash'
    ).trim(),
    NEXT_PUBLIC_SPEAKAI_API_URL: (
      process.env.NEXT_PUBLIC_SPEAKAI_API_URL ||
      process.env.SPEAKAI_API_URL ||
      fallback.NEXT_PUBLIC_SPEAKAI_API_URL ||
      fallback.SPEAKAI_API_URL ||
      ''
    )
      .trim()
      .replace(/\/+$/, ''),
  },
};

export default nextConfig;
