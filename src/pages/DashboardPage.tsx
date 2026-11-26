import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Clock,
  FilePlus2,
  FileText,
  Hourglass,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { PriorityBadge, StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../contexts/AuthContext';
import { ACTION_LABEL, formatJakartaDate } from '../lib/format';
import { supabase } from '../lib/supabaseClient';
import { DocumentRecord } from '../types';

interface DashboardStats {
  total: number;
  waitingMine: number;
  inProgress: number;
  completed: number;
  needsRevision: number;
  rejected: number;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function DashboardPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats] = useState<DashboardStats>({
    total: 0,
    waitingMine: 0,
    inProgress: 0,
    completed: 0,
    needsRevision: 0,
    rejected: 0,
  });
  const [actionDocs, setActionDocs] = useState<any[]>([]);
  const [recentDocs, setRecentDocs] = useState<DocumentRecord[]>([]);
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [monthlyCounts, setMonthlyCounts] = useState<number[]>(Array(12).fill(0));
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    if (!supabase || !profile) return;
    setLoading(true);
    try {
      // 1. Fetch lightweight document summary rows (respecting RLS for user scope)
      const { data: docsData } = await supabase
        .from('documents')
        .select('id, status, created_at')
        .order('created_at', { ascending: false })
        .limit(500);

      const allDocs = docsData || [];
      const currentYear = new Date().getFullYear();
      const monthly = Array(12).fill(0);

      let inProgress = 0;
      let completed = 0;
      let needsRevision = 0;
      let rejected = 0;

      for (const d of allDocs) {
        if (['in_progress', 'waiting_review', 'waiting_approval', 'waiting_signature', 'finalizing'].includes(d.status)) {
          inProgress += 1;
        } else if (d.status === 'completed' || d.status === 'archived') {
          completed += 1;
        } else if (d.status === 'needs_revision') {
          needsRevision += 1;
        } else if (d.status === 'rejected') {
          rejected += 1;
        }

        const dt = new Date(d.created_at);
        if (dt.getFullYear() === currentYear) {
          monthly[dt.getMonth()] += 1;
        }
      }

      // 2. Fetch active tasks assigned to current user
      const { data: myTasks } = await supabase
        .from('document_signers')
        .select(
          'id, action_type, step_order, activated_at, document:documents(id, document_number, title, status, priority, created_at, creator:profiles!documents_created_by_fkey(full_name))'
        )
        .eq('user_id', profile.id)
        .eq('status', 'active')
        .order('activated_at', { ascending: true })
        .limit(10);

      const activeTasks = (myTasks || []).filter(
        (t: any) =>
          t.document &&
          ['in_progress', 'waiting_review', 'waiting_approval', 'waiting_signature'].includes(t.document.status)
      );

      setStats({
        total: allDocs.length,
        waitingMine: activeTasks.length,
        inProgress,
        completed,
        needsRevision,
        rejected,
      });
      setMonthlyCounts(monthly);
      setActionDocs(activeTasks);

      // 3. Recent documents with signer progress
      const { data: recDocs } = await supabase
        .from('documents')
        .select(
          'id, document_number, title, status, priority, created_at, updated_at, signers:document_signers(id, status, step_order)'
        )
        .order('updated_at', { ascending: false })
        .limit(6);

      setRecentDocs((recDocs as any[]) || []);

      // 4. Recent approval activities on accessible documents
      const { data: logs } = await supabase
        .from('approval_logs')
        .select('id, document_id, user_name, action, created_at, document:documents(document_number, title)')
        .order('created_at', { ascending: false })
        .limit(8);

      setRecentLogs(logs || []);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const maxMonthly = Math.max(1, ...monthlyCounts);

  const cards = [
    {
      label: 'Total Dokumen',
      value: stats.total,
      icon: FileText,
      color: 'text-[#163A70]',
      bg: 'bg-slate-100',
      to: '/dokumen-saya',
    },
    {
      label: 'Menunggu Tanda Tangan Saya',
      value: stats.waitingMine,
      icon: Clock,
      color: 'text-[#1755CE]',
      bg: 'bg-blue-50',
      to: '/menunggu-saya',
    },
    {
      label: 'Dalam Proses',
      value: stats.inProgress,
      icon: Hourglass,
      color: 'text-[#F59E0B]',
      bg: 'bg-amber-50',
      to: '/dokumen-saya?status=in_progress',
    },
    {
      label: 'Selesai',
      value: stats.completed,
      icon: CheckCircle2,
      color: 'text-[#16A34A]',
      bg: 'bg-emerald-50',
      to: '/dokumen-selesai',
    },
    {
      label: 'Perlu Revisi',
      value: stats.needsRevision,
      icon: RotateCcw,
      color: 'text-orange-700',
      bg: 'bg-orange-50',
      to: '/dokumen-saya?status=needs_revision',
    },
    {
      label: 'Ditolak',
      value: stats.rejected,
      icon: XCircle,
      color: 'text-[#DC2626]',
      bg: 'bg-red-50',
      to: '/dokumen-saya?status=rejected',
    },
  ];

  const actionText = (act: string) => {
    const map: Record<string, string> = {
      submitted: 'mengajukan dokumen',
      reviewed: 'menyelesaikan review',
      approved: 'menyetujui dokumen',
      signed: 'menandatangani dokumen',
      revision_requested: 'meminta revisi',
      rejected: 'menolak dokumen',
      resubmitted: 'mengajukan ulang revisi',
      finalized: 'memfinalisasi PDF',
      cancelled: 'membatalkan dokumen',
      archived: 'mengarsipkan dokumen',
    };
    return map[act] || act;
  };

  return (
    <AppLayout
      title="Dashboard"
      breadcrumb={`Selamat datang, ${profile?.full_name || ''}`}
      onRefresh={loadDashboard}
      refreshing={loading}
      actions={
        <Link
          to="/buat-dokumen"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#1755CE] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1244A8] whitespace-nowrap shrink-0"
        >
          <FilePlus2 className="h-4 w-4" />
          <span>Buat Dokumen</span>
        </Link>
      }
    >
      {/* Summary Cards */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.label}
              type="button"
              onClick={() => navigate(c.to)}
              className="text-left rounded-lg border border-slate-200 bg-white p-4 hover:border-[#1755CE]/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1755CE]"
            >
              <div className="flex items-center justify-between gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${c.bg} ${c.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-3 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {loading ? '—' : c.value}
              </p>
              <p className="mt-0.5 text-xs text-slate-600 line-clamp-2">{c.label}</p>
            </button>
          );
        })}
      </section>

      {/* Main Grid: Action Needed & Monthly Chart */}
      <section className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Action Required List */}
        <div className="lg:col-span-7 rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
            <h2 className="font-display text-sm font-semibold text-[#163A70]">
              Dokumen Membutuhkan Tindakan Saya
            </h2>
            <Link to="/menunggu-saya" className="text-xs font-medium text-[#1755CE] hover:underline">
              Lihat semua
            </Link>
          </div>
          {loading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : actionDocs.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-slate-600">Tidak ada dokumen yang menunggu tindakan Anda saat ini.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {actionDocs.map((item: any) => (
                <Link
                  key={item.id}
                  to={`/dokumen/${item.document.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-medium text-slate-700">{item.document.document_number}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.document.creator?.full_name || 'Pemohon'}</span>
                    </div>
                    <p className="mt-0.5 text-sm font-semibold text-slate-900 truncate">
                      {item.document.title}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <PriorityBadge priority={item.document.priority} />
                    <span className="rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-[#1755CE]">
                      {ACTION_LABEL[item.action_type as keyof typeof ACTION_LABEL] || item.action_type}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Monthly Documents Chart */}
        <div className="lg:col-span-5 rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-sm font-semibold text-[#163A70]">
                Dokumen Bulanan ({new Date().getFullYear()})
              </h2>
              <p className="text-xs text-slate-500">Jumlah dokumen berdasarkan tanggal pengajuan</p>
            </div>
          </div>

          <div className="mt-4 flex items-end gap-2 h-44 pt-4">
            {monthlyCounts.map((count, idx) => {
              const heightPct = Math.round((count / maxMonthly) * 100);
              return (
                <div key={MONTH_NAMES[idx]} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                  <span className="text-[10px] font-mono text-slate-600 tabular-nums">
                    {count > 0 ? count : ''}
                  </span>
                  <div className="w-full max-w-[24px] flex-1 flex items-end">
                    <div
                      className="w-full rounded-t bg-[#1755CE] transition-all"
                      style={{ height: `${Math.max(count > 0 ? 8 : 2, heightPct)}%`, opacity: count > 0 ? 1 : 0.15 }}
                      title={`${MONTH_NAMES[idx]}: ${count} dokumen`}
                    />
                  </div>
                  <span className="text-[10px] text-slate-500">{MONTH_NAMES[idx]}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Bottom Grid: Recent Documents Progress & Activity Feed */}
      <section className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
            <h2 className="font-display text-sm font-semibold text-[#163A70]">
              Dokumen Terbaru &amp; Progress Tanda Tangan
            </h2>
            <Link to="/dokumen-saya" className="text-xs font-medium text-[#1755CE] hover:underline">
              Kelola dokumen
            </Link>
          </div>
          {recentDocs.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">
              Belum ada dokumen. Klik Buat Dokumen untuk memulai pengajuan.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-600">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Dokumen</th>
                    <th className="px-4 py-2.5 font-medium">Progress</th>
                    <th className="px-5 py-2.5 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentDocs.map((doc) => {
                    const totalSigners = doc.signers?.length || 0;
                    const doneSigners = doc.signers?.filter((s) => s.status === 'completed').length || 0;
                    const pct = totalSigners > 0 ? Math.round((doneSigners / totalSigners) * 100) : 0;
                    return (
                      <tr
                        key={doc.id}
                        onClick={() => navigate(`/dokumen/${doc.id}`)}
                        className="cursor-pointer hover:bg-slate-50 transition-colors"
                      >
                        <td className="px-5 py-3 max-w-xs">
                          <p className="font-medium text-slate-900 truncate">{doc.title}</p>
                          <p className="text-xs font-mono text-slate-500">{doc.document_number}</p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                              <div className="h-full bg-[#16A34A]" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs font-mono text-slate-600 tabular-nums">
                              {doneSigners}/{totalSigners}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <StatusBadge status={doc.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-3.5">
            <h2 className="font-display text-sm font-semibold text-[#163A70]">Aktivitas Terakhir</h2>
          </div>
          {recentLogs.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">
              Belum ada aktivitas persetujuan tercatat.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentLogs.map((log: any) => (
                <Link
                  key={log.id}
                  to={`/dokumen/${log.document_id}`}
                  className="block px-5 py-3 hover:bg-slate-50 transition-colors"
                >
                  <p className="text-xs text-slate-800">
                    <span className="font-semibold">{log.user_name}</span> {actionText(log.action)}{' '}
                    <span className="font-medium text-[#163A70]">
                      {log.document?.title || log.document?.document_number || ''}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                    {formatJakartaDate(log.created_at)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </AppLayout>
  );
}
