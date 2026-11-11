/* Admin › Formulir: tabel semua formulir dari semua pembuat, pencarian kata kunci (pertanyaan/judul/pembuat),
   detail isi lengkap, ekspor respons, dan hapus (satu atau banyak). */
import { h, clear, icon, api, toast, modal, confirmDialog, errMsg, fmtDateTime, debounce, num } from '../core.js';

const TYPE_LABEL = { short: 'Jawaban singkat', paragraph: 'Esai', radio: 'Pilihan ganda', checkbox: 'Kotak centang', dropdown: 'Dropdown', scale: 'Skala', date: 'Tanggal', time: 'Waktu', grid: 'Kisi', ranking: 'Peringkat', file: 'Unggah berkas', section: 'Judul bagian' };
const STATUS = { draft: ['Draf', ''], published: ['Dibuka', 'ok'], closed: ['Ditutup', 'bad'] };
const statusPill = (s) => h('span', { class: `pill ${STATUS[s]?.[1] || ''}` }, STATUS[s]?.[0] || s);

/** Teks dengan kata kunci disorot. */
function hl(text, kw) {
  const s = String(text ?? '');
  if (!kw) return s;
  const out = []; const low = s.toLowerCase(); const k = kw.toLowerCase();
  let i = 0;
  for (let j = low.indexOf(k); j !== -1 && k; j = low.indexOf(k, i)) { if (j > i) out.push(s.slice(i, j)); out.push(h('mark', null, s.slice(j, j + k.length))); i = j + k.length; }
  out.push(s.slice(i));
  return out;
}

