-- ============================================================================
-- LAZUARDI e-SIGN — Complete Supabase PostgreSQL Migration
-- Simple, Secure & Sequential Electronic Signature
-- Timezone: Asia/Jakarta
-- ============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 2. TABLES (12 Core Tables)
-- ============================================================================

-- 2.1 Master Data (Units, Departments, Document Types)
CREATE TABLE IF NOT EXISTS public.master_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('unit', 'department', 'document_type')),
  code text,
  name text NOT NULL,
  description text,
  require_workflow_template boolean NOT NULL DEFAULT false,
  default_template_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, name)
);

CREATE INDEX IF NOT EXISTS idx_master_data_category_active ON public.master_data (category, is_active, sort_order);

-- 2.2 Profiles (Linked to Supabase Auth; NEVER stores passwords)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  employee_id text UNIQUE,
  email text NOT NULL UNIQUE,
  unit_id uuid REFERENCES public.master_data(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.master_data(id) ON DELETE SET NULL,
  job_title text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('super_admin', 'admin', 'user')),
  is_active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_role_active ON public.profiles (role, is_active);
CREATE INDEX IF NOT EXISTS idx_profiles_unit_dept ON public.profiles (unit_id, department_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles (email);

-- 2.3 Workflow Templates
CREATE TABLE IF NOT EXISTS public.workflow_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  document_type_id uuid REFERENCES public.master_data(id) ON DELETE SET NULL,
  description text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_templates_active ON public.workflow_templates (is_active, document_type_id);

-- Add FK from master_data.default_template_id -> workflow_templates.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_master_data_default_template'
  ) THEN
    ALTER TABLE public.master_data
      ADD CONSTRAINT fk_master_data_default_template
      FOREIGN KEY (default_template_id) REFERENCES public.workflow_templates(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2.4 Documents
CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_number text NOT NULL UNIQUE,
  title text NOT NULL,
  document_type_id uuid REFERENCES public.master_data(id) ON DELETE RESTRICT,
  unit_id uuid REFERENCES public.master_data(id) ON DELETE RESTRICT,
  department_id uuid REFERENCES public.master_data(id) ON DELETE RESTRICT,
  description text,
  document_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')::date,
  due_date date,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN (
      'draft',
      'in_progress',
      'waiting_review',
      'waiting_approval',
      'waiting_signature',
      'needs_revision',
      'rejected',
      'finalizing',
      'completed',
      'cancelled',
      'archived'
    )
  ),
  current_version integer NOT NULL DEFAULT 1,
  current_step_order integer,
  workflow_template_id uuid REFERENCES public.workflow_templates(id) ON DELETE SET NULL,
  is_locked boolean NOT NULL DEFAULT false,
  verification_token text UNIQUE,
  verification_id text UNIQUE,
  final_pdf_path text,
  final_hash text,
  include_history_page boolean NOT NULL DEFAULT true,
  revision_reason text,
  rejection_reason text,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_created_by_status ON public.documents (created_by, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_status_created_at ON public.documents (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_unit_dept_type ON public.documents (unit_id, department_id, document_type_id);
CREATE INDEX IF NOT EXISTS idx_documents_verification_token ON public.documents (verification_token) WHERE verification_token IS NOT NULL;

-- 2.5 Document Versions
CREATE TABLE IF NOT EXISTS public.document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number >= 1),
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  page_count integer NOT NULL DEFAULT 1 CHECK (page_count >= 1),
  sha256_hash text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_document_versions_doc ON public.document_versions (document_id, version_number DESC);

-- 2.6 Document Signers (Sequential Order)
CREATE TABLE IF NOT EXISTS public.document_signers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  step_order integer NOT NULL CHECK (step_order >= 1),
  action_type text NOT NULL CHECK (action_type IN ('review', 'approve', 'sign')),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'active', 'completed', 'revision_requested', 'rejected', 'skipped')
  ),
  is_mandatory boolean NOT NULL DEFAULT false,
  activated_at timestamptz,
  acted_at timestamptz,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_document_signers_user_status ON public.document_signers (user_id, status);
CREATE INDEX IF NOT EXISTS idx_document_signers_doc_order ON public.document_signers (document_id, step_order);

