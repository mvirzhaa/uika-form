'use strict';
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const crypto = require('crypto');
const config = require('./config');
const { q, tx } = require('./db');
const schema = require('./schema');

const W = 841.89; // A4 landscape (pt)
const H = 595.28;

/** Kode sertifikat mudah dibaca: UIKA-XXXX-XXXX-XX (tanpa karakter ambigu). */
function newCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (n) => Array.from(crypto.randomBytes(n), (b) => a[b % a.length]).join('');
  return `UIKA-${pick(4)}-${pick(4)}-${pick(2)}`;
}

// Font bawaan PDF hanya mendukung Latin-1; ganti karakter lain agar tidak rusak
const latin = (s) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/[^ -~ -ÿ‘’“”–—]/g, '?');

function fmtDate(d) {
  return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
}

function fillTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : ''));
}

async function loadImage(id) {
  if (!id) return null;
  const r = await q('SELECT data, mime FROM uploads WHERE id=$1', [id]);
  return r.rowCount ? r.rows[0].data : null;
}

/** Gambar dalam kotak (tanpa mendistorsi) dengan perataan. */
function fitImage(doc, buf, x, y, w, h, align = 'center') {
  if (!buf) return;
  try {
    doc.image(buf, x, y, { fit: [w, h], align, valign: 'center' });
  } catch { /* gambar rusak: lewati */ }
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** Format nomor sertifikat: {{no}} / {{no:4}} (urut), {{bulan}} (romawi), {{bulan_angka}}, {{tahun}}. */
function formatNumber(fmt, seq, date) {
  if (!fmt) return '';
  const d = new Date(new Date(date).toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  return String(fmt).replace(/\{\{\s*(no(?::(\d))?|bulan|bulan_angka|tahun)\s*\}\}/g, (_, k, pad) => {
    if (k.startsWith('no')) return String(seq).padStart(Number(pad) || 3, '0');
    if (k === 'bulan') return ROMAN[d.getMonth() + 1];
    if (k === 'bulan_angka') return String(d.getMonth() + 1).padStart(2, '0');
    return String(d.getFullYear());
  });
}

/** Tata letak tiap template (koordinat dalam pt, halaman A4 landscape). */
function layoutFor(template, hasBg) {
  const base = {
    align: 'center', x: 150, w: W - 300, cx: W / 2, nameX: 60, nameW: W - 120,
    title: { y: 118, size: 40, color: 'accent', font: 'Helvetica-Bold', spacing: 6 },
    org: { y: 168, color: '#6e6e73' }, num: { y: 184 }, sub: { y: 205 },
    name: { y: 232, font: 'Times-BoldItalic', size: 40 }, line: { y: 288, x1: W / 2 - 200, x2: W / 2 + 200 },
    body: { y: 305, font: 'Helvetica', size: 15 },
  };
  if (hasBg || template === 'classic') return base;
  if (template === 'modern') {
    return { ...base, title: { y: 40, size: 34, color: '#ffffff', font: 'Helvetica-Bold', spacing: 5 }, org: { y: 88, color: '#ffffff' }, num: { y: 140 },
      sub: { y: 166 }, name: { y: 192, font: 'Helvetica-Bold', size: 38 }, line: { y: 246, x1: W / 2 - 200, x2: W / 2 + 200 }, body: { y: 264, font: 'Helvetica', size: 15 } };
  }
  if (template === 'elegant') {
    return { ...base, title: { y: 112, size: 38, color: 'accent', font: 'Times-Bold', spacing: 8 }, org: { y: 164, color: '#6e6e73' }, num: { y: 182 },
      name: { y: 232, font: 'Times-Italic', size: 44 }, body: { y: 305, font: 'Times-Roman', size: 16 } };
  }
  // minimal: rata kiri
  return { ...base, align: 'left', x: 96, w: W - 260, cx: W - 230, nameX: 96, nameW: W - 220,
    title: { y: 110, size: 34, color: 'accent', font: 'Helvetica-Bold', spacing: 4 }, org: { y: 154, color: '#6e6e73' }, num: { y: 172 }, sub: { y: 205 },
    name: { y: 230, font: 'Helvetica-Bold', size: 36 }, line: { y: 284, x1: 96, x2: 96 + 320 }, body: { y: 300, font: 'Helvetica', size: 15 } };
}

function drawFrame(doc, template, accent) {
  if (template === 'classic') {
    doc.save().lineWidth(3).strokeColor(accent).rect(22, 22, W - 44, H - 44).stroke().restore();
    doc.save().lineWidth(0.8).strokeColor(accent).opacity(0.6).rect(32, 32, W - 64, H - 64).stroke().restore();
    doc.save().fillColor(accent).opacity(0.12);
    doc.polygon([22, 22], [150, 22], [22, 150]).fill();
    doc.polygon([W - 22, H - 22], [W - 150, H - 22], [W - 22, H - 150]).fill();
    doc.restore();
  } else if (template === 'modern') {
    doc.save().fillColor(accent).rect(0, 0, W, 122).fill().restore();
    doc.save().fillColor(accent).opacity(0.1).rect(0, H - 26, W, 26).fill().restore();
  } else if (template === 'elegant') {
    doc.save().lineWidth(1.6).strokeColor(accent).rect(26, 26, W - 52, H - 52).stroke().restore();
    doc.save().lineWidth(0.6).strokeColor(accent).rect(36, 36, W - 72, H - 72).stroke().restore();
    for (const [x, y] of [[36, 36], [W - 36, 36], [36, H - 36], [W - 36, H - 36]]) {
      doc.save().fillColor(accent).translate(x, y).rotate(45).rect(-5, -5, 10, 10).fill().restore();
    }
    doc.save().lineWidth(0.8).strokeColor(accent).moveTo(W / 2 - 120, 98).lineTo(W / 2 + 120, 98).stroke().restore();
    doc.save().fillColor(accent).translate(W / 2, 98).rotate(45).rect(-4, -4, 8, 8).fill().restore();
  } else { // minimal
    doc.save().fillColor(accent).rect(0, 0, 14, H).fill().restore();
    doc.save().lineWidth(0.6).strokeColor('#d2d2d7').moveTo(96, H - 52).lineTo(W - 56, H - 52).stroke().restore();
  }
}

/**
 * Buat PDF sertifikat.
 * @param {object} p {cert, formTitle, name, date, score, code, number}
 */
async function renderCertificate({ cert, formTitle, name, date, score, code, number }) {
  const verifyUrl = `${config.BASE_URL}/verify/${encodeURIComponent(code)}`;
  const [bg, sig, tl, tr, br, qr] = await Promise.all([
    loadImage(cert.bg_image), loadImage(cert.signature_image),
    loadImage(cert.sponsors?.tl), loadImage(cert.sponsors?.tr), loadImage(cert.sponsors?.br),
    QRCode.toBuffer(verifyUrl, { margin: 1, width: 300, errorCorrectionLevel: 'M' }),
  ]);
  const accent = cert.accent || '#0071e3';
  const template = cert.template || 'classic';
  const L = layoutFor(template, !!bg);

  const doc = new PDFDocument({ size: [W, H], margin: 0, info: { Title: `Sertifikat ${name}`, Author: config.ORG_NAME, Subject: formTitle } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res, rej) => { doc.on('end', () => res(Buffer.concat(chunks))); doc.on('error', rej); });

  // Latar
  doc.rect(0, 0, W, H).fill(cert.bg_color || '#ffffff');
  if (bg) {
    try { doc.image(bg, 0, 0, { width: W, height: H }); } catch { /* gambar latar rusak: abaikan */ }
  } else drawFrame(doc, template, accent);

  // Sponsor: kiri atas, kanan atas, kanan bawah
  const BOX_W = 130; const BOX_H = 64;
  const modern = template === 'modern' && !bg;
  fitImage(doc, tl, modern ? 40 : 56, modern ? 28 : 48, BOX_W, modern ? 66 : BOX_H, 'left');
  fitImage(doc, tr, W - (modern ? 40 : 56) - BOX_W, modern ? 28 : 48, BOX_W, modern ? 66 : BOX_H, 'right');
  fitImage(doc, br, W - 56 - BOX_W, H - 48 - BOX_H, BOX_W, BOX_H, 'right');

  const col = (c) => (c === 'accent' ? accent : c);
  // Judul
  doc.fillColor(col(L.title.color)).font(L.title.font).fontSize(L.title.size);
  const titleBox = modern ? { x: 180, w: W - 360 } : { x: L.align === 'left' ? L.x : 0, w: L.align === 'left' ? L.w : W };
  doc.text(latin(cert.title || 'SERTIFIKAT').toUpperCase(), titleBox.x, L.title.y, { width: titleBox.w, align: L.align, characterSpacing: L.title.spacing });
  if (cert.organizer) {
    doc.fillColor(col(L.org.color)).font('Helvetica').fontSize(11);
    doc.text(latin(cert.organizer).toUpperCase(), titleBox.x, L.org.y, { width: titleBox.w, align: L.align, characterSpacing: 2 });
  }
  if (number) {
    doc.fillColor('#6e6e73').font('Helvetica').fontSize(10);
    doc.text(`Nomor: ${latin(number)}`, L.align === 'left' ? L.x : 0, L.num.y, { width: L.align === 'left' ? L.w : W, align: L.align });
  }
  doc.fillColor('#3a3a3c').font('Helvetica').fontSize(14);
  doc.text(latin(cert.subtitle || 'Diberikan kepada'), L.align === 'left' ? L.x : 0, L.sub.y, { width: L.align === 'left' ? L.w : W, align: L.align });

  // Nama (kecilkan bila panjang)
  const nm = latin(name);
  let size = L.name.size;
  doc.font(L.name.font);
  while (size > 18 && doc.fontSize(size).widthOfString(nm) > L.nameW - 40) size -= 2;
  doc.fillColor('#1d1d1f').fontSize(size).text(nm, L.nameX, L.name.y, { width: L.nameW, align: L.align, lineBreak: false });
  doc.save().lineWidth(1).strokeColor(accent).moveTo(L.line.x1, L.line.y).lineTo(L.line.x2, L.line.y).stroke().restore();

  // Isi
  const body = latin(fillTemplate(cert.body, {
    nama: name, judul: formTitle, tanggal: fmtDate(date), nilai: score !== null && score !== undefined ? String(score) : '', kode: code, nomor: number || '',
  }));
  doc.fillColor('#3a3a3c').font(L.body.font).fontSize(L.body.size);
  doc.text(body, L.x, L.body.y, { width: L.w, align: L.align, lineGap: 4 });

  // Penandatangan
  const cx = L.cx;
  if (sig) fitImage(doc, sig, cx - 70, H - 178, 140, 56, 'center');
  doc.save().lineWidth(0.8).strokeColor('#8e8e93').moveTo(cx - 100, H - 118).lineTo(cx + 100, H - 118).stroke().restore();
  doc.fillColor('#1d1d1f').font('Helvetica-Bold').fontSize(12);
  doc.text(latin(cert.signer_name || ''), cx - 150, H - 112, { width: 300, align: 'center' });
  doc.fillColor('#6e6e73').font('Helvetica').fontSize(10);
  doc.text(latin(cert.signer_title || ''), cx - 150, H - 96, { width: 300, align: 'center' });
  doc.fillColor('#6e6e73').fontSize(10).text(`Bogor, ${fmtDate(date)}`, cx - 150, H - 72, { width: 300, align: 'center' });

  // QR verifikasi (kiri bawah)
  const qs = 84;
  const qx = template === 'minimal' && !bg ? 60 : 52;
  doc.save().roundedRect(qx, H - 52 - qs - 18, qs + 12, qs + 30, 8).fill('#ffffff').restore();
  doc.image(qr, qx + 6, H - 52 - qs - 12, { width: qs });
  doc.fillColor('#1d1d1f').font('Helvetica-Bold').fontSize(7.5).text(code, qx, H - 52 - 8, { width: qs + 12, align: 'center' });
  doc.fillColor('#6e6e73').font('Helvetica').fontSize(7).text('Pindai untuk verifikasi', qx, H - 52 + 2, { width: qs + 12, align: 'center' });

  doc.end();
  return { pdf: await done, verifyUrl };
}

/** Terbitkan sertifikat bila memenuhi syarat; idempoten. Mengembalikan kode atau null. */
async function ensureCertificate(form, resp) {
  const settings = schema.cleanSettings(form.settings);
  const cert = schema.cleanCert(form.cert, settings);
  if (!cert.enabled || !resp.graded || resp.status === 'in_progress') return null;
  if (resp.cert_code) return resp.cert_code;
  if (settings.is_quiz) {
    const pct = resp.max_score > 0 ? (Number(resp.score) / Number(resp.max_score)) * 100 : 100;
    if (pct + 1e-9 < (cert.min_percent ?? 0)) return null;
  }
  if (settings.attendance.enabled && settings.attendance.require_for_cert) {
    const c = await q('SELECT 1 FROM checkins WHERE form_id=$1 AND (lower(email)=lower($2) OR ($3::uuid IS NOT NULL AND user_id=$3::uuid)) LIMIT 1', [form.id, resp.email || '', resp.user_id || null]);
    if (!c.rowCount) return null;
  }
  const name = (resp.name || '').trim() || String(resp.email || '').split('@')[0] || 'Peserta';
  for (let i = 0; i < 5; i += 1) {
    const code = newCode();
    const made = await tx(async (c) => {
      const ex = await c.query('SELECT code FROM certificates WHERE response_id=$1', [resp.id]);
      if (ex.rowCount) return ex.rows[0].code;
      await c.query('SELECT 1 FROM forms WHERE id=$1 FOR UPDATE', [form.id]); // serialkan penomoran
      const again = await c.query('SELECT code FROM certificates WHERE response_id=$1', [resp.id]);
      if (again.rowCount) return again.rows[0].code;
      let seq = null; let number = '';
      if (cert.number_format) {
        const n = (await c.query('UPDATE forms SET cert_seq=cert_seq+1 WHERE id=$1 RETURNING cert_seq', [form.id])).rows[0].cert_seq;
        seq = n + (cert.number_start || 1) - 1;
        number = formatNumber(cert.number_format, seq, new Date());
      }
      const ins = await c.query(
        'INSERT INTO certificates (code, response_id, form_id, name, email, number, seq) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING code',
        [code, resp.id, form.id, name, resp.email || '', number, seq],
      );
      if (!ins.rowCount) return null; // kode bentrok: ulangi (transaksi dibatalkan agar nomor tidak terpakai)
      await c.query('UPDATE responses SET cert_code=$1 WHERE id=$2', [code, resp.id]);
      return code;
    });
    if (made) return made;
  }
  return null;
}

module.exports = { renderCertificate, ensureCertificate, newCode, fmtDate, formatNumber };
