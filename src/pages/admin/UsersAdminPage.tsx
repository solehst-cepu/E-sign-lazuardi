import React, { useCallback, useEffect, useState } from 'react';
import { Edit2, KeyRound, Plus, Search, UserCheck, UserX } from 'lucide-react';
import { AppLayout } from '../../components/AppLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { ROLE_LABEL } from '../../lib/format';
import { apiFetch, supabase } from '../../lib/supabaseClient';
import { MasterDataItem, UserProfile, UserRole } from '../../types';

export function UsersAdminPage() {
  const { profile: currentUser } = useAuth();
  const { showToast } = useToast();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const [units, setUnits] = useState<MasterDataItem[]>([]);
  const [departments, setDepartments] = useState<MasterDataItem[]>([]);

  // Create / Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [formFullName, setFormFullName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formEmpId, setFormEmpId] = useState('');
  const [formUnitId, setFormUnitId] = useState('');
  const [formDeptId, setFormDeptId] = useState('');
  const [formJobTitle, setFormJobTitle] = useState('');
  const [formRole, setFormRole] = useState<UserRole>('user');
  const [formPassword, setFormPassword] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset password modal
  const [resetTarget, setResetTarget] = useState<UserProfile | null>(null);
  const [resetPasswordVal, setResetPasswordVal] = useState('');

  const loadMasterData = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from('master_data').select('*').eq('is_active', true).order('sort_order');
    const list = (data as MasterDataItem[]) || [];
    setUnits(list.filter((m) => m.category === 'unit'));
    setDepartments(list.filter((m) => m.category === 'department'));
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: '20',
        ...(search ? { search } : {}),
        ...(roleFilter ? { role: roleFilter } : {}),
      });
      const res = await apiFetch<{ data: UserProfile[]; total: number }>(`/api/admin/users?${qs.toString()}`);
      setUsers(res.data || []);
      setTotal(res.total || 0);
    } catch (err: any) {
      showToast(err?.message || 'Gagal memuat daftar pengguna.', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter, showToast]);

  useEffect(() => {
    loadMasterData();
  }, [loadMasterData]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const openCreateModal = () => {
    setEditingUser(null);
    setFormFullName('');
    setFormEmail('');
    setFormEmpId('');
    setFormUnitId('');
    setFormDeptId('');
    setFormJobTitle('');
    setFormRole('user');
    setFormPassword('');
    setModalOpen(true);
  };

  const openEditModal = (u: UserProfile) => {
    setEditingUser(u);
    setFormFullName(u.full_name);
    setFormEmail(u.email);
    setFormEmpId(u.employee_id || '');
    setFormUnitId(u.unit_id || '');
    setFormDeptId(u.department_id || '');
    setFormJobTitle(u.job_title || '');
    setFormRole(u.role);
    setFormPassword('');
    setModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingUser) {
        await apiFetch(`/api/admin/users/${editingUser.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            full_name: formFullName,
            employee_id: formEmpId || null,
            unit_id: formUnitId || null,
            department_id: formDeptId || null,
            job_title: formJobTitle,
            ...(currentUser?.role === 'super_admin' ? { role: formRole } : {}),
          }),
        });
        showToast('Data pengguna berhasil diperbarui.', 'success');
      } else {
        await apiFetch('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({
            full_name: formFullName,
            email: formEmail,
            password: formPassword,
            employee_id: formEmpId || null,
            unit_id: formUnitId || null,
            department_id: formDeptId || null,
            job_title: formJobTitle,
            role: formRole,
          }),
        });
        showToast('Akun pengguna baru berhasil dibuat.', 'success');
      }
      setModalOpen(false);
      await loadUsers();
    } catch (err: any) {
      showToast(err?.message || 'Gagal menyimpan data pengguna.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u: UserProfile) => {
    try {
      await apiFetch(`/api/admin/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !u.is_active }),
      });
      showToast(`Akun ${u.full_name} ${!u.is_active ? 'diaktifkan' : 'dinonaktifkan'}.`, 'success');
      await loadUsers();
    } catch (err: any) {
      showToast(err?.message || 'Gagal mengubah status akun.', 'error');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setSaving(true);
    try {
      await apiFetch(`/api/admin/users/${resetTarget.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ temporary_password: resetPasswordVal }),
      });
      showToast(`Password sementara untuk ${resetTarget.full_name} berhasil direset.`, 'success');
      setResetTarget(null);
      setResetPasswordVal('');
    } catch (err: any) {
      showToast(err?.message || 'Gagal mereset password.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <AppLayout
      title="Manajemen Pengguna"
      breadcrumb="Administrasi · Akun & Hak Akses"
      onRefresh={loadUsers}
      refreshing={loading}
      actions={
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#1755CE] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1244A8] whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          <span>Tambah Pengguna</span>
        </button>
      }
    >
      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Cari nama, email, atau NIY..."
            className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-1.5 text-sm focus:border-[#1755CE] focus:outline-none"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700"
        >
          <option value="">Semua Role</option>
          <option value="super_admin">Super Admin</option>
          <option value="admin">Admin</option>
          <option value="user">Pegawai / User</option>
        </select>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">Nama &amp; Email</th>
                <th className="px-4 py-3 font-medium">NIY</th>
                <th className="px-4 py-3 font-medium">Unit / Dept</th>
                <th className="px-4 py-3 font-medium">Jabatan</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    Memuat data pengguna...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    Tidak ada pengguna ditemukan.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const canManage =
                    currentUser?.role === 'super_admin' || (currentUser?.role === 'admin' && u.role === 'user');
                  return (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{u.full_name}</p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{u.employee_id || '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {u.unit?.name || '—'} · {u.department?.name || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">{u.job_title || '—'}</td>
                      <td className="px-4 py-3 text-xs font-semibold text-[#163A70]">{ROLE_LABEL[u.role]}</td>
                      <td className="px-4 py-3">
                        {u.is_active ? (
                          <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-[#16A34A]">
                            Aktif
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-[#DC2626]">
                            Nonaktif
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {canManage && (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditModal(u)}
                              className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                              title="Edit pengguna"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setResetTarget(u);
                                setResetPasswordVal('');
                              }}
                              className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                              title="Reset password sementara"
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                            </button>
                            {u.id !== currentUser?.id && (
                              <button
                                type="button"
                                onClick={() => toggleActive(u)}
                                className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                                title={u.is_active ? 'Nonaktifkan akun' : 'Aktifkan akun'}
                              >
                                {u.is_active ? (
                                  <UserX className="h-3.5 w-3.5 text-[#DC2626]" />
                                ) : (
                                  <UserCheck className="h-3.5 w-3.5 text-[#16A34A]" />
                                )}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
          <span className="tabular-nums">
            Halaman {page} / {totalPages} · Total {total} pengguna
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded border border-slate-200 px-3 py-1 disabled:opacity-40"
            >
              Sebelumnya
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border border-slate-200 px-3 py-1 disabled:opacity-40"
            >
              Berikutnya
            </button>
          </div>
        </div>
      </div>

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="font-display text-base font-semibold text-[#163A70]">
              {editingUser ? 'Edit Pengguna' : 'Buat Akun Pengguna Baru'}
            </h3>
            <form onSubmit={handleSaveUser} className="mt-4 space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nama Lengkap *</label>
                  <input
                    type="text"
                    required
                    value={formFullName}
                    onChange={(e) => setFormFullName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">NIY / Employee ID</label>
                  <input
                    type="text"
                    value={formEmpId}
                    onChange={(e) => setFormEmpId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {!editingUser && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Email *</label>
                    <input
                      type="email"
                      required
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Password Sementara * (min. 8)
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Unit</label>
                  <select
                    value={formUnitId}
                    onChange={(e) => setFormUnitId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Pilih Unit</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Departemen</label>
                  <select
                    value={formDeptId}
                    onChange={(e) => setFormDeptId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Pilih Departemen</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Jabatan *</label>
                  <input
                    type="text"
                    required
                    value={formJobTitle}
                    onChange={(e) => setFormJobTitle(e.target.value)}
                    placeholder="Contoh: GA Manager"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
                  <select
                    value={formRole}
                    disabled={currentUser?.role !== 'super_admin'}
                    onChange={(e) => setFormRole(e.target.value as UserRole)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
                  >
                    <option value="user">User / Pegawai</option>
                    {currentUser?.role === 'super_admin' && (
                      <>
                        <option value="admin">Admin</option>
                        <option value="super_admin">Super Admin</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#1755CE] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1244A8] disabled:opacity-50"
                >
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="font-display text-base font-semibold text-[#163A70]">Reset Password Pengguna</h3>
            <p className="mt-1 text-xs text-slate-600">
              Tetapkan password sementara baru untuk <strong>{resetTarget.full_name}</strong>. Pengguna wajib menggantinya saat login berikutnya.
            </p>
            <form onSubmit={handleResetPassword} className="mt-4 space-y-4">
              <input
                type="password"
                required
                minLength={8}
                value={resetPasswordVal}
                onChange={(e) => setResetPasswordVal(e.target.value)}
                placeholder="Password sementara baru (min. 8 karakter)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#1755CE] px-4 py-2 text-xs font-semibold text-white"
                >
                  {saving ? 'Memproses...' : 'Reset Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
