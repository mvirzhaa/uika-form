/* Pembantu bersama: DOM, API, router, modal, toast, ikon, tema. Semua teks dipasang lewat textContent (aman dari XSS). */

import { getLang, switchLang, locale } from './i18n.js';

// Element.append bawaan menuliskan "null"/"false" sebagai teks. Saring nilai kosong dan ratakan larik
// agar `kondisi && elemen` aman dipakai di seluruh antarmuka.
const nativeAppend = Element.prototype.append;
Element.prototype.append = function safeAppend(...nodes) {
  return nativeAppend.apply(this, nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false));
};

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') value = v;
    else if (['checked', 'disabled', 'selected', 'hidden', 'multiple', 'readOnly'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  if (value !== undefined) el.value = value;
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const $ = (s, r = document) => r.querySelector(s);

/* ---------- ikon (garis, gaya SF Symbols) ---------- */
const ICONS = {
  plus: 'M12 5v14M5 12h14', trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6',
  copy: 'M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1', up: 'M18 15l-6-6-6 6', down: 'M6 9l6 6 6-6',
  image: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21', eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  check: 'M20 6L9 17l-5-5', x: 'M18 6L6 18M6 6l12 12', download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12', clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  award: 'M12 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM8.21 13.89L7 23l5-3 5 3-1.21-9.12', users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  share: 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM20 8v6M23 11h-6', chart: 'M12 20V10M18 20V4M6 20v-4',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6', mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  drop: 'M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z', file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  ext: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3', back: 'M19 12H5M12 19l-7-7 7-7',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 22-7z', edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z', shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  heading: 'M6 4v16M18 4v16M6 12h12', file_plus: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 18v-6M9 15h6',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3', refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z', sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42',
  half: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 2v20', table: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18', grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
  bank: 'M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3', branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', warn: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
};
export function icon(name, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'ic'); svg.setAttribute('aria-hidden', 'true');
  if (size) { svg.style.width = `${size}px`; svg.style.height = `${size}px`; }
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name] || ICONS.file);
  svg.append(p);
  return svg;
}
export const logo = () => h('span', { class: 'logo' }, icon('list'));

/* ---------- API ---------- */
export class ApiError extends Error {
  constructor(status, data) { super((data && (data.message || data.error)) || `HTTP ${status}`); this.status = status; this.data = data || {}; }
}
export async function api(method, path, body, opts = {}) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (opts.headers) Object.assign(init.headers, opts.headers);
  if (opts.raw) { init.body = opts.raw; init.headers['content-type'] = opts.contentType || 'application/octet-stream'; }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
  let r;
  try { r = await fetch(path, init); } catch { throw new ApiError(0, { message: 'Tidak dapat terhubung ke server' }); }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json().catch(() => ({})) : null;
  if (!r.ok) throw new ApiError(r.status, data);
  return data;
}

export const session = { user: null, login: {}, org: '' };
export async function loadSession() {
  try { Object.assign(session, await api('GET', '/api/me')); } catch { /* offline */ }
  return session;
}
export const loginUrl = (next = location.pathname + location.search) => `/auth/login?next=${encodeURIComponent(next)}`;

