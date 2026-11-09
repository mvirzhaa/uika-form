'use strict';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://uikaform:uikaform@localhost:5432/uikaform_test';
process.env.DEV_LOGIN = 'true';
process.env.NODE_ENV = 'test';
process.env.BASE_URL = 'http://localhost:0';
process.env.RATE_LIMIT_PER_MIN = '10000';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { pool, migrate } = require('../src/db');
const { createApp } = require('../src/app');

let server; let base;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function call(method, path, { user, body, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (user?.cookie) h.cookie = user.cookie;
  let payload;
  if (raw !== undefined) payload = raw; else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + path, { method, headers: h, body: payload, redirect: 'manual' });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
  return { status: r.status, data, headers: r.headers };
}

async function login(email, name) {
  const r = await fetch(`${base}/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return { cookie, ...(await r.json()).user };
}

test.before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  const app = createApp();
  await new Promise((res) => { server = app.listen(0, res); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await pool.end(); });

let alice; let bob; let carol; let form; let qMc; let qCheck; let qShort; let qEssay;

test('login dan identitas', async () => {
  alice = await login('alice@uika-bogor.ac.id', 'Alice');
  bob = await login('bob@uika-bogor.ac.id', 'Bob');
  carol = await login('carol@uika-bogor.ac.id', 'Carol');
  const me = await call('GET', '/api/me', { user: alice });
  assert.equal(me.data.user.email, 'alice@uika-bogor.ac.id');
  assert.equal((await call('GET', '/api/me')).data.user, null);
  assert.equal((await call('GET', '/api/forms')).status, 401);
});

test('buat kuis, simpan pertanyaan lengkap dengan kunci', async () => {
  const c = await call('POST', '/api/forms', { user: alice, body: { kind: 'quiz', title: 'Kuis Uji' } });
  assert.equal(c.status, 201);
  form = c.data;
  qMc = { id: crypto.randomUUID(), type: 'radio', title: '2+2?', required: true, points: 10, options: [{ id: 'a', text: '3' }, { id: 'b', text: '4' }], correct: ['b'] };
  qCheck = { id: crypto.randomUUID(), type: 'checkbox', title: 'Prima?', points: 10, options: [{ id: 'a', text: '2' }, { id: 'b', text: '4' }, { id: 'c', text: '5' }], correct: ['a', 'c'] };
  qShort = { id: crypto.randomUUID(), type: 'short', title: 'Presiden pertama?', points: 10, correct: ['Soekarno', 'Bung Karno'] };
  qEssay = { id: crypto.randomUUID(), type: 'paragraph', title: 'Jelaskan', points: 20 };
  const put = await call('PUT', `/api/forms/${form.id}`, {
    user: alice,
    body: {
      title: 'Kuis Uji', status: 'published', theme: { color: '#ff3b30', bg: '#fff5f5', header_style: 'solid', font: 'serif' },
      settings: { is_quiz: true, duration_min: 30, identity: 'ask', show_score: 'immediately', show_answers: true },
      cert: { enabled: true, min_percent: 60, signer_name: 'Rektor', auto_email: false },
      questions: [qMc, qCheck, qShort, qEssay],
    },
  });
  assert.equal(put.status, 200);
  assert.equal(put.data.questions.length, 4);
  assert.equal(put.data.theme.color, '#ff3b30');
  form = put.data;
});

test('hak akses editor: hanya pemilik dan email yang didaftarkan', async () => {
  assert.equal((await call('GET', `/api/forms/${form.id}`, { user: carol })).status, 404);
  assert.equal((await call('PUT', `/api/forms/${form.id}`, { user: carol, body: { title: 'x' } })).status, 404);
  assert.equal((await call('GET', `/api/forms/${form.id}`, { user: bob })).status, 404);
  assert.equal((await call('GET', '/api/forms', { user: carol })).data.length, 0);

  const add = await call('POST', `/api/forms/${form.id}/editors`, { user: alice, body: { email: 'BOB@uika-bogor.ac.id' } });
  assert.equal(add.status, 201);
  const g = await call('GET', `/api/forms/${form.id}`, { user: bob });
  assert.equal(g.status, 200);
  assert.equal(g.data.role, 'editor');
  assert.equal((await call('GET', '/api/forms', { user: bob })).data.length, 1);
  assert.equal((await call('PUT', `/api/forms/${form.id}`, { user: bob, body: { title: 'Kuis Uji', status: 'published', settings: form.settings, cert: form.cert, theme: form.theme, questions: form.questions } })).status, 200);

  // editor tidak boleh menambah editor, menghapus form, atau mengeluarkan orang lain
  assert.equal((await call('POST', `/api/forms/${form.id}/editors`, { user: bob, body: { email: 'carol@uika-bogor.ac.id' } })).status, 403);
  assert.equal((await call('DELETE', `/api/forms/${form.id}`, { user: bob })).status, 403);
  assert.equal((await call('GET', `/api/forms/${form.id}`, { user: carol })).status, 404);
  assert.equal((await call('GET', `/api/forms/${form.id}/responses`, { user: carol })).status, 404);
});

test('API publik tidak membocorkan kunci jawaban', async () => {
  const r = await call('GET', `/api/public/forms/${form.slug}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.state, 'open');
  assert.equal(r.data.questions.length, 4);
  const txt = JSON.stringify(r.data);
  assert.ok(!txt.includes('"correct"'), 'kunci jawaban bocor');
  assert.ok(!txt.includes('Soekarno'));
});

