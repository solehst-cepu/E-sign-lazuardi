import {
  Archive,
  CheckCircle2,
  Clock,
  FileEdit,
  FileText,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { STATUS_META } from '../lib/format';
import { DocumentPriority, DocumentStatus } from '../types';

export function StatusBadge({ status }: { status: DocumentStatus }) {
  const meta = STATUS_META[status] || STATUS_META.draft;

  const Icon =
    status === 'completed'
      ? CheckCircle2
      : status === 'rejected'
      ? XCircle
      : status === 'needs_revision'
      ? RotateCcw
      : status === 'archived'
      ? Archive
      : status === 'draft'
      ? FileEdit
      : status === 'finalizing'
      ? ShieldCheck
      : status === 'cancelled'
      ? FileText
      : Clock;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 ${meta.colorClass} ${meta.textClass} ${meta.borderClass}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{meta.label}</span>
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: DocumentPriority }) {
  if (priority === 'urgent') {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-[#DC2626] whitespace-nowrap shrink-0">
        Urgent
      </span>
    );
  }
  return <span className="text-xs text-slate-600 whitespace-nowrap">Normal</span>;
}
