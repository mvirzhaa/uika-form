/* Desain sertifikat visual: pratinjau A4 dengan elemen yang bisa diklik & digeser, panel properti di kanan.
   Satuan mengikuti src/certLayout.js: x/width/size = % lebar halaman, y = % tinggi halaman. */
import { h, clear, icon, api, toast, confirmDialog, errMsg } from '../core.js';

const PW = 841.89; const PH = 595.28;
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const FONT_FAMILY = { sans: 'Helvetica, Arial, "Liberation Sans", sans-serif', serif: '"Times New Roman", Times, "Liberation Serif", serif' };
const LINE_H = { sans: 1.156, serif: 1.116 }; // tinggi baris font PDF bawaan
const OFFSET = { sans: 0.2065, serif: 0.2125 }; // selisih garis dasar browser vs PDF (em)

let META = null;
const loadMeta = async () => { if (!META) META = await api('GET', '/api/public/cert-layout'); return META; };

export function sampleNumber(fmt, start) {
  if (!fmt) return '';
  const d = new Date();
  return fmt.replace(/\{\{\s*(no(?::(\d))?|bulan|bulan_angka|tahun)\s*\}\}/g, (_, k, pad) => {
    if (k.startsWith('no')) return String(start || 1).padStart(Number(pad) || 3, '0');
    if (k === 'bulan') return ROMAN[d.getMonth() + 1];
    if (k === 'bulan_angka') return String(d.getMonth() + 1).padStart(2, '0');
    return String(d.getFullYear());
  });
}
const fillT = (t, v) => String(t || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (v[k] !== undefined ? v[k] : ''));

/** Bingkai templat sebagai SVG (koordinat sama dengan drawFrame di server). */
function frameSvg(template, accent) {
  const s = [];
  if (template === 'classic') {
    s.push(`<rect x="22" y="22" width="${PW - 44}" height="${PH - 44}" fill="none" stroke="${accent}" stroke-width="3"/>`,
      `<rect x="32" y="32" width="${PW - 64}" height="${PH - 64}" fill="none" stroke="${accent}" stroke-width=".8" opacity=".6"/>`,
      `<polygon points="22,22 150,22 22,150" fill="${accent}" opacity=".12"/>`, `<polygon points="${PW - 22},${PH - 22} ${PW - 150},${PH - 22} ${PW - 22},${PH - 150}" fill="${accent}" opacity=".12"/>`);
  } else if (template === 'modern') {
    s.push(`<rect x="0" y="0" width="${PW}" height="122" fill="${accent}"/>`, `<rect x="0" y="${PH - 26}" width="${PW}" height="26" fill="${accent}" opacity=".1"/>`);
  } else if (template === 'elegant') {
    s.push(`<rect x="26" y="26" width="${PW - 52}" height="${PH - 52}" fill="none" stroke="${accent}" stroke-width="1.6"/>`,
      `<rect x="36" y="36" width="${PW - 72}" height="${PH - 72}" fill="none" stroke="${accent}" stroke-width=".6"/>`);
    for (const [x, y] of [[36, 36], [PW - 36, 36], [36, PH - 36], [PW - 36, PH - 36]]) s.push(`<rect x="${x - 5}" y="${y - 5}" width="10" height="10" fill="${accent}" transform="rotate(45 ${x} ${y})"/>`);
    s.push(`<line x1="${PW / 2 - 120}" y1="98" x2="${PW / 2 + 120}" y2="98" stroke="${accent}" stroke-width=".8"/>`, `<rect x="${PW / 2 - 4}" y="94" width="8" height="8" fill="${accent}" transform="rotate(45 ${PW / 2} 98)"/>`);
  } else {
    s.push(`<rect x="0" y="0" width="14" height="${PH}" fill="${accent}"/>`, `<line x1="96" y1="${PH - 52}" x2="${PW - 56}" y2="${PH - 52}" stroke="#d2d2d7" stroke-width=".6"/>`);
  }
  return `<svg class="cd-frame" viewBox="0 0 ${PW} ${PH}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${s.join('')}</svg>`;
}

const getPath = (o, p) => p.split('.').reduce((a, k) => (a ? a[k] : undefined), o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((a, k) => (a[k] = a[k] || {}), o); t[last] = v; };

