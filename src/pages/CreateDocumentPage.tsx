import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  FileUp,
  GripVertical,
  Lock,
  Plus,
  Send,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { OverlaySignatureField, PdfViewer } from '../components/PdfViewer';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ACTION_LABEL, formatBytes } from '../lib/format';
import { apiFetch, supabase, uploadPdfViaSignedUrl } from '../lib/supabaseClient';
import {
  DocumentPriority,
  MasterDataItem,
  SignerActionType,
  UserProfile,
  WorkflowTemplate,
} from '../types';

interface DraftSigner {
  localId: string;
  dbId?: string;
  user_id: string;
  full_name: string;
  job_title: string;
  email: string;
  action_type: SignerActionType;
  is_mandatory: boolean;
}

export function CreateDocumentPage() {
  const { profile, settings } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editDocId = searchParams.get('id');

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [docId, setDocId] = useState<string | null>(editDocId);
  const [loadingInit, setLoadingInit] = useState(true);
  const [saving, setSaving] = useState(false);

  // Master data & users
  const [units, setUnits] = useState<MasterDataItem[]>([]);
  const [departments, setDepartments] = useState<MasterDataItem[]>([]);
  const [docTypes, setDocTypes] = useState<MasterDataItem[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);

  // Step 1 fields
  const [title, setTitle] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [documentTypeId, setDocumentTypeId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [description, setDescription] = useState('');
  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<DocumentPriority>('normal');
  const [includeHistoryPage, setIncludeHistoryPage] = useState(true);

  // Step 2 PDF upload
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPreviewBuffer, setPdfPreviewBuffer] = useState<ArrayBuffer | null>(null);
  const [pdfRemoteUrl, setPdfRemoteUrl] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [uploadedFileSize, setUploadedFileSize] = useState<number>(0);
  const [pdfPageCount, setPdfPageCount] = useState<number>(1);
  const [dragOverFile, setDragOverFile] = useState(false);

  // Step 3 Signers
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [signers, setSigners] = useState<DraftSigner[]>([]);
  const [pickUserId, setPickUserId] = useState('');
  const [pickAction, setPickAction] = useState<SignerActionType>('sign');
  const [draggedSignerIdx, setDraggedSignerIdx] = useState<number | null>(null);

  // Step 4 Signature Fields
  const [fields, setFields] = useState<OverlaySignatureField[]>([]);
  const [activePlacementPage, setActivePlacementPage] = useState(1);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [activeSignerForDrop, setActiveSignerForDrop] = useState<string>('');
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);

  const maxFileSizeMb = settings?.max_file_size_mb || 5;

  const generateDefaultDocNumber = useCallback(
    (uId: string, unitList: MasterDataItem[]) => {
      const unitCode = unitList.find((u) => u.id === uId)?.code || 'LZD';
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const seq = String(Math.floor(1000 + Math.random() * 9000));
      return `LZD/${unitCode}/${yyyy}/${mm}/${seq}`;
    },
    []
  );

  // Load initial master data, users, templates, and existing draft if editing
  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase || !profile) return;
      setLoadingInit(true);
      try {
        const [{ data: md }, { data: profs }, { data: tpls }] = await Promise.all([
          supabase.from('master_data').select('*').eq('is_active', true).order('sort_order'),
          supabase
            .from('profiles')
            .select('id, full_name, email, job_title, employee_id, role, is_active, unit_id, department_id')
            .eq('is_active', true)
            .order('full_name'),
          supabase.from('workflow_templates').select('*').eq('is_active', true).order('name'),
        ]);

        if (!active) return;
        const allMd = (md as MasterDataItem[]) || [];
        const unitList = allMd.filter((m) => m.category === 'unit');
        const deptList = allMd.filter((m) => m.category === 'department');
        const typeList = allMd.filter((m) => m.category === 'document_type');

        setUnits(unitList);
        setDepartments(deptList);
        setDocTypes(typeList);
        setUsers((profs as UserProfile[]) || []);
        setTemplates((tpls as WorkflowTemplate[]) || []);

        if (editDocId) {
          const { data: existingDoc } = await supabase
            .from('documents')
            .select('*')
            .eq('id', editDocId)
            .single();

          if (existingDoc) {
            setDocId(existingDoc.id);
            setTitle(existingDoc.title);
            setDocumentNumber(existingDoc.document_number);
            setDocumentTypeId(existingDoc.document_type_id || '');
            setUnitId(existingDoc.unit_id || '');
            setDepartmentId(existingDoc.department_id || '');
            setDescription(existingDoc.description || '');
            setDocumentDate(existingDoc.document_date || new Date().toISOString().slice(0, 10));
            setDueDate(existingDoc.due_date || '');
            setPriority(existingDoc.priority);
            setIncludeHistoryPage(existingDoc.include_history_page);
            setSelectedTemplateId(existingDoc.workflow_template_id || '');

            // Load latest version PDF signed URL
            const { data: ver } = await supabase
              .from('document_versions')
              .select('*')
              .eq('document_id', existingDoc.id)
              .eq('version_number', existingDoc.current_version)
              .maybeSingle();

            if (ver) {
              setUploadedFileName(ver.file_name);
              setUploadedFileSize(ver.file_size_bytes);
              setPdfPageCount(ver.page_count);
              try {
                const signed = await apiFetch<{ url: string }>(
                  `/api/documents/${existingDoc.id}/pdf-url?kind=original&version=${ver.version_number}`
                );
                setPdfRemoteUrl(signed.url);
              } catch {
                // Ignore if unavailable
              }
            }

            // Load signers
            const { data: docSigners } = await supabase
              .from('document_signers')
              .select('*, user:profiles(id, full_name, job_title, email)')
              .eq('document_id', existingDoc.id)
              .order('step_order');

            const loadedSigners: DraftSigner[] = (docSigners || []).map((ds: any) => ({
              localId: ds.id,
              dbId: ds.id,
              user_id: ds.user_id,
              full_name: ds.user?.full_name || 'Pengguna',
              job_title: ds.user?.job_title || '',
              email: ds.user?.email || '',
              action_type: ds.action_type,
              is_mandatory: ds.is_mandatory,
            }));
            setSigners(loadedSigners);

            // Load signature fields
            const { data: docFields } = await supabase
              .from('signature_fields')
              .select('*')
              .eq('document_id', existingDoc.id)
              .eq('version_number', existingDoc.current_version);

            const signerLookup = new Map(loadedSigners.map((s) => [s.dbId, s]));
            setFields(
              (docFields || []).map((f: any) => {
                const s = signerLookup.get(f.signer_id);
                return {
                  localId: f.id,
                  signer_id: s?.localId || f.signer_id,
                  signer_name: s?.full_name || 'Penandatangan',
                  signer_job_title: s?.job_title || '',
                  action_type: s?.action_type || 'sign',
                  page_number: f.page_number,
                  x_percent: f.x_percent,
                  y_percent: f.y_percent,
                  width_percent: f.width_percent,
                  height_percent: f.height_percent,
                };
              })
            );
          }
        } else {
          const defaultUnit = profile.unit_id || unitList[0]?.id || '';
          const defaultDept = profile.department_id || deptList[0]?.id || '';
          const defaultType = typeList[0]?.id || '';
          setUnitId(defaultUnit);
          setDepartmentId(defaultDept);
          setDocumentTypeId(defaultType);
          setDocumentNumber(generateDefaultDocNumber(defaultUnit, unitList));
        }
      } finally {
        if (active) setLoadingInit(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [editDocId, profile, generateDefaultDocNumber]);

  const selectedDocType = docTypes.find((d) => d.id === documentTypeId);
  const requiresTemplate = Boolean(selectedDocType?.require_workflow_template && selectedDocType?.default_template_id);

  // Apply template automatically if document type mandates it
  const applyTemplate = useCallback(
    (templateId: string, markMandatory = false) => {
      setSelectedTemplateId(templateId);
      const tpl = templates.find((t) => t.id === templateId);
      if (!tpl) return;

      const userMap = new Map(users.map((u) => [u.id, u]));
      const mapped: DraftSigner[] = (tpl.steps || [])
        .slice()
        .sort((a, b) => a.step_order - b.step_order)
        .map((st, idx) => {
          const u = userMap.get(st.user_id);
          return {
            localId: `tpl-${idx}-${st.user_id}`,
            user_id: st.user_id,
            full_name: u?.full_name || st.label || 'Pegawai',
            job_title: u?.job_title || '',
            email: u?.email || '',
            action_type: st.action_type,
            is_mandatory: markMandatory,
          };
        });
      setSigners(mapped);
    },
    [templates, users]
  );

  useEffect(() => {
    if (requiresTemplate && selectedDocType?.default_template_id && !editDocId) {
      applyTemplate(selectedDocType.default_template_id, true);
    }
  }, [requiresTemplate, selectedDocType?.default_template_id, editDocId, applyTemplate]);

  const handleSelectPdfFile = async (file: File) => {
    if (file.type !== 'application/pdf') {
      showToast('File harus berformat PDF.', 'error');
      return;
    }
    if (file.size > maxFileSizeMb * 1024 * 1024) {
      showToast(`Ukuran PDF melebihi batas maksimal (${maxFileSizeMb} MB).`, 'error');
      return;
    }
    const buf = await file.arrayBuffer();
    setPdfFile(file);
    setPdfPreviewBuffer(buf);
    setUploadedFileName(file.name);
    setUploadedFileSize(file.size);
  };

  const addSigner = () => {
    if (!pickUserId) return;
    const u = users.find((x) => x.id === pickUserId);
    if (!u) return;
    setSigners((prev) => [
      ...prev,
      {
        localId: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        user_id: u.id,
        full_name: u.full_name,
        job_title: u.job_title,
        email: u.email,
        action_type: pickAction,
        is_mandatory: false,
      },
    ]);
    setPickUserId('');
  };

  const moveSigner = (fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= signers.length) return;
    const next = [...signers];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setSigners(next);
  };

  const removeSigner = (localId: string) => {
    const target = signers.find((s) => s.localId === localId);
    if (target?.is_mandatory) {
      showToast('Pejabat wajib dari template dokumen tidak dapat dihapus.', 'warning');
      return;
    }
    setSigners((prev) => prev.filter((s) => s.localId !== localId));
    setFields((prev) => prev.filter((f) => f.signer_id !== localId));
  };

  const addSignatureField = (signerLocalId: string, pageNum = activePlacementPage, xPct = 15, yPct = 68) => {
    const signer = signers.find((s) => s.localId === signerLocalId);
    if (!signer) return;
    const newField: OverlaySignatureField = {
      localId: `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      signer_id: signer.localId,
      signer_name: signer.full_name,
      signer_job_title: signer.job_title,
      action_type: signer.action_type,
      page_number: pageNum,
      x_percent: xPct,
      y_percent: yPct,
      width_percent: 24,
      height_percent: 11,
    };
    setFields((prev) => [...prev, newField]);
    setSelectedFieldId(newField.localId);
  };

  // Save draft via backend API (document + upload PDF + signers + signature_fields)
  const persistDraft = async (): Promise<string> => {
    if (!profile) throw new Error('Sesi tidak valid.');
    if (!title.trim() || !documentNumber.trim()) {
      throw new Error('Judul dokumen dan nomor dokumen wajib diisi.');
    }

    const saved = await apiFetch<{ data: { id: string; version_number: number } }>('/api/documents/save-draft', {
      method: 'POST',
      body: JSON.stringify({
        id: docId,
        document_number: documentNumber.trim(),
        title: title.trim(),
        document_type_id: documentTypeId || null,
        unit_id: unitId || null,
        department_id: departmentId || null,
        description: description.trim() || null,
        document_date: documentDate,
        due_date: dueDate || null,
        priority,
        workflow_template_id: selectedTemplateId || null,
        include_history_page: includeHistoryPage,
        signers: signers.map((s) => ({
          localId: s.localId,
          user_id: s.user_id,
          action_type: s.action_type,
          is_mandatory: s.is_mandatory,
        })),
        fields: fields.map((f) => ({
          signer_id: f.signer_id,
          page_number: f.page_number,
          x_percent: f.x_percent,
          y_percent: f.y_percent,
          width_percent: f.width_percent,
          height_percent: f.height_percent,
        })),
      }),
    });

    const resolvedDocId = saved.data.id;
    setDocId(resolvedDocId);

    // Upload PDF directly to private Supabase Storage via signed URL if a new file was selected
    if (pdfFile) {
      await uploadPdfViaSignedUrl(resolvedDocId, saved.data.version_number || 1, pdfFile);
      setPdfFile(null); // Avoid re-uploading unless changed
    }

    return resolvedDocId;
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      await persistDraft();
      showToast('Draft dokumen berhasil disimpan.', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Gagal menyimpan draft.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitDocument = async () => {
    setSaving(true);
    try {
      if (!uploadedFileName) {
        throw new Error('Silakan unggah dokumen PDF pada Langkah 2 terlebih dahulu.');
      }
      if (signers.length === 0) {
        throw new Error('Minimal satu penandatangan harus ditentukan pada Langkah 3.');
      }
      const savedDocId = await persistDraft();
      await apiFetch(`/api/documents/${savedDocId}/submit`, { method: 'POST' });
      showToast('Dokumen berhasil diajukan ke penandatangan pertama.', 'success');
      setSubmitConfirmOpen(false);
      navigate(`/dokumen/${savedDocId}`);
    } catch (err: any) {
      showToast(err?.message || 'Gagal mengajukan dokumen.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const pdfSource = pdfPreviewBuffer || pdfRemoteUrl;

  const stepsMeta = [
    { num: 1, label: 'Informasi Dokumen' },
    { num: 2, label: 'Upload PDF' },
    { num: 3, label: 'Penandatangan' },
    { num: 4, label: 'Posisi Tanda Tangan' },
  ] as const;

  return (
    <AppLayout
      title={editDocId ? 'Lanjutkan Draft Dokumen' : 'Buat Dokumen Baru'}
      breadcrumb="Pengajuan Persetujuan Berjenjang"
      actions={
        <button
          type="button"
          onClick={handleSaveDraft}
          disabled={saving || loadingInit}
          className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
        >
          {saving ? 'Menyimpan...' : 'Simpan Draft'}
        </button>
      }
    >
      {/* 4-Step Progress Bar */}
      <div className="mb-6 rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {stepsMeta.map((s) => {
            const active = step === s.num;
            const completed = step > s.num;
            return (
              <button
                key={s.num}
                type="button"
                onClick={() => setStep(s.num)}
                className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? 'border-[#1755CE] bg-blue-50/70 text-[#163A70]'
                    : completed
                    ? 'border-emerald-200 bg-emerald-50/40 text-emerald-900'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
                    active
                      ? 'bg-[#1755CE] text-white'
                      : completed
                      ? 'bg-[#16A34A] text-white'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {completed ? <Check className="h-3.5 w-3.5" /> : s.num}
                </span>
                <span className="text-xs font-semibold truncate">{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* STEP 1 — INFORMASI DOKUMEN */}
      {step === 1 && (
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="font-display text-base font-semibold text-[#163A70]">
            01. Informasi Dokumen
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Lengkapi metadata dokumen pengajuan sebelum mengunggah file PDF.
          </p>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Judul Dokumen *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Contoh: Pengajuan Pengadaan Perangkat IT Semester Genap"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nomor Dokumen *</label>
              <input
                type="text"
                required
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-[#1755CE] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Jenis Dokumen *</label>
              <select
                value={documentTypeId}
                onChange={(e) => setDocumentTypeId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none"
              >
                <option value="">Pilih jenis dokumen</option>
                {docTypes.map((dt) => (
                  <option key={dt.id} value={dt.id}>
                    {dt.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Unit *</label>
              <select
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none"
              >
                <option value="">Pilih unit</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Departemen *</label>
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none"
              >
                <option value="">Pilih departemen</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Dokumen</label>
              <input
                type="date"
                value={documentDate}
                onChange={(e) => setDocumentDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Target Penyelesaian</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Prioritas</label>
              <div className="flex gap-2">
                {(['normal', 'urgent'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                      priority === p
                        ? p === 'urgent'
                          ? 'border-[#DC2626] bg-red-50 text-[#DC2626]'
                          : 'border-[#1755CE] bg-blue-50 text-[#1755CE]'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    {p === 'normal' ? 'Normal' : 'Urgent'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center pt-5">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeHistoryPage}
                  onChange={(e) => setIncludeHistoryPage(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#1755CE]"
                />
                <span>Sertakan lembar lampiran riwayat persetujuan elektronik pada Final PDF</span>
              </label>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Deskripsi Singkat</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ringkasan singkat tujuan atau isi dokumen..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={() => {
                if (!title.trim() || !documentNumber.trim()) {
                  showToast('Judul dan nomor dokumen wajib diisi.', 'error');
                  return;
                }
                setStep(2);
              }}
              className="rounded-lg bg-[#1755CE] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1244A8]"
            >
              Lanjut ke Upload PDF
            </button>
          </div>
        </div>
      )}

      {/* STEP 2 — UPLOAD PDF */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="font-display text-base font-semibold text-[#163A70]">02. Upload Dokumen PDF</h2>
            <p className="mt-1 text-xs text-slate-500">
              Dokumen disimpan di private storage bucket. Batas maksimal ukuran file: {maxFileSizeMb} MB.
            </p>

            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverFile(true);
              }}
              onDragLeave={() => setDragOverFile(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverFile(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleSelectPdfFile(f);
              }}
              className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
                dragOverFile
                  ? 'border-[#1755CE] bg-blue-50'
                  : 'border-slate-300 bg-slate-50 hover:border-[#1755CE]'
              }`}
            >
              <FileUp className="h-8 w-8 text-[#1755CE]" />
              <span className="mt-2 text-sm font-semibold text-slate-800">
                Seret file PDF ke sini atau klik untuk memilih file
              </span>
              <span className="mt-1 text-xs text-slate-500">
                Format PDF (.pdf) · Maksimal {maxFileSizeMb} MB
              </span>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleSelectPdfFile(f);
                }}
              />
            </label>

            {uploadedFileName && (
              <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs">
                <span className="font-medium text-slate-800 truncate">{uploadedFileName}</span>
                <span className="font-mono text-slate-500 shrink-0 ml-3">
                  {formatBytes(uploadedFileSize)} · {pdfPageCount} halaman
                </span>
              </div>
            )}
          </div>

          {pdfSource && (
            <PdfViewer
              fileSource={pdfSource}
              onNumPagesLoaded={(n) => setPdfPageCount(n)}
            />
          )}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Kembali
            </button>
            <button
              type="button"
              onClick={() => {
                if (!uploadedFileName) {
                  showToast('Silakan unggah file PDF terlebih dahulu.', 'error');
                  return;
                }
                setStep(3);
              }}
              className="rounded-lg bg-[#1755CE] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1244A8]"
            >
              Lanjut ke Penandatangan
            </button>
          </div>
        </div>
      )}

      {/* STEP 3 — PENANDATANGAN */}
      {step === 3 && (
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="font-display text-base font-semibold text-[#163A70]">
            03. Urutan Penandatangan Berjenjang
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Atur urutan dari pertama hingga terakhir. Anda dapat menyeret baris untuk mengubah urutan sebelum diajukan.
          </p>

          {requiresTemplate && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-[#163A70]">
              <Lock className="h-4 w-4 shrink-0 text-[#1755CE] mt-0.5" />
              <span>
                Jenis dokumen <strong>{selectedDocType?.name}</strong> mewajibkan template workflow. Pejabat wajib tidak dapat dihapus dari alur persetujuan.
              </span>
            </div>
          )}

          {/* Template selector & manual adder */}
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-4 border-b border-slate-100 pb-5">
            <div className="lg:col-span-4">
              <label className="block text-xs font-medium text-slate-700 mb-1">Gunakan Template Workflow</label>
              <select
                value={selectedTemplateId}
                disabled={requiresTemplate}
                onChange={(e) => applyTemplate(e.target.value, false)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none disabled:bg-slate-100"
              >
                <option value="">-- Pilih Template (Opsional) --</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-8 flex flex-col sm:flex-row gap-2 items-end">
              <div className="flex-1 w-full">
                <label className="block text-xs font-medium text-slate-700 mb-1">Tambah Penandatangan</label>
                <select
                  value={pickUserId}
                  onChange={(e) => setPickUserId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none"
                >
                  <option value="">Pilih pegawai dari master pengguna...</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name} — {u.job_title || u.email}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-full sm:w-40">
                <label className="block text-xs font-medium text-slate-700 mb-1">Jenis Tindakan</label>
                <select
                  value={pickAction}
                  onChange={(e) => setPickAction(e.target.value as SignerActionType)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none"
                >
                  <option value="review">Review</option>
                  <option value="approve">Approve</option>
                  <option value="sign">Sign</option>
                </select>
              </div>
              <button
                type="button"
                onClick={addSigner}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#1755CE] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1244A8] whitespace-nowrap w-full sm:w-auto"
              >
                <Plus className="h-4 w-4" />
                <span>Tambah</span>
              </button>
            </div>
          </div>

          {/* Signers sequential list */}
          <div className="mt-5 space-y-2">
            {signers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">
                Belum ada penandatangan ditambahkan. Pilih template atau tambahkan pegawai di atas.
              </div>
            ) : (
              signers.map((s, idx) => (
                <div
                  key={s.localId}
                  draggable={!s.is_mandatory}
                  onDragStart={() => setDraggedSignerIdx(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (draggedSignerIdx !== null && draggedSignerIdx !== idx) {
                      moveSigner(draggedSignerIdx, idx);
                    }
                    setDraggedSignerIdx(null);
                  }}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <GripVertical className="h-4 w-4 text-slate-400 cursor-grab shrink-0" />
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#163A70] text-xs font-bold text-white tabular-nums">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {s.full_name}
                        {s.is_mandatory && (
                          <span className="ml-2 text-[11px] font-medium text-[#1755CE]">(Wajib)</span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {s.job_title || 'Pegawai'} · {s.email}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={s.action_type}
                      disabled={s.is_mandatory}
                      onChange={(e) => {
                        const val = e.target.value as SignerActionType;
                        setSigners((prev) =>
                          prev.map((item) => (item.localId === s.localId ? { ...item, action_type: val } : item))
                        );
                      }}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 disabled:bg-slate-100"
                    >
                      <option value="review">Review</option>
                      <option value="approve">Approve</option>
                      <option value="sign">Sign</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => moveSigner(idx, idx - 1)}
                      disabled={idx === 0}
                      className="rounded border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                      aria-label="Naikkan urutan"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSigner(idx, idx + 1)}
                      disabled={idx === signers.length - 1}
                      className="rounded border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                      aria-label="Turunkan urutan"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSigner(s.localId)}
                      disabled={s.is_mandatory}
                      className="rounded border border-slate-200 bg-white p-1 text-slate-500 hover:bg-red-50 hover:text-[#DC2626] disabled:opacity-30"
                      aria-label="Hapus penandatangan"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-6 flex justify-between">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Kembali
            </button>
            <button
              type="button"
              onClick={() => {
                if (signers.length === 0) {
                  showToast('Minimal satu penandatangan harus ditambahkan.', 'error');
                  return;
                }
                setStep(4);
              }}
              className="rounded-lg bg-[#1755CE] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1244A8]"
            >
              Lanjut ke Posisi Tanda Tangan
            </button>
          </div>
        </div>
      )}

      {/* STEP 4 — POSISI TANDA TANGAN */}
      {step === 4 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Panel: Signer Placement Palette */}
          <div className="lg:col-span-4 space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="font-display text-sm font-semibold text-[#163A70]">
                04. Penempatan Kotak Tanda Tangan
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Seret nama penandatangan ke halaman PDF atau klik tombol + untuk menempatkan kotak. Posisi disimpan dalam koordinat halaman PDF.
              </p>

              <div className="mt-4 space-y-2">
                {signers.map((s, idx) => {
                  const count = fields.filter((f) => f.signer_id === s.localId).length;
                  return (
                    <div
                      key={s.localId}
                      draggable
                      onDragStart={() => setActiveSignerForDrop(s.localId)}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 cursor-grab"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {idx + 1}. {s.full_name}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {ACTION_LABEL[s.action_type]} · {count} kotak
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => addSignatureField(s.localId)}
                        className="inline-flex items-center gap-1 rounded bg-[#1755CE] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#1244A8] shrink-0"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Taruh</span>
                      </button>
                    </div>
                  );
                })}
              </div>

              {signers.some((s) => s.action_type === 'sign' && !fields.some((f) => f.signer_id === s.localId)) && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-[#F59E0B] mt-0.5" />
                  <span>Disarankan menempatkan minimal 1 kotak untuk setiap penandatangan bertipe Sign.</span>
                </div>
              )}

              <div className="mt-5 flex flex-col gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setPreviewModalOpen(true)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Eye className="h-4 w-4" />
                  <span>Pratinjau</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={saving}
                  className="rounded-lg border border-[#1755CE] bg-white px-4 py-2 text-xs font-semibold text-[#1755CE] hover:bg-blue-50 disabled:opacity-50"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Draft'}
                </button>
                <button
                  type="button"
                  onClick={() => setSubmitConfirmOpen(true)}
                  disabled={saving}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#16A34A] px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  <span>Ajukan Dokumen</span>
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setStep(3)}
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Kembali ke Langkah 3
            </button>
          </div>

          {/* Right Panel: Interactive PDF Viewer */}
          <div className="lg:col-span-8">
            <PdfViewer
              fileSource={pdfSource}
              pageNumber={activePlacementPage}
              onPageChange={setActivePlacementPage}
              fields={fields}
              editable
              selectedFieldId={selectedFieldId}
              onSelectField={setSelectedFieldId}
              onUpdateField={(localId, patch) =>
                setFields((prev) => prev.map((f) => (f.localId === localId ? { ...f, ...patch } : f)))
              }
              onDeleteField={(localId) => setFields((prev) => prev.filter((f) => f.localId !== localId))}
              onDropNewField={(pageNum, xPct, yPct) => {
                if (activeSignerForDrop) {
                  addSignatureField(activeSignerForDrop, pageNum, xPct, yPct);
                  setActiveSignerForDrop('');
                }
              }}
            />
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-4xl rounded-lg border border-slate-200 bg-white p-5 shadow-xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
              <div>
                <h3 className="font-display text-base font-semibold text-[#163A70]">
                  Pratinjau Posisi Tanda Tangan
                </h3>
                <p className="text-xs text-slate-500">
                  {title} · {documentNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewModalOpen(false)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Tutup
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              <PdfViewer fileSource={pdfSource} fields={fields} editable={false} />
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={submitConfirmOpen}
        title="Ajukan Dokumen Sekarang?"
        description="Setelah diajukan, dokumen dan urutan penandatangan akan dikunci dan tugas akan langsung dikirim ke penandatangan pertama."
        confirmLabel="Ya, Ajukan Dokumen"
        loading={saving}
        onConfirm={handleSubmitDocument}
        onCancel={() => setSubmitConfirmOpen(false)}
      />
    </AppLayout>
  );
}
