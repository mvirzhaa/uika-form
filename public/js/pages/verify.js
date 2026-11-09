import { h, clear, icon, api, navbar, userMenu, fmtDate, navigate, errMsg } from '../core.js';

export async function verifyPage(root, params) {
  clear(root);
  root.append(navbar({ right: userMenu() }));
  const page = h('main', { class: 'page narrow' });
  root.append(page);

  const input = h('input', { class: 'in', placeholder: 'UIKA-XXXX-XXXX-XX', value: params.code || '', style: { textTransform: 'uppercase', letterSpacing: '.06em' }, 'aria-label': 'Kode sertifikat' });
  const result = h('div', { style: { marginTop: '18px' } });
  const go = (e) => { e.preventDefault(); const c = input.value.trim().toUpperCase(); if (c) navigate(`/verify/${encodeURIComponent(c)}`); };
  page.append(h('h1', { style: { fontSize: '32px', marginBottom: '6px' } }, 'Verifikasi sertifikat'),
    h('p', { class: 'muted' }, 'Pindai QR pada sertifikat atau masukkan kode verifikasinya.'),
    h('form', { class: 'row', onsubmit: go }, input, h('button', { class: 'btn primary' }, 'Periksa')), result);

  if (!params.code) return undefined;
  result.append(h('div', { class: 'spinner' }));
  try {
    const v = await api('GET', `/api/public/verify/${encodeURIComponent(params.code)}`);
    clear(result);
    if (v.valid) {
      result.append(h('div', { class: 'card', style: { textAlign: 'center', padding: '32px 20px' } },
        h('div', { class: 'check-anim' }, icon('check')),
        h('h2', null, 'Sertifikat sah'),
        h('p', { class: 'muted' }, 'Sertifikat ini diterbitkan oleh sistem dan tercatat.'),
        h('div', { style: { textAlign: 'left', maxWidth: '420px', margin: '18px auto 0' }, class: 'col' },
          row('Nama', v.name), row('Kegiatan', v.title), row('Penyelenggara', v.organizer), row('Tanggal terbit', fmtDate(v.issued_at)), row('Kode', v.code))));
    } else {
      result.append(h('div', { class: 'card', style: { textAlign: 'center', padding: '32px 20px' } },
        h('div', { class: 'check-anim', style: { background: 'var(--danger)' } }, icon('x')),
        h('h2', null, 'Kode tidak ditemukan'), h('p', { class: 'muted' }, 'Periksa kembali penulisan kode. Sertifikat yang tidak terdaftar tidak dapat dianggap sah.')));
    }
  } catch (e) { clear(result); result.append(h('p', { class: 'muted' }, errMsg(e))); }
  return undefined;
}
const row = (k, v) => h('div', { class: 'row', style: { alignItems: 'flex-start' } }, h('span', { class: 'muted small', style: { width: '110px', flex: 'none' } }, k), h('b', { style: { wordBreak: 'break-word' } }, v));
