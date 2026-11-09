/* Bagian-bagian Editor untuk fitur lanjutan: percabangan, tipe soal baru, daftar peserta, absensi,
   bank soal, tautan/QR/embed, nomor & kirim massal sertifikat. Semua menerima `c` (konteks editor). */
import { h, clear, icon, api, session, toast, modal, confirmDialog, uuid, errMsg, fmtDateTime, copyText, debounce } from '../core.js';
import { OP_LABEL } from '../logic.js';

const optId = () => `o${Math.random().toString(36).slice(2, 8)}`;
const subId = (p) => `${p}${Math.random().toString(36).slice(2, 7)}`;

/* ================= percabangan (tampilkan bila …) ================= */
const OPS_BY_TYPE = {
  radio: ['eq', 'neq', 'answered', 'not_answered'], dropdown: ['eq', 'neq', 'answered', 'not_answered'],
  checkbox: ['eq', 'neq', 'answered', 'not_answered'], scale: ['eq', 'neq', 'gt', 'lt', 'answered', 'not_answered'],
  short: ['eq', 'neq', 'contains', 'answered', 'not_answered'], paragraph: ['contains', 'answered', 'not_answered'],
  date: ['eq', 'gt', 'lt', 'answered', 'not_answered'], time: ['eq', 'answered', 'not_answered'],
  grid: ['answered', 'not_answered'], ranking: ['answered', 'not_answered'], file: ['answered', 'not_answered'],
};
const NEEDS_VALUE = (op) => !['answered', 'not_answered'].includes(op);
const EQ_LABEL = { checkbox: { eq: 'termasuk dipilih', neq: 'tidak dipilih' } };

export function showIfBuilder(q, idx, c, rerender) {
  const earlier = c.form.questions.slice(0, idx).filter((x) => x.type !== 'section');
  const rule = q.config.show_if;
  const box = h('div', { class: 'subbox' });
  box.append(h('div', { class: 'row' }, icon('branch', 16), h('h4', { class: 'grow', style: { margin: 0 } }, 'Logika tampil (percabangan)'),
    !rule && h('button', { class: 'btn sm', disabled: !earlier.length, title: earlier.length ? '' : 'Butuh pertanyaan lain sebelum ini', onclick: () => {
      const src = earlier[earlier.length - 1];
      q.config.show_if = { match: 'all', conds: [{ qid: src.id, op: OPS_BY_TYPE[src.type][0], value: '' }] }; rerender(); c.touch();
    } }, icon('plus', 14), 'Tambah syarat'),
    rule && h('button', { class: 'btn sm ghost', style: { color: 'var(--danger)' }, onclick: () => { delete q.config.show_if; rerender(); c.touch(); } }, 'Hapus logika')));
  if (!rule) { box.append(h('div', { class: 'tiny muted' }, 'Pertanyaan ini selalu tampil. Tambahkan syarat agar hanya tampil bila jawaban sebelumnya tertentu.')); return box; }
  const optionsOf = (src) => (src.options || []).map((o) => [o.id, o.text || '(kosong)']);
  rule.conds.forEach((cond, i) => {
    const src = earlier.find((x) => x.id === cond.qid) || earlier[earlier.length - 1];
    if (!src) return;
    const ops = OPS_BY_TYPE[src.type] || ['answered'];
    if (!ops.includes(cond.op)) cond.op = ops[0];
    const srcSel = h('select', { class: 'in', 'aria-label': 'Pertanyaan sumber', onchange: (e) => { cond.qid = e.target.value; const ns = earlier.find((x) => x.id === cond.qid); cond.op = OPS_BY_TYPE[ns.type][0]; cond.value = ''; rerender(); c.touch(); } },
      earlier.map((x, k) => h('option', { value: x.id, selected: x.id === src.id }, `${k + 1}. ${x.title || '(tanpa judul)'}`.slice(0, 70))));
    const opSel = h('select', { class: 'in', 'aria-label': 'Operator', onchange: (e) => { cond.op = e.target.value; rerender(); c.touch(); } },
      ops.map((o) => h('option', { value: o, selected: o === cond.op }, EQ_LABEL[src.type]?.[o] || OP_LABEL[o])));
    let valEl = null;
    if (NEEDS_VALUE(cond.op)) {
      if (['radio', 'dropdown', 'checkbox'].includes(src.type)) {
        const opts = optionsOf(src);
        if (!opts.some(([v]) => v === cond.value)) cond.value = opts[0]?.[0] || '';
        valEl = h('select', { class: 'in', 'aria-label': 'Nilai', onchange: (e) => { cond.value = e.target.value; c.touch(); } }, opts.map(([v, l]) => h('option', { value: v, selected: v === cond.value }, l)));
      } else if (src.type === 'scale') {
        const lo = src.config.min ?? 1; const hi = src.config.max ?? 5;
        const vals = Array.from({ length: hi - lo + 1 }, (_, k) => String(lo + k));
        if (!vals.includes(String(cond.value))) cond.value = vals[0];
        valEl = h('select', { class: 'in', 'aria-label': 'Nilai', onchange: (e) => { cond.value = e.target.value; c.touch(); } }, vals.map((v) => h('option', { value: v, selected: v === String(cond.value) }, v)));
      } else valEl = h('input', { class: 'in', type: src.type === 'date' ? 'date' : src.type === 'time' ? 'time' : 'text', value: cond.value ?? '', maxlength: 200, placeholder: 'Nilai', oninput: (e) => { cond.value = e.target.value; c.touch(); } });
    }
    box.append(h('div', { class: 'cond' }, h('span', { class: 'small muted', style: { minWidth: '44px' } }, i === 0 ? 'Tampil bila' : (rule.match === 'any' ? 'atau' : 'dan')), srcSel, opSel, valEl,
      h('button', { class: 'btn icon ghost', title: 'Hapus syarat', onclick: () => { rule.conds.splice(i, 1); if (!rule.conds.length) delete q.config.show_if; rerender(); c.touch(); } }, icon('x', 16))));
  });
  const last = rule.conds.length;
  box.append(h('div', { class: 'row wrap', style: { marginTop: '6px' } },
    h('button', { class: 'btn sm ghost', onclick: () => { const src = earlier[earlier.length - 1]; rule.conds.push({ qid: src.id, op: OPS_BY_TYPE[src.type][0], value: '' }); rerender(); c.touch(); } }, icon('plus', 14), 'Syarat lain'),
    last > 1 && h('span', { class: 'small muted' }, 'Tampil bila'),
    last > 1 && h('select', { class: 'in', style: { width: 'auto', padding: '6px 28px 6px 10px', fontSize: '13px' }, onchange: (e) => { rule.match = e.target.value; rerender(); c.touch(); } },
      h('option', { value: 'all', selected: rule.match !== 'any' }, 'semua syarat terpenuhi'), h('option', { value: 'any', selected: rule.match === 'any' }, 'salah satu syarat terpenuhi'))));
  return box;
}