-- 2.7 Signature Profiles (Private Personal Signature Representation)
CREATE TABLE IF NOT EXISTS public.signature_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  signature_type text NOT NULL DEFAULT 'typed' CHECK (signature_type IN ('draw', 'upload', 'typed')),
  image_path text,
  typed_text text,
  typed_font text DEFAULT 'cursive',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2.8 Signature Fields (PDF Coordinate Placement in Percentages)
CREATE TABLE IF NOT EXISTS public.signature_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  version_number integer NOT NULL DEFAULT 1,
  signer_id uuid NOT NULL REFERENCES public.document_signers(id) ON DELETE CASCADE,
  page_number integer NOT NULL CHECK (page_number >= 1),
  x_percent double precision NOT NULL CHECK (x_percent >= 0 AND x_percent <= 100),
  y_percent double precision NOT NULL CHECK (y_percent >= 0 AND y_percent <= 100),
  width_percent double precision NOT NULL CHECK (width_percent > 0 AND width_percent <= 100),
  height_percent double precision NOT NULL CHECK (height_percent > 0 AND height_percent <= 100),
  field_type text NOT NULL DEFAULT 'signature' CHECK (field_type IN ('signature', 'initial', 'stamp')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signature_fields_doc_ver ON public.signature_fields (document_id, version_number);

-- 2.9 Approval Logs (Immutable Sequential Audit Evidence)
CREATE TABLE IF NOT EXISTS public.approval_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  signer_id uuid REFERENCES public.document_signers(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  user_name text NOT NULL,
  user_job_title text NOT NULL,
  action text NOT NULL CHECK (
    action IN (
      'submitted',
      'reviewed',
      'approved',
      'signed',
      'revision_requested',
      'rejected',
      'resubmitted',
      'finalized',
      'cancelled',
      'archived'
    )
  ),
  comment text,
  document_hash text,
  signature_reference_id text UNIQUE,
  consent_statement text,
  signature_snapshot_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_logs_doc ON public.approval_logs (document_id, created_at ASC);

-- 2.10 Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'action_required', 'success', 'warning', 'error')),
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications (user_id, is_read, created_at DESC);

-- 2.11 Audit Logs (Append-Only System Activity Trail)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  activity_name text NOT NULL,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_doc ON public.audit_logs (user_id, document_id);

-- 2.12 System Settings (Singleton Row id = 1)
CREATE TABLE IF NOT EXISTS public.system_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  app_name text NOT NULL DEFAULT 'LAZUARDI e-SIGN',
  organization_name text NOT NULL DEFAULT 'Sekolah & Yayasan Lazuardi',
  logo_url text,
  max_file_size_mb integer NOT NULL DEFAULT 5 CHECK (max_file_size_mb BETWEEN 1 AND 25),
  document_number_format text NOT NULL DEFAULT 'LZD/{UNIT}/{YYYY}/{MM}/{SEQ}',
  signature_display_mode text NOT NULL DEFAULT 'image_name_title_date',
  qr_enabled boolean NOT NULL DEFAULT true,
  qr_allow_doc_number_public boolean NOT NULL DEFAULT true,
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  retention_years integer NOT NULL DEFAULT 10 CHECK (retention_years >= 1),
  maintenance_mode boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 3. IMMUTABILITY & UPDATED_AT TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_master_data_updated_at ON public.master_data;
CREATE TRIGGER trg_master_data_updated_at BEFORE UPDATE ON public.master_data FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_workflow_templates_updated_at ON public.workflow_templates;
CREATE TRIGGER trg_workflow_templates_updated_at BEFORE UPDATE ON public.workflow_templates FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_documents_updated_at ON public.documents;
CREATE TRIGGER trg_documents_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_signature_profiles_updated_at ON public.signature_profiles;
CREATE TRIGGER trg_signature_profiles_updated_at BEFORE UPDATE ON public.signature_profiles FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

-- Prevent modification/deletion on append-only logs
CREATE OR REPLACE FUNCTION public.fn_prevent_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Log bersifat append-only dan tidak dapat diubah atau dihapus.';
END;
$$;

