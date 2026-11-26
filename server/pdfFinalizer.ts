import crypto from 'crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import { getSupabaseAdmin } from './supabase.js';

function formatWib(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return (
    new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d) + ' WIB'
  );
}

function sanitizePdfText(text: string): string {
  // Standard PDF Helvetica/WinAnsi encoding safety
  return text.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
}

export async function generateAndStoreFinalPdf(documentId: string): Promise<{
  finalPdfPath: string;
  finalHash: string;
  verificationId: string;
  verificationToken: string;
}> {
  const supabase = getSupabaseAdmin();

  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .single();

  if (docError || !doc) {
    throw new Error('Dokumen tidak ditemukan untuk finalisasi.');
  }

  if (doc.status === 'completed' && doc.final_pdf_path && doc.final_hash) {
    return {
      finalPdfPath: doc.final_pdf_path,
      finalHash: doc.final_hash,
      verificationId: doc.verification_id,
      verificationToken: doc.verification_token,
    };
  }

  const { data: settings } = await supabase
    .from('system_settings')
    .select('*')
    .eq('id', 1)
    .single();

  const { data: version, error: verError } = await supabase
    .from('document_versions')
    .select('*')
    .eq('document_id', documentId)
    .eq('version_number', doc.current_version)
    .single();

  if (verError || !version) {
    throw new Error('Versi PDF dokumen tidak ditemukan.');
  }

  // Download original PDF from private bucket
  const { data: fileData, error: dlError } = await supabase.storage
    .from('documents-original')
    .download(version.file_path);

  if (dlError || !fileData) {
    throw new Error('Gagal mengunduh file PDF asli dari storage.');
  }

  const originalBytes = new Uint8Array(await fileData.arrayBuffer());
  const pdfDoc = await PDFDocument.load(originalBytes);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const { data: fields } = await supabase
    .from('signature_fields')
    .select('*')
    .eq('document_id', documentId)
    .eq('version_number', doc.current_version);

  const { data: signers } = await supabase
    .from('document_signers')
    .select('*, user:profiles(id, full_name, job_title)')
    .eq('document_id', documentId)
    .order('step_order', { ascending: true });

  const { data: logs } = await supabase
    .from('approval_logs')
    .select('*')
    .eq('document_id', documentId)
    .eq('version_number', doc.current_version)
    .order('created_at', { ascending: true });

  const signerMap = new Map<string, any>();
  for (const s of signers || []) {
    signerMap.set(s.id, s);
  }

  const signerLogMap = new Map<string, any>();
  for (const l of logs || []) {
    if (l.signer_id && ['signed', 'approved', 'reviewed'].includes(l.action)) {
      signerLogMap.set(l.signer_id, l);
    }
  }

  // Cache embedded signature PNG images per user_id
  const embeddedImages = new Map<string, any>();
  for (const s of signers || []) {
    const { data: sigProfile } = await supabase
      .from('signature_profiles')
      .select('*')
      .eq('user_id', s.user_id)
      .maybeSingle();

    if (sigProfile && sigProfile.image_path && (sigProfile.signature_type === 'draw' || sigProfile.signature_type === 'upload')) {
      const { data: imgBlob } = await supabase.storage
        .from('signatures')
        .download(sigProfile.image_path);
      if (imgBlob) {
        try {
          const imgBytes = new Uint8Array(await imgBlob.arrayBuffer());
          const pngImg = await pdfDoc.embedPng(imgBytes);
          embeddedImages.set(s.user_id, { type: 'image', image: pngImg, profile: sigProfile });
        } catch {
          embeddedImages.set(s.user_id, { type: 'typed', profile: sigProfile });
        }
      }
    } else if (sigProfile) {
      embeddedImages.set(s.user_id, { type: 'typed', profile: sigProfile });
    }
  }

  const pages = pdfDoc.getPages();

  // Render each signature field onto the exact PDF page coordinates
  for (const field of fields || []) {
    const pageIndex = Math.max(0, Math.min(pages.length - 1, field.page_number - 1));
    const page = pages[pageIndex];
    const { width: pageWidth, height: pageHeight } = page.getSize();

    const boxWidth = (field.width_percent / 100) * pageWidth;
    const boxHeight = (field.height_percent / 100) * pageHeight;
    const boxX = (field.x_percent / 100) * pageWidth;
    // PDF coordinates originate at bottom-left
    const boxY = pageHeight - ((field.y_percent / 100) * pageHeight) - boxHeight;

    const signer = signerMap.get(field.signer_id);
    const log = signerLogMap.get(field.signer_id);
    const signerName = sanitizePdfText(signer?.user?.full_name || log?.user_name || 'Penandatangan');
    const signerTitle = sanitizePdfText(signer?.user?.job_title || log?.user_job_title || '');
    const signedAtStr = formatWib(log?.created_at || signer?.acted_at || new Date());

    // Subtle container border
    page.drawRectangle({
      x: boxX,
      y: boxY,
      width: boxWidth,
      height: boxHeight,
      borderColor: rgb(0.09, 0.33, 0.81),
      borderWidth: 0.6,
      color: rgb(0.98, 0.99, 1),
      opacity: 0.92,
    });

    const sigAsset = signer ? embeddedImages.get(signer.user_id) : null;
    const labelHeight = Math.min(28, boxHeight * 0.36);
    const imageAreaHeight = Math.max(12, boxHeight - labelHeight - 6);

    if (sigAsset?.type === 'image' && sigAsset.image) {
      const dims = sigAsset.image.scaleToFit(Math.max(10, boxWidth - 8), imageAreaHeight);
      page.drawImage(sigAsset.image, {
        x: boxX + (boxWidth - dims.width) / 2,
        y: boxY + labelHeight + (imageAreaHeight - dims.height) / 2 + 2,
        width: dims.width,
        height: dims.height,
      });
    } else {
      const typedName = sanitizePdfText(sigAsset?.profile?.typed_text || signerName);
      const fontSize = Math.max(8, Math.min(14, boxWidth / Math.max(6, typedName.length * 0.65)));
      page.drawText(typedName, {
        x: boxX + 6,
        y: boxY + labelHeight + imageAreaHeight / 2 - fontSize / 3,
        size: fontSize,
        font: fontItalic,
        color: rgb(0.08, 0.22, 0.44),
      });
    }

    const nameSize = Math.max(6, Math.min(8, boxWidth / 22));
    const metaSize = Math.max(5.5, nameSize - 1);

    page.drawText(signerName.slice(0, 34), {
      x: boxX + 4,
      y: boxY + metaSize * 2 + 6,
      size: nameSize,
      font: fontBold,
      color: rgb(0.08, 0.12, 0.2),
    });

    if (signerTitle) {
      page.drawText(signerTitle.slice(0, 38), {
        x: boxX + 4,
        y: boxY + metaSize + 4,
        size: metaSize,
        font: fontRegular,
        color: rgb(0.32, 0.38, 0.48),
      });
    }

    page.drawText(signedAtStr, {
      x: boxX + 4,
      y: boxY + 3,
      size: metaSize,
      font: fontRegular,
      color: rgb(0.4, 0.45, 0.55),
    });
  }

  // Verification Token & ID
  const verificationToken = doc.verification_token || crypto.randomBytes(20).toString('hex');
  const verificationId =
    doc.verification_id ||
    `LZD-VER-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  const appUrl = (process.env.APP_URL || 'https://esign.lazuardi.sch.id').replace(/\/$/, '');
  const verifyUrl = `${appUrl}/verify/${verificationToken}`;

  // Embed QR Code on the last original page if enabled
  const qrEnabled = settings?.qr_enabled !== false;
  if (qrEnabled && pages.length > 0) {
    const qrPngBuffer = await QRCode.toBuffer(verifyUrl, {
      width: 180,
      margin: 1,
      color: { dark: '#163A70', light: '#FFFFFF' },
    });
    const qrImage = await pdfDoc.embedPng(qrPngBuffer);
    const lastContentPage = pages[pages.length - 1];
    const { width: pw } = lastContentPage.getSize();
    const qrSize = 52;
    const stampW = 195;
    const stampH = 62;
    const stampX = pw - stampW - 20;
    const stampY = 16;

    lastContentPage.drawRectangle({
      x: stampX,
      y: stampY,
      width: stampW,
      height: stampH,
      color: rgb(0.97, 0.98, 1),
      borderColor: rgb(0.8, 0.85, 0.92),
      borderWidth: 0.75,
    });

    lastContentPage.drawImage(qrImage, {
      x: stampX + 5,
      y: stampY + 5,
      width: qrSize,
      height: qrSize,
    });

    lastContentPage.drawText('Electronic Signature — Internal', {
      x: stampX + qrSize + 10,
      y: stampY + 46,
      size: 6.8,
      font: fontBold,
      color: rgb(0.09, 0.23, 0.44),
    });
    lastContentPage.drawText(`ID: ${verificationId}`, {
      x: stampX + qrSize + 10,
      y: stampY + 35,
      size: 6.2,
      font: fontRegular,
      color: rgb(0.15, 0.2, 0.3),
    });
    lastContentPage.drawText(`Doc: ${sanitizePdfText(doc.document_number).slice(0, 24)}`, {
      x: stampX + qrSize + 10,
      y: stampY + 25,
      size: 6,
      font: fontRegular,
      color: rgb(0.3, 0.36, 0.45),
    });
    lastContentPage.drawText('Scan QR untuk verifikasi keaslian', {
      x: stampX + qrSize + 10,
      y: stampY + 12,
      size: 5.5,
      font: fontItalic,
      color: rgb(0.4, 0.45, 0.55),
    });
  }

  // Optional Electronic Approval History Appendix Page
  if (doc.include_history_page) {
    const histPage = pdfDoc.addPage([595.28, 841.89]); // A4
    const { width: hw, height: hh } = histPage.getSize();
    let y = hh - 50;

    histPage.drawText('LEMBAR RIWAYAT PERSETUJUAN ELEKTRONIK', {
      x: 42,
      y,
      size: 13,
      font: fontBold,
      color: rgb(0.09, 0.23, 0.44),
    });
    y -= 16;
    histPage.drawText('LAZUARDI e-SIGN · Electronic Signature — Internal (Bukan TTE Tersertifikasi)', {
      x: 42,
      y,
      size: 8.5,
      font: fontRegular,
      color: rgb(0.35, 0.42, 0.52),
    });
    y -= 18;
    histPage.drawLine({
      start: { x: 42, y },
      end: { x: hw - 42, y },
      thickness: 1,
      color: rgb(0.85, 0.88, 0.92),
    });
    y -= 20;

    const metaRows: [string, string][] = [
      ['Judul Dokumen', sanitizePdfText(doc.title)],
      ['Nomor Dokumen', sanitizePdfText(doc.document_number)],
      ['Verification ID', verificationId],
      ['Versi Dokumen', `v${doc.current_version}`],
      ['SHA-256 Dokumen Asli', version.sha256_hash],
      ['URL Verifikasi', verifyUrl],
    ];

    for (const [k, v] of metaRows) {
      histPage.drawText(k, { x: 42, y, size: 8.5, font: fontBold, color: rgb(0.25, 0.3, 0.38) });
      histPage.drawText(v.slice(0, 74), { x: 175, y, size: 8.5, font: fontRegular, color: rgb(0.1, 0.14, 0.2) });
      y -= 15;
    }

    y -= 12;
    histPage.drawText('Riwayat Tindakan Berjenjang', {
      x: 42,
      y,
      size: 10,
      font: fontBold,
      color: rgb(0.09, 0.23, 0.44),
    });
    y -= 16;

    for (const log of logs || []) {
      if (y < 70) break;
      const lineTitle = `${formatWib(log.created_at)}  |  ${sanitizePdfText(log.user_name)} (${sanitizePdfText(log.user_job_title || '-')})  —  ${log.action.toUpperCase()}`;
      histPage.drawText(lineTitle.slice(0, 96), {
        x: 42,
        y,
        size: 8.2,
        font: fontBold,
        color: rgb(0.1, 0.14, 0.2),
      });
      y -= 12;
      if (log.signature_reference_id) {
        histPage.drawText(`Ref: ${log.signature_reference_id}`, {
          x: 52,
          y,
          size: 7.5,
          font: fontRegular,
          color: rgb(0.35, 0.42, 0.52),
        });
        y -= 11;
      }
      if (log.comment) {
        histPage.drawText(`Catatan: ${sanitizePdfText(log.comment).slice(0, 88)}`, {
          x: 52,
          y,
          size: 7.5,
          font: fontItalic,
          color: rgb(0.3, 0.35, 0.42),
        });
        y -= 11;
      }
      y -= 6;
    }
  }

  // Save final PDF & compute final SHA-256 hash AFTER all signatures and QR code are embedded
  const finalBytes = await pdfDoc.save();
  const finalHash = crypto.createHash('sha256').update(finalBytes).digest('hex');
  const finalPdfPath = `${doc.id}/final-v${doc.current_version}-${verificationId}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from('documents-final')
    .upload(finalPdfPath, Buffer.from(finalBytes), {
      contentType: 'application/pdf',
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Gagal menyimpan final PDF: ${uploadError.message}`);
  }

  const completedAt = new Date().toISOString();
  const { error: updateDocError } = await supabase
    .from('documents')
    .update({
      status: 'completed',
      final_pdf_path: finalPdfPath,
      final_hash: finalHash,
      verification_id: verificationId,
      verification_token: verificationToken,
      completed_at: completedAt,
    })
    .eq('id', documentId);

  if (updateDocError) {
    throw new Error(`Gagal memperbarui status selesai dokumen: ${updateDocError.message}`);
  }

  // Log finalization in approval_logs
  await supabase.from('approval_logs').insert({
    document_id: documentId,
    version_number: doc.current_version,
    user_id: doc.created_by,
    user_name: 'Sistem LAZUARDI e-SIGN',
    user_job_title: 'Finalisasi Otomatis',
    action: 'finalized',
    comment: `Final PDF dibuat (${verificationId}).`,
    document_hash: finalHash,
  });

  // Notify creator & all signers
  const recipientIds = new Set<string>([doc.created_by]);
  for (const s of signers || []) {
    recipientIds.add(s.user_id);
  }
  const notifications = Array.from(recipientIds).map((uid) => ({
    user_id: uid,
    document_id: documentId,
    title: 'Dokumen Selesai Ditandatangani',
    message: `Seluruh tanda tangan pada dokumen "${doc.title}" (${doc.document_number}) telah selesai. Final PDF tersedia.`,
    type: 'success',
  }));
  await supabase.from('notifications').insert(notifications);

  return {
    finalPdfPath,
    finalHash,
    verificationId,
    verificationToken,
  };
}
