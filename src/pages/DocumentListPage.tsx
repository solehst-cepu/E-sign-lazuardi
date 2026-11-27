import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Download, FilePlus2, FileSpreadsheet, Printer, Search } from 'lucide-react';
import * as XLSX from 'xlsx';
import { AppLayout } from '../components/AppLayout';
import { PriorityBadge, StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ACTION_LABEL, formatJakartaDate, STATUS_META } from '../lib/format';
import { apiFetch, downloadFileFromSignedUrl, supabase } from '../lib/supabaseClient';
import { DocumentStatus, MasterDataItem } from '../types';

interface DocumentListPageProps {
  mode: 'waiting' | 'mine' | 'completed' | 'archive';
}

const PAGE_SIZE = 20;

export function DocumentListPage({ mode }: DocumentListPageProps) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(searchParams.get('status') || '');
  const [unitFilter, setUnitFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');

  const [units, setUnits] = useState<MasterDataItem[]>([]);
  const [departments, setDepartments] = useState<MasterDataItem[]>([]);
  const [docTypes, setDocTypes] = useState<MasterDataItem[]>([]);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from('master_data')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        const list = (data as MasterDataItem[]) || [];
        setUnits(list.filter((m) => m.category === 'unit'));
        setDepartments(list.filter((m) => m.category === 'department'));
        setDocTypes(list.filter((m) => m.category === 'document_type'));
      });
  }, []);

  const loadList = useCallback(async () => {
    if (!supabase || !profile) return;
    setLoading(true);
    try {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      if (mode === 'waiting') {
        const { data: tasks, count, error } = await supabase
          .from('document_signers')
          .select(
            'id, action_type, step_order, activated_at, document:documents!inner(id, document_number, title, status, priority, submitted_at, created_at, creator:profiles!documents_created_by_fkey(full_name))',
            { count: 'exact' }
          )
          .eq('user_id', profile.id)
          .eq('status', 'active')
          .in('document.status', ['in_progress', 'waiting_review', 'waiting_approval', 'waiting_signature'])
          .order('activated_at', { ascending: false })
          .range(from, to);

        if (error) throw error;
        let filtered = (tasks || []) as any[];
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          filtered = filtered.filter(
            (t) =>
              t.document.title.toLowerCase().includes(q) ||
              t.document.document_number.toLowerCase().includes(q)
          );
        }
        setRows(filtered);
        setTotal(count || filtered.length);
      } else {
        let query = supabase
          .from('documents')
          .select(
            'id, document_number, title, status, priority, document_date, submitted_at, completed_at, created_at, created_by, creator:profiles!documents_created_by_fkey(full_name), unit:master_data!documents_unit_id_fkey(name), department:master_data!documents_department_id_fkey(name), document_type:master_data!documents_document_type_id_fkey(name)',
            { count: 'exact' }
          )
          .order('created_at', { ascending: false });

        if (mode === 'mine' && profile.role === 'user') {
          query = query.eq('created_by', profile.id);
        } else if (mode === 'completed') {
          query = query.eq('status', 'completed');
        } else if (mode === 'archive') {
          query = query.in('status', ['completed', 'archived', 'rejected', 'cancelled']);
        }

        if (statusFilter) {
          if (statusFilter === 'in_progress') {
            query = query.in('status', ['in_progress', 'waiting_review', 'waiting_approval', 'waiting_signature', 'finalizing']);
          } else {
            query = query.eq('status', statusFilter);
          }
        }
        if (unitFilter) query = query.eq('unit_id', unitFilter);
        if (deptFilter) query = query.eq('department_id', deptFilter);
        if (typeFilter) query = query.eq('document_type_id', typeFilter);
        if (search.trim()) {
          const q = search.trim();
          query = query.or(`title.ilike.%${q}%,document_number.ilike.%${q}%`);
        }
        if (yearFilter) {
          const y = parseInt(yearFilter, 10);
          const mStart = monthFilter ? String(monthFilter).padStart(2, '0') : '01';
          const mEnd = monthFilter ? String(monthFilter).padStart(2, '0') : '12';
          const lastDay = new Date(y, parseInt(mEnd, 10), 0).getDate();
          query = query.gte('document_date', `${y}-${mStart}-01`).lte('document_date', `${y}-${mEnd}-${lastDay}`);
        }

        const { data, count, error } = await query.range(from, to);
        if (error) throw error;
        setRows(data || []);
        setTotal(count || 0);
      }
    } catch (err: any) {
      showToast(err?.message || 'Gagal memuat daftar dokumen.', 'error');
    } finally {
      setLoading(false);
    }
  }, [
    mode,
    page,
    profile,
    search,
    statusFilter,
    unitFilter,
    deptFilter,
    typeFilter,
    yearFilter,
    monthFilter,
    showToast,
  ]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const handleDownloadPdf = async (docId: string, docNumber?: string) => {
    try {
      const res = await apiFetch<{ url: string; fileName?: string }>(
        `/api/documents/${docId}/pdf-url?kind=final&download=1`
      );
      const fallback = `${(docNumber || 'dokumen').replace(/[^a-zA-Z0-9._-]+/g, '-')}-SIGNED.pdf`;
      await downloadFileFromSignedUrl(res.url, res.fileName || fallback);
      showToast('PDF Signed berhasil diunduh.', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Gagal mengunduh PDF Signed.', 'error');
    }
  };

  const handleExportExcel = () => {
    const exportRows = rows.map((r) => ({
      'Nomor Dokumen': r.document_number,
      Judul: r.title,
      Jenis: r.document_type?.name || '-',
      Unit: r.unit?.name || '-',
      Departemen: r.department?.name || '-',
      Tanggal: r.document_date,
      Prioritas: r.priority,
      Status: STATUS_META[r.status as DocumentStatus]?.label || r.status,
      Selesai: formatJakartaDate(r.completed_at),
    }));
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Arsip Dokumen');
    XLSX.writeFile(wb, `arsip-dokumen-lazuardi-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const pageMeta = {
    waiting: { title: 'Menunggu Saya', breadcrumb: 'Daftar Tugas Persetujuan & Tanda Tangan' },
    mine: { title: 'Dokumen Saya', breadcrumb: 'Daftar Pengajuan & Draft Dokumen' },
    completed: { title: 'Dokumen Selesai', breadcrumb: 'Dokumen Telah Selesai Ditandatangani' },
    archive: { title: 'Arsip Dokumen', breadcrumb: 'Arsip Digital Sekolah & Yayasan Lazuardi' },
  }[mode];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AppLayout
      title={pageMeta.title}
      breadcrumb={pageMeta.breadcrumb}
      onRefresh={loadList}
      refreshing={loading}
      actions={
        <div className="flex items-center gap-2">
          {mode === 'archive' && (
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <FileSpreadsheet className="h-4 w-4 text-[#16A34A]" />
              <span>Export Excel</span>
            </button>
          )}
          <Link
            to="/buat-dokumen"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1755CE] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1244A8] whitespace-nowrap"
          >
            <FilePlus2 className="h-4 w-4" />
            <span>Buat Dokumen</span>
          </Link>
        </div>
      }
    >
      {/* Search & Filters */}
      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="sm:col-span-2 relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Cari nomor dokumen atau judul..."
              className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-1.5 text-sm focus:border-[#1755CE] focus:outline-none"
            />
          </div>

          {mode !== 'waiting' && (
            <>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700"
              >
                <option value="">Semua Status</option>
                {Object.entries(STATUS_META).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>

              <select
                value={unitFilter}
                onChange={(e) => {
                  setUnitFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700"
              >
                <option value="">Semua Unit</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>

              <select
                value={deptFilter}
                onChange={(e) => {
                  setDeptFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700"
              >
                <option value="">Semua Departemen</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>

              <select
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700"
              >
                <option value="">Semua Jenis</option>
                {docTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        {mode === 'archive' && (
          <div className="mt-3 flex flex-wrap gap-3 border-t border-slate-100 pt-3">
            <select
              value={yearFilter}
              onChange={(e) => {
                setYearFilter(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700"
            >
              <option value="">Semua Tahun</option>
              {[2026, 2025, 2024].map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
            <select
              value={monthFilter}
              onChange={(e) => {
                setMonthFilter(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700"
            >
              <option value="">Semua Bulan</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={String(m)}>
                  Bulan {m}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
              {mode === 'waiting' ? (
                <tr>
                  <th className="px-4 py-3 font-medium">Nomor Dokumen</th>
                  <th className="px-4 py-3 font-medium">Judul Dokumen</th>
                  <th className="px-4 py-3 font-medium">Pengaju</th>
                  <th className="px-4 py-3 font-medium">Tanggal Pengajuan</th>
                  <th className="px-4 py-3 font-medium">Jenis Tindakan</th>
                  <th className="px-4 py-3 font-medium">Prioritas</th>
                  <th className="px-4 py-3 font-medium text-right">Status</th>
                </tr>
              ) : (
                <tr>
                  <th className="px-4 py-3 font-medium">Nomor Dokumen</th>
                  <th className="px-4 py-3 font-medium">Judul Dokumen</th>
                  <th className="px-4 py-3 font-medium">Unit / Dept</th>
                  <th className="px-4 py-3 font-medium">Tanggal</th>
                  <th className="px-4 py-3 font-medium">Prioritas</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Aksi</th>
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    Memuat data dokumen...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">
                    Tidak ada dokumen yang sesuai dengan filter saat ini.
                  </td>
                </tr>
              ) : mode === 'waiting' ? (
                rows.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => navigate(`/dokumen/${item.document.id}`)}
                    className="cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-700 whitespace-nowrap">
                      {item.document.document_number}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900 max-w-xs truncate">
                      {item.document.title}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                      {item.document.creator?.full_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {formatJakartaDate(item.document.submitted_at || item.document.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-[#1755CE]">
                        {ACTION_LABEL[item.action_type as keyof typeof ACTION_LABEL]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={item.document.priority} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <StatusBadge status={item.document.status} />
                    </td>
                  </tr>
                ))
              ) : (
                rows.map((doc) => (
                  <tr
                    key={doc.id}
                    onClick={() => navigate(`/dokumen/${doc.id}`)}
                    className="cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-700 whitespace-nowrap">
                      {doc.document_number}
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <p className="font-medium text-slate-900 truncate">{doc.title}</p>
                      <p className="text-[11px] text-slate-500 truncate">{doc.document_type?.name || ''}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                      {doc.unit?.name || '—'} · {doc.department?.name || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {formatJakartaDate(doc.created_at, false)}
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={doc.priority} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={doc.status} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {doc.status === 'draft' && doc.created_by === profile?.id ? (
                        <Link
                          to={`/buat-dokumen?id=${doc.id}`}
                          className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-[#1755CE] hover:bg-blue-50"
                        >
                          Lanjutkan
                        </Link>
                      ) : (
                        <div className="inline-flex items-center gap-1.5">
                          {(doc.status === 'completed' || doc.status === 'archived') && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleDownloadPdf(doc.id, doc.document_number)}
                                className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100"
                                title="Download PDF Signed (Selesai Ditandatangani)"
                              >
                                <Download className="h-3.5 w-3.5" />
                                <span>PDF Signed</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => navigate(`/dokumen/${doc.id}`)}
                                className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                                title="Cetak / Detail"
                              >
                                <Printer className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
          <span className="tabular-nums">
            Halaman {page} dari {totalPages} · Total {total} dokumen
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border border-slate-200 px-3 py-1 hover:bg-slate-50 disabled:opacity-40"
            >
              Sebelumnya
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded border border-slate-200 px-3 py-1 hover:bg-slate-50 disabled:opacity-40"
            >
              Berikutnya
            </button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
