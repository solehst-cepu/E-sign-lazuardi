import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { CreateDocumentPage } from './pages/CreateDocumentPage';
import { DashboardPage } from './pages/DashboardPage';
import { DocumentDetailPage } from './pages/DocumentDetailPage';
import { DocumentListPage } from './pages/DocumentListPage';
import { LoginPage } from './pages/LoginPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ProfileSignaturePage } from './pages/ProfileSignaturePage';
import { VerifyPage } from './pages/VerifyPage';
import { AuditTrailPage } from './pages/admin/AuditTrailPage';
import { MasterDataPage } from './pages/admin/MasterDataPage';
import { ReportsPage } from './pages/admin/ReportsPage';
import { SystemSettingsPage } from './pages/admin/SystemSettingsPage';
import { UsersAdminPage } from './pages/admin/UsersAdminPage';
import { WorkflowTemplatesPage } from './pages/admin/WorkflowTemplatesPage';
import { UserRole } from './types';

function FullScreenLoader() {
  return (
    <div className="min-h-screen bg-[#F4F6F9] flex flex-col items-center justify-center text-slate-600">
      <Loader2 className="h-7 w-7 animate-spin text-[#1755CE]" />
      <p className="mt-2 text-sm">Memuat LAZUARDI e-SIGN...</p>
    </div>
  );
}

function RequireAuth({
  children,
  allowPasswordChangeOnly = false,
}: {
  children: React.ReactNode;
  allowPasswordChangeOnly?: boolean;
}) {
  const { session, profile, loading } = useAuth();

  if (loading) return <FullScreenLoader />;
  if (!session || !profile) return <Navigate to="/login" replace />;
  if (profile.must_change_password && !allowPasswordChangeOnly) {
    return <Navigate to="/ganti-password" replace />;
  }

  return <>{children}</>;
}

function RequireRole({
  roles,
  children,
}: {
  roles: UserRole[];
  children: React.ReactNode;
}) {
  const { profile, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!profile || !roles.includes(profile.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/verify/:token" element={<VerifyPage />} />

            {/* Password Change Route */}
            <Route
              path="/ganti-password"
              element={
                <RequireAuth allowPasswordChangeOnly>
                  <ChangePasswordPage />
                </RequireAuth>
              }
            />

            {/* Main Application Routes */}
            <Route
              path="/dashboard"
              element={
                <RequireAuth>
                  <DashboardPage />
                </RequireAuth>
              }
            />
            <Route
              path="/buat-dokumen"
              element={
                <RequireAuth>
                  <CreateDocumentPage />
                </RequireAuth>
              }
            />
            <Route
              path="/menunggu-saya"
              element={
                <RequireAuth>
                  <DocumentListPage mode="waiting" />
                </RequireAuth>
              }
            />
            <Route
              path="/dokumen-saya"
              element={
                <RequireAuth>
                  <DocumentListPage mode="mine" />
                </RequireAuth>
              }
            />
            <Route
              path="/dokumen-selesai"
              element={
                <RequireAuth>
                  <DocumentListPage mode="completed" />
                </RequireAuth>
              }
            />
            <Route
              path="/arsip"
              element={
                <RequireAuth>
                  <DocumentListPage mode="archive" />
                </RequireAuth>
              }
            />
            <Route
              path="/dokumen/:id"
              element={
                <RequireAuth>
                  <DocumentDetailPage />
                </RequireAuth>
              }
            />
            <Route
              path="/notifikasi"
              element={
                <RequireAuth>
                  <NotificationsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/profil"
              element={
                <RequireAuth>
                  <ProfileSignaturePage />
                </RequireAuth>
              }
            />

            {/* Admin & Super Admin Routes */}
            <Route
              path="/admin/pengguna"
              element={
                <RequireAuth>
                  <RequireRole roles={['super_admin', 'admin']}>
                    <UsersAdminPage />
                  </RequireRole>
                </RequireAuth>
              }
            />
            <Route
              path="/admin/master-data"
              element={
                <RequireAuth>
                  <RequireRole roles={['super_admin', 'admin']}>
                    <MasterDataPage />
                  </RequireRole>
                </RequireAuth>
              }
            />
            <Route
              path="/admin/template-workflow"
              element={
                <RequireAuth>
                  <RequireRole roles={['super_admin', 'admin']}>
                    <WorkflowTemplatesPage />
                  </RequireRole>
                </RequireAuth>
              }
            />
            <Route
              path="/admin/laporan"
              element={
                <RequireAuth>
                  <RequireRole roles={['super_admin', 'admin']}>
                    <ReportsPage />
                  </RequireRole>
                </RequireAuth>
              }
            />
            <Route
              path="/admin/audit-trail"
              element={
                <RequireAuth>
                  <RequireRole roles={['super_admin', 'admin']}>
                    <AuditTrailPage />
                  </RequireRole>
                </RequireAuth>
              }
            />
            <Route
              path="/admin/pengaturan"
              element={
                <RequireAuth>
                  <RequireRole roles={['super_admin']}>
                    <SystemSettingsPage />
                  </RequireRole>
                </RequireAuth>
              }
            />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}