export async function openCertDesigner(c, { onClose } = {}) {
  let M;
  try { M = await loadMeta(); } catch (e) { toast(errMsg(e), 'err'); return; }
  const form = c.form; const C = form.cert;
  const ELS = M.elements; const byKey = Object.fromEntries(ELS.map((e) => [e.key, e]));
  let sel = 'name';

  const resolved = () => {
    const d = M.defaults[C.bg_image ? 'classic' : (C.template || 'classic')];
    const L = C.layout || {};
    const out = {};
    for (const { key } of ELS) out[key] = { ...d[key], ...(L[key] || {}) };
    if (!(L.event && typeof L.event.show === 'boolean') && /\{\{\s*judul\s*\}\}/.test(C.body || '')) out.event.show = false;
    return out;
  };
  let lay = resolved();
  const setProp = (key, prop, val, { side = false } = {}) => {
    C.layout = C.layout || {};
    C.layout[key] = { ...lay[key], [prop]: val };
    lay = resolved(); c.touch(); paintPage(); if (side) paintSide();
  };

  const vars = () => ({
    nama: 'Nama Peserta Contoh', judul: form.title || 'Judul Kegiatan', nilai: '100', kode: 'UIKA-ABCD-1234-XY', nomor: sampleNumber(C.number_format, C.number_start),
    tanggal: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }),
  });
  const textOf = (key, v) => ({
    org: C.organizer, title: C.title, subtitle: C.subtitle, name: v.nama, number: v.nomor ? `Nomor: ${v.nomor}` : '',
    body: fillT(C.body, v), event: fillT(C.event_text, v), footer: fillT(C.footer, v), place_date: C.place ? `${C.place}, ${v.tanggal}` : v.tanggal,
    signer_name: C.signer_name, signer_title: C.signer_title, code: v.kode,
  }[key] || '');
  const PLACEHOLDER = { number: 'Nomor: (atur format nomor)', signer_name: 'Nama penanda tangan', signer_title: 'Jabatan penanda tangan', footer: 'Teks penutup', org: 'Penyelenggara' };

  /* ---------- kerangka ---------- */
  const page = h('div', { class: 'cd-page', translate: 'no' });
  const side = h('div', { class: 'cd-side' });
  const scrim = h('div', { class: 'scrim cd-scrim' });
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape' && !e.target.closest?.('input, textarea')) close(); };
  scrim.append(h('div', { class: 'cd', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Desain sertifikat' },
    h('div', { class: 'cd-head' }, h('h2', null, 'Desain sertifikat'), h('span', { class: 'tiny muted grow hide-sm' }, 'Klik elemen untuk memilih, geser untuk memindahkan.'),
      h('button', { class: 'btn icon ghost', title: 'Tutup', 'aria-label': 'Tutup', onclick: close }, icon('x', 22))),
    h('div', { class: 'cd-body' }, h('div', { class: 'cd-stage' }, page), side)));
  document.body.append(scrim);
  document.addEventListener('keydown', onKey);

  /* ---------- pratinjau halaman ---------- */
  function paintPage() {
    clear(page);
    page.style.background = C.bg_image ? `${C.bg_color || '#fff'} url(/uploads/${C.bg_image}) center/100% 100% no-repeat` : (C.bg_color || '#ffffff');
    page.style.setProperty('--cd-accent', C.accent || '#0071e3');
    if (!C.bg_image) page.insertAdjacentHTML('beforeend', frameSvg(C.template || 'classic', C.accent || '#0071e3'));
    const v = vars();
    for (const meta of ELS) {
      const e = lay[meta.key];
      if (!e.show && sel !== meta.key) continue;
      page.append(nodeFor(meta, e, v));
    }
  }

  function nodeFor(meta, e, v) {
    const key = meta.key;
    const color = e.color === 'accent' ? (C.accent || '#0071e3') : (e.color || '#1d1d1f');
    const el = h('div', { class: `cd-el k-${key} ${sel === key ? 'sel' : ''} ${e.show ? '' : 'off'}`, 'data-key': key, title: meta.label });
    const w = meta.kind === 'qr' ? e.size : e.width;
    const left = e.align === 'center' ? e.x - w / 2 : e.align === 'right' ? e.x - w : e.x;
    Object.assign(el.style, { left: `${left}%`, width: `${w}%` });
    if (meta.kind === 'image') {
      el.style.top = `${e.y}%`; el.style.height = `${e.size}cqw`;
      const id = getPath(C, meta.src);
      if (key === 'sponsor_br' && C.sponsor_label) el.append(h('div', { class: 'cd-label', style: { textAlign: e.align, color } }, C.sponsor_label.toUpperCase()));
      el.append(id ? h('img', { src: `/uploads/${id}`, alt: '', draggable: false, style: { objectPosition: `${e.align} center` } }) : h('div', { class: 'cd-ph', style: { justifyContent: { left: 'flex-start', right: 'flex-end', center: 'center' }[e.align] } }, h('span', null, meta.label.replace(/^Logo sponsor "Didukung oleh"$/, 'Logo sponsor'))));
      return el;
    }
    if (meta.kind === 'qr') {
      el.style.top = `${e.y}%`; el.style.height = `${e.size}cqw`; el.classList.add('cd-qr');
      el.append(h('img', { src: `/api/forms/${form.id}/qr?kind=form&format=svg`, alt: 'QR', draggable: false }));
      return el;
    }
    const font = e.font === 'serif' ? 'serif' : 'sans';
    Object.assign(el.style, {
      top: `calc(${e.y}% - ${OFFSET[font]}em)`, fontSize: `${e.size}cqw`, lineHeight: String(LINE_H[font]), fontFamily: FONT_FAMILY[font],
      fontWeight: e.bold ? '700' : '400', fontStyle: e.italic ? 'italic' : 'normal', textTransform: e.upper ? 'uppercase' : 'none',
      letterSpacing: `${(e.spacing || 0) / 100}em`, textAlign: e.align, color,
    });
    let text = textOf(key, v);
    if (key === 'code') { el.append(h('div', null, e.upper ? 'KODE VERIFIKASI:' : 'Kode verifikasi:'), h('div', { style: { fontWeight: 700 } }, text)); return el; }
    if (!text) { text = PLACEHOLDER[key] || meta.label; el.classList.add('cd-empty'); }
    el.append(text);
    if (key === 'name') el.style.whiteSpace = 'nowrap';
    if (e.line) el.classList.add(key === 'signer_name' ? 'line-above' : 'line-below');
    return el;
  }

  /* geser elemen */
  page.addEventListener('pointerdown', (ev) => {
    const el = ev.target.closest('.cd-el');
    if (!el) return;
    ev.preventDefault();
    const key = el.dataset.key;
    if (sel !== key) { sel = key; paintPage(); paintSide(); }
    const node = page.querySelector(`.cd-el[data-key="${key}"]`);
    const r = page.getBoundingClientRect();
    const sx = ev.clientX; const sy = ev.clientY; const e0 = { ...lay[key] };
    let moved = false;
    node.setPointerCapture?.(ev.pointerId);
    const move = (m) => {
      const dx = ((m.clientX - sx) / r.width) * 100; const dy = ((m.clientY - sy) / r.height) * 100;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 0.4) return;
      moved = true;
      const nx = Math.round(Math.min(100, Math.max(0, e0.x + dx)) * 10) / 10; const ny = Math.round(Math.min(100, Math.max(0, e0.y + dy)) * 10) / 10;
      lay[key] = { ...lay[key], x: nx, y: ny };
      const meta = byKey[key];
      const w = meta.kind === 'qr' ? lay[key].size : lay[key].width;
      const left = lay[key].align === 'center' ? nx - w / 2 : lay[key].align === 'right' ? nx - w : nx;
      node.style.left = `${left}%`;
      node.style.top = meta.kind === 'text' ? `calc(${ny}% - ${OFFSET[lay[key].font === 'serif' ? 'serif' : 'sans']}em)` : `${ny}%`;
      sliders.x?.(nx); sliders.y?.(ny);
    };
    const up = () => {
      node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', up);
      if (moved) { C.layout = C.layout || {}; C.layout[key] = { ...lay[key] }; lay = resolved(); c.touch(); }
    };
    node.addEventListener('pointermove', move); node.addEventListener('pointerup', up); node.addEventListener('pointercancel', up);
  });
  // geser halus dengan tombol panah
  scrim.addEventListener('keydown', (ev) => {
    if (ev.target.closest('input, textarea, select') || !sel) return;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
    if (!d) return;
    ev.preventDefault();
    const step = ev.shiftKey ? 2 : 0.5;
    const e = lay[sel];
    C.layout = C.layout || {};
    C.layout[sel] = { ...e, x: Math.min(100, Math.max(0, e.x + d[0] * step)), y: Math.min(100, Math.max(0, e.y + d[1] * step)) };
    lay = resolved(); c.touch(); paintPage(); paintSide();
  });

  /* ---------- panel kanan ---------- */
  let sliders = {};
  function slider(label, key, prop, min, max, step, unit = '') {
    const val = h('span', { class: 'cd-val' });
    const inp = h('input', { type: 'range', min, max, step, value: lay[key][prop], 'aria-label': label });
    const show = (x) => { val.textContent = `${Math.round(x * 10) / 10}${unit}`; };
    show(lay[key][prop]);
    inp.addEventListener('input', () => { const x = Number(inp.value); show(x); setProp(key, prop, x); });
    sliders[prop] = (x) => { inp.value = x; show(x); };
    return h('div', { class: 'cd-row' }, h('span', { class: 'cd-lbl' }, label), inp, val);
  }
  const seg = (opts, cur, on) => h('div', { class: 'seg cd-seg' }, opts.map(([v, l]) => h('button', { class: cur === v ? 'on' : '', type: 'button', onclick: () => on(v) }, l)));
  const check = (label, on, cb) => h('label', { class: 'cd-check' }, h('input', { type: 'checkbox', checked: on, onchange: (e) => cb(e.target.checked) }), h('span', null, label));

  function paintSide() {
    clear(side); sliders = {};
    // templat & warna
    side.append(h('div', { class: 'cd-card' },
      h('div', { class: 'cd-row' }, h('span', { class: 'cd-lbl' }, 'Templat'),
        h('select', { class: 'in cd-sel', onchange: async (ev) => {
          const t = ev.target.value;
          if (C.layout && !await confirmDialog('Ganti templat?', 'Posisi & ukuran elemen dikembalikan ke bawaan templat baru.', 'Ganti')) { ev.target.value = C.template; return; }
          C.template = t; C.layout = null; lay = resolved(); c.touch(); paintPage(); paintSide();
        } }, [['classic', 'Klasik'], ['modern', 'Modern'], ['elegant', 'Elegan'], ['minimal', 'Minimalis']].map(([v, l]) => h('option', { value: v, selected: C.template === v }, l)))),
      h('div', { class: 'cd-row' }, h('span', { class: 'cd-lbl' }, 'Warna aksen'), h('input', { type: 'color', class: 'cd-color', value: C.accent || '#0071e3', oninput: (e) => { C.accent = e.target.value; c.touch(); paintPage(); } }),
        h('span', { class: 'cd-lbl', style: { marginLeft: '10px' } }, 'Latar'), h('input', { type: 'color', class: 'cd-color', value: C.bg_color || '#ffffff', oninput: (e) => { C.bg_color = e.target.value; c.touch(); paintPage(); } })),
      C.bg_image && h('div', { class: 'tiny muted' }, 'Gambar latar aktif: bingkai templat tidak digambar.')));

    // daftar elemen
    side.append(h('div', { class: 'cd-list' }, ELS.map((m) => h('div', { class: `cd-item ${sel === m.key ? 'on' : ''} ${lay[m.key].show ? '' : 'off'}`, onclick: () => { sel = m.key; paintPage(); paintSide(); } },
      h('span', { class: 'grow' }, m.label),
      h('button', { class: 'btn icon ghost', type: 'button', title: lay[m.key].show ? 'Sembunyikan' : 'Tampilkan', onclick: (ev) => { ev.stopPropagation(); setProp(m.key, 'show', !lay[m.key].show, { side: true }); } }, icon(lay[m.key].show ? 'eye' : 'eyeoff', 16))))));

    // properti elemen terpilih
    const m = byKey[sel]; const e = lay[sel];
    const card = h('div', { class: 'cd-card' }, h('h3', null, m.label), check('Tampilkan di sertifikat', e.show, (v) => setProp(sel, 'show', v, { side: true })));
    if (m.kind === 'text' && m.field) {
      const input = m.multiline
        ? h('textarea', { class: 'in', rows: 2, maxlength: m.key === 'body' ? 600 : 400, value: C[m.field] || '', oninput: (ev) => { C[m.field] = ev.target.value; lay = resolved(); c.touch(); paintPage(); } })
        : h('input', { class: 'in', maxlength: 200, value: C[m.field] || '', placeholder: m.key === 'place_date' ? 'Kota (mis. Bogor)' : '', oninput: (ev) => { C[m.field] = ev.target.value; lay = resolved(); c.touch(); paintPage(); } });
      card.append(h('label', { class: 'f' }, m.key === 'place_date' ? 'Tempat (tanggal terisi otomatis)' : 'Teks'), input);
      if (['body', 'event', 'footer'].includes(m.key)) {
        card.append(h('div', { class: 'row wrap', style: { gap: '4px', marginTop: '4px' } }, ['{{nama}}', '{{judul}}', '{{tanggal}}', '{{nilai}}', '{{nomor}}'].map((t) => h('button', { class: 'chipbtn', type: 'button', onclick: () => { C[m.field] = `${C[m.field] || ''}${C[m.field] ? ' ' : ''}${t}`; input.value = C[m.field]; lay = resolved(); c.touch(); paintPage(); } }, t))));
      }
    } else if (m.key === 'name') card.append(h('div', { class: 'tiny muted' }, 'Diisi nama peserta. Nama yang panjang otomatis diperkecil agar muat satu baris.'));
    else if (m.key === 'number') card.append(h('div', { class: 'tiny muted' }, C.number_format ? `Format: ${C.number_format}` : 'Atur format nomor di kartu “Templat & nomor sertifikat”.'));
    else if (m.key === 'code' || m.key === 'qr') card.append(h('div', { class: 'tiny muted' }, 'Kode unik per peserta; QR mengarah ke halaman verifikasi.'));
    if (m.kind === 'image') {
      card.append(c.imageSlot(m.label, 'PNG/JPG, latar transparan lebih rapi', getPath(C, m.src), (nid) => { setPath(C, m.src, nid || null); c.touch(); paintPage(); }));
      if (m.field) card.append(h('label', { class: 'f', style: { marginTop: '8px' } }, 'Label di atas logo'), h('input', { class: 'in', maxlength: 60, value: C[m.field] || '', oninput: (ev) => { C[m.field] = ev.target.value; c.touch(); paintPage(); } }));
    }
    card.append(
      m.kind === 'text' ? slider('Ukuran huruf', sel, 'size', 0.5, 10, 0.1) : slider(m.kind === 'qr' ? 'Ukuran' : 'Tinggi', sel, 'size', 2, 25, 0.5),
      m.kind !== 'qr' && slider('Lebar area', sel, 'width', 5, 100, 1, '%'),
      slider('Posisi X', sel, 'x', 0, 100, 0.5), slider('Posisi Y', sel, 'y', 0, 100, 0.5),
      h('div', { class: 'cd-row' }, h('span', { class: 'cd-lbl' }, 'Rata'), seg([['left', 'Kiri'], ['center', 'Tengah'], ['right', 'Kanan']], e.align, (v) => setProp(sel, 'align', v, { side: true }))));
    if (m.kind === 'text') {
      const isAccent = e.color === 'accent';
      card.append(
        h('div', { class: 'cd-row' }, h('span', { class: 'cd-lbl' }, 'Warna'),
          h('button', { class: `btn sm ${isAccent ? 'primary' : ''}`, type: 'button', onclick: () => setProp(sel, 'color', 'accent', { side: true }) }, 'Aksen'),
          h('input', { type: 'color', class: 'cd-color', value: isAccent ? (C.accent || '#0071e3') : (e.color || '#1d1d1f'), onchange: (ev) => setProp(sel, 'color', ev.target.value, { side: true }) })),
        h('div', { class: 'cd-row' }, h('span', { class: 'cd-lbl' }, 'Huruf'), seg([['sans', 'Sans'], ['serif', 'Serif']], e.font, (v) => setProp(sel, 'font', v, { side: true }))),
        h('div', { class: 'cd-row wrap' }, check('Tebal', e.bold, (v) => setProp(sel, 'bold', v)), check('Miring', e.italic, (v) => setProp(sel, 'italic', v)), check('Kapital', e.upper, (v) => setProp(sel, 'upper', v)),
          ['name', 'signer_name'].includes(sel) && check(sel === 'name' ? 'Garis bawah' : 'Garis tanda tangan', e.line, (v) => setProp(sel, 'line', v))),
        slider('Spasi huruf', sel, 'spacing', 0, 60, 1));
    }
    side.append(card);

    side.append(h('div', { class: 'cd-foot' },
      h('button', { class: 'btn sm', type: 'button', onclick: async () => { if (!C.layout) { toast('Tata letak sudah bawaan templat'); return; } if (!await confirmDialog('Atur ulang tata letak?', 'Semua posisi & ukuran elemen kembali ke bawaan templat.', 'Atur ulang')) return; C.layout = null; lay = resolved(); c.touch(); paintPage(); paintSide(); } }, icon('refresh', 14), 'Atur ulang'),
      h('button', { class: 'btn sm', type: 'button', onclick: async () => { await c.flush(); window.open(`/api/forms/${form.id}/certificate-preview.pdf?t=${Date.now()}`, '_blank', 'noopener'); } }, icon('eye', 14), 'Pratinjau PDF'),
      h('span', { class: 'spacer' }), h('button', { class: 'btn sm primary', type: 'button', onclick: close }, 'Selesai')));
  }

  paintPage(); paintSide();
}
