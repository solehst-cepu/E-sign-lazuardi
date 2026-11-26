import { createClient, SupabaseClient } from '@supabase/supabase-js';

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
}

const initialUrl = normalizeUrl(import.meta.env.VITE_SUPABASE_URL || '');
const initialAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export let isClientSupabaseConfigured = Boolean(initialUrl && initialAnonKey);

export let supabase: SupabaseClient | null = isClientSupabaseConfigured
  ? createClient(initialUrl, initialAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

export function ensureSupabaseClient(rawUrl?: string, rawAnonKey?: string): SupabaseClient | null {
  if (supabase) return supabase;
  const cleanUrl = normalizeUrl(rawUrl || '');
  const cleanKey = (rawAnonKey || '').trim();
  if (!cleanUrl || !cleanKey) return null;

  supabase = createClient(cleanUrl, cleanKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  isClientSupabaseConfigured = true;
  return supabase;
}

export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

export async function parseJsonSafe<T = any>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function apiFetch<T = any>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await parseJsonSafe(res) : null;

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof (data as any).error === 'string'
        ? (data as any).error
        : `Terjadi kesalahan pada server (HTTP ${res.status}).`;
    throw new Error(message);
  }

  if (data === null) {
    throw new Error('Respons server tidak valid (bukan JSON). Pastikan backend API aktif.');
  }

  return data as T;
}
