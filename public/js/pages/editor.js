/* MODE EDITOR — hanya untuk pembuat formulir dan email yang ia daftarkan (dijaga di server). */
import { h, clear, icon, api, ApiError, session, navbar, userMenu, link, navigate, toast, modal, confirmDialog, debounce, uuid, applyTheme, heroClass, heroStyle,
  loginUrl, copyText, fillUrl, errMsg, fmtDateTime, num, logo } from '../core.js';
import { responsesTab } from './results.js';
import { editListDialog } from './lists.js';
import * as P from './editor-parts.js';

const TYPES = [
  ['short', 'Jawaban singkat'], ['paragraph', 'Paragraf / esai'], ['radio', 'Pilihan ganda'], ['checkbox', 'Kotak centang'],
  ['dropdown', 'Dropdown'], ['scale', 'Skala linear'], ['grid', 'Kisi (baris × kolom)'], ['ranking', 'Peringkat (urutkan)'], ['file', 'Unggah berkas'],
  ['date', 'Tanggal'], ['time', 'Waktu'], ['section', 'Judul bagian'],
];
const CHOICE = ['radio', 'checkbox', 'dropdown'];
const WITH_OPTIONS = ['radio', 'checkbox', 'dropdown', 'ranking'];
const GRADABLE = ['radio', 'checkbox', 'dropdown', 'short', 'scale', 'paragraph', 'file'];
const MANUAL = ['paragraph', 'file'];
const ACCENTS = ['#0071e3', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#5ac8fa', '#ff2d55', '#5856d6', '#00a699', '#1d1d1f'];
const BGS = ['#f2f2f7', '#e8f1ff', '#e9f8ee', '#fff4e5', '#fdeceb', '#f3e8ff', '#e5f7fb', '#fdeaf1', '#f5f0e6', '#e5e5ea'];

export async function editorPage(root, { id }, query) {
  if (!session.user) {
    clear(root); root.append(navbar({ right: userMenu() }), h('div', { class: 'center-screen' }, h('div', null, h('h2', null, 'Masuk untuk membuka Editor'), h('p', { class: 'muted' }, 'Editor hanya untuk pembuat formulir dan email yang didaftarkan.'), h('a', { class: 'btn primary', href: loginUrl() }, 'Masuk')))); return undefined;
  }
  let form = await api('GET', `/api/forms/${id}`); // 404 bila bukan pemilik/editor terdaftar
  let base = form.updated_at;
  let tab = ['questions', 'theme', 'settings', 'cert', 'responses'].includes(query.tab) ? query.tab : 'questions';
  let activeId = null;
  let focusNext = null;
  let destroyTab = null;

  /* ---------- simpan otomatis ---------- */
  const stateEl = h('span', { class: 'savestate' }, h('i', { class: 'dot' }), 'Tersimpan');
  const setState = (k, msg) => { clear(stateEl); stateEl.append(h('i', { class: `dot ${k === 'busy' || k === 'dirty' ? 'busy' : k === 'err' ? 'err' : ''}` }), k === 'busy' ? 'Menyimpan…' : k === 'dirty' ? 'Belum tersimpan' : k === 'err' ? (msg || 'Gagal menyimpan') : 'Tersimpan'); };
  let chain = Promise.resolve();
  async function doSave(force) {
    setState('busy');
    try {
      const r = await api('PUT', `/api/forms/${form.id}`, {
        title: form.title, description: form.description, status: form.status, theme: form.theme, settings: form.settings, cert: form.cert,
        questions: form.questions, base_updated_at: base, force: force || undefined,
      });
      base = r.updated_at; form.settings = r.settings; form.cert = r.cert; form.slug = r.slug;
      setState('ok');
    } catch (e) {
      if (e.status === 409 && e.data.error === 'conflict') { setState('err', 'Konflik'); conflict(e.data.form); return; }
      setState('err', e.message);
      if (e.data?.error === 'no_questions') { form.status = 'draft'; renderTop(); }
      toast(errMsg(e), 'err');
    }
  }
  const save = (force) => { chain = chain.then(() => doSave(force)); return chain; };
  const scheduleSave = debounce(() => save(), 700);
  const touch = () => { setState('dirty'); scheduleSave(); };
  const flush = () => { scheduleSave.cancel(); return save(); };

  function conflict(latest) {
    modal({
      title: 'Formulir diubah editor lain', body: h('p', { class: 'muted' }, 'Ada perubahan baru yang belum Anda lihat. Muat versi terbaru (perubahan Anda yang belum tersimpan hilang), atau timpa dengan versi Anda.'),
      actions: [
        { label: 'Timpa dengan versi saya', kind: 'danger', onClick: () => { save(true); } },
        { label: 'Muat versi terbaru', kind: 'primary', onClick: () => { form = { ...form, ...latest }; base = latest.updated_at; renderAll(); setState('ok'); } },
      ],
    });
  }

  /* ---------- kerangka ---------- */
  const shell = h('div', { class: 'fx', style: { minHeight: '100vh' } });
  const topEl = h('div'); const tabsEl = h('div', { class: 'tabs-wrap' }); const body = h('div', { class: 'canvas-in' });
  const canvas = h('div', { class: 'canvas' }, body);
  shell.append(topEl, tabsEl, canvas);
  clear(root); root.append(shell);
  const prevBg = document.body.style.background;

  const refreshTheme = () => { applyTheme(shell, form.theme); document.body.style.background = form.theme.bg; };
  const statusPill = () => ({ draft: h('span', { class: 'pill' }, 'Draf'), published: h('span', { class: 'pill ok' }, 'Dibuka'), closed: h('span', { class: 'pill bad' }, 'Ditutup') }[form.status]);

  function renderTop() {
    clear(topEl);
    const titleIn = h('input', { class: 'title-input', value: form.title, 'aria-label': 'Judul formulir', maxlength: 200, oninput: (e) => { form.title = e.target.value; touch(); } });
    const mode = h('div', { class: 'seg mode', role: 'tablist', 'aria-label': 'Mode' },
      h('button', { class: 'on', role: 'tab', 'aria-selected': 'true' }, icon('edit', 16), 'Editor'),
      h('button', { role: 'tab', title: 'Lihat seperti peserta', onclick: async () => { await flush(); navigate(`/f/${form.slug}?preview=1`); } }, icon('eye', 16), 'Pengisian'));
    const publishBtn = form.status === 'published'
      ? h('button', { class: 'btn sm', onclick: async () => { form.status = 'closed'; renderTop(); touch(); toast('Formulir ditutup'); } }, 'Tutup')
      : h('button', { class: 'btn sm primary', onclick: async () => { form.status = 'published'; renderTop(); await flush(); if (form.status === 'published') shareModal(true); } }, 'Terbitkan');
    topEl.append(navbar({
      left: h('div', { class: 'row', style: { minWidth: 0, flex: '0 1 320px' } }, link('/', { class: 'btn icon ghost', title: 'Ke daftar formulir' }, icon('back')), titleIn),
      center: mode,
      right: [stateEl, statusPill(), h('button', { class: 'btn sm hide-sm', onclick: () => shareModal(false) }, icon('share', 16), 'Bagikan'), publishBtn, userMenu()],
    }));
  }

  function renderTabs() {
    clear(tabsEl);
    const t = (k, label, ic) => h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; history.replaceState({}, '', `?tab=${k}`); renderTabs(); renderBody(); } }, icon(ic, 16), label);
    tabsEl.append(h('div', { class: 'seg' }, t('questions', 'Pertanyaan', 'list'), t('theme', 'Tampilan', 'drop'), t('settings', 'Pengaturan', 'sliders'), t('cert', 'Sertifikat', 'award'),
      t('responses', `Respons${form.response_count ? ` (${form.response_count})` : ''}`, 'chart')));
  }

  function renderBody() {
    if (destroyTab) { destroyTab(); destroyTab = null; }
    clear(body);
    document.querySelectorAll('.addbar').forEach((n) => n.remove());
    ({ questions: questionsTab, theme: themeTab, settings: settingsTab, cert: certTab, responses: respTab }[tab])();
    refreshTheme();
  }
  function renderAll() { renderTop(); renderTabs(); renderBody(); }

  /* ---------- helper komponen ---------- */
  const toggle = (checked, onChange) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }), h('i'));
  const setting = (title, desc, control) => h('div', { class: 'setting' }, h('div', { class: 't' }, h('b', null, title), desc && h('span', null, desc)), control);
  const sel = (value, opts, onChange, props) => h('select', { class: 'in', style: { width: 'auto', ...(props || {}) }, value, onchange: (e) => onChange(e.target.value) }, opts.map(([v, l]) => h('option', { value: v }, l)));
  const colorRow = (current, presets, onPick) => h('div', { class: 'swatches' }, presets.map((c) => h('button', { class: `sw ${current.toLowerCase() === c ? 'on' : ''}`, style: { background: c }, title: c, onclick: () => onPick(c) })),
    h('input', { type: 'color', value: current, title: 'Warna kustom', oninput: (e) => onPick(e.target.value, true) }));
  const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

  async function uploadImage(accept = 'image/png,image/jpeg') {
    return new Promise((resolve) => {
      const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
      inp.addEventListener('change', async () => {
        const f = inp.files[0]; inp.remove();
        if (!f) return resolve(null);
        if (!['image/png', 'image/jpeg'].includes(f.type)) { toast('Gunakan gambar PNG atau JPG', 'err'); return resolve(null); }
        if (f.size > 5 * 1024 * 1024) { toast('Ukuran gambar maksimal 5 MB', 'err'); return resolve(null); }
        try { const r = await api('POST', '/api/uploads', undefined, { raw: await f.arrayBuffer(), contentType: f.type }); resolve(r.id); } catch (e) { toast(errMsg(e), 'err'); resolve(null); }
      });
      inp.addEventListener('cancel', () => resolve(null));
      document.body.append(inp); inp.click();
    });
  }
  const imageSlot = (label, hint, id, onSet) => {
    const holder = h('div', { class: 'drop' });
    const paint = () => {
      clear(holder);
      holder.append(id ? h('img', { src: `/uploads/${id}`, alt: label }) : h('div', { class: 'none' }, icon('image')),
        h('div', { class: 'grow' }, h('b', { class: 'small' }, label), hint && h('div', { class: 'tiny muted' }, hint)),
        h('button', { class: 'btn sm', onclick: async () => { const nid = await uploadImage(); if (nid) { id = nid; onSet(nid); paint(); } } }, icon('upload', 16), id ? 'Ganti' : 'Unggah'),
        id && h('button', { class: 'btn sm icon ghost', title: 'Hapus', onclick: () => { id = null; onSet(null); paint(); } }, icon('x', 16)));
    };
    paint();
    return holder;
  };

  const ctx = { get form() { return form; }, touch, flush, toggle, setting, sel, imageSlot };

  /* ================= TAB PERTANYAAN ================= */
  function newQuestion(type) {
    const quiz = form.settings.is_quiz;
    const q = { id: uuid(), type, title: '', description: '', required: false, options: [], correct: [], points: 0, config: {} };
    if (WITH_OPTIONS.includes(type)) q.options = type === 'ranking' ? [{ id: optId(), text: 'Opsi 1' }, { id: optId(), text: 'Opsi 2' }] : [{ id: optId(), text: 'Opsi 1' }];
    if (type === 'scale') q.config = { min: 1, max: 5, min_label: '', max_label: '' };
    if (type === 'grid') q.config = { rows: [{ id: `r${Math.random().toString(36).slice(2, 7)}`, text: 'Baris 1' }], cols: [{ id: `c${Math.random().toString(36).slice(2, 7)}`, text: 'Kolom 1' }, { id: `c${Math.random().toString(36).slice(2, 7)}`, text: 'Kolom 2' }], multi: false };
    if (type === 'file') q.config = { accept: 'any', max_mb: 5 };
    if (quiz && GRADABLE.includes(type)) q.points = MANUAL.includes(type) ? 20 : 10;
    return q;
  }
  const optId = () => `o${Math.random().toString(36).slice(2, 8)}`;

  function changeType(q, type) {
    q.type = type;
    if (type !== 'dropdown') delete q.config.list_id;
    const keep = { image: q.config.image, always: q.config.always, show_if: q.config.show_if, list_id: q.config.list_id };
    if (CHOICE.includes(type)) { if (!q.options.length) q.options = [{ id: optId(), text: 'Opsi 1' }]; q.correct = q.correct.filter((c) => q.options.some((o) => o.id === c)); if (type !== 'checkbox') q.correct = q.correct.slice(0, 1); } else if (type === 'ranking') { if (q.options.length < 2) q.options = [...q.options, ...Array.from({ length: 2 - q.options.length }, (_, i) => ({ id: optId(), text: `Opsi ${q.options.length + i + 1}` }))]; q.correct = []; } else if (type !== 'short') { if (type !== 'scale') q.options = []; q.correct = []; }
    if (type === 'short') q.correct = [];
    if (type === 'scale') { q.options = []; q.correct = []; q.config = { min: 1, max: 5, min_label: '', max_label: '' }; }
    if (type === 'grid') { q.options = []; q.correct = []; q.config = { rows: [{ id: `r${Math.random().toString(36).slice(2, 7)}`, text: 'Baris 1' }], cols: [{ id: `c${Math.random().toString(36).slice(2, 7)}`, text: 'Kolom 1' }, { id: `c${Math.random().toString(36).slice(2, 7)}`, text: 'Kolom 2' }], multi: false }; }
    if (type === 'file') { q.options = []; q.correct = []; q.config = { accept: 'any', max_mb: 5 }; }
    if (!['scale', 'grid', 'file'].includes(type)) { const old = q.config; q.config = {}; if (type === 'dropdown' && old.list_id) q.config.list_id = old.list_id; if (type === 'checkbox' && old.partial) q.config.partial = true; }
    for (const [k, v] of Object.entries(keep)) { if (v && k !== 'list_id') q.config[k] = v; }
    if (type === 'section') { q.required = false; q.points = 0; delete q.config.image; delete q.config.always; }
    if (form.settings.is_quiz && GRADABLE.includes(type) && !q.points) q.points = MANUAL.includes(type) ? 20 : 10;
    if (!GRADABLE.includes(type)) q.points = 0;
  }

  let listEl;
  function questionsTab() {
    const heroEl = h('section', { class: `${heroClass(form.theme)} hero-edit`, style: heroStyle(form.theme) },
      h('input', { value: form.title, placeholder: 'Judul formulir', maxlength: 200, oninput: (e) => { form.title = e.target.value; const ti = topEl.querySelector('.title-input'); if (ti) ti.value = form.title; touch(); } }),
      h('textarea', { placeholder: 'Deskripsi formulir (opsional)', maxlength: 8000, rows: 2, value: form.description, oninput: (e) => { form.description = e.target.value; touch(); } }),
      form.settings.is_quiz && h('div', { class: 'chips' }, h('span', { class: 'chip' }, icon('clock', 14), form.settings.duration_min ? `${form.settings.duration_min} menit` : 'Tanpa batas waktu'),
        h('span', { class: 'chip' }, `${num(form.questions.reduce((a, x) => a + (x.points || 0), 0))} poin`)));
    listEl = h('div');
    body.append(heroEl, listEl);
    renderList();
    body.append(h('div', { class: 'card', style: { marginTop: '18px' } }, h('div', { class: 'row wrap' }, icon('file'), h('div', { class: 'grow' }, h('b', null, 'Impor soal dari Excel'), h('div', { class: 'small muted' }, 'Unduh template, isi pertanyaan & pilihan jawaban, lalu unggah kembali.')),
      h('button', { class: 'btn', onclick: importModal }, icon('upload', 16), 'Impor Excel')),
    h('div', { class: 'row wrap', style: { marginTop: '14px', paddingTop: '14px', borderTop: '.5px solid var(--line)' } }, icon('bank'), h('div', { class: 'grow' }, h('b', null, 'Bank soal'), h('div', { class: 'small muted' }, 'Simpan soal untuk dipakai ulang, atau ambil soal (semua / acak) dari bank pribadi & global.')),
      h('button', { class: 'btn', onclick: () => P.pickFromBank(ctx, () => { activeId = null; renderList(); renderTabs(); }) }, icon('download', 16), 'Ambil dari bank'),
      h('button', { class: 'btn', onclick: () => P.saveToBank(ctx) }, icon('upload', 16), 'Simpan ke bank'))));
    const bar = h('div', { class: 'addbar fx', role: 'toolbar', 'aria-label': 'Tambah' },
      h('button', { class: 'btn icon', title: 'Tambah pertanyaan', onclick: () => addQuestion('radio') }, icon('plus')),
      h('button', { class: 'btn icon', title: 'Tambah judul bagian', onclick: () => addQuestion('section') }, icon('heading')),
      h('button', { class: 'btn icon', title: 'Impor dari Excel', onclick: importModal }, icon('file_plus')));
    document.body.append(bar);
  }

  function addQuestion(type) {
    const q = newQuestion(type);
    const i = form.questions.findIndex((x) => x.id === activeId);
    form.questions.splice(i >= 0 ? i + 1 : form.questions.length, 0, q);
    activeId = q.id; focusNext = { qid: q.id, field: 'title' };
    renderList(); touch();
    setTimeout(() => listEl.querySelector(`[data-qid="${q.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 30);
  }

  function renderList() {
    clear(listEl);
    const quiz = form.settings.is_quiz;
    if (!form.questions.length) listEl.append(h('div', { class: 'empty' }, h('p', null, 'Belum ada pertanyaan.'), h('button', { class: 'btn primary', onclick: () => addQuestion('radio') }, icon('plus', 16), 'Tambah pertanyaan')));
    let n = 0;
    form.questions.forEach((q, idx) => {
      if (q.type !== 'section') n += 1;
      listEl.append(q.id === activeId ? activeCard(q, idx, quiz) : idleCard(q, q.type === 'section' ? 0 : n, quiz));
    });
    if (focusNext) {
      const el = listEl.querySelector(`[data-qid="${focusNext.qid}"] [data-f="${focusNext.field}"]`);
      if (el) { el.focus(); if (el.select && focusNext.select) el.select(); }
      focusNext = null;
    }
  }

  function idleCard(q, n, quiz) {
    const card = h('div', { class: `q ${q.type === 'section' ? 'section' : ''}`, 'data-qid': q.id, tabindex: 0, onclick: () => { activeId = q.id; renderList(); }, onkeydown: (e) => { if (e.key === 'Enter' && e.target === card) { activeId = q.id; renderList(); } } });
    if (q.type === 'section') { card.append(h('div', { class: 'qt' }, q.title || 'Judul bagian'), q.description && h('div', { class: 'qd' }, q.description)); return card; }
    card.append(quiz && q.points > 0 && h('span', { class: 'pts' }, `${num(q.points)} poin`),
      h('div', { class: 'qt' }, h('span', { class: 'num' }, `${n}.`), q.title || 'Pertanyaan tanpa judul', q.required && h('span', { class: 'req' }, '*')),
      q.description && h('div', { class: 'qd' }, q.description),
      q.config.image && h('img', { class: 'qimg', src: `/uploads/${q.config.image}`, alt: '', style: { maxHeight: '140px' } }),
      h('div', { style: { marginTop: '10px' }, class: 'small muted' }, previewOf(q, quiz)),
      (q.config.show_if || q.config.always) && h('div', { class: 'row wrap', style: { marginTop: '8px', gap: '6px' } }, q.config.show_if && h('span', { class: 'tag' }, icon('branch', 12), 'Logika tampil'), q.config.always && h('span', { class: 'tag' }, 'Selalu disertakan')));
    return card;
  }
  function previewOf(q, quiz) {
    if (q.type === 'dropdown' && q.config.list_id) return `Dropdown dari daftar (${q.options.length} pilihan)`;
    if (P.PREVIEW[q.type]) return P.PREVIEW[q.type](q);
    if (q.type === 'ranking') return q.options.map((o, i) => h('div', { class: 'opt', style: { padding: '3px 0' } }, h('span', { class: 'mark d' }, `${i + 1}.`), h('span', null, o.text || '(kosong)')));
    if (CHOICE.includes(q.type)) return q.options.map((o, i) => h('div', { class: 'opt', style: { padding: '3px 0', color: quiz && q.correct.includes(o.id) ? '#1f8a3b' : '' } },
      h('span', { class: `mark ${q.type === 'radio' ? 'r' : q.type === 'checkbox' ? 'c' : 'd'}` }, q.type === 'dropdown' ? `${i + 1}.` : ''), h('span', null, o.text || '(kosong)'), quiz && q.correct.includes(o.id) && icon('check', 16)));
    return { short: 'Jawaban singkat', paragraph: 'Jawaban panjang (esai)', date: 'Pilih tanggal', time: 'Pilih waktu', scale: `Skala ${q.config.min ?? 1}–${q.config.max ?? 5}` }[q.type] || '';
  }

  /* ---------- daftar pilihan (dropdown dari daftar tersimpan) ---------- */
  let listsCache = null; let listsLoading = false;
  function ensureLists(after) {
    if (listsCache || listsLoading) return;
    listsLoading = true;
    api('GET', '/api/lists').then((l) => { listsCache = l; }).catch(() => { listsCache = []; }).finally(() => { listsLoading = false; after(); });
  }
  function listSource(q, rerender) {
    ensureLists(rerender);
    const cur = q.config.list_id || '';
    const all = listsCache || [];
    const known = all.some((l) => l.id === cur);
    const optsOf = (arr) => arr.map((l) => h('option', { value: l.id }, `${l.name} (${l.count})`));
    const s = h('select', { class: 'in', style: { width: 'auto', maxWidth: '100%' }, value: cur, 'aria-label': 'Sumber pilihan', onchange: async (e) => {
      const v = e.target.value;
      if (v === '') { delete q.config.list_id; if (!q.options.length) q.options = [{ id: optId(), text: 'Opsi 1' }]; rerender(); touch(); return; }
      if (v === '__new') {
        e.target.value = cur;
        editListDialog({ items: q.options.map((o) => o.text).filter(Boolean), onSaved: (l) => { listsCache = [...(listsCache || []), { id: l.id, name: l.name, count: l.items.length, is_global: false, can_edit: true }]; q.config.list_id = l.id; q.options = l.items; q.correct = []; rerender(); touch(); } });
        return;
      }
      try { const l = await api('GET', `/api/lists/${v}`); q.config.list_id = l.id; q.options = l.items; q.correct = []; rerender(); touch(); } catch (er) { toast(errMsg(er), 'err'); e.target.value = cur; }
    } },
    h('option', { value: '' }, 'Ketik pilihan sendiri'),
    cur && !known && h('option', { value: cur }, 'Daftar terhubung'),
    all.some((l) => l.is_global) && h('optgroup', { label: 'Daftar global' }, optsOf(all.filter((l) => l.is_global))),
    all.some((l) => !l.is_global) && h('optgroup', { label: 'Daftar saya' }, optsOf(all.filter((l) => !l.is_global))),
    h('option', { value: '__new' }, '＋ Simpan sebagai daftar baru…'));
    return h('div', { class: 'row wrap', style: { marginBottom: '10px' } }, h('span', { class: 'small muted' }, 'Sumber pilihan:'), s,
      cur && h('a', { class: 'small', href: '/lists', target: '_blank', rel: 'noopener' }, 'Kelola daftar'));
  }

  function activeCard(q, idx, quiz) {
    const rerender = () => renderList();
    const card = h('div', { class: `q active ${q.type === 'section' ? 'section' : ''}`, 'data-qid': q.id });
    const typeSel = h('select', { class: 'in', style: { width: '210px' }, value: q.type, 'aria-label': 'Tipe pertanyaan', onchange: (e) => { changeType(q, e.target.value); rerender(); touch(); } }, TYPES.map(([v, l]) => h('option', { value: v }, l)));
    card.append(h('div', { class: 'qhead' },
      h('div', { class: 'grow' }, h('input', { class: 'in underline', 'data-f': 'title', value: q.title, placeholder: q.type === 'section' ? 'Judul bagian' : 'Pertanyaan', maxlength: 2000, style: { fontSize: '17px', fontWeight: 600 }, oninput: (e) => { q.title = e.target.value; touch(); } })),
      typeSel));
    card.append(h('input', { class: 'in underline', value: q.description, placeholder: 'Deskripsi (opsional)', maxlength: 4000, style: { fontSize: '14px', marginTop: '4px' }, oninput: (e) => { q.description = e.target.value; touch(); } }));

    const body = h('div', { style: { marginTop: '12px' } });
    const linked = q.type === 'dropdown' && !!q.config.list_id;
    if (q.type === 'dropdown') body.append(listSource(q, rerender));
    if (linked) {
      body.append(h('div', { class: 'small muted' }, `${q.options.length} pilihan dari daftar tersimpan — isinya selalu mengikuti daftar. Contoh:`),
        h('div', { style: { marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' } }, q.options.slice(0, 8).map((o) => h('span', { style: { background: '#f2f2f7', borderRadius: '999px', padding: '4px 12px', fontSize: '13px' } }, o.text)), q.options.length > 8 && h('span', { style: { padding: '4px 6px', fontSize: '13px', color: '#6e6e73' } }, `+${q.options.length - 8} lagi`)));
    } else if (WITH_OPTIONS.includes(q.type)) {
      if (q.type === 'ranking') body.append(h('div', { class: 'small muted', style: { marginBottom: '6px' } }, 'Peserta mengurutkan semua opsi dari yang paling penting/diprioritaskan. Peringkat tidak dinilai otomatis.'));
      q.options.forEach((o, i) => {
        const isKey = q.type !== 'ranking' && q.correct.includes(o.id);
        body.append(h('div', { class: `opt ${quiz && isKey ? 'key' : ''}` },
          h('span', { class: `mark ${q.type === 'radio' ? 'r' : q.type === 'checkbox' ? 'c' : 'd'}` }, q.type === 'dropdown' ? `${i + 1}.` : ''),
          h('input', { class: 'in underline', 'data-f': `opt${i}`, value: o.text, placeholder: `Opsi ${i + 1}`, maxlength: 500, oninput: (e) => { o.text = e.target.value; touch(); },
            onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); q.options.splice(i + 1, 0, { id: optId(), text: '' }); focusNext = { qid: q.id, field: `opt${i + 1}` }; rerender(); touch(); } } }),
          quiz && q.type !== 'ranking' && h('button', { class: `btn icon ghost keybtn ${isKey ? 'on' : ''}`, title: isKey ? 'Kunci jawaban (klik untuk lepas)' : 'Jadikan kunci jawaban', onclick: () => {
            if (q.type === 'checkbox') q.correct = isKey ? q.correct.filter((c) => c !== o.id) : [...q.correct, o.id]; else q.correct = isKey ? [] : [o.id];
            rerender(); touch();
          } }, icon('check')),
          q.options.length > (q.type === 'ranking' ? 2 : 1) && h('button', { class: 'btn icon ghost', title: 'Hapus opsi', onclick: () => { q.options.splice(i, 1); q.correct = q.correct.filter((c) => c !== o.id); rerender(); touch(); } }, icon('x'))));
      });
      body.append(h('button', { class: 'btn sm ghost', onclick: () => { q.options.push({ id: optId(), text: '' }); focusNext = { qid: q.id, field: `opt${q.options.length - 1}` }; rerender(); touch(); } }, icon('plus', 16), 'Tambah opsi'));
    } else if (q.type === 'short') {
      body.append(h('div', { class: 'small muted' }, 'Jawaban singkat — teks satu baris'));
      if (quiz) body.append(h('div', { style: { marginTop: '10px' } }, h('label', { class: 'f' }, 'Jawaban benar (satu per baris; huruf besar/kecil diabaikan)'),
        h('textarea', { class: 'in', rows: 2, value: q.correct.join('\n'), placeholder: 'Kosongkan bila tidak dinilai otomatis', oninput: (e) => { q.correct = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); touch(); } })));
    } else if (q.type === 'grid') body.append(P.gridEditor(q, ctx, rerender));
    else if (q.type === 'file') body.append(P.fileEditor(q, ctx, quiz));
    else if (q.type === 'paragraph') {
      body.append(h('div', { class: 'small muted' }, quiz ? 'Esai — dinilai manual di tab Respons › Individual. Nilai maksimum = poin soal.' : 'Jawaban panjang'));
    } else if (q.type === 'scale') {
      const c = q.config;
      body.append(h('div', { class: 'row wrap' }, sel(String(c.min ?? 1), [['0', '0'], ['1', '1']], (v) => { c.min = Number(v); rerender(); touch(); }), h('span', { class: 'muted' }, 'sampai'),
        sel(String(c.max ?? 5), Array.from({ length: 9 }, (_, i) => [String(i + 2), String(i + 2)]), (v) => { c.max = Number(v); rerender(); touch(); })),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('input', { class: 'in', placeholder: 'Label kiri (mis. Tidak puas)', value: c.min_label || '', maxlength: 60, oninput: (e) => { c.min_label = e.target.value; touch(); } }),
        h('input', { class: 'in', placeholder: 'Label kanan (mis. Sangat puas)', value: c.max_label || '', maxlength: 60, oninput: (e) => { c.max_label = e.target.value; touch(); } })));
      if (quiz) body.append(h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'small muted' }, 'Jawaban benar:'),
        sel(q.correct[0] || '', [['', 'Tanpa kunci'], ...Array.from({ length: (c.max ?? 5) - (c.min ?? 1) + 1 }, (_, i) => [String((c.min ?? 1) + i), String((c.min ?? 1) + i)])], (v) => { q.correct = v ? [v] : []; touch(); })));
    } else if (q.type === 'date') body.append(h('div', { class: 'small muted' }, 'Peserta memilih tanggal'));
    else if (q.type === 'time') body.append(h('div', { class: 'small muted' }, 'Peserta memilih jam'));
    card.append(body);
    card.append(P.questionExtras(q, idx, ctx, rerender));

    if (quiz && GRADABLE.includes(q.type) && !MANUAL.includes(q.type) && (q.points || 0) > 0 && q.correct.length === 0) {
      card.append(h('div', { class: 'small', style: { color: '#b26a00', marginTop: '10px' } }, icon('warn', 14), ' Belum ada kunci jawaban — soal ini tidak akan dinilai otomatis.'));
    }

    const foot = h('div', { class: 'qfoot' });
    if (quiz && GRADABLE.includes(q.type)) foot.append(h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Poin'), h('input', { class: 'in', type: 'number', min: 0, max: 1000, step: 'any', value: q.points, style: { width: '84px', padding: '6px 10px' }, oninput: (e) => { q.points = Number(e.target.value) || 0; touch(); } })));
    if (quiz && q.type === 'checkbox') foot.append(h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Nilai sebagian'), toggle(!!q.config.partial, (v) => { q.config.partial = v; touch(); })));
    foot.append(h('span', { class: 'spacer' }));
    if (q.type !== 'section') foot.append(h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Wajib'), toggle(q.required, (v) => { q.required = v; touch(); })));
    foot.append(
      h('button', { class: 'btn icon ghost', title: 'Naikkan', disabled: idx === 0, onclick: () => { [form.questions[idx - 1], form.questions[idx]] = [form.questions[idx], form.questions[idx - 1]]; rerender(); touch(); } }, icon('up')),
      h('button', { class: 'btn icon ghost', title: 'Turunkan', disabled: idx === form.questions.length - 1, onclick: () => { [form.questions[idx + 1], form.questions[idx]] = [form.questions[idx], form.questions[idx + 1]]; rerender(); touch(); } }, icon('down')),
      h('button', { class: 'btn icon ghost', title: 'Gandakan', onclick: () => { const c = JSON.parse(JSON.stringify(q)); c.id = uuid(); const map = {}; c.options = c.options.map((o) => { const nid = optId(); map[o.id] = nid; return { ...o, id: nid }; }); if (CHOICE.includes(c.type)) c.correct = c.correct.map((x) => map[x]).filter(Boolean); form.questions.splice(idx + 1, 0, c); activeId = c.id; rerender(); touch(); } }, icon('copy')),
      h('button', { class: 'btn icon ghost', title: 'Hapus', style: { color: 'var(--danger)' }, onclick: () => { form.questions.splice(idx, 1); activeId = null; rerender(); touch(); } }, icon('trash')));
    card.append(foot);
    return card;
  }

  function importModal() {
    const file = h('input', { type: 'file', accept: '.xlsx', class: 'in' });
    const mode = sel('append', [['append', 'Tambahkan di akhir'], ['replace', 'Ganti semua pertanyaan']], () => {}, { width: '100%' });
    const out = h('div');
    modal({
      title: 'Impor soal dari Excel', wide: false,
      body: h('div', { class: 'col' },
        h('p', { class: 'muted small', style: { margin: 0 } }, 'Satu baris = satu pertanyaan. Tipe: jawaban singkat, esai, pilihan ganda, kotak centang, dropdown, skala, tanggal, waktu, judul bagian. Kunci jawaban & poin untuk kuis.'),
        h('div', { class: 'row wrap' }, h('a', { class: 'btn sm', href: '/api/templates/survey.xlsx', download: '' }, icon('download', 16), 'Template formulir'), h('a', { class: 'btn sm', href: '/api/templates/quiz.xlsx', download: '' }, icon('download', 16), 'Template kuis')),
        h('div', null, h('label', { class: 'f' }, 'Berkas .xlsx'), file), h('div', null, h('label', { class: 'f' }, 'Mode'), mode), out),
      actions: [{ label: 'Tutup' }, { label: 'Impor', kind: 'primary', onClick: async () => {
        if (!file.files[0]) { toast('Pilih berkas Excel dulu', 'err'); return false; }
        if (mode.value === 'replace' && form.questions.length && !await confirmDialog('Ganti semua pertanyaan?', 'Pertanyaan yang ada sekarang akan dihapus.', 'Ganti', true)) return false;
        try {
          await flush();
          const r = await api('POST', `/api/forms/${form.id}/import-excel?mode=${mode.value}`, undefined, { raw: await file.files[0].arrayBuffer() });
          const fresh = await api('GET', `/api/forms/${form.id}`);
          form.questions = fresh.questions; base = fresh.updated_at;
          if (tab === 'questions') { activeId = null; renderList(); }
          toast(`${r.imported} pertanyaan diimpor`);
          if (r.warnings.length) { clear(out); out.append(h('div', { class: 'small', style: { color: '#b26a00' } }, h('b', null, 'Catatan:'), h('ul', { style: { paddingLeft: '18px', margin: '4px 0' } }, r.warnings.slice(0, 12).map((w) => h('li', null, w))))); return false; }
          return true;
        } catch (e) { clear(out); out.append(h('div', { class: 'small', style: { color: 'var(--danger)' } }, errMsg(e))); return false; }
      } }],
    });
  }

  /* ================= TAB TAMPILAN ================= */
  function themeTab() {
    const T = form.theme;
    const heroPrev = h('section', { class: heroClass(T) });
    const paintHero = () => { heroPrev.className = heroClass(form.theme); Object.assign(heroPrev.style, { backgroundImage: '', color: '' }); const st = heroStyle(form.theme); Object.assign(heroPrev.style, st); clear(heroPrev); heroPrev.append(h('h1', null, form.title || 'Judul formulir'), h('p', null, form.description || 'Pratinjau tampilan header')); refreshTheme(); };
    const ctl = h('div', { class: 'card' });
    const draw = () => {
      clear(ctl);
      ctl.append(
        h('h3', null, 'Warna tema'), h('p', { class: 'small muted' }, 'Dipakai untuk header, tombol, dan pilihan.'), colorRow(T.color, ACCENTS, (c) => { T.color = c; paintHero(); touch(); if (!c.startsWith('#') || ACCENTS.includes(c)) draw(); }),
        h('div', { style: { height: '18px' } }), h('h3', null, 'Warna latar halaman'), colorRow(T.bg, BGS, (c) => { T.bg = c; paintHero(); touch(); if (BGS.includes(c)) draw(); }),
        h('div', { style: { height: '18px' } }), h('h3', null, 'Gaya header'),
        h('div', { class: 'seg', style: { marginTop: '8px' } }, [['solid', 'Warna'], ['gradient', 'Gradasi'], ['image', 'Gambar']].map(([v, l]) => h('button', { class: T.header_style === v ? 'on' : '', onclick: () => { T.header_style = v; paintHero(); touch(); draw(); } }, l))),
        T.header_style === 'image' && h('div', { style: { marginTop: '12px' } }, imageSlot('Gambar header', 'PNG/JPG, disarankan 1600×500', T.header_image, (nid) => { T.header_image = nid; paintHero(); touch(); })),
        h('div', { style: { height: '18px' } }), h('h3', null, 'Jenis huruf'),
        h('div', { class: 'seg', style: { marginTop: '8px' } }, [['system', 'Sistem'], ['serif', 'Serif'], ['rounded', 'Rounded'], ['mono', 'Mono']].map(([v, l]) => h('button', { class: T.font === v ? 'on' : '', onclick: () => { T.font = v; paintHero(); touch(); draw(); } }, l))));
    };
    draw(); paintHero();
    body.append(h('div', { style: { margin: '14px 0 6px' } }, h('h2', null, 'Tampilan'), h('p', { class: 'muted small' }, 'Atur warna latar dan header seperti yang Anda mau. Perubahan langsung dipratinjau di bawah.')), heroPrev, ctl);
  }

  /* ================= TAB PENGATURAN ================= */
  function settingsTab() {
    const S = form.settings;
    const again = () => { clear(body); settingsTab(); };
    body.append(h('div', { style: { margin: '14px 0 6px' } }, h('h2', null, 'Pengaturan')));

    const quizCard = h('div', { class: 'card' }, h('h3', null, 'Kuis / ujian'),
      setting('Jadikan kuis', 'Beri poin & kunci jawaban; pilihan ganda dinilai otomatis.', toggle(S.is_quiz, (v) => {
        S.is_quiz = v;
        if (v) form.questions.forEach((q) => { if (!q.points && GRADABLE.includes(q.type)) q.points = q.type === 'paragraph' ? 20 : 10; });
        touch(); again();
      })));
    if (S.is_quiz) {
      quizCard.append(
        setting('Batasi durasi pengerjaan', 'Waktu habis → jawaban terkirim otomatis dan dinilai.', toggle(S.duration_min > 0, (v) => { S.duration_min = v ? 60 : 0; touch(); again(); })));
      if (S.duration_min > 0) {
        quizCard.append(h('div', { class: 'setting' }, h('div', { class: 't' }, h('b', null, 'Durasi (menit)'), h('div', { class: 'row wrap', style: { marginTop: '8px' } }, [15, 30, 45, 60, 90, 120].map((m) => h('button', { class: `btn sm ${S.duration_min === m ? 'primary' : ''}`, onclick: () => { S.duration_min = m; touch(); again(); } }, `${m}`)),
          h('input', { class: 'in', type: 'number', min: 1, max: 720, value: S.duration_min, style: { width: '96px' }, oninput: (e) => { S.duration_min = Math.max(1, Math.min(720, Number(e.target.value) || 1)); touch(); } })))));
      }
      quizCard.append(
        setting('Tampilkan nilai setelah kirim', null, sel(S.show_score, [['immediately', 'Langsung'], ['never', 'Jangan tampilkan']], (v) => { S.show_score = v; touch(); })),
        setting('Tampilkan kunci jawaban setelah kirim', 'Peserta melihat benar/salah per soal.', toggle(S.show_answers, (v) => { S.show_answers = v; touch(); })),
        setting('Acak urutan soal', 'Hanya berlaku bila tidak ada judul bagian.', toggle(S.shuffle_questions, (v) => { S.shuffle_questions = v; touch(); })),
        setting('Acak urutan pilihan', null, toggle(S.shuffle_options, (v) => { S.shuffle_options = v; touch(); })),
        h('div', { class: 'small muted', style: { paddingTop: '8px' } }, `Total poin: ${num(form.questions.reduce((a, x) => a + (x.points || 0), 0))}`));
    }
    body.append(quizCard);

    body.append(h('div', { class: 'card' }, h('h3', null, 'Responden'),
      setting('Identitas peserta', 'Default: peserta tanpa login cukup mengisi nama & email (yang sudah masuk E-Portal terisi otomatis). Pilih “Wajib login” hanya bila formulir khusus civitas.', sel(S.identity, [['ask', 'Nama & email (login opsional)'], ['login', 'Wajib login E-Portal'], ['none', 'Anonim']], (v) => {
        S.identity = v; if (v === 'none' && form.cert.enabled) { toast('Sertifikat butuh nama: identitas diubah ke “Isi nama & email”', 'err'); S.identity = 'ask'; again(); } touch();
      })),
      setting('Satu respons per orang', 'Berlaku untuk akun login atau email yang sama.', toggle(S.one_response, (v) => { S.one_response = v; touch(); }))));

    P.advancedSettings(ctx, again).forEach((card) => body.append(card));
    body.append(P.allowlistCard(ctx), P.attendanceCard(ctx));

    body.append(h('div', { class: 'card' }, h('h3', null, 'Jadwal & status'),
      setting('Status', form.status === 'published' ? 'Peserta dapat mengisi' : 'Peserta belum dapat mengisi', sel(form.status, [['draft', 'Draf'], ['published', 'Dibuka'], ['closed', 'Ditutup']], (v) => { form.status = v; renderTop(); touch(); })),
      setting('Dibuka mulai', 'Kosongkan bila langsung', h('input', { class: 'in', type: 'datetime-local', style: { width: 'auto' }, value: toLocalInput(S.open_at), onchange: (e) => { S.open_at = fromLocalInput(e.target.value); touch(); } })),
      setting('Ditutup pada', 'Kosongkan bila tanpa batas', h('input', { class: 'in', type: 'datetime-local', style: { width: 'auto' }, value: toLocalInput(S.close_at), onchange: (e) => { S.close_at = fromLocalInput(e.target.value); touch(); } }))));

    body.append(h('div', { class: 'card' }, h('h3', null, 'Pesan konfirmasi'), h('p', { class: 'small muted' }, 'Tampil setelah peserta mengirim jawaban.'),
      h('textarea', { class: 'in', maxlength: 2000, value: S.confirmation_message, oninput: (e) => { S.confirmation_message = e.target.value; touch(); } })));

    body.append(h('div', { class: 'card' }, h('h3', null, 'Tautan pengisian'), h('div', { class: 'row', style: { marginTop: '8px' } },
      h('input', { class: 'in', readOnly: true, value: fillUrl(form.slug), onfocus: (e) => e.target.select() }), h('button', { class: 'btn', onclick: () => copyText(fillUrl(form.slug)) }, icon('copy', 16), 'Salin'))));

    const edCard = h('div', { class: 'card' }); body.append(edCard); editorsPanel(edCard);

    if (form.role === 'owner') {
      body.append(h('div', { class: 'card' }, h('h3', { style: { color: 'var(--danger)' } }, 'Zona berbahaya'), h('p', { class: 'small muted' }, 'Menghapus formulir juga menghapus seluruh respons dan sertifikat yang pernah terbit darinya.'),
        h('button', { class: 'btn danger', onclick: async () => { if (!await confirmDialog('Hapus formulir ini?', 'Tindakan ini tidak dapat dibatalkan.', 'Hapus permanen', true)) return; try { scheduleSave.cancel(); await api('DELETE', `/api/forms/${form.id}`); toast('Formulir dihapus'); navigate('/'); } catch (e) { toast(errMsg(e), 'err'); } } }, icon('trash', 16), 'Hapus formulir')));
    }
  }

  /* Panel editor terdaftar (dipakai di Pengaturan dan modal Bagikan) */
  async function editorsPanel(host) {
    clear(host); host.append(h('div', { class: 'spinner' }));
    let d;
    try { d = await api('GET', `/api/forms/${form.id}/editors`); } catch (e) { clear(host); host.append(h('p', null, errMsg(e))); return; }
    clear(host);
    const inp = h('input', { class: 'in', type: 'email', placeholder: 'email editor, mis. dosen@uika-bogor.ac.id' });
    host.append(h('h3', null, 'Editor'), h('p', { class: 'small muted' }, 'Hanya pembuat formulir dan email di daftar ini yang dapat membuka Mode Editor. Peserta tetap hanya melihat Mode Pengisian.'));
    host.append(h('div', { class: 'row', style: { padding: '8px 0' } }, icon('shield'), h('div', { class: 'grow' }, h('b', null, d.owner.name || d.owner.email), h('div', { class: 'tiny muted' }, d.owner.email)), h('span', { class: 'pill blue' }, 'Pemilik')));
    d.editors.forEach((e) => host.append(h('div', { class: 'row', style: { padding: '8px 0', borderTop: '.5px solid var(--line)' } }, icon('user'), h('div', { class: 'grow' }, h('b', null, e.name || e.email), h('div', { class: 'tiny muted' }, e.email + (e.joined ? '' : ' · belum pernah masuk'))), h('span', { class: 'pill' }, 'Editor'),
      (d.can_manage || e.email === session.user.email.toLowerCase()) && h('button', { class: 'btn icon ghost', title: 'Cabut akses', onclick: async () => { try { await api('DELETE', `/api/forms/${form.id}/editors/${encodeURIComponent(e.email)}`); if (e.email === session.user.email.toLowerCase()) { navigate('/'); return; } editorsPanel(host); } catch (er) { toast(errMsg(er), 'err'); } } }, icon('x')))));
    if (d.can_manage) {
      const add = async () => { if (!inp.value.trim()) return; try { await api('POST', `/api/forms/${form.id}/editors`, { email: inp.value }); toast('Editor ditambahkan'); editorsPanel(host); } catch (e) { toast(e.data?.message || (e.data?.error === 'invalid_email' ? 'Email tidak valid' : errMsg(e)), 'err'); } };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      host.append(h('div', { class: 'row', style: { marginTop: '12px' } }, inp, h('button', { class: 'btn primary', onclick: add }, icon('plus', 16), 'Tambah')));
    }
  }

  function shareModal(justPublished) {
    const host = h('div', { class: 'card', style: { boxShadow: 'none', background: 'var(--card-2)', marginTop: '12px' } });
    editorsPanel(host);
    modal({
      wide: true,
      title: justPublished ? 'Formulir diterbitkan 🎉' : 'Bagikan',
      body: h('div', null, h('label', { class: 'f' }, 'Tautan untuk peserta (Mode Pengisian)'), h('div', { class: 'row' }, h('input', { class: 'in', readOnly: true, value: fillUrl(form.slug), onfocus: (e) => e.target.select() }), h('button', { class: 'btn primary', onclick: () => copyText(fillUrl(form.slug)) }, 'Salin')),
        form.status !== 'published' && h('p', { class: 'small', style: { color: '#b26a00' } }, 'Formulir belum dibuka; tautan baru berfungsi setelah diterbitkan.'),
        h('div', { style: { marginTop: '12px' } }, P.shareExtras(ctx, fillUrl)), host),
      actions: [{ label: 'Selesai', kind: 'primary' }],
    });
  }

  /* ================= TAB SERTIFIKAT ================= */
  let stopBulk = null;
  function certTab() {
    const C = form.cert; const S = form.settings;
    destroyTab = () => { if (stopBulk) stopBulk(); stopBulk = null; };
    const wrap = h('div');
    const draw = () => {
      clear(wrap); if (stopBulk) { stopBulk(); stopBulk = null; }
      wrap.append(h('div', { style: { margin: '14px 0 6px' } }, h('h2', null, 'Sertifikat otomatis'), h('p', { class: 'muted small' }, 'Sertifikat PDF berkode QR dibuat otomatis untuk peserta yang selesai mengisi (atau lulus nilai minimal pada kuis). Bisa diunduh peserta atau dikirim ke emailnya.')));
      wrap.append(h('div', { class: 'card' }, setting('Aktifkan sertifikat', 'Matikan bila kegiatan ini tidak memberi sertifikat.', toggle(C.enabled, (v) => {
        C.enabled = v;
        if (v && S.identity === 'none') { S.identity = 'ask'; toast('Identitas peserta diubah ke “Isi nama & email”'); }
        touch(); draw();
      }))));
      if (!C.enabled) return;
      const f = (label, key, props = {}) => h('div', null, h('label', { class: 'f' }, label), h('input', { class: 'in', value: C[key] || '', maxlength: 150, oninput: (e) => { C[key] = e.target.value; touch(); }, ...props }));
      wrap.append(h('div', { class: 'card' }, h('h3', { style: { marginBottom: '12px' } }, 'Isi sertifikat'),
        h('div', { class: 'col' }, f('Judul', 'title'), f('Kalimat pengantar', 'subtitle'),
          h('div', null, h('label', { class: 'f' }, 'Teks isi'), h('textarea', { class: 'in', rows: 3, maxlength: 600, value: C.body, oninput: (e) => { C.body = e.target.value; touch(); } }),
            h('div', { class: 'row wrap', style: { marginTop: '6px' } }, h('span', { class: 'tiny muted' }, 'Sisipkan:'), ['{{nama}}', '{{judul}}', '{{tanggal}}', '{{nilai}}'].map((t) => h('button', { class: 'chipbtn', onclick: () => { C.body = `${C.body} ${t}`.trim(); touch(); draw(); } }, t)))),
          f('Penyelenggara', 'organizer'),
          h('div', { class: 'row' }, h('div', { class: 'grow' }, f('Nama penandatangan', 'signer_name')), h('div', { class: 'grow' }, f('Jabatan', 'signer_title'))))));
      wrap.append(h('div', { class: 'card' }, h('h3', { style: { marginBottom: '8px' } }, 'Latar & warna'),
        h('label', { class: 'f' }, 'Warna aksen (garis & judul)'), colorRow(C.accent, ACCENTS, (c) => { C.accent = c; touch(); }),
        h('div', { style: { height: '14px' } }), h('label', { class: 'f' }, 'Warna latar'), colorRow(C.bg_color, ['#ffffff', '#fffaf0', '#f2f7ff', '#f4fff6', '#fff5f5', '#f7f7f7'], (c) => { C.bg_color = c; touch(); }),
        h('div', { style: { height: '14px' } }), imageSlot('Gambar latar sertifikat', 'A4 landscape (PNG/JPG) — menggantikan bingkai bawaan', C.bg_image, (nid) => { C.bg_image = nid; touch(); })));
      wrap.append(P.certTemplateCard(ctx, draw));
      wrap.append(h('div', { class: 'card' }, h('h3', null, 'Sponsor / logo'), h('p', { class: 'small muted' }, 'Tempatkan logo di kiri atas, kanan atas, atau kanan bawah. QR verifikasi selalu di kiri bawah.'),
        h('div', { class: 'col' }, imageSlot('Kiri atas', 'Logo sponsor 1', C.sponsors.tl, (nid) => { C.sponsors.tl = nid; touch(); }),
          imageSlot('Kanan atas', 'Logo sponsor 2', C.sponsors.tr, (nid) => { C.sponsors.tr = nid; touch(); }),
          imageSlot('Kanan bawah', 'Logo sponsor 3', C.sponsors.br, (nid) => { C.sponsors.br = nid; touch(); }),
          imageSlot('Tanda tangan (opsional)', 'PNG transparan lebih baik', C.signature_image, (nid) => { C.signature_image = nid; touch(); }))));
      wrap.append(h('div', { class: 'card' }, h('h3', null, 'Syarat & pengiriman'),
        S.is_quiz && setting('Nilai minimal untuk sertifikat', 'Dalam persen dari total poin', h('div', { class: 'row' }, h('input', { class: 'in', type: 'number', min: 0, max: 100, value: C.min_percent, style: { width: '90px' }, oninput: (e) => { C.min_percent = Math.max(0, Math.min(100, Number(e.target.value) || 0)); touch(); } }), '%')),
        !S.is_quiz && h('div', { class: 'small muted', style: { padding: '8px 0' } }, 'Peserta mendapat sertifikat setelah mengirim jawaban.'),
        setting('Kirim otomatis ke email peserta', 'Membutuhkan SMTP di server. Peserta juga dapat mengunduh sendiri.', toggle(C.auto_email, (v) => { C.auto_email = v; touch(); }))));
      const frame = h('div');
      const preview = async () => {
        await flush(); clear(frame);
        const src = `/api/forms/${form.id}/certificate-preview.pdf?name=${encodeURIComponent(session.user.name || 'Nama Peserta')}&t=${Date.now()}`;
        frame.append(h('iframe', { class: 'pdf', src, title: 'Pratinjau sertifikat' }), h('div', { class: 'row', style: { marginTop: '8px' } }, h('a', { class: 'btn sm', href: src, target: '_blank', rel: 'noopener' }, icon('ext', 16), 'Buka PDF di tab baru'), h('span', { class: 'tiny muted' }, 'Jika pratinjau kosong (HP), buka di tab baru.')));
      };
      wrap.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('h3', { class: 'grow' }, 'Pratinjau'), h('button', { class: 'btn primary', onclick: preview }, icon('eye', 16), 'Tampilkan pratinjau')), frame));
      const bulk = P.bulkSendCard(ctx); wrap.append(bulk); stopBulk = bulk._stop;
    };
    draw();
    body.append(wrap);
  }

  /* ================= TAB RESPONS ================= */
  function respTab() {
    destroyTab = responsesTab(body, form, { refreshCount: (n) => { form.response_count = n; } });
  }

  /* ---------- mulai ---------- */
  const unload = (e) => { if (stateEl.textContent.includes('Belum')) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', unload);
  refreshTheme(); renderAll();
  return () => {
    window.removeEventListener('beforeunload', unload);
    if (destroyTab) destroyTab();
    document.querySelectorAll('.addbar').forEach((n) => n.remove());
    document.body.style.background = prevBg;
    // simpan perubahan yang tertunda saat berpindah halaman
    scheduleSave.cancel();
    if (stateEl.textContent.includes('Belum')) save();
  };
}
