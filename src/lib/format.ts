import { DocumentPriority, DocumentStatus, SignerActionType, UserRole } from '../types';

export function formatJakartaDate(iso: string | null | undefined, withTime = true): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime
      ? {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }
      : {}),
  };

  const formatted = new Intl.DateTimeFormat('id-ID', options).format(date);
  return withTime ? `${formatted} WIB` : formatted;
}

export function formatDurationBetween(startIso: string | null | undefined, endIso?: string | null): string {
  if (!startIso) return '—';
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const diffMs = Math.max(0, end - start);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins} menit`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam ${mins % 60} mnt`;
  const days = Math.floor(hours / 24);
  return `${days} hari ${hours % 24} jam`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const STATUS_META: Record<
  DocumentStatus,
  { label: string; colorClass: string; textClass: string; borderClass: string }
> = {
  draft: {
    label: 'Draft',
    colorClass: 'bg-slate-100',
    textClass: 'text-slate-700',
    borderClass: 'border-slate-200',
  },
  in_progress: {
    label: 'Dalam Proses',
    colorClass: 'bg-blue-50',
    textClass: 'text-[#1755CE]',
    borderClass: 'border-blue-200',
  },
  waiting_review: {
    label: 'Menunggu Review',
    colorClass: 'bg-amber-50',
    textClass: 'text-amber-700',
    borderClass: 'border-amber-200',
  },
  waiting_approval: {
    label: 'Menunggu Persetujuan',
    colorClass: 'bg-amber-50',
    textClass: 'text-amber-700',
    borderClass: 'border-amber-200',
  },
  waiting_signature: {
    label: 'Menunggu Tanda Tangan',
    colorClass: 'bg-blue-50',
    textClass: 'text-[#1755CE]',
    borderClass: 'border-blue-200',
  },
  needs_revision: {
    label: 'Perlu Revisi',
    colorClass: 'bg-orange-50',
    textClass: 'text-orange-700',
    borderClass: 'border-orange-200',
  },
  rejected: {
    label: 'Ditolak',
    colorClass: 'bg-red-50',
    textClass: 'text-[#DC2626]',
    borderClass: 'border-red-200',
  },
  finalizing: {
    label: 'Finalisasi',
    colorClass: 'bg-blue-50',
    textClass: 'text-[#1755CE]',
    borderClass: 'border-blue-200',
  },
  completed: {
    label: 'Selesai',
    colorClass: 'bg-emerald-50',
    textClass: 'text-[#16A34A]',
    borderClass: 'border-emerald-200',
  },
  cancelled: {
    label: 'Dibatalkan',
    colorClass: 'bg-slate-100',
    textClass: 'text-slate-600',
    borderClass: 'border-slate-200',
  },
  archived: {
    label: 'Diarsipkan',
    colorClass: 'bg-slate-100',
    textClass: 'text-slate-700',
    borderClass: 'border-slate-300',
  },
};

export const ACTION_LABEL: Record<SignerActionType, string> = {
  review: 'Review',
  approve: 'Persetujuan',
  sign: 'Tanda Tangan',
};

export const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  user: 'Pegawai / User',
};

export const PRIORITY_LABEL: Record<DocumentPriority, string> = {
  normal: 'Normal',
  urgent: 'Urgent',
};

export async function computeFileSha256(file: File | ArrayBuffer): Promise<string> {
  const buffer = file instanceof File ? await file.arrayBuffer() : file;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