DROP TRIGGER IF EXISTS trg_approval_logs_immutable ON public.approval_logs;
CREATE TRIGGER trg_approval_logs_immutable
  BEFORE UPDATE OR DELETE ON public.approval_logs
  FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_mutation();

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_mutation();

-- Prevent overwriting final PDF or hash once completed
CREATE OR REPLACE FUNCTION public.fn_protect_completed_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'completed' THEN
    IF NEW.final_pdf_path IS DISTINCT FROM OLD.final_pdf_path OR NEW.final_hash IS DISTINCT FROM OLD.final_hash THEN
      RAISE EXCEPTION 'Dokumen final dan hash dokumen yang telah selesai tidak dapat diubah atau ditimpa.';
    END IF;
    IF NEW.status NOT IN ('completed', 'archived') THEN
      RAISE EXCEPTION 'Status dokumen yang telah selesai hanya dapat diarsipkan.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_completed_document ON public.documents;
CREATE TRIGGER trg_protect_completed_document
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_completed_document();

-- ============================================================================
-- 4. TRANSACTIONAL WORKFLOW FUNCTIONS (Race-Condition & Sequential Safe)
-- ============================================================================

-- 4.1 Submit Document (Locks document & activates Step 1)
CREATE OR REPLACE FUNCTION public.fn_submit_document(
  p_document_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.documents%ROWTYPE;
  v_first_signer public.document_signers%ROWTYPE;
  v_version public.document_versions%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_next_status text;
  v_has_version boolean;
BEGIN
  SELECT * INTO v_doc FROM public.documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dokumen tidak ditemukan.';
  END IF;

  IF v_doc.created_by <> p_user_id THEN
    RAISE EXCEPTION 'Hanya pembuat dokumen yang dapat mengajukan dokumen ini.';
  END IF;

  IF v_doc.status <> 'draft' THEN
    RAISE EXCEPTION 'Hanya dokumen berstatus Draft yang dapat diajukan.';
  END IF;

  SELECT * INTO v_version
  FROM public.document_versions
  WHERE document_id = p_document_id AND version_number = v_doc.current_version;

  v_has_version := FOUND;
  IF NOT v_has_version THEN
    RAISE EXCEPTION 'Dokumen PDF belum diunggah.';
  END IF;

  SELECT * INTO v_first_signer
  FROM public.document_signers
  WHERE document_id = p_document_id
  ORDER BY step_order ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Minimal satu penandatangan harus ditentukan sebelum mengajukan dokumen.';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;

  v_next_status := CASE v_first_signer.action_type
    WHEN 'review' THEN 'waiting_review'
    WHEN 'approve' THEN 'waiting_approval'
    ELSE 'waiting_signature'
  END;

  UPDATE public.document_signers
  SET status = 'active', activated_at = now()
  WHERE id = v_first_signer.id;

  UPDATE public.documents
  SET
    status = v_next_status,
    is_locked = true,
    current_step_order = v_first_signer.step_order,
    submitted_at = now()
  WHERE id = p_document_id;

  INSERT INTO public.approval_logs (
    document_id, version_number, user_id, user_name, user_job_title, action, comment, document_hash
  ) VALUES (
    p_document_id, v_doc.current_version, p_user_id, v_profile.full_name, v_profile.job_title,
    'submitted', 'Dokumen diajukan untuk proses persetujuan berjenjang.', v_version.sha256_hash
  );

  INSERT INTO public.notifications (user_id, document_id, title, message, type)
  VALUES (
    v_first_signer.user_id,
    p_document_id,
    'Dokumen Membutuhkan Tindakan',
    format('Dokumen "%s" (%s) menunggu tindakan %s Anda.', v_doc.title, v_doc.document_number, v_first_signer.action_type),
    'action_required'
  );

  RETURN jsonb_build_object(
    'document_id', p_document_id,
    'status', v_next_status,
    'active_signer_id', v_first_signer.id,
    'active_user_id', v_first_signer.user_id
  );
END;
$$;

-- 4.2 Process Signer Action (Review / Approve / Sign / Revision / Reject)
CREATE OR REPLACE FUNCTION public.fn_process_signer_action(
  p_document_id uuid,
  p_user_id uuid,
  p_action text,
  p_comment text DEFAULT NULL,
  p_document_hash text DEFAULT NULL,
  p_signature_ref_id text DEFAULT NULL,
  p_consent_statement text DEFAULT NULL,
  p_signature_snapshot_path text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.documents%ROWTYPE;
  v_signer public.document_signers%ROWTYPE;
  v_next_signer public.document_signers%ROWTYPE;
  v_version public.document_versions%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_log_action text;
  v_doc_status text;
  v_all_completed boolean := false;
BEGIN
  -- Lock document row to prevent race conditions / duplicate approvals
  SELECT * INTO v_doc FROM public.documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dokumen tidak ditemukan.';
  END IF;

  IF v_doc.status NOT IN ('in_progress', 'waiting_review', 'waiting_approval', 'waiting_signature') THEN
    RAISE EXCEPTION 'Dokumen tidak sedang dalam tahap persetujuan aktif.';
  END IF;

  SELECT * INTO v_version
  FROM public.document_versions
  WHERE document_id = p_document_id AND version_number = v_doc.current_version;

  IF p_document_hash IS NOT NULL AND p_document_hash <> v_version.sha256_hash THEN
    RAISE EXCEPTION 'Validasi hash dokumen gagal. Versi dokumen tidak sesuai.';
  END IF;

  -- Lock active signer row and validate strict ownership & sequence
  SELECT * INTO v_signer
  FROM public.document_signers
  WHERE document_id = p_document_id
    AND step_order = v_doc.current_step_order
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tidak ada tugas penandatangan aktif untuk dokumen ini.';
  END IF;

  IF v_signer.user_id <> p_user_id THEN
    RAISE EXCEPTION 'Anda bukan penandatangan yang sedang aktif pada urutan saat ini.';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND OR NOT v_profile.is_active THEN
    RAISE EXCEPTION 'Akun pengguna tidak aktif.';
  END IF;

  IF p_action IN ('revision_requested', 'rejected') AND (p_comment IS NULL OR length(trim(p_comment)) < 3) THEN
    RAISE EXCEPTION 'Alasan wajib diisi minimal 3 karakter.';
  END IF;

  IF p_action = 'revision_requested' THEN
    UPDATE public.document_signers
    SET status = 'revision_requested', acted_at = now(), comment = p_comment
    WHERE id = v_signer.id;

    UPDATE public.documents
    SET status = 'needs_revision', is_locked = false, revision_reason = p_comment
    WHERE id = p_document_id;

    INSERT INTO public.approval_logs (
      document_id, version_number, signer_id, user_id, user_name, user_job_title, action, comment, document_hash
    ) VALUES (
      p_document_id, v_doc.current_version, v_signer.id, p_user_id, v_profile.full_name, v_profile.job_title,
      'revision_requested', p_comment, v_version.sha256_hash
    );

    INSERT INTO public.notifications (user_id, document_id, title, message, type)
    VALUES (
      v_doc.created_by,
      p_document_id,
      'Dokumen Membutuhkan Revisi',
      format('Dokumen "%s" dikembalikan oleh %s untuk revisi: %s', v_doc.title, v_profile.full_name, p_comment),
      'warning'
    );

    RETURN jsonb_build_object('status', 'needs_revision', 'all_completed', false);
  END IF;

  IF p_action = 'rejected' THEN
    UPDATE public.document_signers
    SET status = 'rejected', acted_at = now(), comment = p_comment
    WHERE id = v_signer.id;

    UPDATE public.documents
    SET status = 'rejected', is_locked = true, rejection_reason = p_comment
    WHERE id = p_document_id;

    INSERT INTO public.approval_logs (
      document_id, version_number, signer_id, user_id, user_name, user_job_title, action, comment, document_hash
    ) VALUES (
      p_document_id, v_doc.current_version, v_signer.id, p_user_id, v_profile.full_name, v_profile.job_title,
      'rejected', p_comment, v_version.sha256_hash
    );

    INSERT INTO public.notifications (user_id, document_id, title, message, type)
    VALUES (
      v_doc.created_by,
      p_document_id,
      'Dokumen Ditolak',
      format('Dokumen "%s" ditolak oleh %s: %s', v_doc.title, v_profile.full_name, p_comment),
      'error'
    );

    RETURN jsonb_build_object('status', 'rejected', 'all_completed', false);
  END IF;

  -- Positive action validation against signer's assigned action_type
  IF (v_signer.action_type = 'review' AND p_action <> 'reviewed')
     OR (v_signer.action_type = 'approve' AND p_action <> 'approved')
     OR (v_signer.action_type = 'sign' AND p_action <> 'signed') THEN
    RAISE EXCEPTION 'Jenis tindakan tidak sesuai dengan kewenangan urutan ini (%).', v_signer.action_type;
  END IF;

  v_log_action := p_action;

  UPDATE public.document_signers
  SET status = 'completed', acted_at = now(), comment = p_comment
  WHERE id = v_signer.id;

  INSERT INTO public.approval_logs (
    document_id, version_number, signer_id, user_id, user_name, user_job_title, action, comment,
    document_hash, signature_reference_id, consent_statement, signature_snapshot_path
  ) VALUES (
    p_document_id, v_doc.current_version, v_signer.id, p_user_id, v_profile.full_name, v_profile.job_title,
    v_log_action, p_comment, v_version.sha256_hash, p_signature_ref_id, p_consent_statement, p_signature_snapshot_path
  );

  -- Find next sequential signer
  SELECT * INTO v_next_signer
  FROM public.document_signers
  WHERE document_id = p_document_id AND step_order > v_signer.step_order
  ORDER BY step_order ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_doc_status := CASE v_next_signer.action_type
      WHEN 'review' THEN 'waiting_review'
      WHEN 'approve' THEN 'waiting_approval'
      ELSE 'waiting_signature'
    END;

    UPDATE public.document_signers
    SET status = 'active', activated_at = now()
    WHERE id = v_next_signer.id;

    UPDATE public.documents
    SET status = v_doc_status, current_step_order = v_next_signer.step_order
    WHERE id = p_document_id;

    INSERT INTO public.notifications (user_id, document_id, title, message, type)
    VALUES (
      v_next_signer.user_id,
      p_document_id,
      'Dokumen Membutuhkan Tindakan',
      format('Dokumen "%s" (%s) kini menunggu tindakan %s Anda.', v_doc.title, v_doc.document_number, v_next_signer.action_type),
      'action_required'
    );

    INSERT INTO public.notifications (user_id, document_id, title, message, type)
    VALUES (
      v_doc.created_by,
      p_document_id,
      'Progress Persetujuan Dokumen',
      format('%s telah menyelesaikan (%s) pada dokumen "%s".', v_profile.full_name, v_log_action, v_doc.title),
      'info'
    );
  ELSE
    v_all_completed := true;
    v_doc_status := 'finalizing';
    UPDATE public.documents
    SET status = 'finalizing', current_step_order = NULL
    WHERE id = p_document_id;
  END IF;

  RETURN jsonb_build_object(
    'status', v_doc_status,
    'all_completed', v_all_completed,
    'next_signer_user_id', v_next_signer.user_id
  );
END;
$$;

-- 4.3 Resubmit Revised Document (Resets signers back to Step 1 on new PDF version)
CREATE OR REPLACE FUNCTION public.fn_resubmit_revised_document(
  p_document_id uuid,
  p_user_id uuid,
  p_new_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.documents%ROWTYPE;
  v_first_signer public.document_signers%ROWTYPE;
  v_version public.document_versions%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_next_status text;
BEGIN
  SELECT * INTO v_doc FROM public.documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dokumen tidak ditemukan.';
  END IF;

  IF v_doc.created_by <> p_user_id THEN
    RAISE EXCEPTION 'Hanya pembuat dokumen yang dapat mengajukan ulang revisi.';
  END IF;

  IF v_doc.status <> 'needs_revision' THEN
    RAISE EXCEPTION 'Dokumen tidak dalam status Perlu Revisi.';
  END IF;

  SELECT * INTO v_version
  FROM public.document_versions
  WHERE document_id = p_document_id AND version_number = p_new_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Versi PDF baru tidak ditemukan.';
  END IF;

  -- Reset all signers because previous approvals do not apply to new version
  UPDATE public.document_signers
  SET status = 'pending', activated_at = NULL, acted_at = NULL, comment = NULL
  WHERE document_id = p_document_id;

  SELECT * INTO v_first_signer
  FROM public.document_signers
  WHERE document_id = p_document_id
  ORDER BY step_order ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Penandatangan belum ditentukan.';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;

  v_next_status := CASE v_first_signer.action_type
    WHEN 'review' THEN 'waiting_review'
    WHEN 'approve' THEN 'waiting_approval'
    ELSE 'waiting_signature'
  END;

  UPDATE public.document_signers
  SET status = 'active', activated_at = now()
  WHERE id = v_first_signer.id;

  UPDATE public.documents
  SET
    current_version = p_new_version,
    status = v_next_status,
    is_locked = true,
    current_step_order = v_first_signer.step_order,
    revision_reason = NULL
  WHERE id = p_document_id;

  INSERT INTO public.approval_logs (
    document_id, version_number, user_id, user_name, user_job_title, action, comment, document_hash
  ) VALUES (
    p_document_id, p_new_version, p_user_id, v_profile.full_name, v_profile.job_title,
    'resubmitted', format('Versi revisi v%s diajukan ulang dari urutan pertama.', p_new_version), v_version.sha256_hash
  );

  INSERT INTO public.notifications (user_id, document_id, title, message, type)
  VALUES (
    v_first_signer.user_id,
    p_document_id,
    'Dokumen Revisi Menunggu Tindakan',
    format('Dokumen "%s" (versi v%s) telah direvisi dan menunggu tindakan Anda.', v_doc.title, p_new_version),
    'action_required'
  );

  RETURN jsonb_build_object('status', v_next_status, 'version', p_new_version);
END;
$$;

-- ============================================================================
-- 5. RLS HELPER FUNCTIONS & POLICIES
-- ============================================================================

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT is_active FROM public.profiles WHERE id = auth.uid()), false);
$$;

CREATE OR REPLACE FUNCTION public.user_can_access_document(p_doc_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = p_doc_id
      AND public.current_user_is_active()
      AND (
        d.created_by = auth.uid()
        OR public.current_user_role() IN ('super_admin', 'admin')
        OR EXISTS (
          SELECT 1 FROM public.document_signers ds
          WHERE ds.document_id = d.id AND ds.user_id = auth.uid()
        )
      )
  );
$$;

-- Enable RLS on all 12 tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_signers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Profiles policies
DROP POLICY IF EXISTS "Active users can view profiles" ON public.profiles;
CREATE POLICY "Active users can view profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.current_user_is_active() OR id = auth.uid());

DROP POLICY IF EXISTS "Users can update own safe profile fields" ON public.profiles;
CREATE POLICY "Users can update own safe profile fields" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() AND public.current_user_is_active())
  WITH CHECK (
    id = auth.uid()
    AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
    AND is_active = (SELECT p.is_active FROM public.profiles p WHERE p.id = auth.uid())
  );