/* ---------- router ---------- */
const routes = [];
let cleanup = null;
export function route(pattern, handler) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  routes.push({ re, keys, handler });
}
export async function render() {
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* abaikan */ } cleanup = null; }
  const root = $('#app');
  const path = location.pathname;
  const query = Object.fromEntries(new URLSearchParams(location.search));
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    document.documentElement.removeAttribute('data-ff');
    clear(root);
    root.append(h('div', { class: 'spinner' }));
    window.scrollTo(0, 0);
    try { cleanup = await r.handler(root, params, query); } catch (e) { clear(root); root.append(errorScreen(e)); console.error(e); }
    return;
  }
  clear(root); root.append(h('div', { class: 'center-screen' }, h('div', null, h('h1', null, '404'), h('p', { class: 'muted' }, 'Halaman tidak ditemukan'), h('a', { class: 'btn primary', href: '/', 'data-link': '' }, 'Ke beranda'))));
}
export function navigate(path, replace = false) {
  if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path);
  return render();
}
export const link = (href, props, ...kids) => h('a', { ...props, href, 'data-link': '' }, ...kids);
export function startRouter() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-link]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });
  window.addEventListener('popstate', render);
  return render();
}
export function errorScreen(e) {
  const msg = e instanceof ApiError && e.status === 404 ? 'Halaman atau formulir tidak ditemukan, atau Anda tidak memiliki akses.' : (e.message || 'Terjadi kesalahan');
  return h('div', { class: 'center-screen' }, h('div', null, h('div', { class: 'big' }, '⚠️'), h('h2', null, 'Tidak dapat dibuka'), h('p', { class: 'muted' }, msg), h('a', { class: 'btn primary', href: '/', 'data-link': '' }, 'Ke beranda')));
}

/* ---------- toast & modal ---------- */
export function toast(msg, kind) {
  const t = h('div', { class: `toast ${kind === 'err' ? 'err' : ''}` }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 5200 : 2600);
}
export function modal({ title, body, actions = [], onClose, wide }) {
  const scrim = h('div', { class: 'scrim' });
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', style: wide ? { width: 'min(760px,100%)' } : {} },
    title && h('h2', null, title), body,
    actions.length > 0 && h('div', { class: 'actions' }, actions.map((a) => h('button', {
      class: `btn ${a.kind || ''}`, onclick: async (ev) => {
        if (a.onClick) { const keep = await a.onClick(ev, close); if (keep === false) return; }
        if (!a.keepOpen) close();
      },
    }, a.label))));
  scrim.append(sheet);
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(scrim);
  return { close, sheet };
}
export function confirmDialog(title, text, okLabel = 'Ya', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title, body: h('p', { class: 'muted', style: { margin: 0 } }, text),
      actions: [
        { label: 'Batal', onClick: () => { done = true; resolve(false); } },
        { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: () => { done = true; resolve(true); } },
      ],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

/* ---------- utilitas ---------- */
export const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); d.flush = (...a) => { clearTimeout(t); return fn(...a); }; return d; };
export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }) : '—');
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(locale(), { dateStyle: 'long', timeZone: 'Asia/Jakarta' }) : '—');
export const fmtMMSS = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); const hh = Math.floor(s / 3600); const mm = Math.floor((s % 3600) / 60); const ss = s % 60; return `${hh ? `${hh}:` : ''}${String(mm).padStart(hh ? 2 : 1, '0')}:${String(ss).padStart(2, '0')}`; };
export const fmtDur = (min) => (min >= 60 ? `${Math.floor(min / 60)} jam${min % 60 ? ` ${min % 60} menit` : ''}` : `${min} menit`);
export const num = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString(locale(), { maximumFractionDigits: 2 }));
export const fillUrl = (slug) => `${location.origin}/f/${slug}`;
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Tautan disalin'); } catch {
    const t = h('textarea', { style: { position: 'fixed', opacity: 0 } }); t.value = text; document.body.append(t); t.select();
    try { document.execCommand('copy'); toast('Tautan disalin'); } catch { toast('Salin manual: ' + text); } t.remove();
  }
}
export const errMsg = (e) => (e instanceof ApiError ? e.message : (e && e.message) || 'Terjadi kesalahan');

