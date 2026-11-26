import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { apiFetch, isClientSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { SystemSettings, UserProfile } from '../types';

export interface SystemHealth {
  ok: boolean;
  supabaseConfigured: boolean;
  hasSuperAdmin: boolean;
  maintenanceMode: boolean;
  appName: string;
  organizationName?: string;
  maxFileSizeMb?: number;
  qrEnabled?: boolean;
  initialSuperAdminEmailHint?: boolean;
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
  refreshMe: () => Promise<void>;
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
      const res = await fetch('/api/health');
      const data = (await res.json()) as SystemHealth;
      setHealth({
        ...data,
        supabaseConfigured: Boolean(data.supabaseConfigured && isClientSupabaseConfigured),
      });
    } catch {
      setHealth({
        ok: false,
        supabaseConfigured: isClientSupabaseConfigured,
        hasSuperAdmin: false,
        maintenanceMode: false,
        appName: 'LAZUARDI e-SIGN',
      });
    }
  }, []);

  const refreshMe = useCallback(async () => {
    if (!supabase) return;
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
    } catch (err: any) {
      setAuthError(err?.message || 'Gagal memuat profil pengguna.');
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function init() {
      await refreshHealth();
      if (!supabase) {
        if (active) setLoading(false);
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session);
      if (data.session) {
        await refreshMe();
      }
      if (active) setLoading(false);
    }

    init();

    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) {
        await refreshMe();
      } else {
        setProfile(null);
        setUnreadNotifications(0);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [refreshHealth, refreshMe]);

  const signIn = async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase belum dikonfigurasi.');
    setAuthError(null);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error || !data.session) {
      throw new Error('Email atau password tidak valid.');
    }
    setSession(data.session);
    try {
      await refreshMe();
      await apiFetch('/api/auth/audit-login', { method: 'POST' });
    } catch (err: any) {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      throw err;
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