/* ================= editor tipe baru ================= */
export function gridEditor(q, c, rerender) {
  const cfg = q.config; cfg.rows = cfg.rows || []; cfg.cols = cfg.cols || [];
  const list = (title, arr, prefix, hint) => h('div', { style: { flex: '1 1 240px', minWidth: 0 } }, h('label', { class: 'f' }, title),
    arr.map((it, i) => h('div', { class: 'opt', style: { padding: '4px 0' } },
      h('input', { class: 'in underline', value: it.text, placeholder: `${hint} ${i + 1}`, maxlength: 300, oninput: (e) => { it.text = e.target.value; c.touch(); } }),
      arr.length > 1 && h('button', { class: 'btn icon ghost', title: 'Hapus', onclick: () => { arr.splice(i, 1); rerender(); c.touch(); } }, icon('x', 16)))),
    h('button', { class: 'btn sm ghost', onclick: () => { arr.push({ id: subId(prefix), text: '' }); rerender(); c.touch(); } }, icon('plus', 14), 'Tambah'));
  return h('div', null, h('div', { class: 'row wrap', style: { alignItems: 'flex-start', gap: '18px' } }, list('Baris', cfg.rows, 'r', 'Baris'), list('Kolom', cfg.cols, 'c', 'Kolom')),
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'small muted' }, 'Boleh pilih lebih dari satu kolom per baris'), c.toggle(!!cfg.multi, (v) => { cfg.multi = v; c.touch(); })),
    h('div', { class: 'tiny muted', style: { marginTop: '6px' } }, 'Jawaban “wajib” berarti setiap baris harus diisi. Kisi tidak dinilai otomatis.'));
}

export function fileEditor(q, c, quiz) {
  const cfg = q.config;
  return h('div', null,
    h('div', { class: 'row wrap' }, h('span', { class: 'small muted' }, 'Jenis berkas'),
      c.sel(cfg.accept || 'any', [['any', 'Gambar / PDF / Word / Excel / PowerPoint'], ['image', 'Gambar (PNG, JPG)'], ['pdf', 'PDF'], ['doc', 'Dokumen Office']], (v) => { cfg.accept = v; c.touch(); }),
      h('span', { class: 'small muted' }, 'Maks.'), c.sel(String(cfg.max_mb || 5), [1, 2, 3, 4, 5].map((n) => [String(n), `${n} MB`]), (v) => { cfg.max_mb = Number(v); c.touch(); })),
    h('div', { class: 'tiny muted', style: { marginTop: '6px' } }, quiz ? 'Berkas dinilai manual di tab Respons › Individual (nilai maksimum = poin soal).' : 'Peserta mengunggah satu berkas; Anda mengunduhnya dari tab Respons.'));
}

/* ================= ekstra tiap pertanyaan: gambar, selalu muncul, logika ================= */
export function questionExtras(q, idx, c, rerender) {
  const box = h('div');
  if (q.type !== 'section') {
    box.append(h('div', { style: { marginTop: '12px' } }, c.imageSlot('Gambar pada pertanyaan', 'PNG/JPG (opsional), tampil di bawah judul', q.config.image, (nid) => { if (nid) q.config.image = nid; else delete q.config.image; c.touch(); })));
  }
  if (c.form.settings.is_quiz && (c.form.settings.pick_count || 0) > 0 && q.type !== 'section') {
    box.append(h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'small muted' }, 'Selalu sertakan (tidak ikut diacak/dipilih acak)'), c.toggle(!!q.config.always, (v) => { if (v) q.config.always = true; else delete q.config.always; c.touch(); })));
  }
  if (idx > 0) box.append(showIfBuilder(q, idx, c, rerender));
  return box;
}