/* Terapkan tema formulir ke elemen akar kanvas */
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16); const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function applyTheme(el, theme) {
  el.style.setProperty('--accent', theme.color);
  el.style.setProperty('--canvas-bg', theme.bg);
  el.style.setProperty('--on-accent', luminance(theme.color) > 0.6 ? '#1d1d1f' : '#ffffff');
  el.classList.remove('ff-serif', 'ff-rounded', 'ff-mono');
  if (theme.font && theme.font !== 'system') el.classList.add(`ff-${theme.font}`);
}
export function heroClass(theme) {
  const light = luminance(theme.color) > 0.6 && theme.header_style !== 'image';
  return `hero ${theme.header_style === 'image' && theme.header_image ? 'image' : theme.header_style === 'solid' ? '' : 'gradient'}${light ? ' light-on' : ''}`;
}
export const heroStyle = (theme) => (theme.header_style === 'image' && theme.header_image ? { backgroundImage: `url(/uploads/${theme.header_image})`, color: '#fff' } : {});

/* Muat Chart.js sekali saja (disajikan dari server sendiri) */
let chartPromise = null;
export function loadChart() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (!chartPromise) {
    chartPromise = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = '/vendor/chart.js'; s.onload = () => res(window.Chart); s.onerror = () => rej(new Error('Chart.js gagal dimuat')); document.head.append(s);
    });
  }
  return chartPromise;
}
export const PALETTE = ['#0a84ff', '#30d158', '#ff9f0a', '#ff453a', '#bf5af2', '#64d2ff', '#ffd60a', '#ff375f', '#5e5ce6', '#8e8e93'];

/* Bilah navigasi seragam */
export function navbar({ left, center, right } = {}) {
  return h('header', { class: 'nav' },
    left || link('/', { class: 'brand' }, logo(), h('span', { class: 'hide-sm' }, 'UIKA Form')),
    center ? h('div', { class: 'grow row', style: { justifyContent: 'center', minWidth: 0 } }, center) : h('div', { class: 'grow' }),
    h('div', { class: 'row' }, right, prefButtons()));
}
/* ---------- tema terang/gelap & bahasa ---------- */
const THEME_KEY = 'uf:theme';
export const getThemePref = () => { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; } };
export function applyThemePref() {
  const p = getThemePref();
  if (p === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', p);
}
export function themeButton() {
  const p = getThemePref();
  const next = { auto: 'light', light: 'dark', dark: 'auto' }[p];
  const label = { auto: 'Tema: otomatis', light: 'Tema: terang', dark: 'Tema: gelap' }[p];
  return h('button', {
    class: 'btn icon ghost', 'data-themebtn': '', title: label, 'aria-label': label,
    onclick: () => { try { localStorage.setItem(THEME_KEY, next); } catch { /* abaikan */ } applyThemePref(); document.querySelectorAll('[data-themebtn]').forEach((el) => el.replaceWith(themeButton())); },
  }, icon({ auto: 'half', light: 'sun', dark: 'moon' }[p]));
}
export function langButton() {
  const l = getLang();
  return h('button', { class: 'btn icon ghost langsw', translate: 'no', title: l === 'id' ? 'Switch to English' : 'Ganti ke Bahasa Indonesia', 'aria-label': 'Language', onclick: () => switchLang(l === 'id' ? 'en' : 'id') }, l === 'id' ? 'EN' : 'ID');
}
export const prefButtons = () => h('div', { class: 'iconbtn-nav' }, langButton(), themeButton());
applyThemePref();

export function userMenu() {
  const u = session.user;
  if (!u) return h('a', { class: 'btn primary sm', href: loginUrl() }, 'Masuk');
  return h('div', { class: 'row' },
    session.user.role !== 'user' && link('/lists', { class: 'btn sm ghost hide-sm' }, 'Daftar pilihan'),
    session.user.role !== 'user' && link('/banks', { class: 'btn sm ghost hide-sm' }, 'Bank soal'),
    session.user.role === 'admin' && link('/admin', { class: 'btn sm ghost hide-sm' }, 'Admin'),
    h('span', { class: 'small muted hide-sm', title: u.email }, u.name || u.email),
    h('button', { class: 'btn icon', title: 'Keluar', onclick: async () => { await api('POST', '/auth/logout'); session.user = null; location.href = '/'; } }, icon('logout')));
}
