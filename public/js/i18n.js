/* Bahasa antarmuka (Indonesia / Inggris). Teks sumber berbahasa Indonesia; terjemahan Inggris
   diterapkan pada simpul teks & atribut lewat kamus (i18n-en.js). Elemen/leluhur dengan
   translate="no" (konten buatan pengguna: judul form, pertanyaan, jawaban) tidak diterjemahkan. */
import { EN, PATTERNS } from './i18n-en.js';

let lang = 'id';
let explicit = false;
try { const v = localStorage.getItem('uf:lang'); if (v === 'en' || v === 'id') { lang = v; explicit = true; } } catch { /* abaikan */ }
document.documentElement.lang = lang;

export const getLang = () => lang;
export const locale = () => (lang === 'en' ? 'en-GB' : 'id-ID');

export function setLang(l, { temporary = false } = {}) {
  if (l !== 'id' && l !== 'en') return;
  if (temporary && explicit) return; // pilihan eksplisit pengguna menang atas bahasa form
  lang = l; document.documentElement.lang = l;
  if (!temporary) { explicit = true; try { localStorage.setItem('uf:lang', l); } catch { /* abaikan */ } }
  start();
}
/** Ganti bahasa lalu muat ulang halaman agar semua teks dibangun ulang. */
export function switchLang(l) { try { localStorage.setItem('uf:lang', l); } catch { /* abaikan */ } location.reload(); }

const cache = new Map();
export function t(s) {
  if (lang !== 'en' || !s) return s;
  const raw = String(s);
  const core = raw.trim();
  if (!core) return raw;
  let out = cache.get(core);
  if (out === undefined) {
    out = EN[core];
    if (out === undefined) for (const [re, fn] of PATTERNS) { const m = core.match(re); if (m) { out = fn(...m.slice(1)); break; } }
    if (out === undefined) out = core;
    if (cache.size > 4000) cache.clear();
    cache.set(core, out);
  }
  if (out === core) return raw;
  const lead = raw.match(/^\s*/)[0]; const trail = raw.match(/\s*$/)[0];
  return lead + out + trail;
}

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const skip = (el) => !el || el.closest?.('[translate="no"], script, style, textarea, code, pre');

function walk(node) {
  if (node.nodeType === 3) {
    const p = node.parentElement;
    if (p && !skip(p)) { const v = t(node.nodeValue); if (v !== node.nodeValue) node.nodeValue = v; }
    return;
  }
  if (node.nodeType !== 1 || skip(node)) return;
  for (const a of ATTRS) { const v = node.getAttribute(a); if (v) { const tv = t(v); if (tv !== v) node.setAttribute(a, tv); } }
  if (node.tagName === 'OPTION' || (node.tagName === 'INPUT' && ['button', 'submit'].includes(node.type))) { /* teks opsi ditangani simpul teks */ }
  for (const c of node.childNodes) walk(c);
}

let observer = null;
export function start() {
  if (lang !== 'en') { if (observer) { observer.disconnect(); observer = null; } return; }
  if (observer) { walk(document.body); return; }
  observer = new MutationObserver((muts) => {
    observer.disconnect();
    try {
      for (const m of muts) {
        if (m.type === 'childList') m.addedNodes.forEach((n) => walk(n));
        else if (m.type === 'characterData') walk(m.target);
        else if (m.type === 'attributes') walk(m.target);
      }
    } finally { observer.observe(document.body, OPTS); }
  });
  const OPTS = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS };
  walk(document.body);
  observer.observe(document.body, OPTS);
}
if (document.readyState !== 'loading') start(); else document.addEventListener('DOMContentLoaded', start);