export const PREVIEW = {
  file: (q) => `Unggah berkas (${{ any: 'semua jenis', image: 'gambar', pdf: 'PDF', doc: 'dokumen' }[q.config.accept || 'any']}, maks. ${q.config.max_mb || 5} MB)`,
  ranking: (q) => `Urutkan ${q.options.length} opsi`,
  grid: (q) => `Kisi ${(q.config.rows || []).length} baris × ${(q.config.cols || []).length} kolom${q.config.multi ? ' (boleh lebih dari satu)' : ''}`,
};

/* ================= pengaturan lanjutan ================= */
export function advancedSettings(c, again) {
  const S = c.form.settings; const { toggle, setting, sel } = c;
  const num = (value, min, max, onChange, w = '84px') => h('input', { class: 'in', type: 'number', min, max, value, style: { width: w }, oninput: (e) => onChange(Math.max(min, Math.min(max, Math.floor(Number(e.target.value) || 0)))) });
  const out = [];

  const resp = h('div', { class: 'card' }, h('h3', null, 'Percobaan & penilaian'),
    setting('Batas jumlah percobaan', '0 = tanpa batas. “Satu respons per orang” sama dengan 1 percobaan.', num(S.one_response ? 1 : S.max_attempts, 0, 50, (v) => { S.max_attempts = v; if (S.one_response && v !== 1) S.one_response = false; c.touch(); }, '84px')));
  if (S.is_quiz) resp.append(setting('Nilai yang dipakai bila mengulang', 'Dipakai untuk rekap, peringkat, dan sertifikat.', sel(S.score_policy, [['best', 'Nilai tertinggi'], ['last', 'Percobaan terakhir'], ['first', 'Percobaan pertama']], (v) => { S.score_policy = v; c.touch(); })));
  out.push(resp);

  if (S.is_quiz) {
    const qcount = c.form.questions.filter((x) => x.type !== 'section').length;
    out.push(h('div', { class: 'card' }, h('h3', null, 'Soal acak'),
      setting('Ambil sejumlah soal acak per peserta', `0 = tampilkan semua soal. Saat ini ada ${qcount} soal di formulir (isi bank soal lalu atur jumlah yang diambil).`, num(S.pick_count || 0, 0, Math.max(qcount, 1), (v) => { S.pick_count = v; c.touch(); }, '90px')),
      S.pick_count > 0 && h('div', { class: 'small muted', style: { paddingTop: '4px' } }, 'Tiap peserta mendapat subset berbeda. Tandai soal tertentu “Selalu sertakan” pada kartu soalnya.')));

    const A = S.anticheat;
    const ac = h('div', { class: 'card' }, h('h3', null, 'Anti-curang'),
      setting('Aktifkan pemantauan', 'Mendeteksi berpindah tab/aplikasi & keluar layar penuh; tiap kejadian dicatat dan diperingatkan.', toggle(A.enabled, (v) => { A.enabled = v; c.touch(); again(); })));
    if (A.enabled) ac.append(
      setting('Batas pelanggaran', 'Mencapai batas ini → jawaban terkirim otomatis.', num(A.max_violations, 1, 20, (v) => { A.max_violations = v || 1; c.touch(); })),
      setting('Blokir salin, tempel, dan klik kanan', null, toggle(A.block_copy, (v) => { A.block_copy = v; c.touch(); })),
      setting('Wajibkan layar penuh', 'Keluar dari layar penuh dihitung pelanggaran (tidak tersedia di semua perangkat, mis. iPhone).', toggle(A.fullscreen, (v) => { A.fullscreen = v; c.touch(); })),
      h('div', { class: 'tiny muted', style: { paddingTop: '6px' } }, 'Catatan: pemantauan berbasis browser mengurangi kecurangan tetapi tidak dapat menghentikan perangkat lain. Gunakan sebagai pelengkap pengawasan.'));
    out.push(ac);
  }

  out.push(h('div', { class: 'card' }, h('h3', null, 'Notifikasi email'), h('p', { class: 'small muted' }, 'Membutuhkan SMTP di server.'),
    setting('Beri tahu saya saat ada respons baru', 'Dikirim ke pemilik formulir, dirangkum maksimal sekali tiap 5 menit.', toggle(S.notify_owner, (v) => { S.notify_owner = v; c.touch(); })),
    setting('Kirim konfirmasi ke peserta', 'Email berisi bukti jawaban diterima (dan nilai bila ditampilkan).', toggle(S.confirm_email, (v) => { S.confirm_email = v; c.touch(); }))));

  out.push(h('div', { class: 'card' }, h('h3', null, 'Tampilan peserta'),
    setting('Bahasa formulir', 'Bahasa antarmuka yang dilihat peserta (isi pertanyaan tetap seperti yang Anda tulis).', sel(S.language, [['id', 'Bahasa Indonesia'], ['en', 'English']], (v) => { S.language = v; c.touch(); })),
    setting('Izinkan disematkan (iframe)', 'Formulir bisa ditempel di situs lain. Masuk E-Portal di dalam iframe bisa terhalang cookie pihak ketiga.', toggle(S.allow_embed, (v) => { S.allow_embed = v; c.touch(); }))));
  return out;
}

