/* MODE PENGISIAN — tampilan yang dilihat peserta (juga dipakai sebagai pratinjau dari Editor). */
import { h, clear, icon, api, ApiError, session, navbar, userMenu, link, toast, modal, confirmDialog, debounce, applyTheme, canvasBg, currentTheme, setPageTheme, heroClass, heroStyle,
  loginUrl, fmtMMSS, fmtDur, fmtDateTime, num, errMsg, logo } from '../core.js';
import { applyLogic, isAnswered } from '../logic.js';
import { setLang } from '../i18n.js';

const LS = (slug) => `uf:attempt:${slug}`;

function hashSeed(s) { let x = 1779033703 ^ s.length; for (let i = 0; i < s.length; i += 1) { x = Math.imul(x ^ s.charCodeAt(i), 3432918353); x = (x << 13) | (x >>> 19); } return x >>> 0; }
function rng(seed) { let a = seed; return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffled(arr, seedStr) { const r = rng(hashSeed(seedStr)); const a = [...arr]; for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const ACCEPT = { any: '.pdf,.png,.jpg,.jpeg,.docx,.xlsx,.pptx,.doc,.xls,.ppt', image: '.png,.jpg,.jpeg', pdf: '.pdf', doc: '.pdf,.docx,.xlsx,.pptx,.doc,.xls,.ppt' };

export async function fillPage(root, { slug }, query) {
  const preview = query.preview === '1';
  const embed = query.embed === '1';
  let form;
  try { form = await api('GET', `/api/public/forms/${encodeURIComponent(slug)}${preview ? '?preview=1' : ''}`); } catch (e) {
    clear(root); root.append(navbar({ right: userMenu() }), h('div', { class: 'center-screen' }, h('div', null, h('div', { class: 'big' }, '🔎'), h('h2', null, 'Formulir tidak ditemukan'), h('p', { class: 'muted' }, 'Periksa kembali tautan yang Anda terima.')))); return undefined;
  }
  if (session.user) form.me = session.user;
  const S = form.settings;
  const quiz = S.is_quiz;
  const AC = S.anticheat && S.anticheat.enabled && !preview ? S.anticheat : null;
  if (!query.lang) setLang(S.language || 'id', { temporary: true });

  /* ---------- kerangka ---------- */
  const shell = h('div', { class: 'fx', style: { minHeight: embed ? '' : '100vh' } });
  setPageTheme(form.theme.mode);
  const prevBg = document.body.style.background;
  const paintTheme = () => { applyTheme(shell, form.theme); document.body.style.background = embed ? 'transparent' : canvasBg(form.theme, currentTheme()); };
  paintTheme();
  window.addEventListener('uf:themechange', paintTheme);
  document.title = `${form.title} — UIKA Form`;
  const content = h('div', { class: 'canvas-in' });
  const canvas = h('div', { class: 'canvas' }, content);
  const banner = preview && h('div', { class: 'banner' }, icon('eye', 18), h('span', null, 'Mode Pengisian (pratinjau) — jawaban tidak disimpan dan tidak masuk rekap.'),
    h('a', { class: 'btn sm', href: `/forms/${form.id}/edit`, 'data-link': '' }, icon('back', 16), 'Kembali ke Editor'));
  const nav = embed ? null : navbar({ left: h('span', { class: 'brand' }, logo(), h('span', { class: 'hide-sm' }, 'UIKA Form')), right: userMenu() });
  clear(root); root.append(shell); shell.append(...[banner, nav, canvas].filter(Boolean));

  const timers = [];
  const listeners = [];
  let beforeUnload = null;
  const on = (target, ev, fn, opts) => { target.addEventListener(ev, fn, opts); listeners.push(() => target.removeEventListener(ev, fn, opts)); };
  const cleanup = () => {
    timers.forEach(clearInterval); listeners.forEach((f) => f());
    if (beforeUnload) window.removeEventListener('beforeunload', beforeUnload);
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    document.body.style.background = prevBg; document.title = 'UIKA Form';
    window.removeEventListener('uf:themechange', paintTheme); setPageTheme(null);
  };

  const hero = (extra) => h('section', { class: heroClass(form.theme), style: heroStyle(form.theme) },
    h('h1', null, form.title), form.description && h('p', null, form.description), extra);
  const stateCard = (emoji, title, text, extra) => { clear(content); content.append(hero(), h('div', { class: 'card', style: { textAlign: 'center', padding: '32px 20px' } }, h('div', { class: 'big', style: { fontSize: '44px' } }, emoji), h('h2', null, title), h('p', { class: 'muted' }, text), extra)); };

  if (form.state === 'draft') { stateCard('🛠️', 'Formulir belum dipublikasikan', 'Pembuat formulir belum membukanya untuk umum.'); return cleanup; }
  if (form.state === 'closed') { stateCard('🔒', 'Formulir ditutup', 'Formulir ini tidak lagi menerima jawaban.'); return cleanup; }
  if (form.state === 'not_open') { stateCard('🗓️', 'Belum dibuka', `Formulir dibuka pada ${fmtDateTime(S.open_at)}.`); return cleanup; }

  /* ---------- status ---------- */
  const answers = {};
  let attempt = null;
  let offset = 0;
  let locked = false;
  let submitting = false;
  let violations = 0;
  const applyOrder = (qs) => (S.shuffle_questions && !qs.some((x) => x.type === 'section') ? shuffled(qs, `${slug}:q`) : qs);
  let questions = applyOrder(form.questions || []);
  const hasFile = questions.some((x) => x.type === 'file');
  // kuis, daftar peserta, dan unggah berkas butuh identitas/percobaan lebih dulu
  const useIntro = quiz || S.allowlist || hasFile;
  const ident = { name: form.me?.name || '', email: form.me?.email || '', identifier: form.me?.identifier || '' };
  const needIdent = !preview && S.identity === 'ask';
  const needLogin = !preview && S.identity === 'login' && !form.me;
  const qEls = new Map();
  const fileNames = {};
  let progressBar; let progressText; let timerEl;

  const countReal = () => (form.question_count ?? questions.filter((x) => x.type !== 'section').length);
  const chips = () => h('div', { class: 'chips' },
    quiz && countReal() > 0 && h('span', { class: 'chip' }, icon('list', 14), `${countReal()} soal`),
    quiz && S.duration_min > 0 && h('span', { class: 'chip' }, icon('clock', 14), fmtDur(S.duration_min)),
    quiz && form.total_points > 0 && h('span', { class: 'chip' }, `${num(form.total_points)} poin`),
    form.certificate && h('span', { class: 'chip' }, icon('award', 14), 'Sertifikat tersedia'),
    S.close_at && h('span', { class: 'chip' }, `Ditutup ${fmtDateTime(S.close_at)}`));

  /* ---------- identitas ---------- */
  function identityCard() {
    if (preview || S.identity === 'none') return null;
    if (needLogin) {
      return h('div', { class: 'card', style: { textAlign: 'center' } }, h('h3', null, 'Masuk untuk mengisi'), h('p', { class: 'muted small' }, 'Formulir ini hanya untuk pengguna E-Portal UIKA.'),
        h('a', { class: 'btn primary', href: loginUrl(), target: embed ? '_top' : undefined }, 'Masuk dengan E-Portal'));
    }
    if (S.identity === 'login') {
      return h('div', { class: 'card row' }, icon('user'), h('div', { class: 'grow' }, h('b', null, form.me.name || form.me.email), h('div', { class: 'small muted' }, form.me.email + (form.me.identifier ? ` · ${form.me.identifier}` : ''))));
    }
    const f = (label, key, props) => h('div', null, h('label', { class: 'f' }, label), h('input', { class: 'in', value: ident[key], oninput: (e) => { ident[key] = e.target.value; e.target.classList.remove('bad'); }, ...props }));
    return h('div', { class: 'card', id: 'identity' }, h('div', { class: 'row wrap', style: { marginBottom: '12px' } }, h('h3', { class: 'grow', style: { margin: 0 } }, 'Data peserta'),
        form.me ? h('span', { class: 'chip' }, icon('user', 14), 'Masuk via E-Portal') : h('a', { class: 'small', href: loginUrl(), target: embed ? '_top' : undefined }, 'Punya akun E-Portal? Masuk')),
      h('div', { class: 'col' }, f('Nama lengkap *', 'name', { autocomplete: 'name', placeholder: 'Sesuai identitas / untuk sertifikat' }),
        f('Email *', 'email', { type: 'email', autocomplete: 'email', placeholder: 'nama@email.com', readOnly: !!form.me }),
        f('NIM / NIP (opsional)', 'identifier', { placeholder: '' })));
  }
  function checkIdentity() {
    if (!needIdent) return true;
    const bad = [];
    if (ident.name.trim().length < 2) bad.push('name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ident.email.trim())) bad.push('email');
    if (bad.length) {
      const card = document.getElementById('identity');
      const inputs = card ? card.querySelectorAll('input') : [];
      if (bad.includes('name') && inputs[0]) inputs[0].classList.add('bad');
      if (bad.includes('email') && inputs[1]) inputs[1].classList.add('bad');
      card && card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('Lengkapi nama dan email yang valid', 'err');
      return false;
    }
    return true;
  }

  /* ---------- jawaban & percabangan ---------- */
  const autosave = debounce(async () => {
    if (!attempt || preview || locked) return;
    try { await api('PUT', `/api/public/attempts/${attempt.id}/save`, { answers: visibleAnswers() }); } catch (e) { if (e.status === 409) { /* waktu habis / sudah dikirim */ } }
  }, 1200);

  const visibleAnswers = () => applyLogic(questions, answers).answers;

  function refreshVisibility() {
    const { visible } = applyLogic(questions, answers);
    let n = 0;
    for (const q of questions) {
      const el = qEls.get(q.id); if (!el) continue;
      const show = visible.has(q.id);
      el.style.display = show ? '' : 'none';
      if (show && q.type !== 'section') { n += 1; const numEl = el.querySelector('.num'); if (numEl) numEl.textContent = `${n}.`; }
    }
    return visible;
  }
  function changed() {
    refreshVisibility();
    updateProgress();
    if (attempt && (quiz || hasFile)) autosave();
  }
  function updateProgress() {
    if (!progressBar) return;
    const { visible, answers: kept } = applyLogic(questions, answers);
    const real = questions.filter((x) => x.type !== 'section' && visible.has(x.id));
    const done = real.filter((x) => isAnswered(x, kept[x.id])).length;
    progressBar.style.width = `${real.length ? (done / real.length) * 100 : 0}%`;
    progressText.textContent = `${done} dari ${real.length} terjawab`;
  }
  const setAnswer = (q, v) => {
    if (v === '' || v === null || v === undefined || (Array.isArray(v) && !v.length)) delete answers[q.id]; else answers[q.id] = v;
    qEls.get(q.id)?.classList.remove('err');
    changed();
  };

  /* ---------- input per tipe ---------- */
  function rankingInput(q, opts) {
    const byId = new Map(q.options.map((o) => [o.id, o]));
    let order = Array.isArray(answers[q.id]) ? [...answers[q.id]] : opts().map((o) => o.id);
    const wrap = h('div');
    let dragId = null;
    const commit = () => setAnswer(q, [...order]);
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= order.length) return; [order[i], order[j]] = [order[j], order[i]]; commit(); draw(); };
    function draw() {
      clear(wrap);
      const list = h('ol', { class: 'rank' });
      order.forEach((id, i) => {
        const li = h('li', { draggable: 'true', 'data-id': id, class: 'rankrow',
          ondragstart: () => { dragId = id; }, ondragover: (e) => { e.preventDefault(); },
          ondrop: (e) => { e.preventDefault(); if (!dragId || dragId === id) return; const from = order.indexOf(dragId); order.splice(from, 1); order.splice(order.indexOf(id), 0, dragId); dragId = null; commit(); draw(); } },
          h('span', { class: 'rk' }, String(i + 1)), h('span', { class: 'grow' }, byId.get(id)?.text || id),
          h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Naikkan', disabled: i === 0, onclick: () => move(i, -1) }, icon('up', 18)),
          h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Turunkan', disabled: i === order.length - 1, onclick: () => move(i, 1) }, icon('down', 18)));
        list.append(li);
      });
      wrap.append(list, answers[q.id] === undefined ? h('div', { class: 'row', style: { marginTop: '6px' } }, h('span', { class: 'small muted grow' }, 'Geser atau gunakan tombol panah untuk mengurutkan.'), h('button', { class: 'chipbtn', type: 'button', onclick: () => { commit(); draw(); } }, 'Pakai urutan ini')) : null);
    }
    draw();
    return wrap;
  }

  function gridInput(q) {
    const rows = q.config.rows || []; const cols = q.config.cols || [];
    const multi = !!q.config.multi;
    const wrap = h('div', { class: 'gridq' });
    const get = () => ({ ...(answers[q.id] || {}) });
    rows.forEach((row) => {
      const line = h('div', { class: 'gridrow' }, h('div', { class: 'gl' }, row.text));
      const box = h('div', { class: 'gcols' });
      cols.forEach((c) => {
        const cur = answers[q.id]?.[row.id];
        const checked = multi ? Array.isArray(cur) && cur.includes(c.id) : cur === c.id;
        const inp = h('input', { type: multi ? 'checkbox' : 'radio', name: `${q.id}:${row.id}`, checked });
        const lab = h('label', { class: `choice ${checked ? 'on' : ''}` }, inp, h('span', null, c.text));
        inp.addEventListener('change', () => {
          const a = get();
          if (multi) { const set = new Set(a[row.id] || []); if (inp.checked) set.add(c.id); else set.delete(c.id); if (set.size) a[row.id] = [...set]; else delete a[row.id]; lab.classList.toggle('on', inp.checked); } else {
            a[row.id] = c.id; box.querySelectorAll('.choice').forEach((x) => x.classList.remove('on')); lab.classList.add('on');
          }
          setAnswer(q, Object.keys(a).length ? a : '');
        });
        box.append(lab);
      });
      line.append(box); wrap.append(line);
    });
    return wrap;
  }

  function fileInput(q) {
    const wrap = h('div');
    const status = h('div', { class: 'small', style: { marginTop: '8px' } });
    const mb = q.config.max_mb || 5;
    const draw = () => {
      clear(status);
      if (answers[q.id]) {
        status.append(h('span', { class: 'pill ok' }, icon('check', 14), fileNames[q.id] || 'Berkas tersimpan'), ' ',
          h('button', { class: 'chipbtn', type: 'button', onclick: async () => { try { await api('DELETE', `/api/public/attempts/${attempt.id}/files/${q.id}`); } catch { /* abaikan */ } delete fileNames[q.id]; setAnswer(q, ''); draw(); } }, 'Hapus'));
      } else status.append(h('span', { class: 'muted' }, `Belum ada berkas · maks ${mb} MB`));
    };
    const pick = h('input', { type: 'file', accept: ACCEPT[q.config.accept || 'any'], style: { display: 'none' }, onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = ''; filePicking = false;
      if (!f) return;
      if (f.size > mb * 1024 * 1024) { toast(`Ukuran berkas maksimal ${mb} MB`, 'err'); return; }
      if (preview || !attempt) { toast('Unggah berkas tidak tersedia pada pratinjau', 'err'); return; }
      btn.disabled = true; btn.lastChild.textContent = 'Mengunggah…';
      try {
        const r = await api('POST', `/api/public/attempts/${attempt.id}/files/${q.id}`, undefined, { raw: f, headers: { 'x-filename': encodeURIComponent(f.name) } });
        fileNames[q.id] = r.filename; setAnswer(q, r.id);
      } catch (er) { toast(errMsg(er), 'err'); }
      btn.disabled = false; btn.lastChild.textContent = answers[q.id] ? 'Ganti berkas' : 'Pilih berkas'; draw();
    } });
    const btn = h('button', { class: 'btn', type: 'button', onclick: () => { filePicking = true; pick.click(); } }, icon('upload', 18), answers[q.id] ? 'Ganti berkas' : 'Pilih berkas');
    wrap.append(btn, pick, status); draw();
    return wrap;
  }

  function input(q) {
    const opts = () => (S.shuffle_options ? shuffled(q.options, `${slug}:${q.id}:${attempt?.id || ''}`) : q.options);
    switch (q.type) {
      case 'short': return h('input', { class: 'in underline', type: 'text', placeholder: 'Jawaban Anda', maxlength: 1000, value: answers[q.id] || '', oninput: (e) => setAnswer(q, e.target.value) });
      case 'paragraph': return h('textarea', { class: 'in underline', rows: 4, placeholder: 'Jawaban Anda', style: { resize: 'vertical' }, value: answers[q.id] || '', oninput: (e) => setAnswer(q, e.target.value) });
      case 'date': return h('input', { class: 'in', type: 'date', style: { maxWidth: '220px' }, value: answers[q.id] || '', onchange: (e) => setAnswer(q, e.target.value) });
      case 'time': return h('input', { class: 'in', type: 'time', style: { maxWidth: '180px' }, value: answers[q.id] || '', onchange: (e) => setAnswer(q, e.target.value) });
      case 'file': return fileInput(q);
      case 'grid': return gridInput(q);
      case 'ranking': return rankingInput(q, opts);
      case 'dropdown': if (opts().length > 25) {
        const list = opts(); const dlId = `dl-${q.id}`;
        const cur = list.find((o) => o.id === answers[q.id]);
        const inp = h('input', { class: 'in', type: 'text', list: dlId, autocomplete: 'off', placeholder: 'Ketik untuk mencari lalu pilih…', style: { maxWidth: '440px' }, value: cur ? cur.text : '', onchange: (e) => {
          const t = e.target.value.trim().toLowerCase();
          const m = list.find((o) => o.text.toLowerCase() === t);
          if (m) { e.target.value = m.text; e.target.classList.remove('bad'); setAnswer(q, m.id); } else { setAnswer(q, ''); e.target.classList.toggle('bad', !!t); }
        } });
        return h('div', null, inp, h('datalist', { id: dlId }, list.map((o) => h('option', { value: o.text }))), h('div', { class: 'tiny muted', style: { marginTop: '4px' } }, `${list.length} pilihan — pilih dari daftar yang muncul`));
      } else return h('select', { class: 'in', style: { maxWidth: '360px' }, value: answers[q.id] || '', onchange: (e) => setAnswer(q, e.target.value) },
        h('option', { value: '' }, 'Pilih…'), opts().map((o) => h('option', { value: o.id }, o.text)));
      case 'radio': {
        const wrap = h('div', { role: 'radiogroup' });
        for (const o of opts()) {
          const rb = h('input', { type: 'radio', name: q.id, checked: answers[q.id] === o.id });
          const lab = h('label', { class: `choice ${answers[q.id] === o.id ? 'on' : ''}` }, rb, h('span', null, o.text));
          rb.addEventListener('change', () => { setAnswer(q, o.id); wrap.querySelectorAll('.choice').forEach((c) => c.classList.remove('on')); lab.classList.add('on'); });
          wrap.append(lab);
        }
        if (!q.required) wrap.append(h('button', { class: 'chipbtn', type: 'button', onclick: () => { setAnswer(q, ''); wrap.querySelectorAll('input').forEach((i) => { i.checked = false; }); wrap.querySelectorAll('.choice').forEach((c) => c.classList.remove('on')); } }, 'Hapus pilihan'));
        return wrap;
      }
      case 'checkbox': {
        const wrap = h('div');
        for (const o of opts()) {
          const cb = h('input', { type: 'checkbox', checked: (answers[q.id] || []).includes(o.id) });
          const lab = h('label', { class: `choice ${cb.checked ? 'on' : ''}` }, cb, h('span', null, o.text));
          cb.addEventListener('change', () => {
            const cur = new Set(answers[q.id] || []);
            if (cb.checked) cur.add(o.id); else cur.delete(o.id);
            lab.classList.toggle('on', cb.checked);
            setAnswer(q, q.options.map((x) => x.id).filter((id) => cur.has(id)));
          });
          wrap.append(lab);
        }
        return wrap;
      }
      case 'scale': {
        const lo = q.config.min ?? 1; const hi = q.config.max ?? 5;
        const wrap = h('div', { class: 'scale', role: 'radiogroup' });
        for (let v = lo; v <= hi; v += 1) {
          const rb = h('input', { type: 'radio', name: q.id, checked: answers[q.id] === String(v) });
          const lab = h('label', { class: answers[q.id] === String(v) ? 'on' : '' }, h('span', null, String(v)), rb);
          rb.addEventListener('change', () => { setAnswer(q, String(v)); wrap.querySelectorAll('label').forEach((l) => l.classList.remove('on')); lab.classList.add('on'); });
          wrap.append(lab);
        }
        return h('div', null, wrap, (q.config.min_label || q.config.max_label) && h('div', { class: 'scalelabels' }, h('span', null, q.config.min_label || ''), h('span', null, q.config.max_label || '')));
      }
      default: return null;
    }
  }

  function questionEl(q) {
    if (q.type === 'section') { const el = h('div', { class: 'q section' }, h('div', { class: 'qt' }, q.title), q.description && h('div', { class: 'qd' }, q.description)); qEls.set(q.id, el); return el; }
    const el = h('div', { class: 'q', 'data-qid': q.id },
      quiz && q.points > 0 && h('span', { class: 'pts' }, `${num(q.points)} poin`),
      h('div', { class: 'qt' }, h('span', { class: 'num' }, ''), q.title || 'Pertanyaan', q.required && h('span', { class: 'req', title: 'Wajib diisi' }, '*')),
      q.description && h('div', { class: 'qd' }, q.description),
      q.config?.image && h('img', { class: 'qimg', src: `/uploads/${q.config.image}`, alt: '', loading: 'lazy' }),
      h('div', { style: { marginTop: '12px' } }, input(q)));
    qEls.set(q.id, el);
    return el;
  }

  function renderQuestions() {
    const list = h('div', { id: 'qlist' });
    for (const q of questions) list.append(questionEl(q));
    return list;
  }

  /* ---------- timer & status ---------- */
  let violEl = null;
  function startStatusBar() {
    const deadline = attempt.deadline_at ? new Date(attempt.deadline_at).getTime() : null;
    timerEl = h('div', { class: 'timer' }, deadline && h('div', { class: 'cap' }, icon('clock', 20), h('span', { id: 'tleft' }, '--:--')));
    if (AC) { violEl = h('span', { class: 'pill warn', style: { marginLeft: deadline ? '12px' : '0' } }, icon('shield', 14), `Pelanggaran ${violations}/${AC.max_violations}`); timerEl.append(violEl); }
    if (deadline) {
      let warned5 = false; let warned1 = false;
      const tick = () => {
        const left = deadline - (Date.now() + offset);
        timerEl.querySelector('#tleft').textContent = fmtMMSS(left);
        timerEl.classList.toggle('low', left <= 60000);
        if (left <= 300000 && !warned5 && left > 60000) { warned5 = true; toast('Sisa waktu 5 menit'); }
        if (left <= 60000 && !warned1 && left > 0) { warned1 = true; toast('Sisa waktu 1 menit!', 'err'); }
        if (left <= 0) { timers.forEach(clearInterval); submit(true); }
      };
      timers.push(setInterval(tick, 250));
      tick();
    }
    return timerEl;
  }

  /* ---------- anti-curang ---------- */
  let filePicking = false;
  let lastViolation = 0;
  let warnOpen = false;
  function setupAnticheat() {
    if (!AC || !quiz) return;
    const report = async (type) => {
      if (locked || submitting || !attempt || warnOpen) return;
      const now = Date.now(); if (now - lastViolation < 2000) return; lastViolation = now;
      try {
        const r = await api('POST', `/api/public/attempts/${attempt.id}/violation`, { type, answers: visibleAnswers() });
        violations = r.count || violations + 1;
        if (violEl) violEl.lastChild.textContent = `Pelanggaran ${violations}/${AC.max_violations}`;
        if (r.submitted && r.result) {
          locked = true; submitting = true; timers.forEach(clearInterval);
          try { localStorage.removeItem(LS(slug)); } catch { /* abaikan */ }
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          renderResult(r.result);
          toast('Batas pelanggaran tercapai. Jawaban dikirim otomatis.', 'err');
          return;
        }
        warnOpen = true;
        const remaining = (AC.max_violations - violations);
        modal({ title: 'Peringatan', body: h('div', null, h('p', { style: { margin: 0 } }, type === 'fullscreen' ? 'Anda keluar dari layar penuh.' : 'Anda meninggalkan halaman ujian.'),
          h('p', { class: 'muted', style: { marginBottom: 0 } }, `Pelanggaran ${violations} dari ${AC.max_violations}. ${remaining <= 1 ? 'Satu pelanggaran lagi akan mengirim jawaban otomatis.' : `Sisa ${remaining} kesempatan sebelum jawaban dikirim otomatis.`}`)),
        actions: [{ label: AC.fullscreen && !document.fullscreenElement ? 'Kembali ke layar penuh' : 'Lanjutkan ujian', kind: 'primary', onClick: () => { if (AC.fullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); } }],
        onClose: () => { warnOpen = false; } });
      } catch { /* jaringan: abaikan */ }
    };
    on(document, 'visibilitychange', () => { if (document.hidden && !filePicking) report('hidden'); });
    on(window, 'blur', () => { setTimeout(() => { if (!document.hasFocus() && !filePicking && !document.hidden) report('blur'); }, 80); });
    on(window, 'focus', () => { setTimeout(() => { filePicking = false; }, 400); });
    if (AC.fullscreen) on(document, 'fullscreenchange', () => { if (!document.fullscreenElement) report('fullscreen'); });
    if (AC.block_copy) {
      const stop = (e) => { if (attempt && !locked) e.preventDefault(); };
      ['copy', 'cut', 'paste', 'contextmenu', 'dragstart'].forEach((ev) => on(document, ev, stop));
    }
  }

  /* ---------- mulai ---------- */
  async function ensureAttempt() {
    if (attempt) return attempt;
    const body = { name: ident.name.trim(), email: ident.email.trim(), identifier: ident.identifier.trim(), preview, resume_id: preview ? undefined : localStorage.getItem(LS(slug)) || undefined };
    const r = await api('POST', `/api/public/forms/${encodeURIComponent(slug)}/start`, body);
    attempt = r.attempt;
    offset = new Date(r.server_now).getTime() - Date.now();
    if (r.questions) questions = applyOrder(r.questions);
    if (!preview) { try { localStorage.setItem(LS(slug), attempt.id); } catch { /* mode privat */ } }
    for (const [k, v] of Object.entries(attempt.answers || {})) answers[k] = v;
    return attempt;
  }

  /** Penanganan galat saat memulai; true bila sudah ditangani (layar diganti). */
  async function handleStartError(e, resuming) {
    const code = e.data?.error;
    if (resuming && e.status === 422) { // percobaan lama sudah tidak ada: minta identitas lagi
      try { localStorage.removeItem(LS(slug)); } catch { /* abaikan */ }
      renderIntro(); toast('Percobaan sebelumnya tidak ditemukan. Isi data Anda untuk mulai baru.', 'err'); return true;
    }
    if (code === 'already_submitted' || code === 'attempts_exhausted') {
      if (e.data.attempt_id) { try { renderResult(await api('GET', `/api/public/attempts/${e.data.attempt_id}/result`)); return true; } catch { /* lanjut */ } }
      stateCard('✅', code === 'already_submitted' ? 'Anda sudah mengisi' : 'Batas percobaan tercapai', e.message || 'Formulir ini sudah tidak dapat diisi lagi oleh Anda.'); return true;
    }
    if (code === 'not_allowed') { stateCard('🚫', 'Anda tidak terdaftar', 'Formulir ini hanya untuk peserta yang terdaftar. Periksa kembali email / NIM yang Anda isi, atau hubungi penyelenggara.', h('button', { class: 'btn', onclick: () => { renderIntro(); } }, 'Coba data lain')); return true; }
    if (e.status === 401) { stateCard('🔐', 'Masuk diperlukan', 'Formulir ini mewajibkan masuk dengan akun E-Portal UIKA.', h('a', { class: 'btn primary', href: loginUrl(), target: embed ? '_top' : undefined }, 'Masuk dengan E-Portal')); return true; }
    return false;
  }

  async function begin() {
    if (needLogin) return;
    const resuming = attemptResume();
    if (!resuming && !checkIdentity()) return;
    try { await ensureAttempt(); } catch (e) {
      if (await handleStartError(e, resuming)) return;
      toast(errMsg(e), 'err'); return;
    }
    if (AC && AC.fullscreen && document.documentElement.requestFullscreen) { try { await document.documentElement.requestFullscreen(); } catch { /* ditolak: lanjut */ } }
    renderForm();
    setupAnticheat();
  }

  /* ---------- tampilan: intro / form / hasil ---------- */
  function renderIntro() {
    clear(content);
    const lim = S.max_attempts;
    const items = [
      quiz && S.duration_min > 0 && `Waktu pengerjaan ${fmtDur(S.duration_min)}. Setelah waktu habis, jawaban terkirim otomatis.`,
      quiz && 'Jawaban tersimpan otomatis; bila halaman tertutup, Anda dapat melanjutkan selama waktu masih ada.',
      quiz && S.pick_count > 0 && 'Soal diambil acak untuk setiap peserta.',
      quiz && S.shuffle_questions && 'Urutan soal diacak.',
      lim === 1 || lim > 1 ? (lim === 1 ? 'Formulir ini hanya dapat dikerjakan satu kali.' : `Anda dapat mencoba maksimal ${lim} kali.`) : null,
      AC && `Jangan berpindah tab atau aplikasi selama ujian. Setelah ${AC.max_violations} pelanggaran, jawaban dikirim otomatis.`,
      AC && AC.fullscreen && 'Ujian berjalan dalam layar penuh.',
      AC && AC.block_copy && 'Salin, tempel, dan klik kanan dinonaktifkan.',
      S.allowlist && 'Hanya peserta terdaftar yang dapat mengisi.',
      S.attendance?.enabled && S.attendance.require_for_cert && form.certificate && 'Sertifikat terbit setelah Anda melakukan absensi kehadiran.',
      form.certificate && quiz && 'Sertifikat dikirim/diunduh setelah Anda memenuhi syarat nilai.',
    ].filter(Boolean);
    const rules = items.length ? h('div', { class: 'card' }, h('h3', null, 'Sebelum mulai'), h('ul', { class: 'muted', style: { margin: '6px 0 0', paddingLeft: '20px' } }, items.map((t) => h('li', null, t)))) : null;
    const resume = attemptResume();
    const label = resume ? (quiz ? 'Lanjutkan kuis' : 'Lanjutkan') : (quiz ? 'Mulai kuis' : 'Mulai mengisi');
    content.append(hero(chips()), resume ? h('div', { class: 'card small' }, icon('clock'), ` Anda punya percobaan yang belum selesai di perangkat ini. Tekan “${label}” untuk meneruskannya.`) : identityCard(), rules,
      h('div', { style: { textAlign: 'center', margin: '22px 0' } }, needLogin ? null : h('button', { class: 'btn primary lg', onclick: begin }, icon('send'), label)));
  }
  const attemptResume = () => { try { return !preview && !!localStorage.getItem(LS(slug)); } catch { return false; } };

  function renderForm() {
    clear(content); qEls.clear();
    progressBar = h('i'); progressText = h('span', { class: 'tiny muted' });
    const submitBtn = h('button', { class: 'btn primary lg', id: 'submitbtn', onclick: () => submit(false) }, icon('send'), 'Kirim');
    content.append(hero(chips()));
    if (attempt && (attempt.deadline_at || AC)) content.append(startStatusBar());
    if (!useIntro) content.append(identityCard());
    content.append(h('div', null, h('div', { class: 'progress' }, progressBar), h('div', { class: 'row' }, progressText, h('span', { class: 'spacer' }), h('span', { class: 'tiny muted' }, '* wajib diisi'))),
      renderQuestions(),
      h('div', { class: 'row', style: { margin: '22px 0', justifyContent: 'space-between' } }, submitBtn, h('button', { class: 'btn ghost', onclick: async () => { if (await confirmDialog('Kosongkan formulir?', 'Semua jawaban yang sudah diisi akan dihapus.', 'Kosongkan', true)) { Object.keys(answers).forEach((k) => delete answers[k]); renderForm(); } } }, 'Kosongkan formulir')));
    refreshVisibility(); updateProgress();
    if (quiz && attempt?.deadline_at && !preview) {
      beforeUnload = (e) => { if (!locked) { e.preventDefault(); e.returnValue = ''; } };
      window.addEventListener('beforeunload', beforeUnload);
    }
  }

  function lockUi(msg) {
    locked = true;
    qEls.forEach((el) => { el.style.pointerEvents = 'none'; el.style.opacity = '.7'; });
    const b = document.getElementById('submitbtn'); if (b) { b.disabled = true; b.textContent = msg || 'Mengirim…'; }
  }
  function unlockUi() {
    submitting = false; locked = false;
    qEls.forEach((el) => { el.style.pointerEvents = ''; el.style.opacity = ''; });
    const b = document.getElementById('submitbtn'); if (b) { b.disabled = false; b.textContent = 'Kirim'; }
  }

  async function submit(auto) {
    if (submitting) return;
    if (needLogin) { toast('Silakan masuk dengan E-Portal terlebih dahulu', 'err'); return; }
    if (!attempt) { // formulir tanpa kuis: peserta belum "mulai"
      if (!checkIdentity()) return;
    }
    const { visible, answers: kept } = applyLogic(questions, answers);
    if (!auto) {
      const missing = questions.filter((x) => visible.has(x.id) && x.required && x.type !== 'section' && !isAnswered(x, kept[x.id]));
      if (missing.length) {
        missing.forEach((x) => qEls.get(x.id)?.classList.add('err'));
        qEls.get(missing[0].id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast(`${missing.length} pertanyaan wajib belum diisi`, 'err');
        return;
      }
      if (quiz) {
        const un = questions.filter((x) => visible.has(x.id) && x.type !== 'section' && !isAnswered(x, kept[x.id])).length;
        if (un > 0 && !await confirmDialog('Kirim jawaban?', `${un} soal belum dijawab. Setelah dikirim, jawaban tidak dapat diubah.`, 'Kirim sekarang')) return;
        else if (un === 0 && !await confirmDialog('Kirim jawaban?', 'Setelah dikirim, jawaban tidak dapat diubah.', 'Kirim sekarang')) return;
      }
    }
    submitting = true;
    autosave.cancel();
    lockUi(auto ? 'Waktu habis — mengirim otomatis…' : 'Mengirim…');
    if (auto) toast('Waktu habis. Jawaban dikirim otomatis.', 'err');
    try {
      await ensureAttempt();
      const path = preview ? '/api/public/attempts/preview/submit' : `/api/public/attempts/${attempt.id}/submit`;
      const res = await api('POST', path, { answers: visibleAnswers(), auto, slug });
      timers.forEach(clearInterval);
      try { localStorage.removeItem(LS(slug)); } catch { /* abaikan */ }
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      renderResult(res);
    } catch (e) {
      unlockUi();
      if (!attempt && await handleStartError(e, false)) return;
      if (e.data?.error === 'required') {
        (e.data.missing || []).forEach((id) => qEls.get(id)?.classList.add('err'));
        toast(e.message, 'err'); return;
      }
      if (e.status === 409 && attempt) { try { renderResult(await api('GET', `/api/public/attempts/${attempt.id}/result`)); return; } catch { /* lanjut */ } }
      toast(`Gagal mengirim: ${errMsg(e)}. Jawaban Anda masih tersimpan di halaman ini, coba lagi.`, 'err');
    }
  }

  function canRetry(res) {
    if (preview) return false;
    const lim = S.max_attempts;
    return lim === 0 || (lim > 1 && (attempt?.attempt_no || 1) < lim);
  }

  function renderResult(res) {
    window.scrollTo(0, 0);
    clear(content);
    const card = h('div', { class: 'card', style: { textAlign: 'center', padding: '30px 22px' } },
      h('div', { class: 'check-anim' }, icon('check')),
      h('h2', null, res.status === 'auto_submitted' ? (violations && AC && violations >= AC.max_violations ? 'Jawaban dikirim otomatis' : 'Waktu habis — jawaban terkirim') : 'Jawaban terkirim'),
      h('p', { class: 'muted', style: { whiteSpace: 'pre-wrap' } }, res.message || ''));
    if (res.preview) card.append(h('span', { class: 'pill warn' }, 'Pratinjau — tidak disimpan'));
    if (res.quiz) {
      if (res.score !== undefined) {
        card.append(h('div', { class: 'ring', style: { '--p': res.percent ?? 0 } }, h('div', null, h('div', null, h('b', null, res.percent === null ? '—' : `${num(res.percent)}%`), h('span', null, `${num(res.score)} / ${num(res.max_score)} poin`)))));
      }
      if (!res.graded) card.append(h('p', { class: 'small', style: { color: '#b26a00' } }, 'Sebagian jawaban (esai / berkas) akan dinilai manual. Nilai akhir menyusul.'));
    }
    content.append(hero(), card);
    const c = res.certificate;
    if (c) {
      if (c.code) {
        const emailBtn = h('button', { class: 'btn', onclick: async () => {
          const send = async (email) => { emailBtn.disabled = true; try { const r = await api('POST', `/api/public/certificates/${c.code}/email`, email ? { email } : {}); toast(`Sertifikat dikirim ke ${r.sent_to}`); } catch (e) { toast(errMsg(e), 'err'); } emailBtn.disabled = false; };
          if (c.has_email) return send();
          const inp = h('input', { class: 'in', type: 'email', placeholder: 'nama@email.com' });
          modal({ title: 'Kirim ke email', body: h('div', null, h('label', { class: 'f' }, 'Alamat email'), inp), actions: [{ label: 'Batal' }, { label: 'Kirim', kind: 'primary', onClick: () => send(inp.value.trim()) }] });
          return undefined;
        } }, icon('mail'), 'Kirim ke email');
        content.append(h('div', { class: 'certbox', style: { margin: '14px 0' } }, h('div', { class: 'ico' }, icon('award', 24)),
          h('div', { class: 'grow' }, h('b', null, 'Sertifikat Anda sudah terbit'), h('div', { class: 'small muted' }, `${c.number ? `Nomor ${c.number} · ` : ''}Kode verifikasi: ${c.code}`)),
          h('a', { class: 'btn primary', href: `/api/public/certificates/${c.code}/pdf?download=1` }, icon('download'), 'Unduh PDF'), emailBtn,
          h('a', { class: 'btn ghost', href: `/verify/${c.code}`, 'data-link': '' }, 'Verifikasi')));
      } else if (c.needs_attendance) {
        content.append(h('div', { class: 'card small' }, icon('qr'), ' Sertifikat terbit setelah kehadiran Anda tercatat. Pindai kode QR absensi di lokasi kegiatan dengan email yang sama, lalu muat ulang halaman ini.'));
      } else if (c.pending) {
        content.append(h('div', { class: 'card small' }, icon('award'), ' Sertifikat akan terbit setelah jawaban Anda dinilai dan nilai memenuhi syarat. Simpan tautan ini lalu cek kembali nanti.'));
      } else if (res.quiz && res.graded && c.min_percent !== null) {
        content.append(h('div', { class: 'card small muted' }, `Sertifikat diberikan untuk nilai minimal ${c.min_percent}%.`));
      } else if (res.preview) {
        content.append(h('div', { class: 'card small muted' }, 'Pada pengisian sebenarnya, tombol unduh/kirim sertifikat muncul di sini setelah peserta memenuhi syarat.'));
      }
    }
    if (res.review) {
      content.append(h('div', { class: 'card' }, h('h3', { style: { marginBottom: '8px' } }, 'Tinjauan jawaban'), res.review.map((r, i) => h('div', { style: { padding: '12px 0', borderTop: i ? '.5px solid var(--line)' : 0 } },
        h('div', { class: 'row', style: { alignItems: 'flex-start' } }, h('b', { class: 'grow' }, `${i + 1}. ${r.title}`),
          r.correct === true && h('span', { class: 'pill ok' }, 'Benar'), r.correct === false && h('span', { class: 'pill bad' }, 'Salah'),
          r.max > 0 && h('span', { class: 'pill' }, `${num(r.points)}/${num(r.max)}`)),
        h('div', { class: 'small muted' }, `Jawaban Anda: ${r.answer || '—'}`),
        r.correct === false && r.correct_text && h('div', { class: 'small', style: { color: '#1f8a3b' } }, `Kunci: ${r.correct_text.join(' / ')}`)))));
    }
    if (canRetry(res)) {
      content.append(h('div', { style: { textAlign: 'center', margin: '18px 0' } }, h('button', { class: 'btn', onclick: () => {
        Object.keys(answers).forEach((k) => delete answers[k]); attempt = null; submitting = false; locked = false; violations = 0;
        try { localStorage.removeItem(LS(slug)); } catch { /* abaikan */ }
        if (form.questions_on_start) questions = [];
        if (useIntro) renderIntro(); else renderForm();
      } }, quiz ? 'Kerjakan lagi' : 'Kirim respons lain')));
    }
    if (preview) content.append(h('div', { style: { textAlign: 'center', margin: '18px 0' } }, h('a', { class: 'btn primary', href: `/forms/${form.id}/edit`, 'data-link': '' }, icon('back', 16), 'Kembali ke Editor')));
  }

  /* ---------- jalankan ---------- */
  if (useIntro) renderIntro(); else renderForm();
  return cleanup;
}
