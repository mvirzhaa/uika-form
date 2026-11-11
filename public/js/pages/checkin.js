/* Halaman absensi: peserta memindai QR di lokasi, lalu mencatat kehadiran (tanpa login, kecuali formulir mewajibkan). */
import { h, clear, icon, api, session, navbar, userMenu, applyTheme, canvasBg, currentTheme, setPageTheme, heroClass, heroStyle, loginUrl, errMsg, logo } from '../core.js';
import { setLang } from '../i18n.js';

export async function checkinPage(root, { token }, query) {
  let info;
  clear(root);
  try { info = await api('GET', `/api/public/checkin/${encodeURIComponent(token)}`); } catch {
    root.append(navbar({ right: userMenu() }), h('div', { class: 'center-screen' }, h('div', null, h('div', { class: 'big' }, '🔎'), h('h2', null, 'Tautan absensi tidak valid'), h('p', { class: 'muted' }, 'QR mungkin sudah diganti oleh penyelenggara. Pindai ulang QR terbaru.')))); return undefined;
  }
  if (!query.lang) setLang(info.language || 'id', { temporary: true });
  const shell = h('div', { class: 'fx', style: { minHeight: '100vh' } });
  setPageTheme(info.theme.mode);
  const prevBg = document.body.style.background;
  const paintTheme = () => { applyTheme(shell, info.theme); document.body.style.background = canvasBg(info.theme, currentTheme()); };
  paintTheme(); window.addEventListener('uf:themechange', paintTheme);
  const leave = () => { document.body.style.background = prevBg; document.title = 'UIKA Form'; window.removeEventListener('uf:themechange', paintTheme); setPageTheme(null); };
  document.title = `Absensi — ${info.title}`;
  const content = h('div', { class: 'canvas-in' });
  shell.append(navbar({ left: h('span', { class: 'brand' }, logo(), h('span', { class: 'hide-sm' }, 'UIKA Form')), right: userMenu() }), h('div', { class: 'canvas' }, content));
  root.append(shell);

  const hero = () => h('section', { class: heroClass(info.theme), style: heroStyle(info.theme) }, h('h1', { translate: 'no' }, info.title), h('p', null, 'Absensi kehadiran'));
  const stateCard = (emoji, title, text, extra) => { clear(content); content.append(hero(), h('div', { class: 'card', style: { textAlign: 'center', padding: '32px 20px' } }, h('div', { style: { fontSize: '44px' } }, emoji), h('h2', { style: { margin: '8px 0' } }, title), text && h('p', { class: 'muted' }, text), extra)); };

  const done = (name) => stateCard('✅', 'Kehadiran tercatat', `Terima kasih${name ? `, ${name}` : ''}. Anda sudah tercatat hadir.`);
  if (!info.enabled) { stateCard('🔒', 'Absensi belum dibuka', 'Penyelenggara belum membuka absensi untuk kegiatan ini.'); return leave; }
  if (info.already) { done(info.me?.name); return leave; }
  if (info.require_login && !info.me) { stateCard('🔐', 'Masuk diperlukan', 'Absensi kegiatan ini mewajibkan masuk dengan akun E-Portal UIKA.', h('a', { class: 'btn primary', href: loginUrl() }, 'Masuk dengan E-Portal')); return leave; }

  const me = info.me || session.user;
  const name = h('input', { class: 'in', placeholder: 'Nama lengkap', maxlength: 200, value: me?.name || '', autocomplete: 'name' });
  const email = h('input', { class: 'in', type: 'email', placeholder: 'Email', maxlength: 200, value: me?.email || '', autocomplete: 'email', disabled: !!me });
  const nim = h('input', { class: 'in', placeholder: 'NIM / NIP (jika ada)', maxlength: 60, value: me?.identifier || '' });
  const err = h('div', { class: 'small', style: { color: 'var(--danger)', minHeight: '18px' } });
  const btn = h('button', { class: 'btn primary lg', style: { width: '100%' }, onclick: async () => {
    err.textContent = ''; btn.disabled = true;
    try {
      const r = await api('POST', `/api/public/checkin/${encodeURIComponent(token)}`, { name: name.value, email: email.value, identifier: nim.value });
      done(r.name);
    } catch (e) { err.textContent = e.data?.error === 'login_required' ? 'Masuk dengan E-Portal terlebih dahulu.' : errMsg(e); btn.disabled = false; }
  } }, icon('check', 18), 'Saya hadir');
  content.append(hero(), h('div', { class: 'card col' },
    me && h('div', { class: 'pill blue', style: { alignSelf: 'flex-start' } }, icon('user', 14), 'Masuk via E-Portal'),
    h('div', null, h('label', { class: 'f' }, 'Nama'), name), h('div', null, h('label', { class: 'f' }, 'Email'), email), h('div', null, h('label', { class: 'f' }, 'NIM / NIP'), nim), err, btn,
    !me && h('a', { class: 'small', href: loginUrl() }, 'Punya akun E-Portal? Masuk'),
    info.allowlist && h('div', { class: 'tiny muted' }, 'Hanya peserta yang terdaftar yang dapat absen.')));
  return leave;
}
