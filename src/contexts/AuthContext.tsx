import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import {
  apiFetch,
  ensureSupabaseClient,
  isClientSupabaseConfigured,
  parseJsonWithDiagnostic,
  supabase,
} from '../lib/supabaseClient';
import { SystemSettings, UserProfile } from '../types';

export interface SystemHealth {
  ok: boolean;
  apiReachable?: boolean;
  healthError?: string;
  supabaseConfigured: boolean;
  hasSuperAdmin: boolean;
  maintenanceMode: boolean;
  appName: string;
  organizationName?: string;
  maxFileSizeMb?: number;
  qrEnabled?: boolean;
  initialSuperAdminEmailHint?: boolean;
  initialSuperAdminEmailMasked?: string | null;
  publicSupabaseConfig?: { url: string; anonKey: string };
  error?: string;
}

interface AuthContextValue {
  session: Session | null;
  profile: UserProfile | null;
  settings: SystemSettings | null;
  unreadNotifications: number;
  health: SystemHealth | null;
  loading: boolean;
  authError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<UserProfile | null>;
  refreshHealth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const refreshHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health', { credentials: 'include' });
      const { data, htmlTitle } = await parseJsonWithDiagnostic<SystemHealth>(res);
      if (!data) {
        throw new Error(
          `Backend /api/health mengembalikan respons bukan JSON (HTTP ${res.status}${htmlTitle ? `: ${htmlTitle}` : ''}).`
        );
      }
      if (data.publicSupabaseConfig?.url && data.publicSupabaseConfig?.anonKey) {
        ensureSupabaseClient(data.publicSupabaseConfig.url, data.publicSupabaseConfig.anonKey);
      }
      setHealth({
        ...data,
        apiReachable: true,
        supabaseConfigured: Boolean(data.supabaseConfigured && (isClientSupabaseConfigured || supabase)),
      });
    } catch (err: any) {
      setHealth({
        ok: false,
        apiReachable: false,
        healthError: err?.message || 'Tidak dapat terhubung ke server backend.',
        supabaseConfigured: isClientSupabaseConfigured,
        hasSuperAdmin: true,
        maintenanceMode: false,
        appName: 'LAZUARDI e-SIGN',
      });
    }
  }, []);

  const refreshMe = useCallback(async (): Promise<UserProfile | null> => {
    if (!supabase) return null;
    try {
      const me = await apiFetch<{
        profile: UserProfile;
        settings: SystemSettings;
        unreadNotifications: number;
      }>('/api/me');
      setProfile(me.profile);
      setSettings(me.settings);
      setUnreadNotifications(me.unreadNotifications || 0);
      setAuthError(null);
      return me.profile;
    } catch (err: any) {
      setAuthError(err?.message || 'Gagal memuat profil pengguna.');
      setProfile(null);
      throw err;
    }
  }, []);

  useEffect(() => {
    let active = true;
    let subscription: { unsubscribe: () => void } | null = null;

    async function init() {
      await refreshHealth();
      if (!supabase) {
        if (active) setLoading(false);
        return;
      }

      const { data: sub } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
        if (!active) return;
        setSession(nextSession);
        if (nextSession) {
          try {
            await refreshMe();
          } catch {
            // Error handled in authError state
          }
        } else {
          setProfile(null);
          setUnreadNotifications(0);
        }
      });
      subscription = sub.subscription;

      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session);
      if (data.session) {
        try {
          await refreshMe();
        } catch {
          // Clear broken session if profile missing
          await supabase.auth.signOut();
          if (active) setSession(null);
        }
      }
      if (active) setLoading(false);
    }

    init();

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, [refreshHealth, refreshMe]);

  const signIn = async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase belum dikonfigurasi.');
    setAuthError(null);
    const normalizedEmail = email.trim().toLowerCase();

    let { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error && (error.message || '').toLowerCase().includes('email not confirmed') && !health?.hasSuperAdmin) {
      let confirmRejection: string | null = null;
      try {
        const confirmRes = await fetch('/api/auth/confirm-initial-superadmin', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: normalizedEmail, password }),
        });
        const { data: confirmData } = await parseJsonWithDiagnostic<{ ok?: boolean; error?: string }>(confirmRes);
        if (!confirmRes.ok && confirmData?.error) {
          confirmRejection = confirmData.error;
        }
      } catch {
        // Ignore if proxy blocks POST; refreshHealth also handles initial super_admin confirmation safely
      }
      if (confirmRejection) {
        throw new Error(confirmRejection);
      }
      await refreshHealth();
      const retry = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      data = retry.data;
      error = retry.error;
    }

    if (error || !data.session) {
      const msg = error?.message || '';
      if (msg.toLowerCase().includes('email not confirmed')) {
        throw new Error(
          'Email belum dikonfirmasi pada Supabase Auth. Cek inbox email Anda atau klik Confirm User pada menu Authentication > Users di Supabase Dashboard.'
        );
      }
      if (msg.toLowerCase().includes('invalid login credentials')) {
        throw new Error('Email atau password tidak valid.');
      }
      if (msg.toLowerCase().includes('not valid json') || msg.toLowerCase().includes('unexpected token')) {
        throw new Error('Server autentikasi mengembalikan respons tidak valid. Periksa konfigurasi VITE_SUPABASE_URL.');
      }
      throw new Error(msg || 'Gagal login.');
    }
    setSession(data.session);
    try {
      await refreshMe();
    } catch (err: any) {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      throw err;
    }
    try {
      await apiFetch('/api/auth/audit-login', { method: 'POST' });
    } catch {
      // Non-fatal: audit log failure should not invalidate an authenticated session
    }
  };

  const signOut = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    setSession(null);
    setProfile(null);
    setUnreadNotifications(0);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        settings,
        unreadNotifications,
        health,
        loading,
        authError,
        signIn,
        signOut,
        refreshMe,
        refreshHealth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