/* ================= daftar peserta (whitelist) ================= */
export function allowlistCard(c) {
  const S = c.form.settings; const A = S.allowlist;
  const card = h('div', { class: 'card' });
  const body = h('div');
  card.append(h('h3', null, 'Peserta yang diizinkan'),
    c.setting('Batasi hanya untuk daftar peserta', 'Hanya email/NIM dalam daftar yang bisa mengisi (dan absen).', c.toggle(A.enabled, (v) => { A.enabled = v; c.touch(); paint(); })), body);
  const paint = async () => {
    clear(body);
    if (!A.enabled) return;
    body.append(c.setting('Wajib login E-Portal', 'Tanpa login, kecocokan hanya berdasar email/NIM yang diketik peserta sehingga bisa dipalsukan. Aktifkan untuk keamanan penuh.', c.toggle(A.require_login, (v) => { A.require_login = v; c.touch(); })));
    const ta = h('textarea', { class: 'in mono', rows: 4, placeholder: 'Satu peserta per baris. Contoh:\nandi@uika-bogor.ac.id, 2021010123, Andi Wijaya\n2021010124\nsiti@gmail.com' });
    const file = h('input', { type: 'file', accept: '.txt,.csv,text/plain,text/csv', style: { display: 'none' }, onchange: async (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > 2e6) { toast('Berkas terlalu besar', 'err'); return; } ta.value = (ta.value ? `${ta.value}\n` : '') + await f.text(); e.target.value = ''; } });
    const replaceCb = h('input', { type: 'checkbox' });
    const out = h('div', { class: 'small' });
    body.append(h('div', { class: 'subbox' }, h('h4', null, 'Tambah peserta'), ta,
      h('div', { class: 'row wrap', style: { marginTop: '8px' } }, file, h('button', { class: 'btn sm', onclick: () => file.click() }, icon('upload', 14), 'Dari .csv/.txt'),
        h('label', { class: 'row small muted', style: { gap: '6px' } }, replaceCb, 'Ganti seluruh daftar'), h('span', { class: 'spacer' }),
        h('button', { class: 'btn sm primary', onclick: async () => {
          if (!ta.value.trim()) { toast('Isi daftar peserta dulu', 'err'); return; }
          if (replaceCb.checked && !await confirmDialog('Ganti seluruh daftar?', 'Daftar peserta yang ada akan dihapus dan diganti dengan isian ini.', 'Ganti', true)) return;
          try {
            const r = await api('POST', `/api/forms/${c.form.id}/allowlist`, { text: ta.value, replace: replaceCb.checked });
            toast(`${r.added} peserta baru ditambahkan`); ta.value = ''; replaceCb.checked = false;
            clear(out); if (r.warnings?.length) out.append(h('div', { style: { color: '#b26a00' } }, r.warnings.slice(0, 5).join(' · ')));
            loadList();
          } catch (e) { clear(out); out.append(h('div', { style: { color: 'var(--danger)' } }, errMsg(e), e.data?.warnings?.length ? ` — ${e.data.warnings.slice(0, 3).join(' · ')}` : '')); }
        } }, icon('plus', 14), 'Tambahkan')), out));
    const listEl = h('div', { style: { marginTop: '12px' } });
    body.append(listEl);
    async function loadList() {
      clear(listEl); listEl.append(h('div', { class: 'spinner' }));
      try {
        const d = await api('GET', `/api/forms/${c.form.id}/allowlist`);
        clear(listEl);
        listEl.append(h('div', { class: 'row wrap' }, h('b', { class: 'grow' }, `${d.total} peserta terdaftar`), h('span', { class: 'pill ok' }, `${d.submitted} sudah mengisi`), c.form.settings.attendance.enabled && h('span', { class: 'pill blue' }, `${d.attended} hadir`),
          d.total > 0 && h('button', { class: 'btn sm danger', onclick: async () => { if (!await confirmDialog('Hapus semua peserta di daftar?', 'Pembatasan tetap aktif; tidak ada yang bisa mengisi sampai Anda menambah peserta.', 'Hapus semua', true)) return; await api('DELETE', `/api/forms/${c.form.id}/allowlist?all=1`); loadList(); } }, 'Hapus semua')));
        if (!d.total) { listEl.append(h('p', { class: 'small muted' }, 'Belum ada peserta. Selama daftar kosong, tidak ada yang dapat mengisi.')); return; }
        listEl.append(h('div', { class: 'scroll-y' }, h('table', { class: 't' }, h('tbody', null, d.rows.map((r) => h('tr', null,
          h('td', null, h('b', null, r.name || r.email || r.identifier), h('div', { class: 'tiny muted' }, [r.email, r.identifier].filter(Boolean).join(' · '))),
          h('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } }, r.submitted && h('span', { class: 'pill ok' }, 'Mengisi'), ' ', r.attended && h('span', { class: 'pill blue' }, 'Hadir')),
          h('td', { style: { width: '40px' } }, h('button', { class: 'btn icon ghost', title: 'Hapus', onclick: async () => { await api('DELETE', `/api/forms/${c.form.id}/allowlist?email=${encodeURIComponent(r.email)}&identifier=${encodeURIComponent(r.identifier)}`); loadList(); } }, icon('x', 16)))))))));
      } catch (e) { clear(listEl); listEl.append(h('p', { class: 'small' }, errMsg(e))); }
    }
    loadList();
  };
  paint();
  return card;
}

