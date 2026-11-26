import crypto from 'crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { PDFDocument } from 'pdf-lib';
import { generateAndStoreFinalPdf } from './pdfFinalizer.ts';
import {
  createStatelessAuthClient,
  getServiceRoleKeyIssue,
  getSupabaseAdmin,
  getSupabaseConfig,
  isSupabaseConfigured,
} from './supabase.ts';

interface AuthenticatedRequest extends Request {
  authUser?: {
    id: string;
    email: string;
  };
  profile?: {
    id: string;
    full_name: string;
    employee_id: string | null;
    email: string;
    unit_id: string | null;
    department_id: string | null;
    job_title: string;
    role: 'super_admin' | 'admin' | 'user';
    is_active: boolean;
    must_change_password: boolean;
  };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // Hard ceiling 25MB; specific limit read from system_settings
  },
});

async function writeAuditLog(
  userId: string | null,
  activityName: string,
  documentId: string | null,
  details: Record<string, unknown>,
  req?: Request
) {
  try {
    const supabase = getSupabaseAdmin();
    const ip =
      (req?.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req?.socket?.remoteAddress ||
      null;
    await supabase.from('audit_logs').insert({
      user_id: userId,
      activity_name: activityName,
      document_id: documentId,
      details,
      ip_address: ip,
    });
  } catch (err) {
    console.error('Audit log insert failed:', err);
  }
}

function getInitialSuperAdminEmail(): string {
  const raw = (process.env.INITIAL_SUPERADMIN_EMAIL || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
    .toLowerCase();
  if (!raw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) || raw.startsWith('my_') || raw.includes('example.com')) {
    return '';
  }
  return raw;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!isSupabaseConfigured()) {
    return res.status(503).json({ error: 'Konfigurasi Supabase belum lengkap.' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Sesi tidak valid. Silakan login kembali.' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ error: 'Token autentikasi kosong.' });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return res.status(401).json({ error: 'Sesi telah berakhir atau tidak valid.' });
    }

    let { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userData.user.id)
      .single();

    if (profErr || !profile) {
      // Auto-provision first Super Admin profile if user was created directly in Supabase Auth Dashboard
      const { count: superCount } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'super_admin');

      const expectedEmail = getInitialSuperAdminEmail();
      const userEmail = (userData.user.email || '').trim().toLowerCase();

      if ((superCount || 0) === 0 && userEmail && (!expectedEmail || userEmail === expectedEmail)) {
        const fallbackName =
          String(userData.user.user_metadata?.full_name || '').trim() ||
          userEmail.split('@')[0] ||
          'Super Admin';

        const fallbackJob =
          String(userData.user.user_metadata?.job_title || '').trim() || 'Super Administrator';
        const rawEmployeeId = String(userData.user.user_metadata?.employee_id || '').trim();
        const fallbackEmployeeId = rawEmployeeId || null;

        const { data: createdProf, error: createProfErr } = await supabase
          .from('profiles')
          .upsert(
            {
              id: userData.user.id,
              email: userEmail,
              full_name: fallbackName,
              job_title: fallbackJob,
              employee_id: fallbackEmployeeId,
              role: 'super_admin',
              is_active: true,
              must_change_password: false,
            },
            { onConflict: 'id' }
          )
          .select('*')
          .single();

        if (!createProfErr && createdProf) {
          profile = createdProf;
          await writeAuditLog(createdProf.id, 'BOOTSTRAP_SUPERADMIN_ON_LOGIN', null, { email: userEmail }, req);
        } else {
          // Handle concurrent login request race condition by re-selecting once
          const { data: retryProf } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userData.user.id)
            .maybeSingle();
          if (retryProf) {
            profile = retryProf;
          } else if (createProfErr) {
            return res.status(500).json({
              error: `Gagal membuat profil Super Admin otomatis: ${createProfErr.message}`,
            });
          }
        }
      }
    }

    if (!profile) {
      return res.status(403).json({
        error: 'Profil pengguna belum terdaftar di sistem. Hubungi Admin atau periksa INITIAL_SUPERADMIN_EMAIL.',
      });
    }

    if (!profile.is_active) {
      return res.status(403).json({ error: 'Akun Anda telah dinonaktifkan oleh Admin.' });
    }

    // Check maintenance mode
    const { data: settings } = await supabase
      .from('system_settings')
      .select('maintenance_mode')
      .eq('id', 1)
      .maybeSingle();

    if (settings?.maintenance_mode && profile.role !== 'super_admin') {
      return res.status(503).json({
        error: 'Sistem sedang dalam pemeliharaan (Maintenance Mode). Hanya Super Admin yang dapat mengakses.',
        maintenance: true,
      });
    }

    req.authUser = {
      id: userData.user.id,
      email: userData.user.email || profile.email,
    };
    req.profile = profile;
    next();
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Gagal memverifikasi sesi.' });
  }
}

function requireRole(...allowedRoles: Array<'super_admin' | 'admin' | 'user'>) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.profile || !allowedRoles.includes(req.profile.role)) {
      return res.status(403).json({ error: 'Anda tidak memiliki hak akses untuk tindakan ini.' });
    }
    next();
  };
}

