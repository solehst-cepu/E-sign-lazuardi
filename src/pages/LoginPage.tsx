import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { parseJsonSafe, supabase } from '../lib/supabaseClient';

export function LoginPage() {
  const { session, profile, health, loading, signIn, refreshHealth } = useAuth();
  const { showToast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Forgot password modal state
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSending, setForgotSending] = useState(false);

  // Allow switching to login if user already exists in Supabase Auth before profiles row is created
  const [bootstrapMode, setBootstrapMode] = useState<'bootstrap' | 'login'>('bootstrap');

  // First-time Super Admin bootstrap state
  const [bootName, setBootName] = useState('');
  const [bootEmail, setBootEmail] = useState('');
  const [bootJob, setBootJob] = useState('Super Administrator');
  const [bootEmployeeId, setBootEmployeeId] = useState('');
  const [bootPassword, setBootPassword] = useState('');
  const [bootSubmitting, setBootSubmitting] = useState(false);

  if (!loading && session && profile) {
    if (profile.must_change_password) {
      return <Navigate to="/ganti-password" replace />;
    }
    return <Navigate to="/dashboard" replace />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
      showToast('Berhasil masuk ke LAZUARDI e-SIGN.', 'success');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal login. Periksa kembali email dan password Anda.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setForgotSending(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/ganti-password`,
      });
      if (error) throw error;
      showToast('Jika email terdaftar, tautan reset password telah dikirim.', 'success');
      setForgotOpen(false);
      setForgotEmail('');
    } catch (err: any) {
      showToast(err?.message || 'Gagal mengirim tautan reset password.', 'error');
    } finally {
      setForgotSending(false);
    }
  };

  const handleBootstrapSuperAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setBootSubmitting(true);
    try {
      const res = await fetch('/api/bootstrap-superadmin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: bootName,
          email: bootEmail,
          job_title: bootJob,
          employee_id: bootEmployeeId || null,
          password: bootPassword,
        }),
      });
      const data = await parseJsonSafe<{ ok?: boolean; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error || `Gagal membuat Super Admin (HTTP ${res.status}). Pastikan server backend aktif.`);
      }
      if (!data) {
        throw new Error('Server mengembalikan respons yang tidak valid. Pastikan endpoint API berjalan.');
      }
      showToast('Super Admin pertama berhasil dibuat. Silakan login.', 'success');
      setEmail(bootEmail);
      setBootstrapMode('login');
      await refreshHealth();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal membuat Super Admin.');
    } finally {
      setBootSubmitting(false);
    }
  };

  const showBootstrapView = Boolean(
    health && health.supabaseConfigured && !health.hasSuperAdmin && bootstrapMode === 'bootstrap'
  );

  return (
    <div className="min-h-screen bg-[#F4F6F9] flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <BrandLogo />
        </div>
        <p className="mt-2.5 text-center text-sm text-slate-600">
          Simple, Secure &amp; Sequential Electronic Signature
        </p>
        <p className="mt-0.5 text-center text-xs text-slate-500">
          Sistem Persetujuan &amp; Tanda Tangan Elektronik Internal Sekolah dan Yayasan Lazuardi
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="rounded-lg border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
          {health && !health.supabaseConfigured ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <AlertCircle className="h-5 w-5 shrink-0 text-[#F59E0B] mt-0.5" />
                <div>
                  <p className="font-semibold">Konfigurasi Supabase Diperlukan</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-800">
                    Aplikasi siap dijalankan setelah Anda menghubungkan proyek Supabase dan menjalankan SQL migration.
                  </p>
                </div>
              </div>
              <div className="space-y-2 text-xs text-slate-700">
                <p className="font-semibold text-slate-900">Langkah Setup Cepat:</p>
                <ol className="list-decimal list-inside space-y-1.5 leading-relaxed">
                  <li>Buat proyek Supabase baru dan nonaktifkan Public Signup pada Authentication &gt; Providers &gt; Email.</li>
                  <li>Jalankan skrip <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">supabase/migrations/001_initial_schema.sql</code> di Supabase SQL Editor.</li>
                  <li>
                    Tambahkan environment variables: <code className="font-mono bg-slate-100 px-1 rounded">VITE_SUPABASE_URL</code>,{' '}
                    <code className="font-mono bg-slate-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code>, dan{' '}
                    <code className="font-mono bg-slate-100 px-1 rounded">SUPABASE_SERVICE_ROLE_KEY</code>.
                  </li>
                </ol>
              </div>
            </div>
          ) : health && health.error ? (
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-[#DC2626]">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Migrasi Database Belum Dijalankan</p>
                <p className="mt-1 text-xs">{health.error}</p>
              </div>
            </div>
          ) : showBootstrapView ? (
            <div>
              <div className="mb-4 flex rounded-lg bg-slate-100 p-1 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    setBootstrapMode('bootstrap');
                  }}
                  className="flex-1 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-[#163A70] shadow-sm"
                >
                  Buat Super Admin
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    setBootstrapMode('login');
                  }}
                  className="flex-1 rounded-md px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  Sudah Punya Akun? Login
                </button>
              </div>

              <div className="mb-5 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3.5 text-xs text-[#163A70]">
                <ShieldCheck className="h-5 w-5 shrink-0 text-[#1755CE] mt-0.5" />
                <div>
                  <p className="font-semibold">Inisialisasi Super Admin Pertama</p>
                  <p className="mt-0.5 text-slate-600">
                    Belum ada akun Super Admin terdaftar. Buat akun baru atau klik tab Login jika Anda sudah membuat user di Supabase Auth.
                  </p>
                </div>
              </div>

              {errorMsg && (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-[#DC2626]">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <form onSubmit={handleBootstrapSuperAdmin} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nama Lengkap</label>
                  <input
                    type="text"
                    required
                    value={bootName}
                    onChange={(e) => setBootName(e.target.value)}
                    placeholder="Nama Lengkap Super Admin"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none focus:ring-2 focus:ring-[#1755CE]/20"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">NIY / Employee ID</label>
                    <input
                      type="text"
                      value={bootEmployeeId}
                      onChange={(e) => setBootEmployeeId(e.target.value)}
                      placeholder="Opsional"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Jabatan</label>
                    <input
                      type="text"
                      required
                      value={bootJob}
                      onChange={(e) => setBootJob(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email Resmi</label>
                  <input
                    type="email"
                    required
                    value={bootEmail}
                    onChange={(e) => setBootEmail(e.target.value)}
                    placeholder="admin@lazuardi.sch.id"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none"
                  />
                  {health?.initialSuperAdminEmailHint && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Gunakan email yang sesuai dengan konfigurasi INITIAL_SUPERADMIN_EMAIL.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Password (min. 8 karakter)</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={bootPassword}
                    onChange={(e) => setBootPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={bootSubmitting}
                  className="w-full rounded-lg bg-[#1755CE] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1244A8] disabled:opacity-50 transition-colors"
                >
                  {bootSubmitting ? 'Menyimpan...' : 'Buat Akun Super Admin'}
                </button>
              </form>
            </div>
          ) : (
            <div>
              {health && health.supabaseConfigured && !health.hasSuperAdmin && (
                <div className="mb-4 flex rounded-lg bg-slate-100 p-1 gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      setBootstrapMode('bootstrap');
                    }}
                    className="flex-1 rounded-md px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    Buat Super Admin
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      setBootstrapMode('login');
                    }}
                    className="flex-1 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-[#163A70] shadow-sm"
                  >
                    Sudah Punya Akun? Login
                  </button>
                </div>
              )}
              <h2 className="font-display text-lg font-semibold text-[#163A70]">Masuk ke Akun Anda</h2>
              <p className="mt-1 text-xs text-slate-500">
                Gunakan email dan password yang diberikan oleh Admin Lazuardi.
              </p>

              {errorMsg && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-[#DC2626]">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <form onSubmit={handleLogin} className="mt-5 space-y-4">
                <div>
                  <label htmlFor="login-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      id="login-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="nama@lazuardi.sch.id"
                      className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 focus:border-[#1755CE] focus:outline-none focus:ring-2 focus:ring-[#1755CE]/20"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="login-password" className="block text-xs font-medium text-slate-700">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => setForgotOpen(true)}
                      className="text-xs font-medium text-[#1755CE] hover:underline"
                    >
                      Lupa Password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Masukkan password"
                      className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-10 py-2 text-sm text-slate-900 focus:border-[#1755CE] focus:outline-none focus:ring-2 focus:ring-[#1755CE]/20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-2.5 top-2 p-0.5 text-slate-400 hover:text-slate-600"
                      aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-[#1755CE] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1244A8] disabled:opacity-50 transition-colors"
                >
                  {submitting ? 'Memverifikasi...' : 'Login'}
                </button>
              </form>

              <div className="mt-5 border-t border-slate-100 pt-4 text-center text-xs text-slate-500">
                Pendaftaran akun mandiri dinonaktifkan. Hubungi Admin atau IT Lazuardi untuk pembuatan akun baru.
              </div>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          &copy; {new Date().getFullYear()} Sekolah &amp; Yayasan Lazuardi · esign.lazuardi.sch.id
        </p>
      </div>

      {/* Lupa Password Modal */}
      {forgotOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center gap-2 text-[#163A70]">
              <KeyRound className="h-5 w-5 text-[#1755CE]" />
              <h3 className="font-display text-base font-semibold">Reset Password</h3>
            </div>
            <p className="mt-1.5 text-xs text-slate-600">
              Masukkan email akun Anda untuk menerima tautan pengaturan ulang password, atau hubungi Admin unit Anda.
            </p>
            <form onSubmit={handleForgotPassword} className="mt-4 space-y-4">
              <input
                type="email"
                required
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="nama@lazuardi.sch.id"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setForgotOpen(false)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={forgotSending}
                  className="rounded-lg bg-[#1755CE] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1244A8] disabled:opacity-50"
                >
                  {forgotSending ? 'Mengirim...' : 'Kirim Tautan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