export function adminFormsPane() {
  const st = { q: '', scope: 'all', status: '', kind: '', sort: 'updated', page: 1, rows: [], total: 0, selected: new Set() };
  const pane = h('div');
  const search = h('input', { class: 'in', type: 'search', placeholder: 'Cari kata kunci pertanyaan, judul, atau pembuat…', 'aria-label': 'Kata kunci', style: { flex: '2 1 260px' } });
  const pick = (opts, key, label) => h('select', { class: 'in af-sel', 'aria-label': label, onchange: (e) => { st[key] = e.target.value; reload(); } }, opts.map(([v, l]) => h('option', { value: v, selected: st[key] === v }, l)));
  const scopeSel = pick([['all', 'Cari di: semua'], ['question', 'Cari di: pertanyaan'], ['title', 'Cari di: judul formulir'], ['owner', 'Cari di: pembuat']], 'scope', 'Cakupan pencarian');
  const summary = h('div', { class: 'row wrap af-summary' });
  const tableHost = h('div');
  const more = h('div', { style: { textAlign: 'center', marginTop: '12px' } });
  const bulkBar = h('div', { class: 'af-bulk', style: { display: 'none' } });

  pane.append(
    h('div', { style: { marginBottom: '14px' } }, h('h1', { style: { fontSize: '30px' } }, 'Semua formulir'),
      h('p', { class: 'muted small', style: { margin: '4px 0 0' } }, 'Seluruh formulir dari semua pembuat. Cari berdasarkan kata kunci pada pertanyaan (judul, deskripsi, pilihan jawaban), judul formulir, atau nama/email pembuat.')),
    h('div', { class: 'card af-filters' },
      h('div', { class: 'row wrap' }, search, scopeSel),
      h('div', { class: 'row wrap', style: { marginTop: '10px' } },
        pick([['', 'Semua status'], ['draft', 'Draf'], ['published', 'Dibuka'], ['closed', 'Ditutup']], 'status', 'Status'),
        pick([['', 'Semua jenis'], ['quiz', 'Kuis'], ['form', 'Formulir/survei']], 'kind', 'Jenis'),
        pick([['updated', 'Urut: terakhir diubah'], ['created', 'Urut: terbaru dibuat'], ['responses', 'Urut: respons terbanyak'], ['title', 'Urut: judul A–Z']], 'sort', 'Urutan'))),
    summary, bulkBar, h('div', { class: 'card af-card' }, tableHost), more);

  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); reload(); }, 300));

  async function load(append) {
    if (!append) { clear(tableHost); tableHost.append(h('div', { class: 'spinner' })); }
    const qs = new URLSearchParams({ q: st.q, scope: st.scope, status: st.status, kind: st.kind, sort: st.sort, page: String(st.page) });
    let d;
    try { d = await api('GET', `/api/admin/forms?${qs}`); } catch (e) { clear(tableHost); tableHost.append(h('p', null, errMsg(e))); return; }
    st.total = d.total; st.rows = append ? [...st.rows, ...d.rows] : d.rows;
    clear(summary);
    summary.append(h('b', { class: 'grow' }, st.q ? `${d.total} formulir cocok dengan “${st.q}”` : `${d.total} formulir`),
      h('span', { class: 'small muted' }, `Total: ${d.totals.forms} formulir · ${d.totals.responses} respons · ${d.totals.creators} pembuat`));
    paint();
    clear(more);
    if (st.rows.length < d.total) more.append(h('button', { class: 'btn', onclick: () => { st.page += 1; load(true); } }, `Muat lagi (${d.total - st.rows.length})`));
  }
  const reload = () => { st.page = 1; st.selected.clear(); load(false); };

  function paintBulk() {
    clear(bulkBar);
    bulkBar.style.display = st.selected.size ? '' : 'none';
    if (!st.selected.size) return;
    bulkBar.append(h('b', { class: 'grow' }, `${st.selected.size} dipilih`),
      h('button', { class: 'btn sm ghost', onclick: () => { st.selected.clear(); paint(); } }, 'Batal pilih'),
      h('button', { class: 'btn sm danger', onclick: async () => {
        const n = st.selected.size;
        if (!await confirmDialog(`Hapus ${n} formulir?`, 'Semua pertanyaan, respons, berkas, dan sertifikat dari formulir terpilih ikut terhapus permanen. Tindakan ini tidak dapat dibatalkan.', 'Hapus permanen', true)) return;
        try { const r = await api('POST', '/api/admin/forms/delete', { ids: [...st.selected] }); toast(`${r.deleted} formulir dihapus`); reload(); } catch (e) { toast(errMsg(e), 'err'); }
      } }, icon('trash', 16), 'Hapus terpilih'));
  }

  function paint() {
    clear(tableHost); paintBulk();
    if (!st.rows.length) { tableHost.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, '🔎'), h('p', null, st.q ? 'Tidak ada formulir yang cocok.' : 'Belum ada formulir.'))); return; }
    const allOn = st.rows.every((r) => st.selected.has(r.id));
    const checkAll = h('input', { type: 'checkbox', checked: allOn, 'aria-label': 'Pilih semua', onchange: (e) => { st.rows.forEach((r) => (e.target.checked ? st.selected.add(r.id) : st.selected.delete(r.id))); paint(); } });
    tableHost.append(h('table', { class: 't resp af-table' },
      h('thead', null, h('tr', null, h('th', { style: { width: '32px' } }, checkAll), h('th', null, 'Formulir'), h('th', null, 'Pembuat'), h('th', null, 'Jenis'), h('th', null, 'Status'),
        h('th', { class: 'num' }, 'Soal'), h('th', { class: 'num' }, 'Respons'), h('th', null, 'Diubah'), h('th', null, ''))),
      h('tbody', null, st.rows.map((r) => h('tr', { class: st.selected.has(r.id) ? 'on' : '' },
        h('td', { class: 'cb' }, h('input', { type: 'checkbox', checked: st.selected.has(r.id), 'aria-label': `Pilih ${r.title}`, onchange: (e) => { if (e.target.checked) st.selected.add(r.id); else st.selected.delete(r.id); paint(); } })),
        h('td', { class: 'af-title', 'data-label': 'Formulir' },
          h('button', { class: 'linkbtn', translate: 'no', onclick: () => openDetail(r.id) }, hl(r.title || '(tanpa judul)', st.scope !== 'question' && st.scope !== 'owner' ? st.q : '')),
          h('div', { class: 'tiny muted', translate: 'no' }, `/f/${r.slug}`),
          r.match_count > 0 && h('div', { class: 'af-matches' }, h('span', { class: 'tiny muted' }, `${r.match_count} pertanyaan cocok:`),
            r.matches.map((m) => h('div', { class: 'af-match', translate: 'no' }, h('span', { class: 'tag' }, TYPE_LABEL[m.type] || m.type), ' ', hl(m.title || '(tanpa judul)', st.q))))),
        h('td', { 'data-label': 'Pembuat' }, h('div', { translate: 'no' }, hl(r.owner_name || '—', st.scope === 'owner' || st.scope === 'all' ? st.q : '')), h('div', { class: 'tiny muted', translate: 'no' }, hl(r.owner_email, st.scope === 'owner' || st.scope === 'all' ? st.q : ''))),
        h('td', { 'data-label': 'Jenis' }, h('span', { class: `pill ${r.is_quiz ? 'blue' : ''}` }, r.is_quiz ? 'Kuis' : 'Formulir'), r.cert ? h('span', { class: 'pill warn', title: 'Sertifikat aktif', style: { marginLeft: '4px' } }, icon('award', 12)) : null),
        h('td', { 'data-label': 'Status' }, statusPill(r.status)),
        h('td', { class: 'num', 'data-label': 'Soal' }, String(r.qn)),
        h('td', { class: 'num', 'data-label': 'Respons' }, String(r.rn)),
        h('td', { 'data-label': 'Diubah', class: 'nowrap' }, fmtDateTime(r.updated_at)),
        h('td', { class: 'acts' },
          h('button', { class: 'btn sm', onclick: () => openDetail(r.id) }, icon('eye', 14), 'Lihat'),
          h('button', { class: 'btn sm icon danger', title: 'Hapus formulir', 'aria-label': `Hapus ${r.title}`, onclick: () => removeOne(r) }, icon('trash', 16))))))));
  }

  async function removeOne(r, after) {
    if (!await confirmDialog(`Hapus “${r.title}”?`, `Milik ${r.owner_email}. Semua pertanyaan, ${r.rn ?? 0} respons, berkas, dan sertifikatnya ikut terhapus permanen.`, 'Hapus permanen', true)) return false;
    try { await api('DELETE', `/api/admin/forms/${r.id}`); toast('Formulir dihapus'); st.selected.delete(r.id); after?.(); reload(); return true; } catch (e) { toast(errMsg(e), 'err'); return false; }
  }

  async function openDetail(id) {
    let d;
    try { d = await api('GET', `/api/admin/forms/${id}`); } catch (e) { toast(errMsg(e), 'err'); return; }
    const S = d.settings; const kw = st.q;
    const info = (label, value) => h('div', { class: 'af-info' }, h('span', { class: 'tiny muted' }, label), h('b', null, value));
    let n = 0;
    const qEls = d.questions.map((q) => {
      if (q.type === 'section') return h('div', { class: 'af-sec', translate: 'no' }, h('b', null, hl(q.title || 'Bagian', kw)), q.description && h('div', { class: 'small muted' }, hl(q.description, kw)));
      n += 1;
      const key = new Set(q.correct || []);
      const body = [];
      if (q.options?.length) {
        body.push(h('ul', { class: 'af-opts', translate: 'no' }, q.options.map((o, i) => h('li', { class: key.has(o.id) ? 'key' : '' },
          q.type === 'ranking' ? `${i + 1}. ` : '', hl(o.text || '(kosong)', kw), key.has(o.id) ? h('span', { class: 'af-key' }, icon('check', 14), 'kunci') : null))));
        if (q.config?.list_id) body.push(h('div', { class: 'tiny muted' }, 'Pilihan diambil dari daftar tersimpan.'));
      }
      if (q.type === 'grid') body.push(h('div', { class: 'small', translate: 'no' }, h('b', null, 'Baris: '), (q.config.rows || []).map((x) => x.text).join(', '), h('br'), h('b', null, 'Kolom: '), (q.config.cols || []).map((x) => x.text).join(', ')));
      if (q.type === 'scale') body.push(h('div', { class: 'small muted' }, `Skala ${q.config.min ?? 1}–${q.config.max ?? 5}${q.config.min_label ? ` (${q.config.min_label} → ${q.config.max_label || ''})` : ''}`));
      if (q.type === 'short' && key.size) body.push(h('div', { class: 'small', style: { color: 'var(--c-ok)' }, translate: 'no' }, `Jawaban benar: ${[...key].join(' / ')}`));
      if (q.type === 'scale' && key.size) body.push(h('div', { class: 'small', style: { color: 'var(--c-ok)' } }, `Kunci: ${[...key].join(', ')}`));
      if (q.type === 'file') body.push(h('div', { class: 'small muted' }, `Unggah berkas (${q.config.accept || 'any'}, maks. ${q.config.max_mb || 5} MB)`));
      return h('div', { class: 'af-q' },
        h('div', { class: 'row', style: { alignItems: 'flex-start' } }, h('span', { class: 'af-num' }, `${n}.`),
          h('div', { class: 'grow' }, h('div', { class: 'af-qt', translate: 'no' }, hl(q.title || '(tanpa judul)', kw), q.required ? h('span', { class: 'req' }, ' *') : null),
            q.description && h('div', { class: 'small muted', translate: 'no' }, hl(q.description, kw)),
            h('div', { class: 'row wrap', style: { gap: '6px', margin: '6px 0' } }, h('span', { class: 'tag' }, TYPE_LABEL[q.type] || q.type), q.points > 0 && h('span', { class: 'pill' }, `${num(q.points)} poin`),
              q.config?.show_if && h('span', { class: 'tag' }, icon('branch', 12), 'Logika tampil'), q.config?.image && h('span', { class: 'tag' }, icon('image', 12), 'Bergambar')),
            body)));
    });
    const m = modal({
      wide: true,
      title: d.title || '(tanpa judul)',
      body: h('div', { class: 'col af-detail' },
        h('div', { class: 'row wrap', style: { gap: '6px' } }, statusPill(d.status), h('span', { class: `pill ${S.is_quiz ? 'blue' : ''}` }, S.is_quiz ? 'Kuis' : 'Formulir'), d.cert.enabled && h('span', { class: 'pill warn' }, icon('award', 12), 'Sertifikat'),
          h('span', { class: 'tiny muted', translate: 'no' }, `/f/${d.slug}${d.alias ? ` · /s/${d.alias}` : ''}`)),
        d.description && h('p', { class: 'small muted', style: { margin: 0, whiteSpace: 'pre-wrap' }, translate: 'no' }, d.description),
        h('div', { class: 'af-grid' },
          info('Pembuat', `${d.owner.name || '—'} (${d.owner.email})`), info('Dibuat', fmtDateTime(d.created_at)), info('Diubah', fmtDateTime(d.updated_at)),
          info('Respons', `${d.counts.responses}${d.counts.in_progress ? ` (+${d.counts.in_progress} sedang mengisi)` : ''}`), info('Respons terakhir', d.counts.last_response ? fmtDateTime(d.counts.last_response) : '—'),
          info('Sertifikat terbit', String(d.counts.certificates)), info('Kehadiran', String(d.counts.checkins)), info('Peserta terdaftar', d.settings.allowlist.enabled ? String(d.counts.allowed) : 'Tidak dibatasi'),
          info('Identitas', { ask: 'Nama & email', login: 'Wajib login', none: 'Anonim' }[S.identity] || S.identity),
          S.is_quiz && info('Durasi', S.duration_min ? `${S.duration_min} menit` : 'Tanpa batas'), S.is_quiz && info('Anti-curang', S.anticheat.enabled ? `Aktif (maks. ${S.anticheat.max_violations})` : 'Tidak')),
        d.editors.length > 0 && h('div', { class: 'small' }, h('b', null, 'Editor tambahan: '), h('span', { translate: 'no' }, d.editors.map((e) => e.email).join(', '))),
        h('div', { class: 'row wrap' },
          h('a', { class: 'btn sm', href: `/f/${d.slug}`, target: '_blank', rel: 'noopener' }, icon('ext', 14), 'Buka halaman pengisian'),
          h('a', { class: 'btn sm', href: `/api/admin/forms/${d.id}/export.xlsx` }, icon('download', 14), 'Unduh respons (Excel)')),
        h('h3', { style: { margin: '6px 0 0' } }, `Pertanyaan (${n})`),
        d.questions.length ? h('div', { class: 'af-qlist' }, qEls) : h('p', { class: 'small muted' }, 'Belum ada pertanyaan.')),
      actions: [
        { label: 'Hapus formulir', kind: 'danger', keepOpen: true, onClick: async () => { await removeOne({ id: d.id, title: d.title, owner_email: d.owner.email, rn: d.counts.responses }, () => m.close()); } },
        { label: 'Tutup', kind: 'primary' },
      ],
    });
  }

  reload();
  return pane;
}