-- Master Data policies
DROP POLICY IF EXISTS "Active users can read master data" ON public.master_data;
CREATE POLICY "Active users can read master data" ON public.master_data
  FOR SELECT TO authenticated
  USING (public.current_user_is_active());

DROP POLICY IF EXISTS "Admins can manage master data" ON public.master_data;
CREATE POLICY "Admins can manage master data" ON public.master_data
  FOR ALL TO authenticated
  USING (public.current_user_role() IN ('super_admin', 'admin'))
  WITH CHECK (public.current_user_role() IN ('super_admin', 'admin'));

-- Workflow Templates policies
DROP POLICY IF EXISTS "Active users can read workflow templates" ON public.workflow_templates;
CREATE POLICY "Active users can read workflow templates" ON public.workflow_templates
  FOR SELECT TO authenticated
  USING (public.current_user_is_active());

DROP POLICY IF EXISTS "Admins can manage workflow templates" ON public.workflow_templates;
CREATE POLICY "Admins can manage workflow templates" ON public.workflow_templates
  FOR ALL TO authenticated
  USING (public.current_user_role() IN ('super_admin', 'admin'))
  WITH CHECK (public.current_user_role() IN ('super_admin', 'admin'));

-- Documents policies
DROP POLICY IF EXISTS "Users can read accessible documents" ON public.documents;
CREATE POLICY "Users can read accessible documents" ON public.documents
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.user_can_access_document(id));

