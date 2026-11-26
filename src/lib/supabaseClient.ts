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
    if (res.status === 413) {
      throw new Error('Ukuran file atau payload melebihi batas proxy server (HTTP 413).');
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

export async function uploadPdfViaSignedUrl(
  documentId: string,
  versionNumber: number,
  file: File,
  notes?: string
): Promise<any> {
  if (!supabase) {
    throw new Error('Koneksi penyimpanan Supabase belum siap.');
  }

  const signedRes = await apiFetch<{
    data: { path: string; token: string; signedUrl: string; maxFileSizeMb: number };
  }>('/api/documents/create-upload-url', {
    method: 'POST',
    body: JSON.stringify({
      document_id: documentId,
      version_number: versionNumber,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type || 'application/pdf',
    }),
  });

  const { path, token } = signedRes.data;
  const { error: uploadErr } = await supabase.storage
    .from('documents-original')
    .uploadToSignedUrl(path, token, file, {
      contentType: 'application/pdf',
    });

  if (uploadErr) {
    throw new Error(`Gagal mengunggah PDF ke penyimpanan: ${uploadErr.message}`);
  }

  const registered = await apiFetch<{ data: any }>('/api/documents/register-pdf', {
    method: 'POST',
    body: JSON.stringify({
      document_id: documentId,
      version_number: versionNumber,
      file_path: path,
      file_name: file.name,
      notes: notes || null,
    }),
  });

  return registered.data;
}

export async function uploadSignaturePngViaSignedUrl(file: Blob): Promise<string> {
  if (!supabase) {
    throw new Error('Koneksi penyimpanan Supabase belum siap.');
  }

  const signedRes = await apiFetch<{
    data: { path: string; token: string; signedUrl: string };
  }>('/api/signature-profile/create-upload-url', {
    method: 'POST',
    body: JSON.stringify({
      file_size: file.size,
      mime_type: 'image/png',
    }),
  });

  const { path, token } = signedRes.data;
  const { error: uploadErr } = await supabase.storage
    .from('signatures')
    .uploadToSignedUrl(path, token, file, {
      contentType: 'image/png',
    });

  if (uploadErr) {
    throw new Error(`Gagal mengunggah gambar tanda tangan: ${uploadErr.message}`);
  }

  return path;
}

