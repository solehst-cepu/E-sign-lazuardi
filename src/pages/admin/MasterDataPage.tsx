import React, { useCallback, useEffect, useState } from 'react';
import { Edit2, Plus, Power } from 'lucide-react';
import { AppLayout } from '../../components/AppLayout';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabaseClient';
import { MasterCategory, MasterDataItem, WorkflowTemplate } from '../../types';

export function MasterDataPage() {
  const { showToast } = useToast();

  const [category, setCategory] = useState<MasterCategory>('unit');
  const [items, setItems] = useState<MasterDataItem[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MasterDataItem | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [requireTpl, setRequireTpl] = useState(false);
  const [defaultTplId, setDefaultTplId] = useState('');
  const [saving, setSaving] = useState(false);

  const loadItems = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [{ data }, { data: tpls }] = await Promise.all([
      supabase.from('master_data').select('*').eq('category', category).order('sort_order').order('name'),
      supabase.from('workflow_templates').select('*').eq('is_active', true).order('name'),
    ]);
    setItems((data as MasterDataItem[]) || []);
    setTemplates((tpls as WorkflowTemplate[]) || []);
    setLoading(false);
  }, [category]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const openModal = (item?: MasterDataItem) => {
    if (item) {
      setEditingItem(item);
      setName(item.name);
      setCode(item.code || '');
      setDescription(item.description || '');
      setRequireTpl(item.require_workflow_template);
      setDefaultTplId(item.default_template_id || '');
    } else {
      setEditingItem(null);
      setName('');
      setCode('');
      setDescription('');
      setRequireTpl(false);
      setDefaultTplId('');
    }
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setSaving(true);
    try {
      const payload = {
        category,
        name: name.trim(),
        code: code.trim() || null,
        description: description.trim() || null,
        require_workflow_template: category === 'document_type' ? requireTpl : false,
        default_template_id: category === 'document_type' && defaultTplId ? defaultTplId : null,
      };
      if (editingItem) {
        const { error } = await supabase.from('master_data').update(payload).eq('id', editingItem.id);
        if (error) throw error;
        showToast('Master data diperbarui.', 'success');
      } else {
        const { error } = await supabase.from('master_data').insert(payload);
        if (error) throw error;
        showToast('Master data ditambahkan.', 'success');
      }
      setModalOpen(false);
      await loadItems();
    } catch (err: any) {
      showToast(err?.message || 'Gagal menyimpan master data.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (item: MasterDataItem) => {
    if (!supabase) return;
    const { error } = await supabase
      .from('master_data')
      .update({ is_active: !item.is_active })
      .eq('id', item.id);
    if (error) showToast(error.message, 'error');
    else await loadItems();
  };

  return (
    <AppLayout
      title="Master Data"
      breadcrumb="Administrasi · Unit, Departemen & Jenis Dokumen"
      onRefresh={loadItems}
      refreshing={loading}
      actions={
        <button
          type="button"
          onClick={() => openModal()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#1755CE] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1244A8]"
        >
          <Plus className="h-4 w-4" />
          <span>Tambah Data</span>
        </button>
      }
    >
      <div className="mb-4 inline-flex rounded-lg bg-slate-200/70 p-1 gap-1">
        {(
          [
            { key: 'unit', label: 'Master Unit' },
            { key: 'department', label: 'Master Departemen' },
            { key: 'document_type', label: 'Master Jenis Dokumen' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setCategory(tab.key)}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              category === tab.key ? 'bg-white text-[#163A70] shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Kode</th>
              <th className="px-4 py-3 font-medium">Nama</th>
              {category === 'document_type' && <th className="px-4 py-3 font-medium">Wajib Template</th>}
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs text-slate-600">{item.code || '—'}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{item.name}</p>
                  {item.description && <p className="text-xs text-slate-500">{item.description}</p>}
                </td>
                {category === 'document_type' && (
                  <td className="px-4 py-3 text-xs text-slate-700">
                    {item.require_workflow_template ? 'Wajib Template' : 'Bebas'}
                  </td>
                )}
                <td className="px-4 py-3">
                  <span
                    className={`rounded border px-2 py-0.5 text-xs font-medium ${
                      item.is_active
                        ? 'border-emerald-200 bg-emerald-50 text-[#16A34A]'
                        : 'border-slate-200 bg-slate-100 text-slate-500'
                    }`}
                  >
                    {item.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <div className="inline-flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => openModal(item)}
                      className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleActive(item)}
                      className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                      title={item.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                    >
                      <Power className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="font-display text-base font-semibold text-[#163A70]">
              {editingItem ? 'Edit Master Data' : 'Tambah Master Data'}
            </h3>
            <form onSubmit={handleSave} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Kode Singkat</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Contoh: GA, YYS, PP"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Keterangan</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              {category === 'document_type' && (
                <div className="space-y-3 border-t border-slate-100 pt-3">
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={requireTpl}
                      onChange={(e) => setRequireTpl(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[#1755CE]"
                    />
                    <span>Wajibkan template workflow untuk jenis dokumen ini</span>
                  </label>
                  {requireTpl && (
                    <select
                      value={defaultTplId}
                      onChange={(e) => setDefaultTplId(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="">Pilih template wajib...</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

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
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