DROP POLICY IF EXISTS "Active users can create own draft documents" ON public.documents;
CREATE POLICY "Active users can create own draft documents" ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_is_active() AND created_by = auth.uid() AND status = 'draft');

DROP POLICY IF EXISTS "Creators can update unlocked drafts" ON public.documents;
CREATE POLICY "Creators can update unlocked drafts" ON public.documents
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() AND is_locked = false AND status IN ('draft', 'needs_revision'))
  WITH CHECK (created_by = auth.uid() AND status IN ('draft', 'needs_revision'));

-- Document Versions policies
DROP POLICY IF EXISTS "Users can read accessible document versions" ON public.document_versions;
CREATE POLICY "Users can read accessible document versions" ON public.document_versions
  FOR SELECT TO authenticated
  USING (public.user_can_access_document(document_id));

DROP POLICY IF EXISTS "Creators can insert versions for unlocked docs" ON public.document_versions;
CREATE POLICY "Creators can insert versions for unlocked docs" ON public.document_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.created_by = auth.uid() AND d.is_locked = false
    )
  );

-- Document Signers policies
DROP POLICY IF EXISTS "Users can read accessible document signers" ON public.document_signers;
CREATE POLICY "Users can read accessible document signers" ON public.document_signers
  FOR SELECT TO authenticated
  USING (public.user_can_access_document(document_id));

