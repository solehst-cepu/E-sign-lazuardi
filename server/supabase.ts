import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

function normalizeSupabaseUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
}

export function getSupabaseConfig() {
  const url = normalizeSupabaseUrl(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '');
  const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return { url, anonKey, serviceRoleKey };
}

export function isSupabaseConfigured(): boolean {
  const { url, anonKey, serviceRoleKey } = getSupabaseConfig();
  return Boolean(url && anonKey && serviceRoleKey);
}

export function getServiceRoleKeyIssue(): string | null {
  const { serviceRoleKey } = getSupabaseConfig();
  if (!serviceRoleKey) return 'SUPABASE_SERVICE_ROLE_KEY belum diisi.';
  if (serviceRoleKey.startsWith('sb_publishable_')) {
    return 'SUPABASE_SERVICE_ROLE_KEY diisi dengan Publishable Key (sb_publishable_...). Ganti dengan Secret / service_role key dari Supabase Settings > API.';
  }
  const parts = serviceRoleKey.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (payload?.role === 'anon') {
        return 'SUPABASE_SERVICE_ROLE_KEY terdeteksi menggunakan Anon Key (role: anon). Ganti dengan service_role key dari Supabase Settings > API.';
      }
    } catch {
      // Non-JWT or malformed token; let Supabase validate
    }
  }
  return null;
}

let cachedAdmin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  const { url, serviceRoleKey } = getSupabaseConfig();
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase belum dikonfigurasi pada server environment.');
  }
  if (!cachedAdmin) {
    cachedAdmin = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return cachedAdmin;
}

export function createStatelessAuthClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    throw new Error('Supabase URL atau Anon Key belum dikonfigurasi.');
  }
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