let attempt;
test('mulai: identitas wajib; durasi menghasilkan tenggat', async () => {
  assert.equal((await call('POST', `/api/public/forms/${form.slug}/start`, { body: {} })).status, 422);
  const s = await call('POST', `/api/public/forms/${form.slug}/start`, { body: { name: 'Dina Peserta', email: 'dina@example.com', identifier: '2023001' } });
  assert.equal(s.status, 201);
  attempt = s.data.attempt;
  const diff = new Date(attempt.deadline_at) - new Date(s.data.server_now);
  assert.ok(Math.abs(diff - 30 * 60000) < 5000);
});

test('kirim: wajib diisi, penilaian otomatis, esai menunggu, sertifikat tertunda', async () => {
  const miss = await call('POST', `/api/public/attempts/${attempt.id}/submit`, { body: { answers: {} } });
  assert.equal(miss.status, 422);
  assert.deepEqual(miss.data.missing, [qMc.id]);

  await call('PUT', `/api/public/attempts/${attempt.id}/save`, { body: { answers: { [qMc.id]: 'b' } } });
  const sub = await call('POST', `/api/public/attempts/${attempt.id}/submit`, {
    body: { answers: { [qMc.id]: 'b', [qCheck.id]: ['a', 'c'], [qShort.id]: ' soekarno ', [qEssay.id]: 'Karena ...' } },
  });
  assert.equal(sub.status, 200);
  assert.equal(sub.data.score, 30);
  assert.equal(sub.data.max_score, 50);
  assert.equal(sub.data.graded, false);
  assert.equal(sub.data.certificate.pending, true);
  assert.equal(sub.data.certificate.code, null);
  assert.equal(sub.data.review.find((x) => x.id === qMc.id).correct, true);

  const again = await call('POST', `/api/public/attempts/${attempt.id}/submit`, { body: { answers: {} } }); // idempoten
  assert.equal(again.status, 200);
  assert.equal(again.data.score, 30);
});