DROP POLICY IF EXISTS "Creators can manage signers on unlocked docs" ON public.document_signers;
CREATE POLICY "Creators can manage signers on unlocked docs" ON public.document_signers
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.created_by = auth.uid() AND d.is_locked = false
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.created_by = auth.uid() AND d.is_locked = false
    )
  );

-- Signature Profiles policies (Strictly Private per Owner)
DROP POLICY IF EXISTS "Users manage only their own signature profile" ON public.signature_profiles;
CREATE POLICY "Users manage only their own signature profile" ON public.signature_profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.current_user_is_active())
  WITH CHECK (user_id = auth.uid() AND public.current_user_is_active());

-- Signature Fields policies
DROP POLICY IF EXISTS "Users can read accessible signature fields" ON public.signature_fields;
CREATE POLICY "Users can read accessible signature fields" ON public.signature_fields
  FOR SELECT TO authenticated
  USING (public.user_can_access_document(document_id));

DROP POLICY IF EXISTS "Creators can manage signature fields on unlocked docs" ON public.signature_fields;
CREATE POLICY "Creators can manage signature fields on unlocked docs" ON public.signature_fields
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.created_by = auth.uid() AND d.is_locked = false
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.created_by = auth.uid() AND d.is_locked = false
    )
  );

-- Approval Logs policies (Read only for authorized users; inserts via SECURITY DEFINER RPC/Service Role)
DROP POLICY IF EXISTS "Users can read accessible approval logs" ON public.approval_logs;
CREATE POLICY "Users can read accessible approval logs" ON public.approval_logs
  FOR SELECT TO authenticated
  USING (public.user_can_access_document(document_id));

