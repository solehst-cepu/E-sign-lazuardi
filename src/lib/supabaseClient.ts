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
  const { data } = await parseJsonWithDiagnostic<T>(res);
  return data;
}

export async function parseJsonWithDiagnostic<T = any>(
  res: Response
): Promise<{ data: T | null; htmlTitle: string | null; rawText: string }> {
  const text = await res.text();
  if (!text) return { data: null, htmlTitle: null, rawText: '' };
  try {
    return { data: JSON.parse(text) as T, htmlTitle: null, rawText: text };
  } catch {
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    return {
      data: null,
      htmlTitle: titleMatch ? titleMatch[1].trim() : null,
      rawText: text.slice(0, 200),
    };
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
    credentials: 'include',
    ...options,
    headers,
  });

  const { data, htmlTitle } = await parseJsonWithDiagnostic(res);

  if (!res.ok) {
    if (data && typeof data === 'object' && 'error' in data && typeof (data as any).error === 'string') {
      throw new Error((data as any).error);
    }
    if (res.status === 403 && htmlTitle) {
      throw new Error(
        `Akses diblokir oleh proxy preview (HTTP 403: ${htmlTitle}). Silakan buka aplikasi di tab baru agar cookie sesi aktif.`
      );
    }
    throw new Error(`Terjadi kesalahan pada server (HTTP ${res.status}${htmlTitle ? `: ${htmlTitle}` : ''}).`);
  }

  if (data === null) {
    throw new Error(
      `Respons server tidak valid (bukan JSON${htmlTitle ? `: ${htmlTitle}` : ''}). Coba buka aplikasi di tab baru.`
    );
  }

  return data as T;
}
