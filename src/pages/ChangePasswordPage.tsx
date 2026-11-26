import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch, supabase } from '../lib/supabaseClient';

export function ChangePasswordPage() {
  const { profile, refreshMe } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    if (newPassword.length < 8) {
      showToast('Password baru minimal 8 karakter.', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('Konfirmasi password tidak cocok.', 'error');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      await apiFetch('/api/auth/complete-password-change', { method: 'POST' });
      await refreshMe();
      showToast('Password berhasil diperbarui.', 'success');
      navigate('/dashboard');
    } catch (err: any) {
      showToast(err?.message || 'Gagal memperbarui password.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout title="Ganti Password" breadcrumb="Keamanan Akun">
      <div className="max-w-lg rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2.5 text-[#163A70]">
          <KeyRound className="h-5 w-5 text-[#1755CE]" />
          <h2 className="font-display text-base font-semibold">
            {profile?.must_change_password ? 'Wajib Ganti Password Sementara' : 'Ubah Password Akun'}
          </h2>
        </div>
        <p className="mt-1.5 text-sm text-slate-600">
          {profile?.must_change_password
            ? 'Untuk keamanan akun Anda, ganti password sementara dari Admin sebelum melanjutkan.'
            : 'Gunakan kombinasi huruf, angka, dan simbol minimal 8 karakter.'}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Password Baru</label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm focus:border-[#1755CE] focus:outline-none"
                placeholder="Minimal 8 karakter"
              />
              <button
                type="button"
                onClick={() => setShowPwd((s) => !s)}
                className="absolute right-2.5 top-2 p-0.5 text-slate-400 hover:text-slate-600"
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Konfirmasi Password Baru</label>
            <input
              type={showPwd ? 'text' : 'password'}
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none"
              placeholder="Ulangi password baru"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            {!profile?.must_change_password && (
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[#1755CE] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1244A8] disabled:opacity-50"
            >
              {saving ? 'Menyimpan...' : 'Simpan Password Baru'}
            </button>
          </div>
        </form>
      </div>
    </AppLayout>
  );
}