-- Notifications policies
DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users mark own notifications read" ON public.notifications;
CREATE POLICY "Users mark own notifications read" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Audit Logs policies (Admin & Super Admin read only)
DROP POLICY IF EXISTS "Admins read audit logs" ON public.audit_logs;
CREATE POLICY "Admins read audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.current_user_role() IN ('super_admin', 'admin'));

-- System Settings policies
DROP POLICY IF EXISTS "Active users read system settings" ON public.system_settings;
CREATE POLICY "Active users read system settings" ON public.system_settings
  FOR SELECT TO authenticated
  USING (public.current_user_is_active());

DROP POLICY IF EXISTS "Super Admin updates system settings" ON public.system_settings;
CREATE POLICY "Super Admin updates system settings" ON public.system_settings
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'super_admin')
  WITH CHECK (public.current_user_role() = 'super_admin');

-- ============================================================================
-- 6. SUPABASE STORAGE PRIVATE BUCKETS & POLICIES
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('documents-original', 'documents-original', false, 10485760, ARRAY['application/pdf']),
  ('documents-final', 'documents-final', false, 15728640, ARRAY['application/pdf']),
  ('signatures', 'signatures', false, 2097152, ARRAY['image/png'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Signatures bucket: user can only access folder matching their own auth.uid()
DROP POLICY IF EXISTS "Users manage own signature files" ON storage.objects;
CREATE POLICY "Users manage own signature files" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'signatures' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'signatures' AND (storage.foldername(name))[1] = auth.uid()::text);

-- documents-final: strictly prevent overwrite/delete from client API
DROP POLICY IF EXISTS "Prevent client mutations on final documents" ON storage.objects;
CREATE POLICY "Prevent client mutations on final documents" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'documents-final' AND public.current_user_role() IN ('super_admin', 'admin'));

