import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Archive,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileUp,
  Lock,
  PenTool,
  Printer,
  QrCode,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import QRCode from 'qrcode';
import { AppLayout } from '../components/AppLayout';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { OverlaySignatureField, PdfViewer } from '../components/PdfViewer';
import { PriorityBadge, StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ACTION_LABEL, formatBytes, formatDurationBetween, formatJakartaDate } from '../lib/format';
import { apiFetch, supabase, uploadPdfViaSignedUrl } from '../lib/supabaseClient';
import {
  ApprovalLog,
  DocumentRecord,
  DocumentSigner,
  DocumentVersion,
  SignatureField,
} from '../types';

export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [doc, setDoc] = useState<DocumentRecord | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [signers, setSigners] = useState<DocumentSigner[]>([]);
  const [fields, setFields] = useState<SignatureField[]>([]);
  const [logs, setLogs] = useState<ApprovalLog[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Action dialogs
  const [signModalOpen, setSignModalOpen] = useState(false);
  const [signPassword, setSignPassword] = useState('');
  const [signConsent, setSignConsent] = useState(false);
  const [signComment, setSignComment] = useState('');

  const [reasonModal, setReasonModal] = useState<{
    open: boolean;
    type: 'revision_requested' | 'rejected' | 'reviewed' | 'approved';
    title: string;
    requireReason: boolean;
  }>({ open: false, type: 'approved', title: '', requireReason: false });
  const [actionComment, setActionComment] = useState('');

  // Revision upload state
  const [revisionFile, setRevisionFile] = useState<File | null>(null);
  const [resubmitting, setResubmitting] = useState(false);

  // Archive / Cancel confirm
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!supabase || !id) return;
    setLoading(true);
    try {
      const { data: docRow, error: docErr } = await supabase
        .from('documents')
        .select(
          '*, creator:profiles!documents_created_by_fkey(id, full_name, job_title, email), unit:master_data!documents_unit_id_fkey(id, name, code), department:master_data!documents_department_id_fkey(id, name, code), document_type:master_data!documents_document_type_id_fkey(id, name, code)'
        )
        .eq('id', id)
        .single();

      if (docErr || !docRow) {
        showToast('Dokumen tidak ditemukan atau Anda tidak memiliki akses.', 'error');
        navigate('/dashboard');
        return;
      }

      setDoc(docRow as DocumentRecord);

      const [{ data: verRows }, { data: signerRows }, { data: fieldRows }, { data: logRows }] = await Promise.all([
        supabase
          .from('document_versions')
          .select('*')
          .eq('document_id', id)
          .order('version_number', { ascending: false }),
        supabase
          .from('document_signers')
          .select('*, user:profiles(id, full_name, job_title, email, employee_id)')
          .eq('document_id', id)
          .order('step_order', { ascending: true }),
        supabase
          .from('signature_fields')
          .select('*')
          .eq('document_id', id)
          .eq('version_number', docRow.current_version),
        supabase
          .from('approval_logs')
          .select('*')
          .eq('document_id', id)
          .order('created_at', { ascending: true }),
      ]);

      setVersions((verRows as DocumentVersion[]) || []);
      setSigners((signerRows as DocumentSigner[]) || []);
      setFields((fieldRows as SignatureField[]) || []);
      setLogs((logRows as ApprovalLog[]) || []);

      // Fetch short-lived signed URL for PDF preview only when opening document detail
      if ((verRows && verRows.length > 0) || docRow.final_pdf_path) {
        try {
          const signed = await apiFetch<{ url: string }>(`/api/documents/${id}/pdf-url?kind=auto`);
          setPdfUrl(signed.url);
        } catch {
          setPdfUrl(null);
        }
      }

      // Generate QR preview if completed
      if (docRow.verification_token) {
        const verifyLink = `${window.location.origin}/verify/${docRow.verification_token}`;
        QRCode.toDataURL(verifyLink, { width: 160, margin: 1 }).then(setQrDataUrl).catch(() => {});
      }
    } finally {
      setLoading(false);
    }
  }, [id, navigate, showToast]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const activeSigner = signers.find(
    (s) => s.step_order === doc?.current_step_order && s.status === 'active'
  );
  const isCurrentActiveSigner = Boolean(activeSigner && activeSigner.user_id === profile?.id);
  const isCreator = Boolean(doc && doc.created_by === profile?.id);
  const activeVersion = versions.find((v) => v.version_number === doc?.current_version);

  // Convert DB fields to PdfViewer overlays
  const signerLookup = new Map(signers.map((s) => [s.id, s]));
  const overlayFields: OverlaySignatureField[] = fields.map((f) => {
    const s = signerLookup.get(f.signer_id);
    return {
      localId: f.id,
      signer_id: f.signer_id,
      signer_name: s?.user?.full_name || 'Penandatangan',
      signer_job_title: s?.user?.job_title || '',
      action_type: s?.action_type || 'sign',
      page_number: f.page_number,
      x_percent: f.x_percent,
      y_percent: f.y_percent,
      width_percent: f.width_percent,
      height_percent: f.height_percent,
    };
  });

  const handleSignerSimpleAction = async () => {
    if (!doc) return;
    if (reasonModal.requireReason && actionComment.trim().length < 3) {
      showToast('Alasan wajib diisi minimal 3 karakter.', 'error');
      return;
    }

    setActionLoading(true);
    try {
      await apiFetch(`/api/documents/${doc.id}/action`, {
        method: 'POST',
        body: JSON.stringify({
          action: reasonModal.type,
          comment: actionComment.trim() || null,
          expected_hash: activeVersion?.sha256_hash,
        }),
      });
      showToast('Tindakan berhasil dicatat.', 'success');
      setReasonModal({ ...reasonModal, open: false });
      setActionComment('');
      await loadDetail();
    } catch (err: any) {
      showToast(err?.message || 'Gagal memproses tindakan.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleElectronicSign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doc) return;
    if (!signConsent) {
      showToast('Centang pernyataan persetujuan terlebih dahulu.', 'error');
      return;
    }
    if (!signPassword) {
      showToast('Masukkan kembali password Anda untuk verifikasi.', 'error');
      return;
    }

    setActionLoading(true);
    try {
      await apiFetch(`/api/documents/${doc.id}/action`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'signed',
          password: signPassword,
          consent_accepted: true,
          comment: signComment.trim() || null,
          expected_hash: activeVersion?.sha256_hash,
        }),
      });
      setSignPassword(''); // Immediately clear sensitive state
      setSignConsent(false);
      setSignComment('');
      setSignModalOpen(false);
      showToast('Dokumen berhasil ditandatangani secara elektronik.', 'success');
      await loadDetail();
    } catch (err: any) {
      showToast(err?.message || 'Verifikasi tanda tangan gagal.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUploadRevisionAndResubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doc || !revisionFile || !supabase) return;
    setResubmitting(true);
    try {
      const nextVersion = doc.current_version + 1;
      await uploadPdfViaSignedUrl(doc.id, nextVersion, revisionFile, `Revisi v${nextVersion}`);

      await apiFetch(`/api/documents/${doc.id}/resubmit`, {
        method: 'POST',
        body: JSON.stringify({ new_version: nextVersion }),
      });

      setRevisionFile(null);
      showToast('Versi revisi berhasil diunggah dan diajukan kembali dari penandatangan pertama.', 'success');
      await loadDetail();
    } catch (err: any) {
      showToast(err?.message || 'Gagal mengajukan revisi dokumen.', 'error');
    } finally {
      setResubmitting(false);
    }
  };

  const handleDownloadPdf = async (kind: 'auto' | 'original' | 'final' = 'auto') => {
    if (!doc) return;
    try {
      const res = await apiFetch<{ url: string }>(`/api/documents/${doc.id}/pdf-url?kind=${kind}&download=1`);
      window.open(res.url, '_blank', 'noopener');
    } catch (err: any) {
      showToast(err?.message || 'Gagal mengunduh PDF.', 'error');
    }
  };

  const handleCopyVerifyLink = () => {
    if (!doc?.verification_token) return;
    const link = `${window.location.origin}/verify/${doc.verification_token}`;
    navigator.clipboard.writeText(link);
    showToast('Tautan verifikasi disalin ke clipboard.', 'success');
  };

  const handleArchive = async () => {
    if (!doc) return;
    setActionLoading(true);
    try {
      await apiFetch(`/api/documents/${doc.id}/archive`, { method: 'POST' });
      showToast('Dokumen berhasil dipindahkan ke arsip.', 'success');
      setArchiveConfirmOpen(false);
      await loadDetail();
    } catch (err: any) {
      showToast(err?.message || 'Gagal mengarsipkan dokumen.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!doc) return;
    setActionLoading(true);
    try {
      await apiFetch(`/api/documents/${doc.id}/cancel`, { method: 'POST' });
      showToast('Dokumen berhasil dibatalkan.', 'success');
      setCancelConfirmOpen(false);
      await loadDetail();
    } catch (err: any) {
      showToast(err?.message || 'Gagal membatalkan dokumen.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <AppLayout title="Detail Dokumen" breadcrumb="Memuat...">
        <div className="h-64 rounded-lg border border-slate-200 bg-white animate-pulse" />
      </AppLayout>
    );
  }

  if (!doc) return null;

  const isCompletedOrArchived = doc.status === 'completed' || doc.status === 'archived';
  const mySignatureFields = overlayFields.filter((f) => f.signer_id === activeSigner?.id);

  return (
    <AppLayout
      title={doc.title}
      breadcrumb={`Dokumen · ${doc.document_number}`}
      onRefresh={loadDetail}
      actions={
        <div className="flex items-center gap-2">
          {doc.status === 'draft' && isCreator && (
            <Link
              to={`/buat-dokumen?id=${doc.id}`}
              className="rounded-lg bg-[#1755CE] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1244A8]"
            >
              Edit Draft
            </Link>
          )}
          {isCompletedOrArchived && (
            <>
              <button
                type="button"
                onClick={() => handleDownloadPdf('final')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#1755CE] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1244A8]"
              >
                <Download className="h-4 w-4" />
                <span>Download PDF</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Printer className="h-4 w-4" />
                <span>Print</span>
              </button>
            </>
          )}
        </div>
      }
    >
      {/* Active Signer Action Banner */}
      {isCurrentActiveSigner && activeSigner && (
        <div className="mb-6 rounded-lg border border-blue-300 bg-blue-50/80 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#1755CE]">
              Giliran Tindakan Anda (Urutan ke-{activeSigner.step_order})
            </p>
            <h2 className="mt-0.5 font-display text-base font-semibold text-[#163A70]">
              Dokumen menunggu {ACTION_LABEL[activeSigner.action_type]} dari Anda
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Silakan periksa isi dokumen PDF di bawah sebelum memberikan persetujuan atau tanda tangan.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {activeSigner.action_type === 'review' && (
              <button
                type="button"
                onClick={() =>
                  setReasonModal({
                    open: true,
                    type: 'reviewed',
                    title: 'Konfirmasi Selesai Review',
                    requireReason: false,
                  })
                }
                className="rounded-lg bg-[#16A34A] px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                Selesai Review
              </button>
            )}
            {activeSigner.action_type === 'approve' && (
              <button
                type="button"
                onClick={() =>
                  setReasonModal({
                    open: true,
                    type: 'approved',
                    title: 'Konfirmasi Persetujuan Dokumen',
                    requireReason: false,
                  })
                }
                className="rounded-lg bg-[#16A34A] px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                Setujui
              </button>
            )}
            {activeSigner.action_type === 'sign' && (
              <button
                type="button"
                onClick={() => setSignModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#1755CE] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1244A8]"
              >
                <PenTool className="h-4 w-4" />
                <span>Tanda Tangani</span>
              </button>
            )}

            <button
              type="button"
              onClick={() =>
                setReasonModal({
                  open: true,
                  type: 'revision_requested',
                  title: 'Minta Revisi Dokumen',
                  requireReason: true,
                })
              }
              className="rounded-lg border border-amber-300 bg-white px-3.5 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50"
            >
              Minta Revisi
            </button>
            <button
              type="button"
              onClick={() =>
                setReasonModal({
                  open: true,
                  type: 'rejected',
                  title: 'Tolak Dokumen',
                  requireReason: true,
                })
              }
              className="rounded-lg border border-red-300 bg-white px-3.5 py-2 text-xs font-semibold text-[#DC2626] hover:bg-red-50"
            >
              Tolak
            </button>
          </div>
        </div>
      )}

      {/* Revision Required Banner for Creator */}
      {doc.status === 'needs_revision' && isCreator && (
        <div className="mb-6 rounded-lg border border-orange-300 bg-orange-50 p-5">
          <div className="flex items-start gap-3">
            <RotateCcw className="h-5 w-5 shrink-0 text-orange-700 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-display text-sm font-semibold text-orange-950">
                Dokumen Dikembalikan untuk Revisi
              </h3>
              <p className="mt-1 text-xs text-orange-900">
                Alasan revisi: <strong>{doc.revision_reason || '—'}</strong>
              </p>
              <p className="mt-1 text-xs text-orange-800">
                Unggah PDF versi baru (v{doc.current_version + 1}). Dokumen lama tetap disimpan sebagai riwayat dan proses persetujuan dimulai kembali dari urutan pertama.
              </p>
              <form onSubmit={handleUploadRevisionAndResubmit} className="mt-4 flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-orange-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50">
                  <FileUp className="h-4 w-4 text-[#1755CE]" />
                  <span>{revisionFile ? revisionFile.name : 'Pilih PDF Revisi Baru'}</span>
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => setRevisionFile(e.target.files?.[0] || null)}
                  />
                </label>
                <button
                  type="submit"
                  disabled={!revisionFile || resubmitting}
                  className="rounded-lg bg-[#1755CE] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1244A8] disabled:opacity-50"
                >
                  {resubmitting ? 'Mengunggah...' : 'Unggah & Ajukan Ulang'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: PDF Viewer */}
        <div className="lg:col-span-8 space-y-4">
          <PdfViewer
            fileSource={pdfUrl}
            fields={isCompletedOrArchived ? [] : overlayFields}
            editable={false}
          />

          {/* Previous Versions History */}
          {versions.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <h3 className="font-display text-sm font-semibold text-[#163A70] mb-3">
                Riwayat Versi &amp; Integritas SHA-256
              </h3>
              <div className="divide-y divide-slate-100 text-xs">
                {versions.map((v) => (
                  <div key={v.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-slate-900">
                        Versi v{v.version_number} — {v.file_name}
                      </span>
                      <p className="font-mono text-[11px] text-slate-500 break-all">
                        SHA-256 Asli: {v.sha256_hash}
                      </p>
                    </div>
                    <span className="text-slate-500 shrink-0 tabular-nums">
                      {formatBytes(v.file_size_bytes)} · {formatJakartaDate(v.created_at)}
                    </span>
                  </div>
                ))}
                {doc.final_hash && (
                  <div className="pt-3">
                    <span className="font-semibold text-[#16A34A]">Final PDF (Terverifikasi)</span>
                    <p className="font-mono text-[11px] text-slate-600 break-all">
                      SHA-256 Final: {doc.final_hash}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: Metadata, Signer Sequence & Tracking Timeline */}
        <div className="lg:col-span-4 space-y-5">
          {/* Document Metadata Card */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <StatusBadge status={doc.status} />
              <PriorityBadge priority={doc.priority} />
            </div>

            <dl className="mt-3 divide-y divide-slate-100 text-xs">
              <div className="py-2 flex justify-between gap-3">
                <dt className="text-slate-500">Nomor Dokumen</dt>
                <dd className="font-mono font-medium text-slate-900 text-right">{doc.document_number}</dd>
              </div>
              <div className="py-2 flex justify-between gap-3">
                <dt className="text-slate-500">Pemohon</dt>
                <dd className="font-medium text-slate-900 text-right">{doc.creator?.full_name || '—'}</dd>
              </div>
              <div className="py-2 flex justify-between gap-3">
                <dt className="text-slate-500">Jenis Dokumen</dt>
                <dd className="text-slate-900 text-right">{doc.document_type?.name || '—'}</dd>
              </div>
              <div className="py-2 flex justify-between gap-3">
                <dt className="text-slate-500">Unit / Departemen</dt>
                <dd className="text-slate-900 text-right">
                  {doc.unit?.name || '—'} · {doc.department?.name || '—'}
                </dd>
              </div>
              <div className="py-2 flex justify-between gap-3">
                <dt className="text-slate-500">Tanggal Dokumen</dt>
                <dd className="text-slate-900 tabular-nums">{doc.document_date}</dd>
              </div>
              <div className="py-2 flex justify-between gap-3">
                <dt className="text-slate-500">Target Selesai</dt>
                <dd className="text-slate-900 tabular-nums">{doc.due_date || '—'}</dd>
              </div>
              <div className="py-2 flex justify-between gap-3">
                <dt className="text-slate-500">Versi Aktif</dt>
                <dd className="font-mono text-slate-900">v{doc.current_version}</dd>
              </div>
            </dl>

            {doc.description && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="text-[11px] font-medium text-slate-500">Deskripsi</p>
                <p className="mt-1 text-xs text-slate-700 leading-relaxed">{doc.description}</p>
              </div>
            )}

            {/* Quick Lifecycle Actions */}
            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              {['completed', 'rejected', 'cancelled'].includes(doc.status) &&
                (isCreator || ['super_admin', 'admin'].includes(profile?.role || '')) && (
                  <button
                    type="button"
                    onClick={() => setArchiveConfirmOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    <span>Arsipkan</span>
                  </button>
                )}

              {!['completed', 'archived', 'cancelled'].includes(doc.status) &&
                (isCreator || profile?.role === 'super_admin') && (
                  <button
                    type="button"
                    onClick={() => setCancelConfirmOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-[#DC2626] hover:bg-red-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>Batalkan Dokumen</span>
                  </button>
                )}
            </div>
          </div>

          {/* QR Verification Card when Completed */}
          {isCompletedOrArchived && doc.verification_token && (
            <div className="rounded-lg border border-emerald-200 bg-white p-5">
              <div className="flex items-center gap-2 text-[#163A70]">
                <QrCode className="h-4 w-4 text-[#16A34A]" />
                <h3 className="font-display text-sm font-semibold">Verifikasi Final PDF</h3>
              </div>
              <div className="mt-3 flex items-center gap-4">
                {qrDataUrl && (
                  <img
                    src={qrDataUrl}
                    alt="QR Verifikasi Dokumen"
                    className="h-24 w-24 rounded border border-slate-200 p-1 bg-white shrink-0"
                  />
                )}
                <div className="min-w-0 space-y-1.5 text-xs">
                  <p className="font-mono font-semibold text-slate-900">{doc.verification_id}</p>
                  <p className="text-[11px] text-slate-500">Electronic Signature — Internal</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleCopyVerifyLink}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Copy className="h-3 w-3" />
                      <span>Copy Verification Link</span>
                    </button>
                    <Link
                      to={`/verify/${doc.verification_token}`}
                      target="_blank"
                      className="inline-flex items-center gap-1 rounded bg-[#1755CE] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#1244A8]"
                    >
                      <span>Buka Verifikasi</span>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Sequential Signers Progress */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="font-display text-sm font-semibold text-[#163A70] mb-4">
              Urutan Penandatangan Berjenjang
            </h3>
            <div className="space-y-3">
              {signers.map((s) => {
                const isDone = s.status === 'completed';
                const isActive = s.status === 'active';
                const isRej = s.status === 'rejected';
                const isRev = s.status === 'revision_requested';
                const waitingDuration =
                  isActive && s.activated_at
                    ? formatDurationBetween(s.activated_at)
                    : isDone && s.activated_at && s.acted_at
                    ? formatDurationBetween(s.activated_at, s.acted_at)
                    : null;

                return (
                  <div
                    key={s.id}
                    className={`rounded-lg border p-3 ${
                      isActive
                        ? 'border-[#1755CE] bg-blue-50/50'
                        : isDone
                        ? 'border-emerald-200 bg-emerald-50/30'
                        : isRej
                        ? 'border-red-200 bg-red-50/40'
                        : isRev
                        ? 'border-orange-200 bg-orange-50/40'
                        : 'border-slate-200 bg-slate-50/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white tabular-nums ${
                            isDone
                              ? 'bg-[#16A34A]'
                              : isActive
                              ? 'bg-[#1755CE]'
                              : isRej
                              ? 'bg-[#DC2626]'
                              : 'bg-slate-400'
                          }`}
                        >
                          {s.step_order}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 truncate">
                            {s.user?.full_name || 'Pengguna'}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {s.user?.job_title || ''} · {ACTION_LABEL[s.action_type]}
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] font-medium shrink-0 text-slate-700">
                        {isDone ? (
                          <CheckCircle2 className="h-4 w-4 text-[#16A34A]" />
                        ) : isActive ? (
                          <Clock className="h-4 w-4 text-[#1755CE]" />
                        ) : null}
                      </span>
                    </div>

                    {(s.acted_at || waitingDuration) && (
                      <p className="mt-2 text-[11px] text-slate-500 tabular-nums">
                        {s.acted_at ? `Selesai: ${formatJakartaDate(s.acted_at)}` : 'Sedang menunggu'}
                        {waitingDuration ? ` · Durasi: ${waitingDuration}` : ''}
                      </p>
                    )}
                    {s.comment && (
                      <p className="mt-1.5 rounded bg-white/80 px-2.5 py-1.5 text-[11px] text-slate-700 border border-slate-200/70">
                        “{s.comment}”
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Document Tracking Timeline */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="font-display text-sm font-semibold text-[#163A70] mb-4">
              Timeline Riwayat Persetujuan
            </h3>
            <div className="space-y-3">
              <div className="text-xs">
                <p className="font-semibold text-slate-900">Dokumen dibuat</p>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  {doc.creator?.full_name} · {formatJakartaDate(doc.created_at)}
                </p>
              </div>
              {logs.map((log) => (
                <div key={log.id} className="border-t border-slate-100 pt-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{log.user_name}</span>
                    <span className="text-[11px] font-mono text-[#1755CE] uppercase">{log.action}</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {log.user_job_title} · {formatJakartaDate(log.created_at)}
                  </p>
                  {log.signature_reference_id && (
                    <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                      Ref: {log.signature_reference_id}
                    </p>
                  )}
                  {log.comment && <p className="mt-1 text-[11px] text-slate-700">{log.comment}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Electronic Signature Verification Modal */}
      {signModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center gap-2.5 text-[#163A70]">
              <ShieldCheck className="h-5 w-5 text-[#1755CE]" />
              <h3 className="font-display text-base font-semibold">
                Konfirmasi Tanda Tangan Elektronik
              </h3>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1">
              <p className="font-semibold text-slate-900">{doc.title}</p>
              <p className="font-mono text-slate-600">{doc.document_number} · Versi v{doc.current_version}</p>
              <p className="text-slate-600">
                Posisi kotak tanda tangan:{' '}
                {mySignatureFields.length > 0
                  ? mySignatureFields.map((f) => `Halaman ${f.page_number}`).join(', ')
                  : 'Tercatat pada lembar persetujuan elektronik'}
              </p>
            </div>

            <form onSubmit={handleElectronicSign} className="mt-4 space-y-4">
              <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-xs text-slate-700 leading-relaxed">
                <p className="font-semibold text-[#163A70] mb-1">Electronic Signature — Internal</p>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={signConsent}
                    onChange={(e) => setSignConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#1755CE]"
                  />
                  <span>
                    Saya menyatakan telah membaca dokumen ini dan menyetujui pembubuhan tanda tangan elektronik internal atas nama{' '}
                    <strong>{profile?.full_name}</strong> secara sadar dan sah. (Bukan TTE tersertifikasi).
                  </span>
                </label>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Catatan (Opsional)</label>
                <input
                  type="text"
                  value={signComment}
                  onChange={(e) => setSignComment(e.target.value)}
                  placeholder="Catatan persetujuan..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Masukkan Kembali Password Akun Anda *
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="password"
                    required
                    value={signPassword}
                    onChange={(e) => setSignPassword(e.target.value)}
                    placeholder="Verifikasi identitas penandatangan"
                    className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none"
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Password hanya diverifikasi secara aman ke Supabase Auth dan tidak disimpan.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setSignModalOpen(false);
                    setSignPassword('');
                  }}
                  disabled={actionLoading}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="rounded-lg bg-[#1755CE] px-5 py-2 text-xs font-semibold text-white hover:bg-[#1244A8] disabled:opacity-50"
                >
                  {actionLoading ? 'Memproses...' : 'Tanda Tangani Dokumen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Review / Approve / Revision / Reject Modal */}
      {reasonModal.open && (
        <ConfirmDialog
          open={reasonModal.open}
          title={reasonModal.title}
          description={
            reasonModal.requireReason
              ? 'Mohon cantumkan alasan yang jelas untuk pemohon dokumen.'
              : 'Tambahkan catatan opsional sebelum melanjutkan ke tahap berikutnya.'
          }
          confirmLabel="Kirim Tindakan"
          danger={reasonModal.type === 'rejected'}
          loading={actionLoading}
          onConfirm={handleSignerSimpleAction}
          onCancel={() => setReasonModal({ ...reasonModal, open: false })}
        >
          <textarea
            rows={3}
            value={actionComment}
            onChange={(e) => setActionComment(e.target.value)}
            placeholder={reasonModal.requireReason ? 'Tulis alasan wajib di sini...' : 'Catatan (opsional)...'}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1755CE] focus:outline-none"
          />
        </ConfirmDialog>
      )}

      <ConfirmDialog
        open={archiveConfirmOpen}
        title="Arsipkan Dokumen?"
        description="Dokumen akan dipindahkan ke menu Arsip Dokumen dan tetap dapat diunduh serta diverifikasi."
        confirmLabel="Arsipkan"
        loading={actionLoading}
        onConfirm={handleArchive}
        onCancel={() => setArchiveConfirmOpen(false)}
      />

      <ConfirmDialog
        open={cancelConfirmOpen}
        title="Batalkan Dokumen?"
        description="Proses persetujuan akan dihentikan secara permanen dan QR verification akan berstatus Dibatalkan."
        confirmLabel="Ya, Batalkan"
        danger
        loading={actionLoading}
        onConfirm={handleCancel}
        onCancel={() => setCancelConfirmOpen(false)}
      />
    </AppLayout>
  );
}