export function createApiApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  // Health & Bootstrap check
  app.get('/api/health', async (_req: Request, res: Response) => {
    if (!isSupabaseConfigured()) {
      return res.json({
        ok: true,
        supabaseConfigured: false,
        hasSuperAdmin: false,
        maintenanceMode: false,
        appName: 'LAZUARDI e-SIGN',
      });
    }

    const keyIssue = getServiceRoleKeyIssue();
    if (keyIssue) {
      return res.status(500).json({
        ok: false,
        supabaseConfigured: true,
        hasSuperAdmin: false,
        maintenanceMode: false,
        appName: 'LAZUARDI e-SIGN',
        error: keyIssue,
      });
    }

    try {
      const supabase = getSupabaseAdmin();
      const { count, error: countErr } = await supabase
        .from('profiles')
        .select('id', { count: 'exact' })
        .eq('role', 'super_admin')
        .limit(1);

      if (countErr) {
        const msg = countErr.message || 'permission denied for table profiles';
        const hint = msg.toLowerCase().includes('permission denied')
          ? ' Jalankan skrip GRANT pada file supabase/migrations/002_grant_permissions.sql di Supabase SQL Editor.'
          : '';
        return res.status(500).json({
          ok: false,
          supabaseConfigured: true,
          hasSuperAdmin: false,
          maintenanceMode: false,
          appName: 'LAZUARDI e-SIGN',
          error: `Database error (profiles): ${msg}.${hint}`,
        });
      }

      // If zero super_admins exist and INITIAL_SUPERADMIN_EMAIL already signed up via client fallback,
      // confirm its email so first-time Super Admin login works even when mailer_autoconfirm is disabled.
      const expectedEmail = getInitialSuperAdminEmail();
      if ((count || 0) === 0 && expectedEmail) {
        try {
          const { data: usersPage } = await supabase.auth.admin.listUsers({ page: 1, perPage: 100 });
          const targetAuth = usersPage?.users?.find(
            (u) => (u.email || '').trim().toLowerCase() === expectedEmail
          );
          if (targetAuth && !targetAuth.email_confirmed_at) {
            await supabase.auth.admin.updateUserById(targetAuth.id, { email_confirm: true });
          }
        } catch {
          // Ignore admin listUsers transient errors during health check
        }
      }

      const { data: settings, error: settingsErr } = await supabase
        .from('system_settings')
        .select('app_name, organization_name, maintenance_mode, max_file_size_mb, qr_enabled')
        .eq('id', 1)
        .maybeSingle();

      if (settingsErr) {
        return res.status(500).json({
          ok: false,
          supabaseConfigured: true,
          hasSuperAdmin: (count || 0) > 0,
          maintenanceMode: false,
          appName: 'LAZUARDI e-SIGN',
          error: `Database error (system_settings): ${settingsErr.message}`,
        });
      }

      const { url, anonKey } = getSupabaseConfig();
      return res.json({
        ok: true,
        supabaseConfigured: true,
        hasSuperAdmin: (count || 0) > 0,
        maintenanceMode: Boolean(settings?.maintenance_mode),
        appName: settings?.app_name || 'LAZUARDI e-SIGN',
        organizationName: settings?.organization_name || 'Sekolah & Yayasan Lazuardi',
        maxFileSizeMb: settings?.max_file_size_mb || 5,
        qrEnabled: settings?.qr_enabled !== false,
        initialSuperAdminEmailHint: Boolean(expectedEmail),
        initialSuperAdminEmailMasked: (count || 0) === 0 && expectedEmail ? maskEmail(expectedEmail) : null,
        publicSupabaseConfig: { url, anonKey },
      });
    } catch (err: any) {
      return res.status(500).json({
        ok: false,
        supabaseConfigured: true,
        error: err?.message || 'Database belum dimigrasi. Jalankan SQL migration terlebih dahulu.',
      });
    }
  });

  // First-run Super Admin bootstrap (only works when zero super_admin exist)
  app.post('/api/bootstrap-superadmin', async (req: Request, res: Response) => {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({ error: 'Konfigurasi Supabase belum tersedia.' });
    }

    const { email, password, full_name, job_title, employee_id } = req.body || {};
    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'Email, nama lengkap, dan password wajib diisi.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password minimal 8 karakter.' });
    }

    const expectedEmail = getInitialSuperAdminEmail();
    if (expectedEmail && String(email).trim().toLowerCase() !== expectedEmail) {
      return res.status(403).json({
        error: `Email harus sesuai dengan INITIAL_SUPERADMIN_EMAIL pada server (${maskEmail(expectedEmail)}).`,
      });
    }

    try {
      const supabase = getSupabaseAdmin();
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'super_admin');

      if ((count || 0) > 0) {
        return res.status(409).json({ error: 'Akun Super Admin sudah dibuat sebelumnya.' });
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      const { data: createdAuth, error: authErr } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password: String(password),
        email_confirm: true,
      });

      if (authErr || !createdAuth?.user) {
        const msg = authErr?.message || '';
        if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('registered')) {
          return res.status(409).json({
            error:
              'Email ini sudah terdaftar di Supabase Auth. Silakan pindah ke tab Login dan masuk menggunakan password Supabase Auth Anda.',
          });
        }
        return res.status(400).json({ error: msg || 'Gagal membuat akun auth Super Admin.' });
      }

      const { error: profErr } = await supabase.from('profiles').insert({
        id: createdAuth.user.id,
        email: normalizedEmail,
        full_name: String(full_name).trim(),
        job_title: String(job_title || 'Super Administrator').trim(),
        employee_id: employee_id ? String(employee_id).trim() : null,
        role: 'super_admin',
        is_active: true,
        must_change_password: false,
      });

      if (profErr) {
        await supabase.auth.admin.deleteUser(createdAuth.user.id);
        return res.status(400).json({ error: profErr.message });
      }

      await writeAuditLog(createdAuth.user.id, 'BOOTSTRAP_SUPERADMIN', null, { email: normalizedEmail }, req);
      return res.json({ ok: true, message: 'Super Admin pertama berhasil dibuat. Silakan login.' });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Gagal membuat Super Admin.' });
    }
  });

  // Confirm initial Super Admin email only when zero super_admin exist and password matches
  app.post('/api/auth/confirm-initial-superadmin', async (req: Request, res: Response) => {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({ error: 'Konfigurasi Supabase belum tersedia.' });
    }
    const { email, password } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !password) {
      return res.status(400).json({ error: 'Email dan password wajib diisi.' });
    }

    const expectedEmail = getInitialSuperAdminEmail();
    if (expectedEmail && normalizedEmail !== expectedEmail) {
      return res.status(403).json({
        error: `Email harus sesuai dengan INITIAL_SUPERADMIN_EMAIL pada server (${maskEmail(expectedEmail)}).`,
      });
    }

    try {
      const supabase = getSupabaseAdmin();
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'super_admin');
      if ((count || 0) > 0) {
        return res.status(409).json({ error: 'Super Admin sudah dikonfigurasi.' });
      }

      const { data: usersPage } = await supabase.auth.admin.listUsers({ page: 1, perPage: 100 });
      const targetAuth = usersPage?.users?.find(
        (u) => (u.email || '').trim().toLowerCase() === normalizedEmail
      );
      if (!targetAuth) {
        return res.status(404).json({ error: 'Akun belum terdaftar di Supabase Auth.' });
      }

      if (!targetAuth.email_confirmed_at) {
        await supabase.auth.admin.updateUserById(targetAuth.id, { email_confirm: true });
      }

      const stateless = createStatelessAuthClient();
      const { error: verifyErr } = await stateless.auth.signInWithPassword({
        email: normalizedEmail,
        password: String(password),
      });
      if (verifyErr) {
        return res.status(401).json({ error: 'Email atau password tidak valid.' });
      }

      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Gagal mengonfirmasi Super Admin awal.' });
    }
  });

  // Current user profile & settings
  app.get('/api/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const supabase = getSupabaseAdmin();
    const { data: profile } = await supabase
      .from('profiles')
      .select('*, unit:master_data!profiles_unit_id_fkey(id, name, code), department:master_data!profiles_department_id_fkey(id, name, code)')
      .eq('id', req.profile!.id)
      .single();

    const { data: settings } = await supabase.from('system_settings').select('*').eq('id', 1).maybeSingle();
    const { count: unreadNotifications } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.profile!.id)
      .eq('is_read', false);

    return res.json({
      profile: profile || req.profile,
      settings,
      unreadNotifications: unreadNotifications || 0,
    });
  });

  app.post('/api/auth/audit-login', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    await writeAuditLog(req.profile!.id, 'LOGIN', null, { email: req.profile!.email }, req);
    return res.json({ ok: true });
  });

  app.post('/api/auth/complete-password-change', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const supabase = getSupabaseAdmin();
    await supabase
      .from('profiles')
      .update({ must_change_password: false })
      .eq('id', req.profile!.id);
    await writeAuditLog(req.profile!.id, 'PASSWORD_CHANGED', null, {}, req);
    return res.json({ ok: true });
  });

  // ============================================================================
  // USER MANAGEMENT (Admin & Super Admin)
  // ============================================================================
  app.get('/api/admin/users', requireAuth, requireRole('super_admin', 'admin'), async (req: AuthenticatedRequest, res: Response) => {
    const supabase = getSupabaseAdmin();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const pageSize = Math.min(20, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10)));
    const search = String(req.query.search || '').trim();
    const roleFilter = String(req.query.role || '').trim();
    const statusFilter = String(req.query.status || '').trim();

    let query = supabase
      .from('profiles')
      .select(
        '*, unit:master_data!profiles_unit_id_fkey(id, name, code), department:master_data!profiles_department_id_fkey(id, name, code)',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false });

    if (search) {
      query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,employee_id.ilike.%${search}%`);
    }
    if (roleFilter) {
      query = query.eq('role', roleFilter);
    }
    if (statusFilter === 'active') {
      query = query.eq('is_active', true);
    } else if (statusFilter === 'inactive') {
      query = query.eq('is_active', false);
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, count, error } = await query.range(from, to);

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ data: data || [], total: count || 0, page, pageSize });
  });

  app.post('/api/admin/users', requireAuth, requireRole('super_admin', 'admin'), async (req: AuthenticatedRequest, res: Response) => {
    const { email, password, full_name, employee_id, unit_id, department_id, job_title, role } = req.body || {};
    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'Email, nama lengkap, dan password sementara wajib diisi.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password sementara minimal 8 karakter.' });
    }

    const requestedRole = role || 'user';
    if (!['super_admin', 'admin', 'user'].includes(requestedRole)) {
      return res.status(400).json({ error: 'Role tidak valid.' });
    }

    // Strict RBAC enforcement: Admin cannot create Super Admin or Admin
    if (req.profile!.role === 'admin' && requestedRole !== 'user') {
      return res.status(403).json({ error: 'Admin hanya dapat membuat akun pengguna biasa (User).' });
    }

    const supabase = getSupabaseAdmin();
    const normalizedEmail = String(email).trim().toLowerCase();

    const { data: createdAuth, error: authErr } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password: String(password),
      email_confirm: true,
    });

    if (authErr || !createdAuth?.user) {
      return res.status(400).json({ error: authErr?.message || 'Gagal membuat user pada Supabase Auth.' });
    }

    const { data: insertedProfile, error: profErr } = await supabase
      .from('profiles')
      .insert({
        id: createdAuth.user.id,
        email: normalizedEmail,
        full_name: String(full_name).trim(),
        employee_id: employee_id ? String(employee_id).trim() : null,
        unit_id: unit_id || null,
        department_id: department_id || null,
        job_title: String(job_title || '').trim(),
        role: requestedRole,
        is_active: true,
        must_change_password: true,
      })
      .select()
      .single();

    if (profErr) {
      await supabase.auth.admin.deleteUser(createdAuth.user.id);
      return res.status(400).json({ error: profErr.message });
    }

    await writeAuditLog(
      req.profile!.id,
      'USER_CREATED',
      null,
      { target_user_id: createdAuth.user.id, target_email: normalizedEmail, role: requestedRole },
      req
    );

    return res.status(201).json({ data: insertedProfile });
  });

  app.patch('/api/admin/users/:id', requireAuth, requireRole('super_admin', 'admin'), async (req: AuthenticatedRequest, res: Response) => {
    const targetId = req.params.id;
    const { full_name, employee_id, unit_id, department_id, job_title, role, is_active } = req.body || {};

    const supabase = getSupabaseAdmin();
    const { data: target, error: findErr } = await supabase.from('profiles').select('*').eq('id', targetId).single();
    if (findErr || !target) {
      return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    }

    // Admin cannot modify Super Admin or another Admin, nor elevate role
    if (req.profile!.role === 'admin') {
      if (target.role !== 'user') {
        return res.status(403).json({ error: 'Admin tidak dapat mengubah akun Admin atau Super Admin.' });
      }
      if (role && role !== 'user') {
        return res.status(403).json({ error: 'Admin tidak dapat meningkatkan hak akses pengguna.' });
      }
    }

    // Prevent self-deactivation or self-demotion for super_admin safety
    if (targetId === req.profile!.id && is_active === false) {
      return res.status(400).json({ error: 'Anda tidak dapat menonaktifkan akun Anda sendiri.' });
    }

    const updates: Record<string, unknown> = {};
    if (full_name !== undefined) updates.full_name = String(full_name).trim();
    if (employee_id !== undefined) updates.employee_id = employee_id ? String(employee_id).trim() : null;
    if (unit_id !== undefined) updates.unit_id = unit_id || null;
    if (department_id !== undefined) updates.department_id = department_id || null;
    if (job_title !== undefined) updates.job_title = String(job_title).trim();
    if (role !== undefined && req.profile!.role === 'super_admin') updates.role = role;
    if (is_active !== undefined) updates.is_active = Boolean(is_active);

    const { data: updated, error: updErr } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', targetId)
      .select()
      .single();

    if (updErr) return res.status(400).json({ error: updErr.message });

    if (role !== undefined && role !== target.role) {
      await writeAuditLog(
        req.profile!.id,
        'ROLE_CHANGED',
        null,
        { target_user_id: targetId, old_role: target.role, new_role: role },
        req
      );
    } else {
      await writeAuditLog(
        req.profile!.id,
        'USER_UPDATED',
        null,
        { target_user_id: targetId, is_active: updates.is_active },
        req
      );
    }

    return res.json({ data: updated });
  });

  app.post('/api/admin/users/:id/reset-password', requireAuth, requireRole('super_admin', 'admin'), async (req: AuthenticatedRequest, res: Response) => {
    const targetId = req.params.id;
    const { temporary_password } = req.body || {};
    if (!temporary_password || String(temporary_password).length < 8) {
      return res.status(400).json({ error: 'Password sementara baru minimal 8 karakter.' });
    }

    const supabase = getSupabaseAdmin();
    const { data: target } = await supabase.from('profiles').select('*').eq('id', targetId).single();
    if (!target) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });

    if (req.profile!.role === 'admin' && target.role !== 'user') {
      return res.status(403).json({ error: 'Admin hanya dapat mereset password pengguna biasa.' });
    }

    const { error: resetErr } = await supabase.auth.admin.updateUserById(targetId, {
      password: String(temporary_password),
    });

    if (resetErr) return res.status(400).json({ error: resetErr.message });

    await supabase.from('profiles').update({ must_change_password: true }).eq('id', targetId);
    await writeAuditLog(req.profile!.id, 'ADMIN_PASSWORD_RESET', null, { target_user_id: targetId }, req);

    return res.json({ ok: true, message: 'Password sementara berhasil direset.' });
  });

  // ============================================================================
  // SYSTEM SETTINGS (Super Admin)
  // ============================================================================
  app.patch('/api/admin/settings', requireAuth, requireRole('super_admin'), async (req: AuthenticatedRequest, res: Response) => {
    const supabase = getSupabaseAdmin();
    const allowed = [
      'app_name',
      'organization_name',
      'logo_url',
      'max_file_size_mb',
      'document_number_format',
      'signature_display_mode',
      'qr_enabled',
      'qr_allow_doc_number_public',
      'timezone',
      'retention_years',
      'maintenance_mode',
    ];
    const updates: Record<string, unknown> = { updated_by: req.profile!.id };
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    const { data, error } = await supabase.from('system_settings').update(updates).eq('id', 1).select().single();
    if (error) return res.status(400).json({ error: error.message });

    await writeAuditLog(req.profile!.id, 'SETTINGS_UPDATED', null, { fields: Object.keys(updates) }, req);
    return res.json({ data });
  });

  // ============================================================================
  // AUDIT TRAIL & REPORTS (Admin & Super Admin)
  // ============================================================================
  app.get('/api/admin/audit-logs', requireAuth, requireRole('super_admin', 'admin'), async (req: AuthenticatedRequest, res: Response) => {
    const supabase = getSupabaseAdmin();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const pageSize = Math.min(20, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10)));
    const activity = String(req.query.activity || '').trim();
    const search = String(req.query.search || '').trim();

    let query = supabase
      .from('audit_logs')
      .select('*, user:profiles(full_name, email), document:documents(document_number, title)', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (activity) query = query.eq('activity_name', activity);
    if (search) query = query.ilike('activity_name', `%${search}%`);

    const from = (page - 1) * pageSize;
    const { data, count, error } = await query.range(from, from + pageSize - 1);
    if (error) return res.status(400).json({ error: error.message });

    return res.json({ data: data || [], total: count || 0, page, pageSize });
  });

  app.get('/api/admin/reports', requireAuth, requireRole('super_admin', 'admin'), async (req: AuthenticatedRequest, res: Response) => {
    const supabase = getSupabaseAdmin();
    const year = parseInt(String(req.query.year || new Date().getFullYear()), 10);

    const { data: docs, error } = await supabase
      .from('documents')
      .select(
        'id, document_number, title, status, priority, created_at, submitted_at, completed_at, due_date, unit:master_data!documents_unit_id_fkey(name), department:master_data!documents_department_id_fkey(name), document_type:master_data!documents_document_type_id_fkey(name)'
      )
      .gte('created_at', `${year}-01-01T00:00:00Z`)
      .lte('created_at', `${year}-12-31T23:59:59Z`)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });

    const rows = docs || [];
    const monthly = Array.from({ length: 12 }, (_, idx) => ({ month: idx + 1, count: 0 }));
    const byUnit: Record<string, number> = {};
    const byDepartment: Record<string, number> = {};
    let inProgress = 0;
    let completed = 0;
    let rejected = 0;
    let overdue = 0;
    let totalDurationMs = 0;
    let durationCount = 0;
    const now = Date.now();

    for (const d of rows as any[]) {
      const m = new Date(d.created_at).getMonth();
      monthly[m].count += 1;

      const uName = d.unit?.name || 'Lainnya';
      byUnit[uName] = (byUnit[uName] || 0) + 1;

      const depName = d.department?.name || 'Lainnya';
      byDepartment[depName] = (byDepartment[depName] || 0) + 1;

      if (['in_progress', 'waiting_review', 'waiting_approval', 'waiting_signature', 'finalizing'].includes(d.status)) {
        inProgress += 1;
        if (d.due_date && new Date(d.due_date).getTime() < now) {
          overdue += 1;
        }
      } else if (d.status === 'completed' || d.status === 'archived') {
        completed += 1;
        if (d.submitted_at && d.completed_at) {
          totalDurationMs += Math.max(0, new Date(d.completed_at).getTime() - new Date(d.submitted_at).getTime());
          durationCount += 1;
        }
      } else if (d.status === 'rejected') {
        rejected += 1;
      }
    }

    const avgCompletionHours = durationCount > 0 ? Math.round((totalDurationMs / durationCount / 3600000) * 10) / 10 : 0;

    return res.json({
      year,
      summary: {
        total: rows.length,
        inProgress,
        completed,
        rejected,
        overdue,
        avgCompletionHours,
      },
      monthly,
      byUnit: Object.entries(byUnit).map(([name, count]) => ({ name, count })),
      byDepartment: Object.entries(byDepartment).map(([name, count]) => ({ name, count })),
      documents: rows,
    });
  });

  // ============================================================================
  // PRIVATE SIGNATURE PROFILE MANAGEMENT (Owner Only)
  // ============================================================================
  app.get('/api/signature-profile/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const supabase = getSupabaseAdmin();
    const { data: sigProfile } = await supabase
      .from('signature_profiles')
      .select('*')
      .eq('user_id', req.profile!.id)
      .maybeSingle();

    let signedImageUrl: string | null = null;
    if (sigProfile?.image_path) {
      const { data: urlData } = await supabase.storage
        .from('signatures')
        .createSignedUrl(sigProfile.image_path, 300);
      signedImageUrl = urlData?.signedUrl || null;
    }

    return res.json({ data: sigProfile ? { ...sigProfile, signed_image_url: signedImageUrl } : null });
  });

  app.post(
    '/api/signature-profile/save',
    requireAuth,
    upload.single('image'),
    async (req: AuthenticatedRequest, res: Response) => {
      const supabase = getSupabaseAdmin();
      const signatureType = String(req.body.signature_type || 'typed');
      if (!['draw', 'upload', 'typed'].includes(signatureType)) {
        return res.status(400).json({ error: 'Jenis tanda tangan tidak valid.' });
      }

      let imagePath: string | null = null;
      if (signatureType === 'draw' || signatureType === 'upload') {
        if (!req.file) {
          return res.status(400).json({ error: 'File gambar tanda tangan PNG wajib disediakan.' });
        }
        if (req.file.mimetype !== 'image/png') {
          return res.status(400).json({ error: 'Gambar tanda tangan harus berformat PNG.' });
        }
        // Validate PNG signature header
        const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        if (req.file.buffer.length < 8 || !req.file.buffer.subarray(0, 4).equals(pngHeader)) {
          return res.status(400).json({ error: 'File gambar bukan PNG yang valid.' });
        }
        if (req.file.size > 2 * 1024 * 1024) {
          return res.status(400).json({ error: 'Ukuran gambar tanda tangan maksimal 2 MB.' });
        }

        imagePath = `${req.profile!.id}/signature-${Date.now()}.png`;
        const { error: upErr } = await supabase.storage
          .from('signatures')
          .upload(imagePath, req.file.buffer, {
            contentType: 'image/png',
            upsert: true,
          });
        if (upErr) return res.status(400).json({ error: upErr.message });
      }

      const payload = {
        user_id: req.profile!.id,
        signature_type: signatureType,
        image_path: imagePath,
        typed_text: req.body.typed_text ? String(req.body.typed_text).trim() : req.profile!.full_name,
        typed_font: req.body.typed_font ? String(req.body.typed_font) : 'cursive',
      };

      const { data: saved, error: saveErr } = await supabase
        .from('signature_profiles')
        .upsert(payload, { onConflict: 'user_id' })
        .select()
        .single();

      if (saveErr) return res.status(400).json({ error: saveErr.message });

      let signedImageUrl: string | null = null;
      if (saved.image_path) {
        const { data: urlData } = await supabase.storage.from('signatures').createSignedUrl(saved.image_path, 300);
        signedImageUrl = urlData?.signedUrl || null;
      }

      return res.json({ data: { ...saved, signed_image_url: signedImageUrl } });
    }
  );

  // ============================================================================
  // DOCUMENTS: PDF UPLOAD, SUBMIT, SEQUENTIAL ACTION, REVISION, DOWNLOAD
  // ============================================================================
  app.post(
    '/api/documents/upload-pdf',
    requireAuth,
    upload.single('file'),
    async (req: AuthenticatedRequest, res: Response) => {
      const { document_id, version_number, notes } = req.body || {};
      if (!document_id || !req.file) {
        return res.status(400).json({ error: 'Document ID dan file PDF wajib disediakan.' });
      }

      const supabase = getSupabaseAdmin();
      const { data: doc, error: docErr } = await supabase
        .from('documents')
        .select('*')
        .eq('id', document_id)
        .single();

      if (docErr || !doc) return res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
      if (doc.created_by !== req.profile!.id) {
        return res.status(403).json({ error: 'Anda tidak berwenang mengunggah PDF untuk dokumen ini.' });
      }
      if (doc.is_locked && doc.status !== 'needs_revision') {
        return res.status(400).json({ error: 'Dokumen sudah terkunci dan tidak dapat diubah.' });
      }

      // Enforce system max file size
      const { data: settings } = await supabase.from('system_settings').select('max_file_size_mb').eq('id', 1).single();
      const maxMb = settings?.max_file_size_mb || 5;
      if (req.file.size > maxMb * 1024 * 1024) {
        return res.status(400).json({ error: `Ukuran file melebihi batas maksimal (${maxMb} MB).` });
      }

      // Validate PDF MIME & magic header
      if (req.file.mimetype !== 'application/pdf' || req.file.buffer.subarray(0, 5).toString('utf8') !== '%PDF-') {
        return res.status(400).json({ error: 'File harus berupa dokumen PDF yang valid.' });
      }

      let pageCount = 1;
      try {
        const parsedPdf = await PDFDocument.load(req.file.buffer);
        pageCount = parsedPdf.getPageCount();
      } catch {
        return res.status(400).json({ error: 'File PDF tidak dapat dibaca atau rusak.' });
      }

      const sha256Hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
      const vNum = parseInt(String(version_number || doc.current_version || 1), 10);
      const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `${doc.id}/v${vNum}-${Date.now()}-${safeName}`;

      const { error: upErr } = await supabase.storage
        .from('documents-original')
        .upload(filePath, req.file.buffer, {
          contentType: 'application/pdf',
          upsert: false,
        });

      if (upErr) return res.status(400).json({ error: upErr.message });

      // Remove prior unsubmitted draft version if re-uploading same draft version number
      if (doc.status === 'draft') {
        await supabase
          .from('document_versions')
          .delete()
          .eq('document_id', doc.id)
          .eq('version_number', vNum);
      }

      const { data: versionRow, error: verErr } = await supabase
        .from('document_versions')
        .insert({
          document_id: doc.id,
          version_number: vNum,
          file_path: filePath,
          file_name: req.file.originalname,
          file_size_bytes: req.file.size,
          page_count: pageCount,
          sha256_hash: sha256Hash,
          uploaded_by: req.profile!.id,
          notes: notes ? String(notes) : null,
        })
        .select()
        .single();

      if (verErr) return res.status(400).json({ error: verErr.message });

      await writeAuditLog(
        req.profile!.id,
        'PDF_UPLOADED',
        doc.id,
        { version: vNum, file_name: req.file.originalname, sha256_hash: sha256Hash },
        req
      );

      return res.json({ data: versionRow });
    }
  );

  // Submit draft document
  app.post('/api/documents/:id/submit', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const docId = req.params.id;
    const supabase = getSupabaseAdmin();

    const { data: doc } = await supabase
      .from('documents')
      .select('*, document_type:master_data!documents_document_type_id_fkey(*)')
      .eq('id', docId)
      .single();

    if (!doc) return res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
    if (doc.created_by !== req.profile!.id) {
      return res.status(403).json({ error: 'Hanya pembuat dokumen yang dapat mengajukan dokumen.' });
    }

    // Validate mandatory template workflow if required by document type
    if (doc.document_type?.require_workflow_template && doc.document_type?.default_template_id) {
      const { data: tpl } = await supabase
        .from('workflow_templates')
        .select('*')
        .eq('id', doc.document_type.default_template_id)
        .single();

      if (tpl && Array.isArray(tpl.steps)) {
        const { data: signers } = await supabase
          .from('document_signers')
          .select('*')
          .eq('document_id', docId)
          .order('step_order', { ascending: true });

        const signerUserIds = new Set((signers || []).map((s: any) => s.user_id));
        for (const requiredStep of tpl.steps as any[]) {
          if (!signerUserIds.has(requiredStep.user_id)) {
            return res.status(400).json({
              error: `Jenis dokumen "${doc.document_type.name}" mewajibkan template workflow "${tpl.name}". Pejabat wajib tidak boleh dihapus.`,
            });
          }
        }
      }
    }

    const { data: result, error: rpcErr } = await supabase.rpc('fn_submit_document', {
      p_document_id: docId,
      p_user_id: req.profile!.id,
    });

    if (rpcErr) return res.status(400).json({ error: rpcErr.message });

    await writeAuditLog(req.profile!.id, 'DOCUMENT_SUBMITTED', docId, { document_number: doc.document_number }, req);
    return res.json({ data: result });
  });

  // Process sequential signer action (Review / Approve / Sign / Request Revision / Reject)
  app.post('/api/documents/:id/action', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const docId = req.params.id;
    const { action, comment, password, consent_accepted, expected_hash } = req.body || {};

    const validActions = ['reviewed', 'approved', 'signed', 'revision_requested', 'rejected'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: 'Jenis tindakan tidak valid.' });
    }

    const supabase = getSupabaseAdmin();

    // Load document & active version
    const { data: doc, error: docErr } = await supabase.from('documents').select('*').eq('id', docId).single();
    if (docErr || !doc) return res.status(404).json({ error: 'Dokumen tidak ditemukan.' });

    const { data: version } = await supabase
      .from('document_versions')
      .select('*')
      .eq('document_id', docId)
      .eq('version_number', doc.current_version)
      .single();

    if (!version) return res.status(400).json({ error: 'Versi dokumen aktif tidak ditemukan.' });

    if (expected_hash && expected_hash !== version.sha256_hash) {
      return res.status(409).json({ error: 'Hash dokumen berubah. Muat ulang halaman sebelum melanjutkan.' });
    }

    let signatureRefId: string | null = null;
    let consentStatement: string | null = null;
    let signatureSnapshotPath: string | null = null;

    // For Electronic Signature ('signed'), require explicit consent + password re-verification
    if (action === 'signed') {
      if (!consent_accepted) {
        return res.status(400).json({ error: 'Anda wajib menyetujui pernyataan persetujuan tanda tangan elektronik.' });
      }
      if (!password) {
        return res.status(400).json({ error: 'Password wajib dimasukkan kembali untuk verifikasi identitas penandatangan.' });
      }

      // Stateless re-verification with Supabase Auth (password is NEVER stored or logged)
      const statelessClient = createStatelessAuthClient();
      const { error: verifyErr } = await statelessClient.auth.signInWithPassword({
        email: req.profile!.email,
        password: String(password),
      });

      if (verifyErr) {
        await writeAuditLog(
          req.profile!.id,
          'SIGNATURE_REAUTH_FAILED',
          docId,
          { reason: 'Password verifikasi tidak sesuai' },
          req
        );
        return res.status(401).json({ error: 'Password verifikasi tidak sesuai. Tanda tangan dibatalkan.' });
      }

      // Verify owner's signature profile exists
      const { data: sigProfile } = await supabase
        .from('signature_profiles')
        .select('*')
        .eq('user_id', req.profile!.id)
        .maybeSingle();

      if (!sigProfile) {
        return res.status(400).json({
          error: 'Anda belum mengatur representasi tanda tangan pribadi. Silakan atur di menu Profil Saya terlebih dahulu.',
        });
      }

      signatureRefId = `SIG-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      consentStatement =
        'Saya menyatakan telah membaca isi dokumen ini dan menyetujui pembubuhan tanda tangan elektronik internal (Electronic Signature — Internal) secara sadar dan sah sesuai kewenangan saya.';
      signatureSnapshotPath = sigProfile.image_path || null;
    }

    const { data: rpcResult, error: rpcErr } = await supabase.rpc('fn_process_signer_action', {
      p_document_id: docId,
      p_user_id: req.profile!.id,
      p_action: action,
      p_comment: comment ? String(comment).trim() : null,
      p_document_hash: version.sha256_hash,
      p_signature_ref_id: signatureRefId,
      p_consent_statement: consentStatement,
      p_signature_snapshot_path: signatureSnapshotPath,
    });

    if (rpcErr) {
      return res.status(400).json({ error: rpcErr.message });
    }

    await writeAuditLog(
      req.profile!.id,
      `DOCUMENT_${action.toUpperCase()}`,
      docId,
      {
        version: doc.current_version,
        signature_reference_id: signatureRefId,
      },
      req
    );

    // If all signers finished, generate Final PDF synchronously so completion is atomic
    let finalMeta: any = null;
    if (rpcResult?.all_completed) {
      try {
        finalMeta = await generateAndStoreFinalPdf(docId);
        await writeAuditLog(
          req.profile!.id,
          'DOCUMENT_FINALIZED',
          docId,
          { verification_id: finalMeta.verificationId, final_hash: finalMeta.finalHash },
          req
        );
      } catch (finErr: any) {
        return res.status(500).json({
          error: `Persetujuan dicatat, namun gagal menghasilkan Final PDF: ${finErr?.message}`,
        });
      }
    }

    return res.json({ data: { ...rpcResult, finalMeta } });
  });

  // Resubmit revised document
  app.post('/api/documents/:id/resubmit', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const docId = req.params.id;
    const { new_version } = req.body || {};
    const supabase = getSupabaseAdmin();

    const { data: doc } = await supabase.from('documents').select('*').eq('id', docId).single();
    if (!doc) return res.status(404).json({ error: 'Dokumen tidak ditemukan.' });

    const { data: result, error: rpcErr } = await supabase.rpc('fn_resubmit_revised_document', {
      p_document_id: docId,
      p_user_id: req.profile!.id,
      p_new_version: parseInt(String(new_version || doc.current_version + 1), 10),
    });

    if (rpcErr) return res.status(400).json({ error: rpcErr.message });

    await writeAuditLog(req.profile!.id, 'DOCUMENT_RESUBMITTED', docId, { new_version }, req);
    return res.json({ data: result });
  });

  // Cancel or Archive document
  app.post('/api/documents/:id/cancel', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const docId = req.params.id;
    const supabase = getSupabaseAdmin();
    const { data: doc } = await supabase.from('documents').select('*').eq('id', docId).single();
    if (!doc) return res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
    if (doc.created_by !== req.profile!.id && req.profile!.role !== 'super_admin') {
      return res.status(403).json({ error: 'Anda tidak berwenang membatalkan dokumen ini.' });
    }
    if (doc.status === 'completed' || doc.status === 'archived') {
      return res.status(400).json({ error: 'Dokumen yang telah selesai tidak dapat dibatalkan.' });
    }

    const { error } = await supabase
      .from('documents')
      .update({ status: 'cancelled', is_locked: true })
      .eq('id', docId);
    if (error) return res.status(400).json({ error: error.message });

    await supabase.from('approval_logs').insert({
      document_id: docId,
      version_number: doc.current_version,
      user_id: req.profile!.id,
      user_name: req.profile!.full_name,
      user_job_title: req.profile!.job_title,
      action: 'cancelled',
      comment: req.body?.reason ? String(req.body.reason) : 'Dokumen dibatalkan.',
    });

    await writeAuditLog(req.profile!.id, 'DOCUMENT_CANCELLED', docId, {}, req);
    return res.json({ ok: true });
  });

  app.post('/api/documents/:id/archive', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const docId = req.params.id;
    const supabase = getSupabaseAdmin();
    const { data: doc } = await supabase.from('documents').select('*').eq('id', docId).single();
    if (!doc) return res.status(404).json({ error: 'Dokumen tidak ditemukan.' });

    const isOwner = doc.created_by === req.profile!.id;
    const isAdmin = ['super_admin', 'admin'].includes(req.profile!.role);
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Anda tidak berwenang mengarsipkan dokumen ini.' });
    }
    if (!['completed', 'rejected', 'cancelled'].includes(doc.status)) {
      return res.status(400).json({ error: 'Hanya dokumen Selesai, Ditolak, atau Dibatalkan yang dapat diarsipkan.' });
    }

    const { error } = await supabase
      .from('documents')
      .update({ status: 'archived', archived_at: new Date().toISOString() })
      .eq('id', docId);
    if (error) return res.status(400).json({ error: error.message });

    await supabase.from('approval_logs').insert({
      document_id: docId,
      version_number: doc.current_version,
      user_id: req.profile!.id,
      user_name: req.profile!.full_name,
      user_job_title: req.profile!.job_title,
      action: 'archived',
      comment: 'Dokumen dipindahkan ke arsip digital.',
    });

    await writeAuditLog(req.profile!.id, 'DOCUMENT_ARCHIVED', docId, {}, req);
    return res.json({ ok: true });
  });

  // Short-lived Signed URL for authorized PDF preview / download
  app.get('/api/documents/:id/pdf-url', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const docId = req.params.id;
    const kind = String(req.query.kind || 'auto'); // 'auto' | 'original' | 'final'
    const versionParam = req.query.version ? parseInt(String(req.query.version), 10) : null;
    const isDownload = req.query.download === '1';

    const supabase = getSupabaseAdmin();
    const { data: doc } = await supabase.from('documents').select('*').eq('id', docId).single();
    if (!doc) return res.status(404).json({ error: 'Dokumen tidak ditemukan.' });

    // Authorization check
    const isAdmin = ['super_admin', 'admin'].includes(req.profile!.role);
    const isCreator = doc.created_by === req.profile!.id;
    let isSigner = false;
    if (!isAdmin && !isCreator) {
      const { data: signerRow } = await supabase
        .from('document_signers')
        .select('id')
        .eq('document_id', docId)
        .eq('user_id', req.profile!.id)
        .maybeSingle();
      isSigner = Boolean(signerRow);
    }

    if (!isAdmin && !isCreator && !isSigner) {
      return res.status(403).json({ error: 'Anda tidak memiliki hak akses ke dokumen ini.' });
    }

    let bucket = 'documents-original';
    let path = '';
    if ((kind === 'final' || (kind === 'auto' && doc.final_pdf_path)) && doc.final_pdf_path) {
      bucket = 'documents-final';
      path = doc.final_pdf_path;
    } else {
      const targetVer = versionParam || doc.current_version;
      const { data: ver } = await supabase
        .from('document_versions')
        .select('file_path')
        .eq('document_id', docId)
        .eq('version_number', targetVer)
        .single();
      if (!ver) return res.status(404).json({ error: 'File PDF versi tersebut tidak ditemukan.' });
      path = ver.file_path;
    }

    const { data: signed, error: signErr } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 120, isDownload ? { download: `${doc.document_number}.pdf` } : undefined);

    if (signErr || !signed?.signedUrl) {
      return res.status(500).json({ error: 'Gagal membuat tautan akses PDF sementara.' });
    }

    if (isDownload) {
      await writeAuditLog(req.profile!.id, 'DOCUMENT_DOWNLOADED', docId, { bucket, path }, req);
    }

    return res.json({ url: signed.signedUrl, bucket });
  });

  // ============================================================================
  // PUBLIC QR CODE & HASH VERIFICATION (Limited Non-Confidential Info Only)
  // ============================================================================
  app.get('/api/verify/:token', async (req: Request, res: Response) => {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({ error: 'Sistem belum terhubung ke database.' });
    }
    const token = String(req.params.token || '').trim();
    const supabase = getSupabaseAdmin();

    const { data: settings } = await supabase
      .from('system_settings')
      .select('qr_allow_doc_number_public, organization_name')
      .eq('id', 1)
      .maybeSingle();

    const { data: doc } = await supabase
      .from('documents')
      .select('status, document_number, completed_at, verification_id')
      .eq('verification_token', token)
      .maybeSingle();

    if (!doc) {
      return res.json({
        result: 'not_found',
        label: 'Dokumen Tidak Ditemukan',
        signature_type: 'Electronic Signature — Internal',
      });
    }

    if (doc.status === 'cancelled') {
      return res.json({
        result: 'cancelled',
        label: 'Dokumen Dibatalkan',
        verification_id: doc.verification_id,
        document_number: settings?.qr_allow_doc_number_public ? doc.document_number : null,
        completed_at: doc.completed_at,
        signature_type: 'Electronic Signature — Internal',
      });
    }

    return res.json({
      result: 'registered',
      label: 'Dokumen Terdaftar',
      verification_id: doc.verification_id,
      document_number: settings?.qr_allow_doc_number_public ? doc.document_number : null,
      completed_at: doc.completed_at,
      status: doc.status,
      signature_type: 'Electronic Signature — Internal',
      organization_name: settings?.organization_name || 'Sekolah & Yayasan Lazuardi',
    });
  });

  app.post('/api/verify/:token/check-hash', upload.single('file'), async (req: Request, res: Response) => {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({ error: 'Sistem belum terhubung ke database.' });
    }
    const token = String(req.params.token || '').trim();
    const supabase = getSupabaseAdmin();

    let uploadedHash = String(req.body?.sha256_hash || '').trim().toLowerCase();
    if (req.file) {
      uploadedHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    }

    if (!uploadedHash || !/^[a-f0-9]{64}$/.test(uploadedHash)) {
      return res.status(400).json({ error: 'File PDF atau SHA-256 hash tidak valid.' });
    }

    const { data: doc } = await supabase
      .from('documents')
      .select('status, final_hash, verification_id')
      .eq('verification_token', token)
      .maybeSingle();

    if (!doc) {
      return res.json({
        match: false,
        result: 'not_found',
        label: 'Dokumen Tidak Ditemukan',
        uploaded_hash: uploadedHash,
      });
    }

    if (doc.status === 'cancelled') {
      return res.json({
        match: false,
        result: 'cancelled',
        label: 'Dokumen Dibatalkan',
        uploaded_hash: uploadedHash,
      });
    }

    if (doc.final_hash && doc.final_hash.toLowerCase() === uploadedHash) {
      return res.json({
        match: true,
        result: 'matched',
        label: 'Dokumen Sesuai dengan File Final',
        uploaded_hash: uploadedHash,
        verification_id: doc.verification_id,
      });
    }

    return res.json({
      match: false,
      result: 'tampered',
      label: 'Dokumen Telah Berubah',
      uploaded_hash: uploadedHash,
      verification_id: doc.verification_id,
    });
  });

  // Guarantee JSON responses for any unmatched /api/* route or Express/Multer error
  app.use('/api', (_req: Request, res: Response) => {
    return res.status(404).json({ error: 'Endpoint API tidak ditemukan.' });
  });

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    if (req.path.startsWith('/api')) {
      if (err?.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Format payload JSON tidak valid.' });
      }
      if (err?.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Ukuran file melebihi batas maksimal server.' });
      }
      return res.status(err?.status || 500).json({
        error: err?.message || 'Terjadi kesalahan internal pada server.',
      });
    }
    return next(err);
  });

  return app;
}
