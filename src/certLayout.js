'use strict';
/* Tata letak sertifikat berbasis elemen (dipakai bersama desainer visual & pembuat PDF).
   Satuan: x, width, size dalam % lebar halaman; y dalam % tinggi halaman (A4 landscape).
   size = ukuran huruf (teks) atau tinggi kotak (gambar/QR), keduanya dalam % lebar halaman.
   x adalah titik jangkar: rata kiri → tepi kiri kotak, tengah → titik tengah, kanan → tepi kanan. */

const ELEMENTS = [
  { key: 'logo_tl', label: 'Logo sponsor kiri atas', kind: 'image', src: 'sponsors.tl' },
  { key: 'logo_tr', label: 'Logo sponsor kanan atas', kind: 'image', src: 'sponsors.tr' },
  { key: 'logo', label: 'Logo penyelenggara', kind: 'image', src: 'logo_image' },
  { key: 'org', label: 'Penyelenggara', kind: 'text', field: 'organizer' },
  { key: 'title', label: 'Judul sertifikat', kind: 'text', field: 'title' },
  { key: 'number', label: 'Nomor sertifikat', kind: 'text' },
  { key: 'subtitle', label: 'Kalimat pengantar', kind: 'text', field: 'subtitle' },
  { key: 'name', label: 'Nama peserta', kind: 'text' },
  { key: 'body', label: 'Teks isi', kind: 'text', field: 'body', multiline: true },
  { key: 'event', label: 'Judul kegiatan', kind: 'text', field: 'event_text' },
  { key: 'footer', label: 'Teks penutup', kind: 'text', field: 'footer', multiline: true },
  { key: 'place_date', label: 'Tempat & tanggal', kind: 'text', field: 'place' },
  { key: 'signature', label: 'Tanda tangan', kind: 'image', src: 'signature_image' },
  { key: 'signer_name', label: 'Nama penanda tangan', kind: 'text', field: 'signer_name' },
  { key: 'signer_title', label: 'Jabatan penanda tangan', kind: 'text', field: 'signer_title' },
  { key: 'qr', label: 'QR verifikasi', kind: 'qr' },
  { key: 'code', label: 'Kode verifikasi', kind: 'text' },
  { key: 'sponsor_br', label: 'Logo sponsor "Didukung oleh"', kind: 'image', src: 'sponsors.br', field: 'sponsor_label' },
];
const KEYS = ELEMENTS.map((e) => e.key);

const T = (o) => ({ show: true, size: 1.4, width: 60, x: 50, y: 50, align: 'center', color: '#3a3a3c', font: 'sans', bold: false, italic: false, upper: false, spacing: 0, line: false, ...o });

