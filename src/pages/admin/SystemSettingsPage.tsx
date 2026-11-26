import React, { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { AppLayout } from '../../components/AppLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { apiFetch } from '../../lib/supabaseClient';

export function SystemSettingsPage() {
  const { settings, refreshMe } = useAuth();
  const { showToast } = useToast();

  const [appName, setAppName] = useState('LAZUARDI e-SIGN');
  const [orgName, setOrgName] = useState('Sekolah & Yayasan Lazuardi');
  const [maxSizeMb, setMaxSizeMb] = useState(5);
  const [docFormat, setDocFormat] = useState('LZD/{UNIT}/{YYYY}/{MM}/{SEQ}');
  const [qrEnabled, setQrEnabled] = useState(true);
  const [qrAllowDocNumber, setQrAllowDocNumber] = useState(true);
  const [retentionYears, setRetentionYears] = useState(10);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setAppName(settings.app_name);
    setOrgName(settings.organization_name);
    setMaxSizeMb(settings.max_file_size_mb);
    setDocFormat(settings.document_number_format);
    setQrEnabled(settings.qr_enabled);
    setQrAllowDocNumber(settings.qr_allow_doc_number_public);
    setRetentionYears(settings.retention_years);
    setMaintenanceMode(settings.maintenance_mode);
  }, [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          app_name: appName,
          organization_name: orgName,
          max_file_size_mb: Number(maxSizeMb),
          document_number_format: docFormat,
          qr_enabled: qrEnabled,
          qr_allow_doc_number_public: qrAllowDocNumber,
          retention_years: Number(retentionYears),
          maintenance_mode: maintenanceMode,
        }),
      });
      await refreshMe();
      showToast('Pengaturan sistem berhasil disimpan.', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Gagal menyimpan pengaturan.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout title="Pengaturan Sistem" breadcrumb="Super Admin · Konfigurasi Aplikasi">
      <form onSubmit={handleSave} className="max-w-2xl rounded-lg border border-slate-200 bg-white p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Nama Aplikasi</label>
            <input
              type="text"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Nama Organisasi</label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Maksimal Ukuran PDF (MB)</label>
            <input
              type="number"
              min={1}
              max={25}
              value={maxSizeMb}
              onChange={(e) => setMaxSizeMb(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Retensi Dokumen (Tahun)</label>
            <input
              type="number"
              min={1}
              max={50}
              value={retentionYears}
              onChange={(e) => setRetentionYears(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Timezone</label>
            <input
              type="text"
              disabled
              value="Asia/Jakarta"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Format Nomor Dokumen</label>
          <input
            type="text"
            value={docFormat}
            onChange={(e) => setDocFormat(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
          />
        </div>

        <div className="space-y-2.5 border-t border-slate-100 pt-4 text-xs text-slate-700">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={qrEnabled}
              onChange={(e) => setQrEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[#1755CE]"
            />
            <span>Sematkan QR Code verifikasi otomatis pada Final PDF</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={qrAllowDocNumber}
              onChange={(e) => setQrAllowDocNumber(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[#1755CE]"
            />
            <span>Tampilkan Nomor Dokumen pada halaman verifikasi publik (/verify)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-[#DC2626] font-medium">
            <input
              type="checkbox"
              checked={maintenanceMode}
              onChange={(e) => setMaintenanceMode(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[#DC2626]"
            />
            <span>Aktifkan Maintenance Mode (Hanya Super Admin dapat mengakses)</span>
          </label>
        </div>

        <div className="flex justify-end border-t border-slate-100 pt-4">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1755CE] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1244A8] disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            <span>{saving ? 'Menyimpan...' : 'Simpan Pengaturan'}</span>
          </button>
        </div>
      </form>
    </AppLayout>
  );
}
