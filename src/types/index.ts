export type UserRole = 'super_admin' | 'admin' | 'user';

export type MasterCategory = 'unit' | 'department' | 'document_type';

export type DocumentPriority = 'normal' | 'urgent';

export type DocumentStatus =
  | 'draft'
  | 'in_progress'
  | 'waiting_review'
  | 'waiting_approval'
  | 'waiting_signature'
  | 'needs_revision'
  | 'rejected'
  | 'finalizing'
  | 'completed'
  | 'cancelled'
  | 'archived';

export type SignerActionType = 'review' | 'approve' | 'sign';

export type SignerStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'revision_requested'
  | 'rejected'
  | 'skipped';

export interface MasterDataItem {
  id: string;
  category: MasterCategory;
  code: string | null;
  name: string;
  description: string | null;
  require_workflow_template: boolean;
  default_template_id: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  full_name: string;
  employee_id: string | null;
  email: string;
  unit_id: string | null;
  department_id: string | null;
  job_title: string;
  role: UserRole;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
  unit?: { id: string; name: string; code: string | null } | null;
  department?: { id: string; name: string; code: string | null } | null;
}

export interface WorkflowTemplateStep {
  step_order: number;
  user_id: string;
  action_type: SignerActionType;
  label?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  document_type_id: string | null;
  description: string | null;
  steps: WorkflowTemplateStep[];
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  document_type?: { id: string; name: string } | null;
}

export interface DocumentRecord {
  id: string;
  document_number: string;
  title: string;
  document_type_id: string | null;
  unit_id: string | null;
  department_id: string | null;
  description: string | null;
  document_date: string;
  due_date: string | null;
  priority: DocumentPriority;
  status: DocumentStatus;
  current_version: number;
  current_step_order: number | null;
  workflow_template_id: string | null;
  is_locked: boolean;
  verification_token: string | null;
  verification_id: string | null;
  final_pdf_path: string | null;
  final_hash: string | null;
  include_history_page: boolean;
  revision_reason: string | null;
  rejection_reason: string | null;
  created_by: string;
  submitted_at: string | null;
  completed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  creator?: { id: string; full_name: string; job_title: string; email: string } | null;
  unit?: { id: string; name: string; code: string | null } | null;
  department?: { id: string; name: string; code: string | null } | null;
  document_type?: { id: string; name: string; code: string | null } | null;
  signers?: DocumentSigner[];
}

export interface DocumentVersion {
  id: string;
  document_id: string;
  version_number: number;
  file_path: string;
  file_name: string;
  file_size_bytes: number;
  page_count: number;
  sha256_hash: string;
  uploaded_by: string;
  notes: string | null;
  created_at: string;
}

export interface DocumentSigner {
  id: string;
  document_id: string;
  user_id: string;
  step_order: number;
  action_type: SignerActionType;
  status: SignerStatus;
  is_mandatory: boolean;
  activated_at: string | null;
  acted_at: string | null;
  comment: string | null;
  created_at: string;
  user?: {
    id: string;
    full_name: string;
    job_title: string;
    email: string;
    employee_id: string | null;
  } | null;
}

export interface SignatureField {
  id: string;
  document_id: string;
  version_number: number;
  signer_id: string;
  page_number: number;
  x_percent: number;
  y_percent: number;
  width_percent: number;
  height_percent: number;
  field_type: 'signature' | 'initial' | 'stamp';
  created_at?: string;
}

export interface SignatureProfile {
  id: string;
  user_id: string;
  signature_type: 'draw' | 'upload' | 'typed';
  image_path: string | null;
  typed_text: string | null;
  typed_font: string | null;
  signed_image_url?: string | null;
  updated_at: string;
}

export interface ApprovalLog {
  id: string;
  document_id: string;
  version_number: number;
  signer_id: string | null;
  user_id: string;
  user_name: string;
  user_job_title: string;
  action:
    | 'submitted'
    | 'reviewed'
    | 'approved'
    | 'signed'
    | 'revision_requested'
    | 'rejected'
    | 'resubmitted'
    | 'finalized'
    | 'cancelled'
    | 'archived';
  comment: string | null;
  document_hash: string | null;
  signature_reference_id: string | null;
  consent_statement: string | null;
  signature_snapshot_path: string | null;
  created_at: string;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  document_id: string | null;
  title: string;
  message: string;
  type: 'info' | 'action_required' | 'success' | 'warning' | 'error';
  is_read: boolean;
  created_at: string;
}

export interface AuditLogItem {
  id: string;
  user_id: string | null;
  activity_name: string;
  document_id: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
  user?: { full_name: string; email: string } | null;
  document?: { document_number: string; title: string } | null;
}

export interface SystemSettings {
  id: number;
  app_name: string;
  organization_name: string;
  logo_url: string | null;
  max_file_size_mb: number;
  document_number_format: string;
  signature_display_mode: string;
  qr_enabled: boolean;
  qr_allow_doc_number_public: boolean;
  timezone: string;
  retention_years: number;
  maintenance_mode: boolean;
  updated_at: string;
}
