'use strict';
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const crypto = require('crypto');
const config = require('./config');
const { q, tx } = require('./db');
const schema = require('./schema');
const { ELEMENTS, resolveLayout, boxOf } = require('./certLayout');

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

const FONTS = {
  sans: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  serif: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
};
const fontOf = (e) => FONTS[e.font === 'serif' ? 'serif' : 'sans'][(e.bold ? 1 : 0) + (e.italic ? 2 : 0)];

/** Teks tiap elemen (kosong → tidak digambar). */
function elementTexts(cert, v) {
  const fill = (t) => fillTemplate(t, v);
  return {
    org: cert.organizer || '', title: cert.title || '', subtitle: cert.subtitle || '', name: v.nama,
    number: v.nomor ? `Nomor: ${v.nomor}` : '', body: fill(cert.body), event: fill(cert.event_text), footer: fill(cert.footer),
    place_date: cert.place ? `${cert.place}, ${v.tanggal}` : v.tanggal, signer_name: cert.signer_name || '', signer_title: cert.signer_title || '',
    code: v.kode,
  };
}

/**
 * Buat PDF sertifikat sesuai tata letak elemen (lihat certLayout.js).
 * @param {object} p {cert, formTitle, name, date, score, code, number}
 */
async function renderCertificate({ cert, formTitle, name, date, score, code, number }) {
  const verifyUrl = `${config.BASE_URL}/verify/${encodeURIComponent(code)}`;
  const [bg, sig, tl, tr, br, logo, qr] = await Promise.all([
    loadImage(cert.bg_image), loadImage(cert.signature_image),
    loadImage(cert.sponsors?.tl), loadImage(cert.sponsors?.tr), loadImage(cert.sponsors?.br), loadImage(cert.logo_image),
    QRCode.toBuffer(verifyUrl, { margin: 1, width: 300, errorCorrectionLevel: 'M' }),
  ]);
  const accent = cert.accent || '#0071e3';
  const template = cert.template || 'classic';
  const L = resolveLayout(cert);
  const vars = { nama: name, judul: formTitle, tanggal: fmtDate(date), nilai: score !== null && score !== undefined ? String(score) : '', kode: code, nomor: number || '' };
  const texts = elementTexts(cert, vars);
  const images = { logo_tl: tl, logo_tr: tr, logo, signature: sig, sponsor_br: br };

  const doc = new PDFDocument({ size: [W, H], margin: 0, info: { Title: `Sertifikat ${name}`, Author: config.ORG_NAME, Subject: formTitle } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res, rej) => { doc.on('end', () => res(Buffer.concat(chunks))); doc.on('error', rej); });

  doc.rect(0, 0, W, H).fill(cert.bg_color || '#ffffff');
  if (bg) {
    try { doc.image(bg, 0, 0, { width: W, height: H }); } catch { /* gambar latar rusak: abaikan */ }
  } else drawFrame(doc, template, accent);

  const col = (c) => (c === 'accent' ? accent : c || '#1d1d1f');
  for (const { key, kind } of ELEMENTS) {
    const e = L[key];
    if (!e || !e.show) continue;
    const b = boxOf(e);
    const left = b.left * W; const top = b.top * H; const w = b.w * W;
    const fs = (e.size / 100) * W;
    if (kind === 'image') {
      const img = images[key];
      if (!img) continue;
      if (key === 'sponsor_br' && cert.sponsor_label) {
        const lf = 0.0095 * W;
        doc.fillColor(col(e.color)).font('Helvetica-Bold').fontSize(lf)
          .text(latin(cert.sponsor_label).toUpperCase(), left, top - lf * 1.9, { width: w, align: e.align, characterSpacing: lf * 0.2, lineBreak: false });
      }
      fitImage(doc, img, left, top, w, fs, e.align);
      continue;
    }
    if (kind === 'qr') {
      const ax = (e.x / 100) * W;
      const qx = e.align === 'center' ? ax - fs / 2 : e.align === 'right' ? ax - fs : ax;
      doc.save().roundedRect(qx - 4, top - 4, fs + 8, fs + 8, 6).fill('#ffffff').restore();
      doc.image(qr, qx, top, { width: fs, height: fs });
      continue;
    }
    let text = texts[key];
    if (!text) continue;
    text = latin(text);
    if (e.upper) text = text.toUpperCase();
    const spacing = (e.spacing / 100) * fs;
    doc.fillColor(col(e.color));
    if (key === 'code') {
      doc.font(FONTS[e.font === 'serif' ? 'serif' : 'sans'][0]).fontSize(fs).text(e.upper ? 'KODE VERIFIKASI:' : 'Kode verifikasi:', left, top, { width: w, align: e.align, lineBreak: false });
      doc.font(FONTS[e.font === 'serif' ? 'serif' : 'sans'][1]).fontSize(fs).text(text, left, top + fs * 1.156, { width: w, align: e.align, lineBreak: false, characterSpacing: spacing });
      continue;
    }
    let size = fs;
    doc.font(fontOf(e));
    if (key === 'name') { // satu baris; kecilkan bila terlalu panjang
      while (size > fs * 0.45 && doc.fontSize(size).widthOfString(text, { characterSpacing: (e.spacing / 100) * size }) > w * 0.96) size *= 0.94;
      doc.fontSize(size).text(text, left, top + (fs - size) * 0.6, { width: w, align: e.align, lineBreak: false, characterSpacing: (e.spacing / 100) * size });
    } else {
      doc.fontSize(size).text(text, left, top, { width: w, align: e.align, characterSpacing: spacing });
    }
    if (e.line) {
      const ly = key === 'signer_name' ? top - fs * 0.35 : top + fs * 1.25;
      doc.save().lineWidth(key === 'signer_name' ? 0.8 : 1).strokeColor(key === 'signer_name' ? '#8e8e93' : accent)
        .moveTo(left + w * 0.04, ly).lineTo(left + w * 0.96, ly).stroke().restore();
    }
  }

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
