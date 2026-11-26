import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { formatJakartaDate } from '../lib/format';
import { supabase } from '../lib/supabaseClient';
import { NotificationItem } from '../types';

export function NotificationsPage() {
  const { profile, refreshMe } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadNotifications = useCallback(async () => {
    if (!supabase || !profile) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!error && data) {
      setItems(data as NotificationItem[]);
    }
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const markAsRead = async (id: string) => {
    if (!supabase) return;
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    await refreshMe();
  };

  const markAllRead = async () => {
    if (!supabase || !profile) return;
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', profile.id)
      .eq('is_read', false);
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await refreshMe();
    showToast('Semua notifikasi ditandai sudah dibaca.', 'success');
  };

  return (
    <AppLayout
      title="Notifikasi"
      breadcrumb="Aktivitas & Pemberitahuan"
      onRefresh={loadNotifications}
      refreshing={loading}
      actions={
        <button
          type="button"
          onClick={markAllRead}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
        >
          <CheckCheck className="h-4 w-4 text-[#1755CE]" />
          <span>Tandai Sudah Dibaca</span>
        </button>
      }
    >
      <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 rounded bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="py-14 text-center">
            <Bell className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm text-slate-600">Belum ada notifikasi.</p>
          </div>
        ) : (
          items.map((n) => (
            <div
              key={n.id}
              className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 ${
                n.is_read ? 'bg-white' : 'bg-blue-50/40'
              }`}
            >
              <div
                className="min-w-0 cursor-pointer flex-1"
                onClick={async () => {
                  if (!n.is_read) await markAsRead(n.id);
                  if (n.document_id) navigate(`/dokumen/${n.document_id}`);
                }}
              >
                <div className="flex items-center gap-2">
                  <p className={`text-sm ${n.is_read ? 'font-medium text-slate-800' : 'font-semibold text-[#163A70]'}`}>
                    {n.title}
                  </p>
                  {!n.is_read && (
                    <span className="rounded bg-[#1755CE] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      Baru
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-600">{n.message}</p>
                <p className="mt-1 text-[11px] text-slate-400 tabular-nums">{formatJakartaDate(n.created_at)}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {!n.is_read && (
                  <button
                    type="button"
                    onClick={() => markAsRead(n.id)}
                    className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Tandai Dibaca
                  </button>
                )}
                {n.document_id && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!n.is_read) await markAsRead(n.id);
                      navigate(`/dokumen/${n.document_id}`);
                    }}
                    className="rounded bg-[#1755CE] px-3 py-1 text-xs font-medium text-white hover:bg-[#1244A8]"
                  >
                    Buka Dokumen
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </AppLayout>
  );
}