/* ================= absensi QR ================= */
export function attendanceCard(c) {
  const S = c.form.settings; const T = S.attendance;
  const card = h('div', { class: 'card' }); const body = h('div');
  card.append(h('h3', null, 'Absensi (QR)'), c.setting('Aktifkan absensi', 'Peserta memindai QR di lokasi acara untuk mencatat kehadiran.', c.toggle(T.enabled, async (v) => { T.enabled = v; await c.touch(true); paint(); })), body);
  async function paint() {
    clear(body);
    if (!T.enabled) return;
    body.append(c.setting('Sertifikat hanya untuk yang hadir', c.form.cert.enabled ? 'Peserta yang mengisi tetapi belum absen belum mendapat sertifikat; sertifikat terbit otomatis begitu mereka absen.' : 'Aktifkan sertifikat dulu di tab Sertifikat.', c.toggle(T.require_for_cert, (v) => { T.require_for_cert = v; c.touch(); })));
    if (c.form.status !== 'published') body.append(h('p', { class: 'small', style: { color: '#b26a00' } }, 'Absensi hanya dapat dipakai peserta setelah formulir diterbitkan.'));
    const host = h('div', { class: 'subbox' }); body.append(host);
    let d;
    try { d = await api('GET', `/api/forms/${c.form.id}/checkins`); } catch (e) { host.append(h('p', null, errMsg(e))); return; }
    const draw = () => {
      clear(host);
      const qrSrc = (fmt) => `/api/forms/${c.form.id}/qr?kind=checkin&format=${fmt}&token=${d.token}${fmt === 'png' ? '&download=1' : ''}`;
      host.append(h('div', { class: 'row wrap', style: { alignItems: 'flex-start', gap: '18px' } },
        h('div', { class: 'qrbox' }, h('img', { src: qrSrc('svg'), alt: 'QR absensi' })),
        h('div', { class: 'grow', style: { minWidth: '220px' } }, h('label', { class: 'f' }, 'Tautan absensi'),
          h('div', { class: 'row' }, h('input', { class: 'in', readOnly: true, value: d.url, onfocus: (e) => e.target.select() }), h('button', { class: 'btn', onclick: () => copyText(d.url) }, icon('copy', 16))),
          h('div', { class: 'row wrap', style: { marginTop: '10px' } }, h('a', { class: 'btn sm', href: qrSrc('png'), download: '' }, icon('download', 14), 'Unduh QR (PNG)'),
            h('button', { class: 'btn sm ghost', onclick: async () => { if (!await confirmDialog('Buat QR baru?', 'QR/tautan lama berhenti berlaku. Berguna bila QR bocor ke orang yang tidak hadir.', 'Buat baru')) return; const r = await api('POST', `/api/forms/${c.form.id}/checkin-token`); d.token = r.token; d.url = r.url; draw(); } }, icon('refresh', 14), 'Buat QR baru')),
          h('div', { class: 'tiny muted', style: { marginTop: '8px' } }, 'Tampilkan QR ini di layar/proyektor atau cetak di meja registrasi.'))));
      const name = h('input', { class: 'in', placeholder: 'Nama' }); const email = h('input', { class: 'in', type: 'email', placeholder: 'Email' });
      host.append(h('div', { class: 'row wrap', style: { marginTop: '14px' } }, h('b', { class: 'grow' }, `${d.total} hadir`),
        h('a', { class: 'btn sm', href: `/api/forms/${c.form.id}/export.xlsx` }, icon('download', 14), 'Excel (sheet Kehadiran)')));
      host.append(h('div', { class: 'row wrap', style: { marginTop: '8px' } }, name, email, h('button', { class: 'btn sm', onclick: async () => {
        try { await api('POST', `/api/forms/${c.form.id}/checkins`, { name: name.value, email: email.value }); toast('Kehadiran dicatat'); d = await api('GET', `/api/forms/${c.form.id}/checkins`); draw(); } catch (e) { toast(errMsg(e), 'err'); }
      } }, icon('plus', 14), 'Catat manual')));
      if (d.rows.length) host.append(h('div', { class: 'scroll-y', style: { marginTop: '8px' } }, h('table', { class: 't' }, h('tbody', null, d.rows.map((r) => h('tr', null,
        h('td', null, h('b', null, r.name), h('div', { class: 'tiny muted' }, [r.email, r.identifier].filter(Boolean).join(' · '))), h('td', { class: 'tiny muted', style: { textAlign: 'right' } }, fmtDateTime(r.created_at)),
        h('td', { style: { width: '40px' } }, h('button', { class: 'btn icon ghost', title: 'Hapus', onclick: async () => { await api('DELETE', `/api/forms/${c.form.id}/checkins/${r.id}`); d = await api('GET', `/api/forms/${c.form.id}/checkins`); draw(); } }, icon('x', 16)))))))));
    };
    draw();
  }
  paint();
  return card;
}