-- ============================================================================
-- 7. INITIAL SEED DATA (System Settings & Master Data)
-- ============================================================================

INSERT INTO public.system_settings (id, app_name, organization_name, max_file_size_mb, timezone)
VALUES (1, 'LAZUARDI e-SIGN', 'Sekolah & Yayasan Lazuardi', 5, 'Asia/Jakarta')
ON CONFLICT (id) DO NOTHING;

-- Units
INSERT INTO public.master_data (category, code, name, sort_order) VALUES
  ('unit', 'YYS', 'Yayasan', 1),
  ('unit', 'HO', 'Head Office', 2),
  ('unit', 'KG', 'Kindergarten', 3),
  ('unit', 'EL', 'Elementary', 4),
  ('unit', 'JHS', 'Junior High School', 5)
ON CONFLICT (category, name) DO NOTHING;

-- Departments
INSERT INTO public.master_data (category, code, name, sort_order) VALUES
  ('department', 'GA', 'General Affairs', 1),
  ('department', 'FIN', 'Finance', 2),
  ('department', 'HR', 'Human Resources', 3),
  ('department', 'ACD', 'Academic', 4),
  ('department', 'IT', 'IT', 5),
  ('department', 'SEC', 'Security', 6),
  ('department', 'MNT', 'Maintenance', 7),
  ('department', 'RES', 'Resources', 8),
  ('department', 'TRP', 'Transportation', 9)
ON CONFLICT (category, name) DO NOTHING;

-- Document Types
INSERT INTO public.master_data (category, code, name, sort_order) VALUES
  ('document_type', 'SI', 'Surat Internal', 1),
  ('document_type', 'SE', 'Surat Eksternal', 2),
  ('document_type', 'PP', 'Pengajuan Pembelian', 3),
  ('document_type', 'PA', 'Pengajuan Anggaran', 4),
  ('document_type', 'BA', 'Berita Acara', 5),
  ('document_type', 'BAST', 'BAST', 6),
  ('document_type', 'MI', 'Memo Internal', 7),
  ('document_type', 'SOP', 'SOP', 8),
  ('document_type', 'SK', 'Surat Keputusan', 9),
  ('document_type', 'LAP', 'Laporan', 10)
ON CONFLICT (category, name) DO NOTHING;

-- ============================================================================
-- 7.5 DOCUMENT COMMENTS (Review & Pre-Signature Discussion)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.document_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number >= 1),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  author_name text NOT NULL,
  author_job_title text NOT NULL DEFAULT '',
  author_role text NOT NULL DEFAULT '',
  page_number integer CHECK (page_number IS NULL OR page_number >= 1),
  comment text NOT NULL CHECK (length(trim(comment)) >= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_comments_doc_created
  ON public.document_comments (document_id, created_at ASC);

ALTER TABLE public.document_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read accessible document comments" ON public.document_comments;
CREATE POLICY "Users can read accessible document comments" ON public.document_comments
  FOR SELECT TO authenticated
  USING (public.user_can_access_document(document_id));

DROP POLICY IF EXISTS "Authorized users can insert document comments" ON public.document_comments;
CREATE POLICY "Authorized users can insert document comments" ON public.document_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.user_can_access_document(document_id)
  );

-- ============================================================================
-- 8. EXPLICIT POSTGRESQL GRANTS (Required for PostgREST / Supabase API)
-- ============================================================================

GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

