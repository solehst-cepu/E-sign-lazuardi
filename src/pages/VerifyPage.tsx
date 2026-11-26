import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileCheck2, Loader2, ShieldAlert, Upload, XCircle } from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { formatJakartaDate } from '../lib/format';
import { parseJsonSafe } from '../lib/supabaseClient';

interface VerifyMetadata {
  result: 'registered' | 'not_found' | 'cancelled';
  label: string;
  verification_id?: string;
  document_number?: string | null;
  completed_at?: string | null;
  status?: string;
  signature_type: string;
  organization_name?: string;
}

interface HashCheckResult {
  match: boolean;
  result: 'matched' | 'tampered' | 'not_found' | 'cancelled';
  label: string;
  uploaded_hash: string;
  verification_id?: string;
}

export function VerifyPage() {
  const { token } = useParams<{ token: string }>();
  const [meta, setMeta] = useState<VerifyMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [hashResult, setHashResult] = useState<HashCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch(`/api/verify/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data = await parseJsonSafe<VerifyMetadata & { error?: string }>(r);
        if (!r.ok || !data) {
          throw new Error(data?.error || 'Gagal memuat data verifikasi.');
        }
        return data;
      })
      .then((data) => {
        setMeta(data);
        setLoading(false);
      })
      .catch((err: any) => {
        setError(err?.message || 'Gagal menghubungi layanan verifikasi.');
        setLoading(false);
      });
  }, [token]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    if (file.type !== 'application/pdf') {
      setError('Mohon unggah file berformat PDF.');
      return;
    }

    setError(null);
    setChecking(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const digest = await window.crypto.subtle.digest('SHA-256', arrayBuffer);
      const sha256Hash = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const res = await fetch(`/api/verify/${encodeURIComponent(token)}/check-hash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha256_hash: sha256Hash }),
      });
      const data = await parseJsonSafe<HashCheckResult & { error?: string }>(res);
      if (!res.ok || !data) throw new Error(data?.error || 'Gagal memverifikasi hash file.');
      setHashResult(data);
    } catch (err: any) {
      setError(err?.message || 'Gagal memeriksa file PDF.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F6F9] py-10 px-4 sm:px-6">
      <div className="mx-auto max-w-xl">
        <div className="flex items-center justify-between mb-6">
          <BrandLogo />
          <Link to="/login" className="text-xs font-medium text-[#1755CE] hover:underline">
            Masuk Sistem
          </Link>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
          <h1 className="font-display text-lg font-semibold text-[#163A70]">
            Verifikasi Dokumen Elektronik
          </h1>
          <p className="mt-1 text-xs text-slate-600">
            Pemeriksaan keaslian dan integritas file PDF melalui Verification ID dan SHA-256 Hash.
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin text-[#1755CE] mr-2" />
              <span className="text-sm">Memeriksa data verifikasi...</span>
            </div>
          ) : error && !meta ? (
            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-[#DC2626]">
              {error}
            </div>
          ) : meta ? (
            <div className="mt-6 space-y-6">
              {/* Registration Status */}
              <div
                className={`flex items-start gap-3 rounded-lg border p-4 ${
                  meta.result === 'registered'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : meta.result === 'cancelled'
                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : 'border-red-200 bg-red-50 text-red-900'
                }`}
              >
                {meta.result === 'registered' ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-[#16A34A] mt-0.5" />
                ) : meta.result === 'cancelled' ? (
                  <AlertTriangle className="h-5 w-5 shrink-0 text-[#F59E0B] mt-0.5" />
                ) : (
                  <XCircle className="h-5 w-5 shrink-0 text-[#DC2626] mt-0.5" />
                )}
                <div>
                  <p className="text-sm font-semibold">{meta.label}</p>
                  <p className="mt-0.5 text-xs opacity-90">
                    {meta.result === 'registered'
                      ? 'Token verifikasi ini tercatat dalam sistem LAZUARDI e-SIGN. Unggah file PDF di bawah untuk memastikan isi file tidak berubah.'
                      : meta.result === 'cancelled'
                      ? 'Dokumen ini telah dibatalkan oleh pemohon atau administrator.'
                      : 'Token verifikasi tidak ditemukan dalam catatan sistem.'}
                  </p>
                </div>
              </div>

              {meta.result !== 'not_found' && (
                <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                  <div className="flex justify-between gap-4 px-4 py-2.5">
                    <dt className="text-xs text-slate-500">Verification ID</dt>
                    <dd className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                      {meta.verification_id || '—'}
                    </dd>
                  </div>
                  {meta.document_number && (
                    <div className="flex justify-between gap-4 px-4 py-2.5">
                      <dt className="text-xs text-slate-500">Nomor Dokumen</dt>
                      <dd className="font-mono text-xs font-medium text-slate-900">{meta.document_number}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-4 px-4 py-2.5">
                    <dt className="text-xs text-slate-500">Tanggal Penyelesaian</dt>
                    <dd className="text-xs text-slate-900 tabular-nums">
                      {formatJakartaDate(meta.completed_at)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4 px-4 py-2.5">
                    <dt className="text-xs text-slate-500">Jenis Tanda Tangan</dt>
                    <dd className="text-xs font-medium text-[#163A70]">{meta.signature_type}</dd>
                  </div>
                </dl>
              )}

              {/* PDF Hash Integrity Checker */}
              {meta.result === 'registered' && (
                <div className="border-t border-slate-200 pt-5">
                  <h2 className="font-display text-sm font-semibold text-slate-900">
                    Verifikasi Integritas File PDF (SHA-256)
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Pemindaian QR Code saja tidak membuktikan isi dokumen belum dimodifikasi. Unggah file PDF final untuk mencocokkan hash SHA-256.
                  </p>

                  <label className="mt-3 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center hover:border-[#1755CE] hover:bg-blue-50/40 transition-colors">
                    <Upload className="h-6 w-6 text-[#1755CE]" />
                    <span className="mt-2 text-xs font-semibold text-slate-800">
                      {checking ? 'Menghitung SHA-256 hash...' : 'Pilih atau unggah file PDF final'}
                    </span>
                    <span className="mt-0.5 text-[11px] text-slate-500">
                      File tidak disimpan; hanya dicocokkan dengan hash di database
                    </span>
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={handleFileUpload}
                      disabled={checking}
                    />
                  </label>

                  {error && (
                    <p className="mt-2 text-xs text-[#DC2626]">{error}</p>
                  )}

                  {hashResult && (
                    <div
                      className={`mt-4 rounded-lg border p-4 ${
                        hashResult.match
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                          : 'border-red-200 bg-red-50 text-red-900'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        {hashResult.match ? (
                          <FileCheck2 className="h-5 w-5 shrink-0 text-[#16A34A] mt-0.5" />
                        ) : (
                          <ShieldAlert className="h-5 w-5 shrink-0 text-[#DC2626] mt-0.5" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{hashResult.label}</p>
                          <p className="mt-1 font-mono text-[11px] break-all opacity-80">
                            SHA-256: {hashResult.uploaded_hash}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
