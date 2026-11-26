import { useCallback, useEffect, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { AppLayout } from '../../components/AppLayout';
import { useToast } from '../../contexts/ToastContext';
import { formatJakartaDate, STATUS_META } from '../../lib/format';
import { apiFetch } from '../../lib/supabaseClient';
import { DocumentStatus } from '../../types';

interface ReportResponse {
  year: number;
  summary: {
    total: number;
    inProgress: number;
    completed: number;
    rejected: number;
    overdue: number;
    avgCompletionHours: number;
  };
  monthly: Array<{ month: number; count: number }>;
  byUnit: Array<{ name: string; count: number }>;
  byDepartment: Array<{ name: string; count: number }>;
  documents: any[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function ReportsPage() {
  const { showToast } = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ReportResponse>(`/api/admin/reports?year=${year}`);
      setReport(data);
    } catch (err: any) {
      showToast(err?.message || 'Gagal memuat laporan.', 'error');
    } finally {
      setLoading(false);
    }
  }, [year, showToast]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const exportExcel = () => {
    if (!report) return;
    const rows = report.documents.map((d) => ({
      'Nomor Dokumen': d.document_number,
      Judul: d.title,
      Jenis: d.document_type?.name || '-',
      Unit: d.unit?.name || '-',
      Departemen: d.department?.name || '-',
      Prioritas: d.priority,
      Status: STATUS_META[d.status as DocumentStatus]?.label || d.status,
      Diajukan: formatJakartaDate(d.submitted_at),
      Selesai: formatJakartaDate(d.completed_at),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Laporan ${year}`);
    XLSX.writeFile(wb, `laporan-lazuardi-esign-${year}.xlsx`);
  };

  const exportCsv = () => {
    if (!report) return;
    const headers = ['Nomor Dokumen', 'Judul', 'Unit', 'Departemen', 'Status', 'Dibuat'];
    const lines = [
      headers.join(','),
      ...report.documents.map((d) =>
        [
          `"${d.document_number}"`,
          `"${String(d.title).replace(/"/g, '""')}"`,
          `"${d.unit?.name || '-'}"`,
          `"${d.department?.name || '-'}"`,
          `"${STATUS_META[d.status as DocumentStatus]?.label || d.status}"`,
          `"${formatJakartaDate(d.created_at)}"`,
        ].join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `laporan-lazuardi-esign-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout
      title="Laporan"
      breadcrumb="Administrasi · Analitik & Rekapitulasi"
      onRefresh={loadReports}
      refreshing={loading}
      actions={
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
          >
            {[2026, 2025, 2024].map((y) => (
              <option key={y} value={y}>
                Tahun {y}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!report}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>CSV</span>
          </button>
          <button
            type="button"
            onClick={exportExcel}
            disabled={!report}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#16A34A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Excel</span>
          </button>
        </div>
      }
    >
      {report && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Total Dokumen', val: report.summary.total },
              { label: 'Dalam Proses', val: report.summary.inProgress },
              { label: 'Selesai', val: report.summary.completed },
              { label: 'Ditolak', val: report.summary.rejected },
              { label: 'Terlambat', val: report.summary.overdue },
              { label: 'Rata-rata Selesai', val: `${report.summary.avgCompletionHours} jam` },
            ].map((k) => (
              <div key={k.label} className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">{k.label}</p>
                <p className="mt-2 font-display text-2xl font-bold text-[#163A70] tabular-nums">{k.val}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Monthly */}
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="font-display text-sm font-semibold text-[#163A70] mb-3">Dokumen per Bulan</h2>
              <div className="space-y-2">
                {report.monthly.map((m) => (
                  <div key={m.month} className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">{MONTHS[m.month - 1]}</span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">{m.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* By Unit */}
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="font-display text-sm font-semibold text-[#163A70] mb-3">Dokumen per Unit</h2>
              {report.byUnit.length === 0 ? (
                <p className="text-xs text-slate-500">Belum ada data.</p>
              ) : (
                <div className="space-y-2">
                  {report.byUnit.map((u) => (
                    <div key={u.name} className="flex items-center justify-between text-xs">
                      <span className="text-slate-700">{u.name}</span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">{u.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* By Department */}
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="font-display text-sm font-semibold text-[#163A70] mb-3">Dokumen per Departemen</h2>
              {report.byDepartment.length === 0 ? (
                <p className="text-xs text-slate-500">Belum ada data.</p>
              ) : (
                <div className="space-y-2">
                  {report.byDepartment.map((d) => (
                    <div key={d.name} className="flex items-center justify-between text-xs">
                      <span className="text-slate-700">{d.name}</span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">{d.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
