import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Edit2, Plus, Power, Trash2 } from 'lucide-react';
import { AppLayout } from '../../components/AppLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { ACTION_LABEL } from '../../lib/format';
import { supabase } from '../../lib/supabaseClient';
import { MasterDataItem, SignerActionType, UserProfile, WorkflowTemplate, WorkflowTemplateStep } from '../../types';

export function WorkflowTemplatesPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [docTypes, setDocTypes] = useState<MasterDataItem[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTpl, setEditingTpl] = useState<WorkflowTemplate | null>(null);
  const [name, setName] = useState('');
  const [docTypeId, setDocTypeId] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<WorkflowTemplateStep[]>([]);
  const [pickUser, setPickUser] = useState('');
  const [pickAction, setPickAction] = useState<SignerActionType>('sign');
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [{ data: tpls }, { data: dts }, { data: profs }] = await Promise.all([
      supabase
        .from('workflow_templates')
        .select('*, document_type:master_data!workflow_templates_document_type_id_fkey(id, name)')
        .order('created_at', { ascending: false }),
      supabase.from('master_data').select('*').eq('category', 'document_type').eq('is_active', true).order('sort_order'),
      supabase.from('profiles').select('id, full_name, job_title, email').eq('is_active', true).order('full_name'),
    ]);
    setTemplates((tpls as WorkflowTemplate[]) || []);
    setDocTypes((dts as MasterDataItem[]) || []);
    setUsers((profs as UserProfile[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const userMap = new Map(users.map((u) => [u.id, u]));

  const openModal = (tpl?: WorkflowTemplate) => {
    if (tpl) {
      setEditingTpl(tpl);
      setName(tpl.name);
      setDocTypeId(tpl.document_type_id || '');
      setDescription(tpl.description || '');
      setSteps(tpl.steps || []);
    } else {
      setEditingTpl(null);
      setName('');
      setDocTypeId('');
      setDescription('');
      setSteps([]);
    }
    setModalOpen(true);
  };

  const addStep = () => {
    if (!pickUser) return;
    const u = userMap.get(pickUser);
    setSteps((prev) => [
      ...prev,
      {
        step_order: prev.length + 1,
        user_id: pickUser,
        action_type: pickAction,
        label: u?.full_name || '',
      },
    ]);
    setPickUser('');
  };

  const removeStep = (idx: number) => {
    setSteps((prev) =>
      prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step_order: i + 1 }))
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !profile) return;
    if (steps.length === 0) {
      showToast('Tambahkan minimal satu langkah persetujuan.', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        document_type_id: docTypeId || null,
        description: description.trim() || null,
        steps: steps.map((s, idx) => ({ ...s, step_order: idx + 1 })),
        created_by: profile.id,
      };
      if (editingTpl) {
        const { error } = await supabase.from('workflow_templates').update(payload).eq('id', editingTpl.id);
        if (error) throw error;
        showToast('Template workflow berhasil diperbarui.', 'success');
      } else {
        const { error } = await supabase.from('workflow_templates').insert(payload);
        if (error) throw error;
        showToast('Template workflow baru berhasil dibuat.', 'success');
      }
      setModalOpen(false);
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'Gagal menyimpan template.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const duplicateTemplate = async (tpl: WorkflowTemplate) => {
    if (!supabase || !profile) return;
    const { error } = await supabase.from('workflow_templates').insert({
      name: `${tpl.name} (Salinan)`,
      document_type_id: tpl.document_type_id,
      description: tpl.description,
      steps: tpl.steps,
      is_active: true,
      created_by: profile.id,
    });
    if (error) showToast(error.message, 'error');
    else {
      showToast('Template berhasil diduplikasi.', 'success');
      await loadAll();
    }
  };

  const toggleActive = async (tpl: WorkflowTemplate) => {
    if (!supabase) return;
    await supabase.from('workflow_templates').update({ is_active: !tpl.is_active }).eq('id', tpl.id);
    await loadAll();
  };

  return (
    <AppLayout
      title="Template Workflow"
      breadcrumb="Administrasi · Alur Persetujuan Standar"
      onRefresh={loadAll}
      refreshing={loading}
      actions={
        <button
          type="button"
          onClick={() => openModal()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#1755CE] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1244A8]"
        >
          <Plus className="h-4 w-4" />
          <span>Buat Template</span>
        </button>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.map((tpl) => (
          <div key={tpl.id} className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-[#163A70]">{tpl.name}</h3>
                <p className="text-xs text-slate-500">
                  {tpl.document_type?.name || 'Semua Jenis Dokumen'} ·{' '}
                  <span className={tpl.is_active ? 'text-[#16A34A]' : 'text-slate-400'}>
                    {tpl.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => openModal(tpl)}
                  className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                  title="Edit"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => duplicateTemplate(tpl)}
                  className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                  title="Duplicate"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => toggleActive(tpl)}
                  className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                  title={tpl.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                >
                  <Power className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <ol className="mt-4 space-y-1.5 text-xs">
              {(tpl.steps || []).map((st, idx) => {
                const u = userMap.get(st.user_id);
                return (
                  <li key={idx} className="flex items-center justify-between rounded bg-slate-50 px-3 py-1.5">
                    <span className="font-medium text-slate-800">
                      {idx + 1}. {u?.full_name || st.label || 'Pegawai'}
                      {u?.job_title ? ` (${u.job_title})` : ''}
                    </span>
                    <span className="font-medium text-[#1755CE]">{ACTION_LABEL[st.action_type]}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="font-display text-base font-semibold text-[#163A70]">
              {editingTpl ? 'Edit Template Workflow' : 'Buat Template Workflow'}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Perubahan template tidak memengaruhi dokumen yang sudah berjalan.
            </p>
            <form onSubmit={handleSave} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama Template *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: Template Pengadaan Barang"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Jenis Dokumen Terkait</label>
                <select
                  value={docTypeId}
                  onChange={(e) => setDocTypeId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Umum / Semua Jenis</option>
                  {docTypes.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="border-t border-slate-100 pt-3">
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Urutan Penandatangan</label>
                <div className="flex gap-2">
                  <select
                    value={pickUser}
                    onChange={(e) => setPickUser(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  >
                    <option value="">Pilih pegawai...</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name} ({u.job_title || u.email})
                      </option>
                    ))}
                  </select>
                  <select
                    value={pickAction}
                    onChange={(e) => setPickAction(e.target.value as SignerActionType)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  >
                    <option value="review">Review</option>
                    <option value="approve">Approve</option>
                    <option value="sign">Sign</option>
                  </select>
                  <button
                    type="button"
                    onClick={addStep}
                    className="rounded-lg bg-[#1755CE] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Tambah
                  </button>
                </div>

                <div className="mt-3 space-y-1.5">
                  {steps.map((s, idx) => {
                    const u = userMap.get(s.user_id);
                    return (
                      <div key={idx} className="flex items-center justify-between rounded bg-slate-50 px-3 py-2 text-xs">
                        <span>
                          {idx + 1}. {u?.full_name || s.label} — <strong>{ACTION_LABEL[s.action_type]}</strong>
                        </span>
                        <button
                          type="button"
                          onClick={() => removeStep(idx)}
                          className="text-slate-400 hover:text-[#DC2626]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
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
                  className="rounded-lg bg-[#1755CE] px-4 py-2 text-xs font-semibold text-white"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Template'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
