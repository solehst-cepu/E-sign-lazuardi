import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '../../components/AppLayout';
import { useToast } from '../../contexts/ToastContext';
import { formatJakartaDate } from '../../lib/format';
import { apiFetch } from '../../lib/supabaseClient';
import { AuditLogItem } from '../../types';

export function AuditTrailPage() {
  const { showToast } = useToast();
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [activityFilter, setActivityFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: '20',
        ...(activityFilter ? { activity: activityFilter } : {}),
      });
      const res = await apiFetch<{ data: AuditLogItem[]; total: number }>(`/api/admin/audit-logs?${qs.toString()}`);
      setLogs(res.data || []);
      setTotal(res.total || 0);
    } catch (err: any) {
      showToast(err?.message || 'Gagal memuat audit trail.', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, activityFilter, showToast]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <AppLayout
      title="Audit Trail"
      breadcrumb="Administrasi · Catatan Aktivitas Sistem (Append-Only)"
      onRefresh={loadLogs}
      refreshing={loading}
    >
      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap gap-3 items-center justify-between">
        <select
          value={activityFilter}
          onChange={(e) => {
            setActivityFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700"
        >
          <option value="">Semua Aktivitas</option>
          <option value="LOGIN">Login</option>
          <option value="USER_CREATED">Pembuatan Pengguna</option>
          <option value="ROLE_CHANGED">Perubahan Hak Akses</option>
          <option value="PDF_UPLOADED">Upload PDF</option>
          <option value="DOCUMENT_SUBMITTED">Pengajuan Dokumen</option>
          <option value="DOCUMENT_REVIEWED">Review</option>
          <option value="DOCUMENT_APPROVED">Approval</option>
          <option value="DOCUMENT_SIGNED">Tanda Tangan</option>
          <option value="DOCUMENT_REVISION_REQUESTED">Permintaan Revisi</option>
          <option value="DOCUMENT_REJECTED">Penolakan</option>
          <option value="DOCUMENT_FINALIZED">Finalisasi</option>
          <option value="DOCUMENT_DOWNLOADED">Download Dokumen</option>
        </select>
        <span className="text-xs text-slate-500 tabular-nums">Total {total} catatan</span>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">Waktu (WIB)</th>
                <th className="px-4 py-3 font-medium">Pengguna</th>
                <th className="px-4 py-3 font-medium">Aktivitas</th>
                <th className="px-4 py-3 font-medium">Dokumen</th>
                <th className="px-4 py-3 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                    Memuat audit trail...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                    Belum ada catatan aktivitas.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 tabular-nums text-slate-600 whitespace-nowrap">
                      {formatJakartaDate(log.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{log.user?.full_name || 'Sistem'}</p>
                      <p className="text-[11px] text-slate-500">{log.user?.email || ''}</p>
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-[#163A70] whitespace-nowrap">
                      {log.activity_name}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700 whitespace-nowrap">
                      {log.document?.document_number || '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-600 max-w-xs truncate">
                      {JSON.stringify(log.details)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
          <span className="tabular-nums">
            Halaman {page} / {totalPages}
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
    </AppLayout>
  );
}
