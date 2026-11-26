import React, { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Archive,
  BarChart3,
  Bell,
  CheckCircle2,
  ClipboardList,
  Clock,
  Database,
  FilePlus2,
  FileText,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  Settings,
  ShieldAlert,
  UserCircle,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ROLE_LABEL } from '../lib/format';
import { BrandLogo } from './BrandLogo';

interface AppLayoutProps {
  title: string;
  breadcrumb?: string;
  actions?: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: React.ReactNode;
}

export function AppLayout({
  title,
  breadcrumb,
  actions,
  onRefresh,
  refreshing = false,
  children,
}: AppLayoutProps) {
  const { profile, unreadNotifications, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const isAdminOrSuper = profile?.role === 'admin' || profile?.role === 'super_admin';

  const mainNav = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/buat-dokumen', label: 'Buat Dokumen', icon: FilePlus2 },
    { to: '/menunggu-saya', label: 'Menunggu Saya', icon: Clock },
    { to: '/dokumen-saya', label: 'Dokumen Saya', icon: FileText },
    { to: '/dokumen-selesai', label: 'Dokumen Selesai', icon: CheckCircle2 },
    { to: '/arsip', label: 'Arsip Dokumen', icon: Archive },
    { to: '/notifikasi', label: 'Notifikasi', icon: Bell, badge: unreadNotifications },
    { to: '/profil', label: 'Profil Saya', icon: UserCircle },
  ];

  const adminNav = [
    { to: '/admin/pengguna', label: 'Manajemen Pengguna', icon: Users },
    { to: '/admin/master-data', label: 'Master Data', icon: Database },
    { to: '/admin/template-workflow', label: 'Template Workflow', icon: GitBranch },
    { to: '/admin/laporan', label: 'Laporan', icon: BarChart3 },
    { to: '/admin/audit-trail', label: 'Audit Trail', icon: ClipboardList },
    ...(profile?.role === 'super_admin'
      ? [{ to: '/admin/pengaturan', label: 'Pengaturan', icon: Settings }]
      : []),
  ];

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const renderNavLink = (item: { to: string; label: string; icon: any; badge?: number }) => {
    const Icon = item.icon;
    const isActive = location.pathname === item.to || location.pathname.startsWith(item.to + '/');
    return (
      <NavLink
        key={item.to}
        to={item.to}
        onClick={() => setSidebarOpen(false)}
        className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
          isActive
            ? 'bg-[#1755CE] text-white'
            : 'text-slate-700 hover:bg-slate-100 hover:text-[#163A70]'
        }`}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`} />
          <span className="truncate">{item.label}</span>
        </span>
        {item.badge && item.badge > 0 ? (
          <span
            className={`rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold tabular-nums ${
              isActive ? 'bg-white/20 text-white' : 'bg-[#1755CE] text-white'
            }`}
          >
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        ) : null}
      </NavLink>
    );
  };

  return (
    <div className="min-h-screen flex bg-[#F4F6F9] text-slate-900">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
          <Link to="/dashboard" className="focus:outline-none">
            <BrandLogo compact />
          </Link>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 lg:hidden"
            aria-label="Tutup menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          <div className="space-y-1">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Menu Utama
            </p>
            {mainNav.map(renderNavLink)}
          </div>

          {isAdminOrSuper && (
            <div className="space-y-1">
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Administrasi
              </p>
              {adminNav.map(renderNavLink)}
            </div>
          )}
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="mb-3">
            <p className="text-sm font-semibold text-slate-900 truncate">{profile?.full_name}</p>
            <p className="text-xs text-slate-500 truncate">
              {profile?.job_title || (profile ? ROLE_LABEL[profile.role] : '')}
            </p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-[#DC2626] transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 lg:hidden"
              aria-label="Buka menu navigasi"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              {breadcrumb && (
                <p className="text-xs text-slate-500 truncate">{breadcrumb}</p>
              )}
              <h1 className="font-display text-base sm:text-lg font-semibold text-[#163A70] truncate">
                {title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                title="Muat ulang data"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Muat Ulang</span>
              </button>
            )}
            <Link
              to="/notifikasi"
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shrink-0"
              aria-label="Notifikasi"
            >
              <Bell className="h-4 w-4" />
              {unreadNotifications > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#DC2626] px-1 text-[10px] font-bold text-white tabular-nums">
                  {unreadNotifications > 9 ? '9+' : unreadNotifications}
                </span>
              )}
            </Link>
            {actions}
          </div>
        </header>

        {profile?.must_change_password && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 sm:px-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs sm:text-sm text-amber-900">
              <ShieldAlert className="h-4 w-4 shrink-0 text-[#F59E0B]" />
              <span>Anda menggunakan password sementara. Demi keamanan, segera ubah password Anda.</span>
            </div>
            <Link
              to="/ganti-password"
              className="rounded bg-[#F59E0B] px-3 py-1 text-xs font-semibold text-white hover:bg-amber-600 whitespace-nowrap shrink-0"
            >
              Ganti Password
            </Link>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