/* ================= tautan pendek, QR, embed (modal Bagikan) ================= */
export function shareExtras(c, fillUrl) {
  const f = c.form; const wrap = h('div', { class: 'subbox' });
  const shortUrl = () => `${location.origin}/s/${f.alias || f.slug}`;
  const draw = () => {
    clear(wrap);
    const alias = h('input', { class: 'in', value: f.alias || '', placeholder: 'mis. kuis-pbo-2026', maxlength: 40, style: { flex: 1 } });
    const msg = h('div', { class: 'tiny', style: { minHeight: '16px', marginTop: '4px' } });
    wrap.append(h('h4', null, 'Tautan pendek'),
      h('div', { class: 'row' }, h('span', { class: 'small muted', style: { whiteSpace: 'nowrap' } }, `${location.host}/s/`), alias,
        h('button', { class: 'btn sm', onclick: async () => {
          try { const r = await api('PUT', `/api/forms/${f.id}/alias`, { alias: alias.value }); f.alias = r.alias; toast(r.alias ? 'Alias disimpan' : 'Alias dihapus'); draw(); } catch (e) { msg.style.color = 'var(--danger)'; msg.textContent = errMsg(e); }
        } }, 'Simpan')), msg,
      h('div', { class: 'row', style: { marginTop: '6px' } }, h('input', { class: 'in', readOnly: true, value: shortUrl(), onfocus: (e) => e.target.select() }), h('button', { class: 'btn', onclick: () => copyText(shortUrl()) }, icon('copy', 16))));
    wrap.append(h('div', { class: 'row wrap', style: { alignItems: 'flex-start', gap: '16px', marginTop: '14px' } },
      h('div', { class: 'qrbox', style: { width: '160px', height: '160px' } }, h('img', { src: `/api/forms/${f.id}/qr?kind=form&format=svg&v=${encodeURIComponent(f.alias || f.slug)}`, alt: 'QR formulir' })),
      h('div', { class: 'col', style: { gap: '8px' } }, h('div', { class: 'small muted' }, 'QR untuk poster, slide, atau grup chat.'),
        h('a', { class: 'btn sm', href: `/api/forms/${f.id}/qr?kind=form&format=png&download=1&v=${encodeURIComponent(f.alias || f.slug)}`, download: '' }, icon('download', 14), 'Unduh PNG'),
        h('a', { class: 'btn sm', href: `/api/forms/${f.id}/qr?kind=form&format=svg&v=${encodeURIComponent(f.alias || f.slug)}`, download: `qr-${f.slug}.svg`, target: '_blank', rel: 'noopener' }, icon('download', 14), 'Unduh SVG'))));
    const code = `<iframe src="${location.origin}/f/${f.alias || f.slug}?embed=1" width="100%" height="800" style="border:0" title="${(f.title || 'Formulir').replace(/"/g, '&quot;')}" loading="lazy"></iframe>`;
    wrap.append(h('h4', { style: { marginTop: '16px' } }, 'Sematkan (iframe)'),
      f.settings.allow_embed ? h('div', null, h('div', { class: 'codebox' }, code), h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn sm', onclick: () => copyText(code) }, icon('copy', 14), 'Salin kode')))
        : h('div', { class: 'row' }, h('span', { class: 'small muted grow' }, 'Penyematan belum diizinkan.'), h('button', { class: 'btn sm', onclick: () => { f.settings.allow_embed = true; c.touch(); draw(); } }, 'Izinkan penyematan')));
  };
  draw();
  return wrap;
}

/* ================= bank soal ================= */
const cloneQuestion = (bq) => {
  const q = JSON.parse(JSON.stringify(bq));
  const map = {}; q.options = (q.options || []).map((o) => { const id = optId(); map[o.id] = id; return { ...o, id }; });
  if (['radio', 'checkbox', 'dropdown', 'ranking'].includes(q.type)) q.correct = (q.correct || []).map((x) => map[x]).filter(Boolean);
  q.config = q.config || {}; q.id = uuid();
  if (q.type === 'grid') {
    const rm = {}; const cm = {};
    q.config.rows = (q.config.rows || []).map((r) => { const id = subId('r'); rm[r.id] = id; return { ...r, id }; });
    q.config.cols = (q.config.cols || []).map((cc) => { const id = subId('c'); cm[cc.id] = id; return { ...cc, id }; });
  }
  return q;
};

export async function pickFromBank(c, onInserted) {
  let banks;
  try { banks = await api('GET', '/api/banks'); } catch (e) { toast(errMsg(e), 'err'); return; }
  if (!banks.length) { toast('Belum ada bank soal. Simpan pertanyaan ke bank terlebih dahulu.', 'err'); return; }
  const bsel = h('select', { class: 'in' }, banks.map((b) => h('option', { value: b.id }, `${b.is_global ? '🌐 ' : ''}${b.name} (${b.count})`)));
  const mode = c.sel('all', [['all', 'Semua soal di bank'], ['random', 'Ambil acak sejumlah…']], () => { cnt.style.display = mode.value === 'random' ? '' : 'none'; }, { width: '100%' });
  const cnt = h('input', { class: 'in', type: 'number', min: 1, max: 1000, value: 10, style: { display: 'none', marginTop: '8px' } });
  modal({
    title: 'Ambil soal dari bank',
    body: h('div', { class: 'col' }, h('div', null, h('label', { class: 'f' }, 'Bank soal'), bsel), h('div', null, h('label', { class: 'f' }, 'Jumlah'), mode, cnt),
      h('p', { class: 'tiny muted', style: { margin: 0 } }, 'Soal disalin ke formulir ini; mengubah di sini tidak mengubah bank. Untuk memberi tiap peserta soal berbeda, impor semua soal lalu atur “Soal acak” di Pengaturan.')),
    actions: [{ label: 'Batal' }, { label: 'Tambahkan', kind: 'primary', onClick: async () => {
      try {
        const b = await api('GET', `/api/banks/${bsel.value}`);
        let list = b.questions;
        if (mode.value === 'random') { const n = Math.max(1, Math.min(list.length, Number(cnt.value) || 1)); list = [...list].sort(() => Math.random() - 0.5).slice(0, n); }
        const qs = list.map(cloneQuestion);
        if (c.form.settings.is_quiz) qs.forEach((q) => { if (!q.points && ['radio', 'checkbox', 'dropdown', 'short', 'scale', 'paragraph', 'file'].includes(q.type)) q.points = 10; });
        c.form.questions.push(...qs); toast(`${qs.length} soal ditambahkan`); onInserted(); c.touch();
      } catch (e) { toast(errMsg(e), 'err'); return false; }
    } }],
  });
}

export async function saveToBank(c) {
  const qs = c.form.questions.filter((x) => x.type !== 'section' && x.title.trim());
  if (!qs.length) { toast('Belum ada pertanyaan untuk disimpan', 'err'); return; }
  let banks = [];
  try { banks = (await api('GET', '/api/banks')).filter((b) => b.can_edit); } catch (e) { toast(errMsg(e), 'err'); return; }
  const checks = qs.map((q) => h('input', { type: 'checkbox', checked: true }));
  const target = h('select', { class: 'in' }, h('option', { value: '' }, '＋ Bank baru'), banks.map((b) => h('option', { value: b.id }, `${b.is_global ? '🌐 ' : ''}${b.name} (${b.count})`)));
  const nameIn = h('input', { class: 'in', placeholder: 'Nama bank soal baru', maxlength: 120, value: c.form.title.slice(0, 80) });
  const globalCb = h('input', { type: 'checkbox' });
  target.addEventListener('change', () => { nameIn.style.display = target.value ? 'none' : ''; gl.style.display = !target.value && session.user.role === 'admin' ? '' : 'none'; });
  const gl = h('label', { class: 'row small muted', style: { gap: '6px', display: session.user.role === 'admin' ? '' : 'none' } }, globalCb, 'Jadikan bank global (semua pembuat bisa memakai)');
  modal({
    title: 'Simpan ke bank soal',
    body: h('div', { class: 'col' }, h('div', null, h('label', { class: 'f' }, 'Simpan ke'), target), nameIn, gl,
      h('div', null, h('label', { class: 'f' }, `Soal yang disimpan (${qs.length})`), h('div', { class: 'scroll-y' }, qs.map((q, i) => h('label', { class: 'row', style: { padding: '5px 0', gap: '8px', alignItems: 'flex-start' } }, checks[i], h('span', { class: 'small' }, q.title.slice(0, 120)))))),
      h('p', { class: 'tiny muted', style: { margin: 0 } }, 'Judul bagian, gambar, dan logika tampil tidak ikut disimpan. Kunci jawaban & poin ikut.')),
    actions: [{ label: 'Batal' }, { label: 'Simpan', kind: 'primary', onClick: async () => {
      const chosen = qs.filter((_, i) => checks[i].checked);
      if (!chosen.length) { toast('Pilih minimal satu soal', 'err'); return false; }
      try {
        if (target.value) await api('PUT', `/api/banks/${target.value}`, { questions: chosen, append: true });
        else { if (!nameIn.value.trim()) { toast('Nama bank wajib diisi', 'err'); return false; } await api('POST', '/api/banks', { name: nameIn.value, questions: chosen, global: globalCb.checked }); }
        toast(`${chosen.length} soal disimpan ke bank`);
      } catch (e) { toast(errMsg(e), 'err'); return false; }
    } }],
  });
}

/* ================= sertifikat: templat, nomor, kirim massal ================= */
export function certTemplateCard(c, redraw) {
  const C = c.form.cert;
  const tpls = [['classic', 'Klasik'], ['modern', 'Modern'], ['elegant', 'Elegan'], ['minimal', 'Minimalis']];
  const ex = h('code', { class: 'kbd' }, '');
  const upd = () => { ex.textContent = (C.number_format || '').replace(/\{\{no(?::(\d))?\}\}/g, (_, n) => String(C.number_start || 1).padStart(Number(n || 0), '0')).replace('{{bulan}}', 'XI').replace('{{bulan_angka}}', '11').replace('{{tahun}}', String(new Date().getFullYear())) || '—'; };
  upd();
  return h('div', { class: 'card' }, h('h3', null, 'Templat & nomor sertifikat'),
    h('div', { class: 'tpl-grid' }, tpls.map(([v, l]) => h('button', { class: `tpl ${C.template === v ? 'on' : ''}`, onclick: () => { C.template = v; c.touch(); redraw(); } }, h('i', { class: v }), l))),
    h('div', { style: { marginTop: '16px' } }, h('label', { class: 'f' }, 'Format nomor resmi (kosongkan bila tidak perlu)'),
      h('input', { class: 'in', value: C.number_format || '', maxlength: 100, placeholder: '{{no:3}}/UIKA/SERT/{{bulan}}/{{tahun}}', oninput: (e) => { C.number_format = e.target.value; upd(); c.touch(); } }),
      h('div', { class: 'row wrap', style: { marginTop: '6px' } }, h('span', { class: 'tiny muted' }, 'Sisipkan:'), ['{{no:3}}', '{{bulan}}', '{{bulan_angka}}', '{{tahun}}'].map((t) => h('button', { class: 'chipbtn', onclick: () => { C.number_format = `${C.number_format || ''}${t}`; c.touch(); redraw(); } }, t))),
      h('div', { class: 'tiny muted', style: { marginTop: '6px' } }, '{{no:3}} = urutan 3 digit (001). {{bulan}} = angka Romawi. Contoh hasil: ', ex)),
    h('div', { class: 'row', style: { marginTop: '12px' } }, h('span', { class: 'small muted' }, 'Mulai dari nomor'), h('input', { class: 'in', type: 'number', min: 1, max: 999999, value: C.number_start || 1, style: { width: '110px' }, oninput: (e) => { C.number_start = Math.max(1, Math.floor(Number(e.target.value) || 1)); upd(); c.touch(); } }),
      h('span', { class: 'tiny muted' }, 'Nomor bertambah otomatis per sertifikat yang terbit.')));
}

export function bulkSendCard(c) {
  const card = h('div', { class: 'card' }); const body = h('div');
  card.append(h('h3', null, 'Sertifikat yang terbit'), body);
  let poll = null;
  const stop = () => { if (poll) { clearInterval(poll); poll = null; } };
  async function paint() {
    clear(body);
    let d; try { d = await api('GET', `/api/forms/${c.form.id}/certificates`); } catch (e) { body.append(h('p', { class: 'small' }, errMsg(e))); return; }
    const jobBox = h('div', { style: { marginTop: '10px' } });
    const resend = h('input', { type: 'checkbox' });
    body.append(h('div', { class: 'row wrap' }, h('b', { class: 'grow' }, `${d.total} sertifikat`),
      h('button', { class: 'btn primary', disabled: !d.total || !d.smtp, title: d.smtp ? '' : 'SMTP belum dikonfigurasi di server', onclick: async () => {
        if (!await confirmDialog('Kirim sertifikat ke semua peserta?', resend.checked ? 'Termasuk yang sudah pernah dikirim.' : 'Hanya yang belum pernah dikirim.', 'Kirim')) return;
        try { await api('POST', `/api/forms/${c.form.id}/certificates/send-all`, { resend: resend.checked }); watch(); } catch (e) { toast(errMsg(e), 'err'); }
      } }, icon('send', 16), 'Kirim semua ke email')),
    h('label', { class: 'row small muted', style: { gap: '6px', marginTop: '6px' } }, resend, 'Kirim ulang juga yang sudah terkirim'),
    !d.smtp && h('p', { class: 'small', style: { color: '#b26a00' } }, 'Pengiriman email belum aktif di server (SMTP). Peserta tetap bisa mengunduh sertifikat sendiri.'), jobBox);
    if (d.rows.length) body.append(h('div', { class: 'scroll-y', style: { marginTop: '10px' } }, h('table', { class: 't' }, h('tbody', null, d.rows.slice(0, 200).map((r) => h('tr', null,
      h('td', null, h('b', null, r.name), h('div', { class: 'tiny muted' }, [r.number, r.email].filter(Boolean).join(' · '))),
      h('td', { style: { textAlign: 'right' } }, r.emailed_at ? h('span', { class: 'pill ok' }, 'Terkirim') : h('span', { class: 'pill' }, 'Belum')),
      h('td', { style: { width: '70px' } }, h('a', { class: 'btn sm ghost', href: `/api/public/certificates/${r.code}/pdf?download=1` }, 'PDF'))))))));
    async function watch() {
      stop();
      const tick = async () => {
        let j; try { j = await api('GET', `/api/forms/${c.form.id}/certificates/send-all`); } catch { return; }
        clear(jobBox);
        const done = j.sent + j.failed + j.skipped;
        jobBox.append(h('div', { class: 'bar-prog' }, h('i', { style: { width: `${j.total ? (done / j.total) * 100 : 100}%` } })),
          h('div', { class: 'small muted', style: { marginTop: '4px' } }, `${done}/${j.total} diproses · ${j.sent} terkirim · ${j.skipped} dilewati · ${j.failed} gagal${j.done ? ' — selesai' : ''}`),
          j.errors?.length ? h('div', { class: 'tiny', style: { color: 'var(--danger)' } }, j.errors.join(' · ')) : null);
        if (j.done) { stop(); }
      };
      await tick(); poll = setInterval(tick, 1500);
    }
    api('GET', `/api/forms/${c.form.id}/certificates/send-all`).then((j) => { if (j && j.total && !j.done) watch(); }).catch(() => {});
  }
  paint();
  card._stop = stop;
  return card;
}

export { debounce };
