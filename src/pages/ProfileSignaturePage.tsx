import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eraser, KeyRound, PenTool, Type, Upload } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ROLE_LABEL } from '../lib/format';
import { apiFetch } from '../lib/supabaseClient';
import { SignatureProfile } from '../types';

export function ProfileSignaturePage() {
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [sigProfile, setSigProfile] = useState<SignatureProfile | null>(null);
  const [mode, setMode] = useState<'draw' | 'upload' | 'typed'>('draw');
  const [typedText, setTypedText] = useState(profile?.full_name || '');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(false);

  const loadSignatureProfile = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: SignatureProfile | null }>('/api/signature-profile/me');
      if (res.data) {
        setSigProfile(res.data);
        setMode(res.data.signature_type);
        setTypedText(res.data.typed_text || profile?.full_name || '');
      }
    } catch {
      // Initial empty profile
    }
  }, [profile?.full_name]);

  useEffect(() => {
    loadSignatureProfile();
  }, [loadSignatureProfile]);

  useEffect(() => {
    if (profile?.full_name && !typedText) {
      setTypedText(profile.full_name);
    }
  }, [profile?.full_name, typedText]);

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    ctx.strokeStyle = '#163A70';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawingRef.current = true;
    hasDrawnRef.current = true;
    canvas.setPointerCapture(e.pointerId);
  };

  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const endDraw = () => {
    drawingRef.current = false;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawnRef.current = false;
  };

  const handleUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== 'image/png') {
      showToast('File tanda tangan harus berformat PNG.', 'error');
      return;
    }
    if (f.size > 2 * 1024 * 1024) {
      showToast('Ukuran gambar maksimal 2 MB.', 'error');
      return;
    }
    setUploadFile(f);
    setUploadPreview(URL.createObjectURL(f));
  };

  const handleSaveSignature = async () => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('signature_type', mode);

      if (mode === 'draw') {
        const canvas = canvasRef.current;
        if (!canvas || !hasDrawnRef.current) {
          throw new Error('Silakan gambar tanda tangan Anda pada area kanvas terlebih dahulu.');
        }
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('Gagal memproses gambar tanda tangan.');
        formData.append('image', blob, 'signature.png');
      } else if (mode === 'upload') {
        if (!uploadFile) {
          throw new Error('Silakan pilih file PNG tanda tangan terlebih dahulu.');
        }
        formData.append('image', uploadFile);
      } else {
        if (!typedText.trim()) {
          throw new Error('Nama tanda tangan tidak boleh kosong.');
        }
        formData.append('typed_text', typedText.trim());
      }

      const res = await apiFetch<{ data: SignatureProfile }>('/api/signature-profile/save', {
        method: 'POST',
        body: formData,
      });
      setSigProfile(res.data);
      showToast('Representasi tanda tangan pribadi berhasil disimpan.', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Gagal menyimpan tanda tangan.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout title="Profil Saya & Tanda Tangan" breadcrumb="Akun Pribadi">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Profile Info */}
        <div className="lg:col-span-5 rounded-lg border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-[#163A70]">Informasi Pegawai</h2>
              <p className="text-xs text-slate-500">Data identitas akun Lazuardi Anda</p>
            </div>
            <Link
              to="/ganti-password"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <KeyRound className="h-3.5 w-3.5 text-[#1755CE]" />
              <span>Ganti Password</span>
            </Link>
          </div>

          <dl className="divide-y divide-slate-100 text-sm">
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-xs text-slate-500">Nama Lengkap</dt>
              <dd className="font-medium text-slate-900 text-right">{profile?.full_name}</dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-xs text-slate-500">NIY / Employee ID</dt>
              <dd className="font-mono text-xs text-slate-900">{profile?.employee_id || '—'}</dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-xs text-slate-500">Email</dt>
              <dd className="text-xs text-slate-900">{profile?.email}</dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-xs text-slate-500">Unit</dt>
              <dd className="text-xs text-slate-900">{profile?.unit?.name || '—'}</dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-xs text-slate-500">Departemen</dt>
              <dd className="text-xs text-slate-900">{profile?.department?.name || '—'}</dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-xs text-slate-500">Jabatan</dt>
              <dd className="text-xs font-medium text-slate-900">{profile?.job_title || '—'}</dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-xs text-slate-500">Role</dt>
              <dd className="text-xs font-semibold text-[#1755CE]">
                {profile ? ROLE_LABEL[profile.role] : ''}
              </dd>
            </div>
          </dl>

          {sigProfile && (
            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-medium text-slate-700 mb-2">Tanda Tangan Tersimpan Saat Ini</p>
              <div className="flex h-24 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-3">
                {sigProfile.signed_image_url && sigProfile.signature_type !== 'typed' ? (
                  <img
                    src={sigProfile.signed_image_url}
                    alt="Tanda tangan tersimpan"
                    className="max-h-16 object-contain"
                  />
                ) : (
                  <span className="font-serif italic text-2xl text-[#163A70]">
                    {sigProfile.typed_text || profile?.full_name}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Electronic Signature Representation Manager */}
        <div className="lg:col-span-7 rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="font-display text-base font-semibold text-[#163A70]">
            Representasi Tanda Tangan Pribadi
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Disimpan secara privat. Hanya dapat digunakan saat Anda menyetujui dokumen secara langsung dan memverifikasi ulang password.
          </p>

          {/* Method Tabs */}
          <div className="mt-5 inline-flex rounded-lg bg-slate-100 p-1 gap-1">
            <button
              type="button"
              onClick={() => setMode('draw')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === 'draw' ? 'bg-white text-[#163A70] shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <PenTool className="h-3.5 w-3.5" />
              <span>Gambar Tanda Tangan</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('upload')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === 'upload' ? 'bg-white text-[#163A70] shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Upload PNG</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('typed')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === 'typed' ? 'bg-white text-[#163A70] shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Type className="h-3.5 w-3.5" />
              <span>Berbasis Nama</span>
            </button>
          </div>

          <div className="mt-5">
            {mode === 'draw' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-600">Gunakan mouse atau layar sentuh untuk menggambar</span>
                  <button
                    type="button"
                    onClick={clearCanvas}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-[#DC2626]"
                  >
                    <Eraser className="h-3.5 w-3.5" />
                    <span>Bersihkan</span>
                  </button>
                </div>
                <canvas
                  ref={canvasRef}
                  width={560}
                  height={200}
                  onPointerDown={startDraw}
                  onPointerMove={moveDraw}
                  onPointerUp={endDraw}
                  onPointerCancel={endDraw}
                  className="w-full h-48 rounded-lg border border-dashed border-slate-300 bg-white touch-none cursor-crosshair"
                />
              </div>
            )}

            {mode === 'upload' && (
              <div>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:border-[#1755CE]">
                  <Upload className="h-6 w-6 text-[#1755CE]" />
                  <span className="mt-2 text-xs font-semibold text-slate-800">
                    Pilih file gambar tanda tangan (PNG transparan disarankan)
                  </span>
                  <span className="mt-0.5 text-[11px] text-slate-500">Maksimal ukuran file 2 MB</span>
                  <input type="file" accept="image/png" className="hidden" onChange={handleUploadChange} />
                </label>
                {uploadPreview && (
                  <div className="mt-4 flex h-28 items-center justify-center rounded-lg border border-slate-200 bg-white p-3">
                    <img src={uploadPreview} alt="Pratinjau PNG" className="max-h-20 object-contain" />
                  </div>
                )}
              </div>
            )}

            {mode === 'typed' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Teks Tanda Tangan (Berdasarkan Nama)
                  </label>
                  <input
                    type="text"
                    value={typedText}
                    onChange={(e) => setTypedText(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none"
                    placeholder="Nama lengkap Anda"
                  />
                </div>
                <div className="flex h-28 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-4">
                  <span className="font-serif italic text-3xl text-[#163A70]">
                    {typedText || profile?.full_name}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
            <span className="text-[11px] text-slate-500">Label: Electronic Signature — Internal</span>
            <button
              type="button"
              onClick={handleSaveSignature}
              disabled={saving}
              className="rounded-lg bg-[#1755CE] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1244A8] disabled:opacity-50"
            >
              {saving ? 'Menyimpan...' : 'Simpan Tanda Tangan'}
            </button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