test('penilaian esai manual → sertifikat terbit, PDF valid, verifikasi QR', async () => {
  const list = await call('GET', `/api/forms/${form.id}/responses`, { user: alice });
  assert.equal(list.data.total, 1);
  const rid = list.data.rows[0].id;
  const g = await call('PATCH', `/api/forms/${form.id}/responses/${rid}/grade`, { user: alice, body: { scores: { [qEssay.id]: 18 } } });
  assert.equal(g.status, 200);
  assert.equal(g.data.score, 48);
  assert.equal(g.data.graded, true);
  assert.match(g.data.cert_code, /^UIKA-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{2}$/);

  const res = await call('GET', `/api/public/attempts/${attempt.id}/result`);
  assert.equal(res.data.certificate.code, g.data.cert_code);

  const pdf = await call('GET', `/api/public/certificates/${g.data.cert_code}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.data.length > 3000);

  const v = await call('GET', `/api/public/verify/${g.data.cert_code}`);
  assert.equal(v.data.valid, true);
  assert.equal(v.data.name, 'Dina Peserta');
  assert.equal((await call('GET', '/api/public/verify/UIKA-AAAA-BBBB-CC')).data.valid, false);

  // email: SMTP belum dikonfigurasi → 503 yang jelas
  const em = await call('POST', `/api/public/certificates/${g.data.cert_code}/email`, { body: {} });
  assert.equal(em.status, 503);
});

test('nilai di bawah batas lulus tidak mendapat sertifikat', async () => {
  const s = await call('POST', `/api/public/forms/${form.slug}/start`, { body: { name: 'Eko', email: 'eko@example.com' } });
  const sub = await call('POST', `/api/public/attempts/${s.data.attempt.id}/submit`, { body: { answers: { [qMc.id]: 'a' } } });
  assert.equal(sub.data.score, 0);
  const rid = (await call('GET', `/api/forms/${form.id}/responses`, { user: alice })).data.rows.find((r) => r.name === 'Eko').id;
  const g = await call('PATCH', `/api/forms/${form.id}/responses/${rid}/grade`, { user: alice, body: { scores: { [qEssay.id]: 5 } } });
  assert.equal(g.data.cert_code, null);
});

test('timer: lewat batas waktu → dikirim otomatis memakai simpanan terakhir', async () => {
  const s = await call('POST', `/api/public/forms/${form.slug}/start`, { body: { name: 'Fani', email: 'fani@example.com' } });
  const id = s.data.attempt.id;
  await call('PUT', `/api/public/attempts/${id}/save`, { body: { answers: { [qMc.id]: 'b' } } });
  await pool.query("UPDATE responses SET deadline_at = now() - interval '10 minutes' WHERE id=$1", [id]);
  // peserta mencoba mengirim jawaban baru setelah waktu habis: harus ditolak (memakai simpanan lama)
  const sub = await call('POST', `/api/public/attempts/${id}/submit`, { body: { answers: { [qMc.id]: 'b', [qCheck.id]: ['a', 'c'], [qShort.id]: 'Bung Karno' } } });
  assert.equal(sub.status, 200);
  assert.equal(sub.data.status, 'auto_submitted');
  assert.equal(sub.data.score, 10);
  const save = await call('PUT', `/api/public/attempts/${id}/save`, { body: { answers: {} } });
  assert.equal(save.status, 409);
});

test('auto-submit dari klien saat waktu habis (tanpa validasi wajib)', async () => {
  const s = await call('POST', `/api/public/forms/${form.slug}/start`, { body: { name: 'Gita', email: 'gita@example.com' } });
  const sub = await call('POST', `/api/public/attempts/${s.data.attempt.id}/submit`, { body: { auto: true, answers: {} } });
  assert.equal(sub.status, 200);
  assert.equal(sub.data.status, 'auto_submitted');
});

test('ringkasan, per-peserta, dan ekspor Excel', async () => {
  const sum = await call('GET', `/api/forms/${form.id}/summary`, { user: alice });
  assert.ok(sum.data.total >= 4);
  assert.equal(sum.data.scores.histogram.length, 10);
  const qm = sum.data.questions.find((x) => x.id === qMc.id);
  assert.equal(qm.options.find((o) => o.id === 'b').correct, true);
  assert.ok(qm.correct_rate >= 0);

  const x = await call('GET', `/api/forms/${form.id}/export.xlsx`, { user: alice });
  assert.equal(x.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(x.data);
  const ws = wb.getWorksheet('Respons');
  assert.ok(ws.rowCount >= 5);
  assert.equal(ws.getRow(1).getCell(9).value, 'Nilai');
  assert.equal((await call('GET', `/api/forms/${form.id}/export.xlsx`, { user: carol })).status, 404);
});

test('template Excel dapat diunduh dan diimpor kembali', async () => {
  for (const kind of ['survey', 'quiz']) {
    const t = await call('GET', `/api/templates/${kind}.xlsx`);
    assert.equal(t.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(t.data);
    assert.ok(wb.getWorksheet('Soal'));
    assert.ok(wb.getWorksheet('Petunjuk'));

    const f = (await call('POST', '/api/forms', { user: alice, body: { kind: kind === 'quiz' ? 'quiz' : 'form', title: `Impor ${kind}` } })).data;
    const imp = await call('POST', `/api/forms/${f.id}/import-excel?mode=replace`, { user: alice, raw: t.data, headers: { 'content-type': 'application/octet-stream' } });
    assert.equal(imp.status, 200, JSON.stringify(imp.data));
    assert.ok(imp.data.imported >= 8);
    const types = new Set(imp.data.questions.map((x) => x.type));
    for (const need of ['short', 'paragraph', 'radio', 'checkbox', 'dropdown', 'scale', 'section']) assert.ok(types.has(need), `${kind}: tipe ${need} tidak terimpor`);
    if (kind === 'quiz') {
      const mc = imp.data.questions.find((x) => x.type === 'radio');
      assert.equal(mc.points, 10);
      assert.equal(mc.correct.length, 1);
      const cb = imp.data.questions.find((x) => x.type === 'checkbox');
      assert.equal(cb.correct.length, 3);
      const sh = imp.data.questions.find((x) => x.type === 'short');
      assert.ok(sh.correct.includes('Ir. Soekarno'));
    }
  }
  const bad = await call('POST', `/api/forms/${(await call('GET', '/api/forms', { user: alice })).data[0].id}/import-excel`, { user: alice, raw: Buffer.from('bukan excel'), headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(bad.status, 422);
});

test('satu respons per orang (login) dan jadwal tutup', async () => {
  const f = (await call('POST', '/api/forms', { user: alice, body: { title: 'Survei' } })).data;
  const q1 = { id: crypto.randomUUID(), type: 'scale', title: 'Puas?', required: true, config: { min: 1, max: 5 } };
  await call('PUT', `/api/forms/${f.id}`, { user: alice, body: { title: 'Survei', status: 'published', settings: { identity: 'login', one_response: true }, questions: [q1] } });
  assert.equal((await call('POST', `/api/public/forms/${f.slug}/start`, { body: {} })).status, 401);
  const s = await call('POST', `/api/public/forms/${f.slug}/start`, { user: carol, body: {} });
  assert.equal(s.status, 201);
  const sub = await call('POST', `/api/public/attempts/${s.data.attempt.id}/submit`, { user: carol, body: { answers: { [q1.id]: 4 } } });
  assert.equal(sub.status, 200);
  assert.equal(sub.data.quiz, false);
  assert.equal((await call('POST', `/api/public/forms/${f.slug}/start`, { user: carol, body: {} })).status, 409);

  await call('PUT', `/api/forms/${f.id}`, { user: alice, body: { title: 'Survei', status: 'closed' } });
  assert.equal((await call('GET', `/api/public/forms/${f.slug}`)).data.state, 'closed');
  assert.equal((await call('POST', `/api/public/forms/${f.slug}/start`, { user: bob, body: {} })).status, 403);
  // draft tidak terlihat peserta, tetapi editor bisa pratinjau
  await call('PUT', `/api/forms/${f.id}`, { user: alice, body: { title: 'Survei', status: 'draft' } });
  assert.equal((await call('GET', `/api/public/forms/${f.slug}`)).data.state, 'draft');
  const pv = await call('GET', `/api/public/forms/${f.slug}?preview=1`, { user: alice });
  assert.equal(pv.data.state, 'open');
  assert.equal(pv.data.preview, true);
  assert.equal((await call('GET', `/api/public/forms/${f.slug}?preview=1`, { user: bob })).data.state, 'draft');
});

test('unggah gambar: hanya PNG/JPG asli', async () => {
  const ok = await call('POST', '/api/uploads', { user: alice, raw: PNG, headers: { 'content-type': 'image/png' } });
  assert.equal(ok.status, 201);
  const img = await call('GET', ok.data.url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  const fake = await call('POST', '/api/uploads', { user: alice, raw: Buffer.from('<svg onload=alert(1)>'), headers: { 'content-type': 'image/png' } });
  assert.equal(fake.status, 415);
  assert.equal((await call('POST', '/api/uploads', { raw: PNG, headers: { 'content-type': 'image/png' } })).status, 401);

  // sertifikat dengan latar + sponsor tiga posisi menghasilkan PDF
  const f = (await call('POST', '/api/forms', { user: alice, body: { title: 'Webinar' } })).data;
  await call('PUT', `/api/forms/${f.id}`, {
    user: alice, body: { title: 'Webinar', cert: { enabled: true, bg_image: ok.data.id, sponsors: { tl: ok.data.id, tr: ok.data.id, br: ok.data.id }, signature_image: ok.data.id, signer_name: 'Dekan' } },
  });
  const pdf = await call('GET', `/api/forms/${f.id}/certificate-preview.pdf?name=Nama%20Panjang%20Sekali%20Untuk%20Menguji%20Pengecilan%20Huruf`, { user: alice });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
});

test('CSRF dan peran admin', async () => {
  const bad = await fetch(`${base}/api/forms`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example', cookie: alice.cookie }, body: '{}' });
  assert.equal(bad.status, 403);
  assert.equal((await call('GET', '/api/admin/users', { user: alice })).status, 403);
});

test('hapus form hanya oleh pemilik', async () => {
  const f = (await call('POST', '/api/forms', { user: alice, body: { title: 'Hapus' } })).data;
  assert.equal((await call('DELETE', `/api/forms/${f.id}`, { user: alice })).status, 200);
  assert.equal((await call('GET', `/api/forms/${f.id}`, { user: alice })).status, 404);
});

test('daftar pilihan: global oleh admin, pribadi oleh pemilik, dipanggil di dropdown', async () => {
  const admin = await login('admin-list@uika-bogor.ac.id', 'Admin');
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
  const adm = await login('admin-list@uika-bogor.ac.id', 'Admin');

  // hanya admin yang boleh membuat daftar global
  assert.equal((await call('POST', '/api/lists', { user: alice, body: { name: 'X', global: true, items: ['a'] } })).status, 403);
  assert.equal((await call('GET', '/api/lists')).status, 401);
  const g = await call('POST', '/api/lists', { user: adm, body: { name: 'Dosen', global: true, items: 'Dr. Ani\nDr. Budi\n\nDr. Ani\n  Dr.   Citra ' } });
  assert.equal(g.status, 201);
  assert.deepEqual(g.data.items.map((i) => i.text), ['Dr. Ani', 'Dr. Budi', 'Dr. Citra']);

  // daftar pribadi: tidak terlihat orang lain
  const mine = (await call('POST', '/api/lists', { user: alice, body: { name: 'Prodi', items: ['TI', 'SI'] } })).data;
  assert.equal((await call('GET', `/api/lists/${mine.id}`, { user: bob })).status, 404);
  assert.equal((await call('PUT', `/api/lists/${mine.id}`, { user: bob, body: { name: 'hack' } })).status, 404);
  assert.equal((await call('PUT', `/api/lists/${g.data.id}`, { user: alice, body: { name: 'hack' } })).status, 403);
  const seenByBob = (await call('GET', '/api/lists', { user: bob })).data.map((l) => l.name);
  assert.deepEqual(seenByBob, ['Dosen']);
  const seenByAlice = (await call('GET', '/api/lists', { user: alice })).data;
  assert.deepEqual(seenByAlice.map((l) => l.name).sort(), ['Dosen', 'Prodi']);
  assert.equal(seenByAlice.find((l) => l.name === 'Dosen').can_edit, false);

  // pakai di dropdown: opsi terisi dari daftar dan mengikuti perubahan daftar
  const f = (await call('POST', '/api/forms', { user: alice, body: { title: 'Survei Dosen' } })).data;
  const qid = crypto.randomUUID();
  const put = await call('PUT', `/api/forms/${f.id}`, { user: alice, body: { status: 'published', base_updated_at: f.updated_at,
    questions: [{ id: qid, type: 'dropdown', title: 'Dosen pengampu', required: true, options: [], config: { list_id: g.data.id } }] } });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  let pub = (await call('GET', `/api/public/forms/${f.slug}`)).data;
  assert.equal(pub.questions[0].options.length, 3);
  const budi = g.data.items.find((i) => i.text === 'Dr. Budi');

  // ubah daftar: id yang teksnya sama dipertahankan, item baru ditambah
  const upd = await call('PUT', `/api/lists/${g.data.id}`, { user: adm, body: { items: ['Dr. Ani', 'Dr. Budi', 'Dr. Dewi'] } });
  assert.equal(upd.status, 200);
  assert.equal(upd.data.items.find((i) => i.text === 'Dr. Budi').id, budi.id);
  pub = (await call('GET', `/api/public/forms/${f.slug}`)).data;
  assert.deepEqual(pub.questions[0].options.map((o) => o.text), ['Dr. Ani', 'Dr. Budi', 'Dr. Dewi']);

  // peserta menjawab dengan id item; id asing ditolak
  const st = await call('POST', `/api/public/forms/${f.slug}/start`, { body: { name: 'Peserta', email: 'p@example.com' } });
  const sub = await call('POST', `/api/public/attempts/${st.data.attempt.id}/submit`, { body: { answers: { [qid]: budi.id } } });
  assert.equal(sub.status, 200, JSON.stringify(sub.data));
  const rows = (await call('GET', `/api/forms/${f.id}/responses`, { user: alice })).data.rows;
  const detail = (await call('GET', `/api/forms/${f.id}/responses/${rows[0].id}`, { user: alice })).data;
  assert.match(JSON.stringify(detail), /Dr\. Budi/);

  // bob tidak boleh menautkan daftar pribadi alice ke formnya
  const bf = (await call('POST', '/api/forms', { user: bob, body: { title: 'Bob' } })).data;
  const bput = await call('PUT', `/api/forms/${bf.id}`, { user: bob, body: { base_updated_at: bf.updated_at,
    questions: [{ id: crypto.randomUUID(), type: 'dropdown', title: 'x', options: [{ id: 'o1', text: 'salin' }], config: { list_id: mine.id } }] } });
  assert.equal(bput.status, 200);
  assert.equal(bput.data.questions[0].config.list_id, undefined);
  assert.deepEqual(bput.data.questions[0].options.map((o) => o.text), ['salin']);

  // hapus daftar: form tetap menyimpan salinan opsi terakhir
  assert.equal((await call('DELETE', `/api/lists/${g.data.id}`, { user: adm })).status, 204);
  const after = (await call('GET', `/api/public/forms/${f.slug}`)).data;
  assert.equal(after.questions[0].options.length, 3);
});

test('peserta tanpa login dapat melanjutkan percobaan dengan resume_id (tanpa mengisi ulang identitas)', async () => {
  const f = (await call('POST', '/api/forms', { user: alice, body: { kind: 'quiz', title: 'Resume' } })).data;
  const qid = crypto.randomUUID();
  await call('PUT', `/api/forms/${f.id}`, { user: alice, body: { status: 'published', base_updated_at: f.updated_at, settings: { is_quiz: true, duration_min: 10, identity: 'ask' },
    questions: [{ id: qid, type: 'radio', title: 'q', points: 5, options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], correct: ['a'] }] } });
  const st = await call('POST', `/api/public/forms/${f.slug}/start`, { body: { name: 'Anon', email: 'anon-resume@example.com' } });
  assert.equal(st.status, 201);
  await call('PUT', `/api/public/attempts/${st.data.attempt.id}/save`, { body: { answers: { [qid]: 'a' } } });
  const again = await call('POST', `/api/public/forms/${f.slug}/start`, { body: { resume_id: st.data.attempt.id } });
  assert.equal(again.status, 200);
  assert.equal(again.data.attempt.id, st.data.attempt.id);
  assert.equal(again.data.attempt.answers[qid], 'a');
  // id acak / percobaan orang lain tidak membuka celah: tanpa identitas tetap ditolak
  assert.equal((await call('POST', `/api/public/forms/${f.slug}/start`, { body: { resume_id: crypto.randomUUID() } })).status, 422);
});
