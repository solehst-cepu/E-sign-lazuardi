# LAZUARDI e-SIGN

**Simple, Secure & Sequential Electronic Signature**  
Aplikasi web internal Sekolah dan Yayasan Lazuardi (`esign.lazuardi.sch.id`) untuk pengelolaan persetujuan dokumen dan tanda tangan elektronik berjenjang.

---

## Arsitektur & Teknologi

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons, PDF.js (`pdfjs-dist`), SheetJS (`xlsx`)
- **Backend API**: Node.js + Express (`server/app.ts`) — berjalan melalui `server.ts` (development/Node) dan `api/index.ts` (Vercel Serverless)
- **PDF & Kriptografi**: `pdf-lib`, `qrcode`, `SHA-256` (`crypto`)
- **Database, Auth & Storage**: Supabase PostgreSQL, Supabase Auth (Email & Password), Supabase Private Storage

---

## 1. Panduan Setup Supabase

1. **Buat Proyek Supabase** di [supabase.com](https://supabase.com).
2. **Nonaktifkan Public Signup**:
   - Buka **Authentication → Providers → Email**.
   - Nonaktifkan **Enable Email Signup** (atau pastikan pendaftaran mandiri tidak dibuka; seluruh akun dibuat oleh Admin/Super Admin melalui Supabase Admin API di backend).
3. **Jalankan SQL Migration**:
   - Buka **SQL Editor** di dashboard Supabase.
   - Salin seluruh isi file `supabase/migrations/001_initial_schema.sql` dan jalankan (**Run**).
   - Migration ini otomatis membuat:
     - 12 tabel inti (`profiles`, `master_data`, `workflow_templates`, `documents`, `document_versions`, `document_signers`, `signature_profiles`, `signature_fields`, `approval_logs`, `notifications`, `audit_logs`, `system_settings`)
     - Fungsi transaksional anti race-condition (`fn_submit_document`, `fn_process_signer_action`, `fn_resubmit_revised_document`)
     - Trigger immutability pada `approval_logs`, `audit_logs`, dan dokumen final (`completed`)
     - Row Level Security (RLS) policies pada seluruh tabel
     - 3 Private Storage Buckets (`documents-original`, `documents-final`, `signatures`) beserta Storage RLS policies
     - Seed awal Unit, Departemen, Jenis Dokumen, dan Pengaturan Sistem.

---

## 2. Environment Variables

Salin `.env.example` menjadi `.env` (jangan pernah commit `.env` ke GitHub):

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
APP_URL=https://esign.lazuardi.sch.id
INITIAL_SUPERADMIN_EMAIL=superadmin@lazuardi.sch.id
```

> **Penting:** `SUPABASE_SERVICE_ROLE_KEY` hanya digunakan pada sisi server (`server/supabase.ts`) dan **tidak boleh** diawali `VITE_` atau diekspos ke browser.

---

## 3. Membuat Akun Super Admin Pertama

Setelah migration dijalankan dan environment variables terpasang:

1. Buka halaman aplikasi (`/login`).
2. Jika belum ada akun `super_admin` di tabel `profiles`, sistem otomatis menampilkan form **Inisialisasi Super Admin Pertama**.
3. Jika `INITIAL_SUPERADMIN_EMAIL` diisi pada environment server, email yang didaftarkan harus sama dengan nilai tersebut.
4. Isi nama lengkap, jabatan, email resmi, dan password (minimal 8 karakter), lalu klik **Buat Akun Super Admin**.
5. Setelah akun Super Admin dibuat, form inisialisasi otomatis terkunci permanen.

---

## 4. Panduan Deployment ke GitHub & Vercel

1. Push source code ke repository GitHub (pastikan `.env` tidak ikut ter-commit; `.gitignore` sudah mengecualikan `.env*`).
2. Masuk ke [vercel.com](https://vercel.com) → **Add New Project** → pilih repository GitHub Anda.
3. Konfigurasikan **Environment Variables** di Vercel Project Settings:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `APP_URL` (`https://esign.lazuardi.sch.id`)
   - `INITIAL_SUPERADMIN_EMAIL`
4. `vercel.json` sudah dikonfigurasi untuk membangun frontend Vite ke `dist/` dan mengarahkan seluruh `/api/*` ke `api/index.ts`.
5. Hubungkan custom domain `esign.lazuardi.sch.id` melalui **Vercel → Settings → Domains**.

---

## Catatan Keamanan & Kepatuhan

- Tanda tangan elektronik menggunakan label **Electronic Signature — Internal** (bukan TTE tersertifikasi).
- Penandatanganan wajib melewati verifikasi ulang password ke Supabase Auth secara stateless; password tidak pernah disimpan atau dicatat pada log.
- Verifikasi publik `/verify/[verification_token]` hanya menampilkan metadata terbatas non-rahasia dan memeriksa kecocokan hash `SHA-256` file PDF final.