/** Tata letak bawaan tiap templat. */
function defaultLayout(template = 'classic') {
  const base = {
    logo_tl: T({ x: 6.5, y: 7.5, width: 17, size: 6.5, align: 'left' }),
    logo_tr: T({ x: 93.5, y: 7.5, width: 17, size: 6.5, align: 'right' }),
    logo: T({ x: 50, y: 8, width: 12, size: 5 }),
    org: T({ y: 16.5, width: 70, size: 1.5, bold: true, color: 'accent' }),
    title: T({ y: 21.5, width: 80, size: 5.2, bold: true, color: 'accent', upper: true, spacing: 12 }),
    number: T({ y: 30.5, width: 60, size: 1.15, color: '#6e6e73' }),
    subtitle: T({ y: 34.5, width: 60, size: 1.3, color: '#6e6e73', upper: true, spacing: 30 }),
    name: T({ y: 39.5, width: 70, size: 4.2, bold: true, color: '#1d1d1f', line: true }),
    body: T({ y: 52.5, width: 70, size: 1.65 }),
    event: T({ y: 57.5, width: 76, size: 2.4, bold: true, color: 'accent' }),
    footer: T({ y: 64, width: 76, size: 1.6 }),
    place_date: T({ y: 70.5, width: 36, size: 1.25, color: '#6e6e73' }),
    signature: T({ y: 74, width: 22, size: 6.5 }),
    signer_name: T({ y: 85.5, width: 34, size: 1.5, bold: true, color: '#1d1d1f', line: true }),
    signer_title: T({ y: 89.3, width: 34, size: 1.2, color: '#6e6e73' }),
    qr: T({ x: 6.5, y: 70, width: 10, size: 9.5, align: 'left' }),
    code: T({ x: 6.5, y: 87.5, width: 30, size: 1, align: 'left', color: '#3a3a3c' }),
    sponsor_br: T({ x: 93.5, y: 76, width: 20, size: 6.5, align: 'right', color: '#6e6e73' }),
  };
  if (template === 'modern') {
    return {
      ...base,
      logo_tl: { ...base.logo_tl, y: 4, size: 5.5 }, logo_tr: { ...base.logo_tr, y: 4, size: 5.5 },
      logo: { ...base.logo, show: false },
      title: { ...base.title, y: 5, size: 4.3, color: '#ffffff', spacing: 10 },
      org: { ...base.org, y: 13.2, color: '#ffffff' },
      number: { ...base.number, y: 24 }, subtitle: { ...base.subtitle, y: 28.5 },
      name: { ...base.name, y: 33.5 }, body: { ...base.body, y: 47 }, event: { ...base.event, y: 52 }, footer: { ...base.footer, y: 58.5 },
    };
  }
  if (template === 'elegant') {
    const serif = (o) => ({ ...o, font: 'serif' });
    return {
      ...base,
      org: serif(base.org), title: serif({ ...base.title, spacing: 16 }), subtitle: serif({ ...base.subtitle, italic: true, upper: false, spacing: 2, size: 1.6 }),
      name: serif({ ...base.name, italic: true, size: 4.6 }), body: serif({ ...base.body, size: 1.8 }), event: serif({ ...base.event, italic: true }),
      footer: serif({ ...base.footer, size: 1.75 }), signer_name: serif(base.signer_name), signer_title: serif(base.signer_title), place_date: serif(base.place_date),
      qr: { ...base.qr, x: 7.5 }, code: { ...base.code, x: 7.5 }, logo_tl: { ...base.logo_tl, x: 7.5, y: 9 }, logo_tr: { ...base.logo_tr, x: 92.5, y: 9 },
    };
  }
  if (template === 'minimal') {
    const L = (o, extra = {}) => ({ ...o, x: 11.5, align: 'left', ...extra });
    return {
      ...base,
      logo_tl: { ...base.logo_tl, x: 11.5 }, logo: L(base.logo, { show: false }),
      org: L(base.org, { y: 15 }), title: L(base.title, { y: 19.5, size: 4.6, spacing: 6 }), number: L(base.number, { y: 28 }),
      subtitle: L(base.subtitle, { y: 33, spacing: 20 }), name: L(base.name, { y: 38, width: 62 }), body: L(base.body, { y: 51, width: 62 }),
      event: L(base.event, { y: 56, width: 62 }), footer: L(base.footer, { y: 62.5, width: 62 }),
      place_date: { ...base.place_date, x: 79 }, signature: { ...base.signature, x: 79 }, signer_name: { ...base.signer_name, x: 79, width: 30 }, signer_title: { ...base.signer_title, x: 79, width: 30 },
      qr: { ...base.qr, x: 11.5, y: 68 }, code: { ...base.code, x: 11.5, y: 85.5 },
    };
  }
  return base;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const num = (v, min, max, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : d; };

/** Sanitasi tata letak tersimpan; null/kosong → null (pakai bawaan templat). */
function cleanLayout(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const k of KEYS) {
    const e = raw[k];
    if (!e || typeof e !== 'object') continue;
    const o = {};
    if (typeof e.show === 'boolean') o.show = e.show;
    if (e.size !== undefined) o.size = num(e.size, 0.3, 25, 1.4);
    if (e.width !== undefined) o.width = num(e.width, 2, 100, 60);
    if (e.x !== undefined) o.x = num(e.x, 0, 100, 50);
    if (e.y !== undefined) o.y = num(e.y, 0, 100, 50);
    if (['left', 'center', 'right'].includes(e.align)) o.align = e.align;
    if (e.color === 'accent' || (typeof e.color === 'string' && HEX_RE.test(e.color))) o.color = e.color.toLowerCase();
    if (['sans', 'serif'].includes(e.font)) o.font = e.font;
    for (const b of ['bold', 'italic', 'upper', 'line']) if (typeof e[b] === 'boolean') o[b] = e[b];
    if (e.spacing !== undefined) o.spacing = num(e.spacing, 0, 80, 0);
    out[k] = o;
  }
  return Object.keys(out).length ? out : null;
}

/** Tata letak efektif = bawaan templat ditimpa nilai tersimpan. */
function resolveLayout(cert) {
  const d = defaultLayout(cert.bg_image ? 'classic' : (cert.template || 'classic'));
  const L = cert.layout || {};
  const out = {};
  for (const k of KEYS) out[k] = { ...d[k], ...(L[k] || {}) };
  // Formulir lama: judul kegiatan sudah ada di teks isi → jangan tampilkan dua kali
  if (!(L.event && typeof L.event.show === 'boolean') && /\{\{\s*judul\s*\}\}/.test(cert.body || '')) out.event.show = false;
  return out;
}

/** Kotak elemen dalam satuan halaman: {left, top, w} (fraksi 0..1 dari lebar/tinggi). */
function boxOf(e) {
  const w = e.width / 100;
  const ax = e.x / 100;
  const left = e.align === 'center' ? ax - w / 2 : e.align === 'right' ? ax - w : ax;
  return { left, top: e.y / 100, w };
}

module.exports = { ELEMENTS, KEYS, defaultLayout, cleanLayout, resolveLayout, boxOf };
