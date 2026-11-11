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
const logic = require('../src/logic');

let server; let base; let owner; let other; let admin;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const uid = () => crypto.randomUUID();

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
const mcq = (title, correct = 'a', extra = {}) => ({ id: uid(), type: 'radio', title, required: true, points: 10, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correct: [correct], ...extra });

/** Buat form terbit dengan pengaturan & pertanyaan tertentu. */
async function makeForm({ kind = 'form', settings = {}, questions, cert }) {
  const f = (await call('POST', '/api/forms', { user: owner, body: { kind, title: `F ${Math.random()}` } })).data;
  const put = await call('PUT', `/api/forms/${f.id}`, { user: owner, body: { status: 'published', base_updated_at: f.updated_at, settings: { is_quiz: kind === 'quiz', ...settings }, cert, questions } });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  return put.data;
}
const start = (slug, body, user) => call('POST', `/api/public/forms/${slug}/start`, { body, user });
const submit = (id, answers, extra = {}) => call('POST', `/api/public/attempts/${id}/submit`, { body: { answers, ...extra } });

test.before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  const app = createApp();
  await new Promise((res) => { server = app.listen(0, res); });
  base = `http://127.0.0.1:${server.address().port}`;
  owner = await login('owner@uika-bogor.ac.id', 'Owner');
  other = await login('other@uika-bogor.ac.id', 'Other');
  const a = await login('admin@uika-bogor.ac.id', 'Admin');
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [a.id]);
  admin = await login('admin@uika-bogor.ac.id', 'Admin');
});
test.after(async () => { server.close(); await pool.end(); });

test('logika percabangan: murni', () => {
  const q1 = { id: 'q1', type: 'radio', options: [{ id: 'a' }, { id: 'b' }], config: {} };
  const q2 = { id: 'q2', type: 'short', config: { show_if: { match: 'all', conds: [{ qid: 'q1', op: 'eq', value: 'b' }] } } };
  const q3 = { id: 'q3', type: 'short', config: { show_if: { match: 'all', conds: [{ qid: 'q2', op: 'answered' }] } } };
  assert.deepEqual(logic.applyLogic([q1, q2, q3], { q1: 'a', q2: 'x', q3: 'y' }).visible.map((x) => x.id), ['q1']);
  const r = logic.applyLogic([q1, q2, q3], { q1: 'b', q2: 'x', q3: 'y' });
  assert.deepEqual(r.visible.map((x) => x.id), ['q1', 'q2', 'q3']);
  assert.deepEqual(r.answers, { q1: 'b', q2: 'x', q3: 'y' });
  // rantai: q1≠b → q2 tersembunyi → q3 (butuh q2 terjawab) ikut tersembunyi
  assert.deepEqual(logic.applyLogic([q1, q2, q3], { q1: 'a' }).visible.length, 1);
  assert.equal(logic.isAnswered({ type: 'grid', config: { rows: [{ id: 'r1' }, { id: 'r2' }] } }, { r1: 'c1' }), false);
});

test('soal acak: subset tetap, soal "selalu" selalu ada, judul ikut blok', () => {
  const qs = [{ id: 's1', type: 'section', config: {} }, ...Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, type: 'short', config: i === 0 ? { always: true } : {} })), { id: 's2', type: 'section', config: {} }, { id: 'z', type: 'short', config: {} }];
  for (let i = 0; i < 20; i += 1) {
    const ids = logic.pickQuestionIds(qs, 3);
    assert.ok(ids.includes('q0'));
    assert.equal(ids.filter((x) => !x.startsWith('s')).length, 4); // 1 always + 3 acak
  }
  assert.equal(logic.pickQuestionIds(qs, 99), null);
});

test('daftar peserta: hanya yang terdaftar (email atau NIM); wajib login opsional', async () => {
  const f = await makeForm({ settings: { allowlist: { enabled: true } }, questions: [{ id: uid(), type: 'short', title: 'x' }] });
  const add = await call('POST', `/api/forms/${f.id}/allowlist`, { user: owner, body: { text: 'Ani Wijaya, ani@example.com\nBudi\tbudi@example.com\n2310001, Citra Dewi\nbaris-rusak' } });
  assert.equal(add.status, 201);
  assert.equal(add.data.added, 3);
  assert.equal(add.data.warnings.length, 1);
  assert.equal((await start(f.slug, { name: 'Orang Lain', email: 'asing@example.com' })).status, 403);
  assert.equal((await start(f.slug, { name: 'Ani', email: 'ANI@example.com' })).status, 201);
  assert.equal((await start(f.slug, { name: 'Citra', email: 'c@x.com', identifier: '2310001' })).status, 201);
  assert.equal((await call('GET', `/api/forms/${f.id}/allowlist`, { user: other })).status, 404);
  // wajib login E-Portal untuk daftar peserta
  const g = await makeForm({ settings: { allowlist: { enabled: true, require_login: true } }, questions: [{ id: uid(), type: 'short', title: 'x' }] });
  await call('POST', `/api/forms/${g.id}/allowlist`, { user: owner, body: { items: [{ email: 'other@uika-bogor.ac.id' }] } });
  assert.equal((await start(g.slug, { name: 'Other', email: 'other@uika-bogor.ac.id' })).status, 401);
  assert.equal((await start(g.slug, {}, other)).status, 201);
  const list = (await call('GET', `/api/forms/${f.id}/allowlist`, { user: owner })).data;
  assert.equal(list.total, 3);
});

test('percobaan ulang: batas, nomor percobaan, kebijakan nilai tertinggi', async () => {
  const q1 = mcq('2+2?', 'b');
  const f = await makeForm({ kind: 'quiz', settings: { max_attempts: 2, score_policy: 'best' }, questions: [q1] });
  const who = { name: 'Dina', email: 'dina@example.com' };
  const a1 = (await start(f.slug, who)).data;
  assert.equal(a1.attempt.attempt_no, 1);
  await submit(a1.attempt.id, { [q1.id]: 'a' }); // salah → 0
  const a2 = (await start(f.slug, who)).data;
  assert.equal(a2.attempt.attempt_no, 2);
  await submit(a2.attempt.id, { [q1.id]: 'b' }); // benar → 10
  const third = await start(f.slug, who);
  assert.equal(third.status, 409);
  assert.equal(third.data.error, 'attempts_exhausted');
  const sum = (await call('GET', `/api/forms/${f.id}/summary`, { user: owner })).data;
  assert.equal(sum.attempts_total, 2);
  assert.equal(sum.total, 1);               // satu orang dihitung sekali
  assert.equal(sum.scores.highest, 100);    // kebijakan: tertinggi
  const list = (await call('GET', `/api/forms/${f.id}/responses`, { user: owner })).data;
  assert.equal(list.total, 2);
});

test('anti-curang: pelanggaran tercatat; batas tercapai → kirim otomatis', async () => {
  const q1 = mcq('s?', 'a');
  const f = await makeForm({ kind: 'quiz', settings: { anticheat: { enabled: true, max_violations: 2, block_copy: true } }, questions: [q1] });
  const a = (await start(f.slug, { name: 'Eko', email: 'eko@example.com' })).data.attempt;
  const v1 = await call('POST', `/api/public/attempts/${a.id}/violation`, { body: { type: 'hidden' } });
  assert.equal(v1.data.count, 1); assert.ok(!v1.data.submitted);
  const v2 = await call('POST', `/api/public/attempts/${a.id}/violation`, { body: { type: 'blur', answers: { [q1.id]: 'a' } } });
  assert.equal(v2.data.submitted, true);
  assert.equal(v2.data.result.score, 10);
  const detail = (await call('GET', `/api/forms/${f.id}/responses/${a.id}`, { user: owner })).data;
  assert.equal(detail.status, 'auto_submitted');
  assert.equal(detail.violations.length, 2);
});

test('soal acak per peserta: bank tidak bocor, nilai dihitung dari subset', async () => {
  const qs = Array.from({ length: 6 }, (_, i) => mcq(`Soal ${i}`, 'a', i === 0 ? { config: { always: true } } : {}));
  const f = await makeForm({ kind: 'quiz', settings: { pick_count: 2 }, questions: qs });
  const pub = (await call('GET', `/api/public/forms/${f.slug}`)).data;
  assert.equal(pub.questions, undefined);
  assert.equal(pub.questions_on_start, true);
  const st = (await start(f.slug, { name: 'Fani', email: 'fani@example.com' })).data;
  assert.equal(st.questions.length, 3); // 1 selalu + 2 acak
  assert.ok(st.questions.some((x) => x.id === qs[0].id));
  const res = await submit(st.attempt.id, Object.fromEntries(st.questions.map((x) => [x.id, 'a'])));
  assert.equal(res.data.max_score, 30);
  assert.equal(res.data.score, 30);
});

test('percabangan: soal tersembunyi tidak wajib, tidak dinilai, jawabannya dibuang', async () => {
  const q1 = { id: uid(), type: 'radio', title: 'Mahasiswa?', required: true, options: [{ id: 'y', text: 'Ya' }, { id: 'n', text: 'Tidak' }] };
  const q2 = { id: uid(), type: 'short', title: 'NIM', required: true, config: { show_if: { match: 'all', conds: [{ qid: q1.id, op: 'eq', value: 'y' }] } } };
  const f = await makeForm({ questions: [q1, q2] });
  const kept = (await call('GET', `/api/forms/${f.id}`, { user: owner })).data.questions;
  assert.equal(kept[1].config.show_if.conds[0].qid, q1.id);
  const a = (await start(f.slug, { name: 'Gina', email: 'g@example.com' })).data.attempt;
  const no = await submit(a.id, { [q1.id]: 'n', [q2.id]: 'sisa' });
  assert.equal(no.status, 200);
  const d = (await call('GET', `/api/forms/${f.id}/responses/${a.id}`, { user: owner })).data;
  assert.equal(d.items.length, 1); // soal NIM tidak tampil untuk peserta ini
  const b = (await start(f.slug, { name: 'Hana', email: 'h@example.com' })).data.attempt;
  const miss = await submit(b.id, { [q1.id]: 'y' });
  assert.equal(miss.status, 422);
  assert.deepEqual(miss.data.missing, [q2.id]);
  // rujukan ke soal yang SETELAH dirinya dibuang saat simpan
  const bad = { id: uid(), type: 'short', title: 'x', config: { show_if: { conds: [{ qid: q2.id, op: 'answered' }] } } };
  const f2 = (await call('PUT', `/api/forms/${f.id}`, { user: owner, body: { base_updated_at: (await call('GET', `/api/forms/${f.id}`, { user: owner })).data.updated_at, questions: [bad, q2] } })).data;
  assert.equal(f2.questions[0].config.show_if, undefined);
});

test('tipe baru: kisi, peringkat, unggah berkas (validasi isi berkas) + rekap', async () => {
  const grid = { id: uid(), type: 'grid', title: 'Nilai layanan', required: true, config: { rows: [{ id: 'r1', text: 'Dosen' }, { id: 'r2', text: 'Staf' }], cols: [{ id: 'c1', text: 'Baik' }, { id: 'c2', text: 'Buruk' }] } };
  const rank = { id: uid(), type: 'ranking', title: 'Urutkan', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }] };
  const file = { id: uid(), type: 'file', title: 'Bukti', config: { accept: 'image', max_mb: 1 } };
  const f = await makeForm({ questions: [grid, rank, file] });
  const a = (await start(f.slug, { name: 'Ivan', email: 'ivan@example.com' })).data.attempt;
  const path = `/api/public/attempts/${a.id}/files/${file.id}`;
  assert.equal((await call('POST', path, { raw: Buffer.from('%PDF-1.4 x'), headers: { 'x-filename': 'a.pdf', 'content-type': 'application/octet-stream' } })).status, 415); // accept=image
  assert.equal((await call('POST', path, { raw: Buffer.from('bukan gambar'), headers: { 'x-filename': 'a.png', 'content-type': 'application/octet-stream' } })).status, 415);
  const up = await call('POST', path, { raw: PNG, headers: { 'x-filename': encodeURIComponent('bukti saya.png'), 'content-type': 'application/octet-stream' } });
  assert.equal(up.status, 201);
  const res = await submit(a.id, { [grid.id]: { r1: 'c1', r2: 'c2' }, [rank.id]: ['c', 'a', 'b'], [file.id]: up.data.id });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  // peringkat tidak lengkap / id palsu dibuang
  const b = (await start(f.slug, { name: 'Joko', email: 'joko@example.com' })).data.attempt;
  const rb = await submit(b.id, { [grid.id]: { r1: 'c1' }, [rank.id]: ['a'], [file.id]: uid() }, { auto: true });
  assert.equal(rb.status, 200);
  const d = (await call('GET', `/api/forms/${f.id}/responses/${a.id}`, { user: owner })).data;
  assert.equal(d.items.find((x) => x.type === 'file').answer, 'bukti saya.png');
  assert.match(d.items.find((x) => x.type === 'grid').answer, /Dosen: Baik/);
  assert.equal(d.items.find((x) => x.type === 'ranking').answer, '1. C; 2. A; 3. B');
  const dl = await call('GET', `/api/forms/${f.id}/files/${up.data.id}`, { user: owner });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /attachment/);
  assert.equal((await call('GET', `/api/forms/${f.id}/files/${up.data.id}`, { user: other })).status, 404);
  const sum = (await call('GET', `/api/forms/${f.id}/summary`, { user: owner })).data;
  assert.equal(sum.questions.find((x) => x.type === 'ranking').ranking[0].text, 'C');
  assert.equal(sum.questions.find((x) => x.type === 'grid').grid[0].cols[0].count, 2);
  assert.equal(sum.questions.find((x) => x.type === 'file').files, 1);
  const x = await call('GET', `/api/forms/${f.id}/export.xlsx`, { user: owner });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.data);
  assert.ok(JSON.stringify(wb.getWorksheet('Respons').getRow(2).values).includes('bukti saya.png'));
});

test('absensi QR: sertifikat hanya setelah hadir; nomor sertifikat berurutan', async () => {
  const q1 = mcq('q', 'a');
  const f = await makeForm({ kind: 'quiz', settings: { attendance: { enabled: true, require_for_cert: true }, one_response: true },
    cert: { enabled: true, min_percent: 50, number_format: '{{no:3}}/SERT/UIKA/{{bulan}}/{{tahun}}', number_start: 10, template: 'modern' }, questions: [q1] });
  const info = await call('GET', `/api/public/checkin/${f.checkin_token}`);
  assert.equal(info.data.enabled, true);
  const a = (await start(f.slug, { name: 'Kiki', email: 'kiki@example.com' })).data.attempt;
  const r = await submit(a.id, { [q1.id]: 'a' });
  assert.equal(r.data.certificate.code, null);
  assert.equal(r.data.certificate.needs_attendance, true);
  const ci = await call('POST', `/api/public/checkin/${f.checkin_token}`, { body: { name: 'Kiki', email: 'KIKI@example.com' } });
  assert.equal(ci.data.ok, true);
  assert.equal((await call('POST', `/api/public/checkin/${f.checkin_token}`, { body: { name: 'Kiki', email: 'kiki@example.com' } })).data.already, true);
  const after = (await call('GET', `/api/public/attempts/${a.id}/result`)).data;
  assert.ok(after.certificate.code, 'sertifikat terbit setelah absen');
  assert.match(after.certificate.number, /^010\/SERT\/UIKA\/[IVX]+\/\d{4}$/);
  // peserta kedua: absen dulu, lalu isi
  await call('POST', `/api/public/checkin/${f.checkin_token}`, { body: { name: 'Lala', email: 'lala@example.com' } });
  const b = (await start(f.slug, { name: 'Lala', email: 'lala@example.com' })).data.attempt;
  const rb = await submit(b.id, { [q1.id]: 'a' });
  assert.match(rb.data.certificate.number, /^011\//);
  const pdf = await call('GET', `/api/public/certificates/${rb.data.certificate.code}/pdf`);
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
  const ver = (await call('GET', `/api/public/verify/${rb.data.certificate.code}`)).data;
  assert.match(ver.number, /^011\//);
  // daftar kehadiran hanya untuk editor; token bisa dibuat ulang
  assert.equal((await call('GET', `/api/forms/${f.id}/checkins`, { user: other })).status, 404);
  const list = (await call('GET', `/api/forms/${f.id}/checkins`, { user: owner })).data;
  assert.equal(list.total, 2);
  const nt = (await call('POST', `/api/forms/${f.id}/checkin-token`, { user: owner })).data.token;
  assert.notEqual(nt, f.checkin_token);
  assert.equal((await call('GET', `/api/public/checkin/${f.checkin_token}`)).status, 404);
});

test('empat template sertifikat menghasilkan PDF valid', async () => {
  for (const template of ['classic', 'modern', 'elegant', 'minimal']) {
    const f = await makeForm({ cert: { enabled: true, template, number_format: '{{no}}/X', title: 'SERTIFIKAT' }, questions: [{ id: uid(), type: 'short', title: 'x' }] });
    const r = await call('GET', `/api/forms/${f.id}/certificate-preview.pdf?name=Nama%20Panjang%20Sekali%20Untuk%20Uji`, { user: owner });
    assert.equal(r.status, 200, template);
    assert.equal(r.data.subarray(0, 4).toString(), '%PDF');
  }
});

test('bank soal: pribadi vs global; simpan & pakai ulang', async () => {
  const mine = await call('POST', '/api/banks', { user: owner, body: { name: 'Bank Dasar', questions: [mcq('Satu'), mcq('Dua'), { type: 'section', title: 'judul' }] } });
  assert.equal(mine.status, 201);
  assert.equal(mine.data.count, 2); // judul bagian tidak masuk
  assert.equal((await call('GET', `/api/banks/${mine.data.id}`, { user: other })).status, 404);
  assert.equal((await call('POST', '/api/banks', { user: owner, body: { name: 'G', global: true } })).status, 403);
  const g = await call('POST', '/api/banks', { user: admin, body: { name: 'Global', global: true, questions: [mcq('G1')] } });
  assert.equal(g.status, 201);
  const seen = (await call('GET', '/api/banks', { user: other })).data.map((b) => b.name);
  assert.deepEqual(seen, ['Global']);
  assert.equal((await call('PUT', `/api/banks/${g.data.id}`, { user: other, body: { name: 'x' } })).status, 403);
  const full = (await call('GET', `/api/banks/${mine.data.id}`, { user: owner })).data;
  assert.deepEqual(full.questions[0].correct, ['a']); // pemilik melihat kunci
  const up = await call('PUT', `/api/banks/${mine.data.id}`, { user: owner, body: { append: true, questions: [mcq('Tiga')] } });
  assert.equal(up.data.count, 3);
  assert.equal((await call('DELETE', `/api/banks/${mine.data.id}`, { user: owner })).status, 204);
});

test('tautan pendek, QR, embed, dan laporan PDF + analisis butir', async () => {
  const qs = [mcq('Mudah', 'a'), mcq('Sulit', 'b')];
  const f = await makeForm({ kind: 'quiz', settings: { allow_embed: true }, questions: qs });
  assert.equal((await call('PUT', `/api/forms/${f.id}/alias`, { user: owner, body: { alias: 'Admin' } })).status, 422); // dilarang
  assert.equal((await call('PUT', `/api/forms/${f.id}/alias`, { user: owner, body: { alias: 'kuis-tik-2026' } })).status, 200);
  const g = await makeForm({ questions: [{ id: uid(), type: 'short', title: 'x' }] });
  assert.equal((await call('PUT', `/api/forms/${g.id}/alias`, { user: owner, body: { alias: 'kuis-tik-2026' } })).status, 409);
  const red = await call('GET', '/s/kuis-tik-2026');
  assert.equal(red.status, 302);
  assert.equal(red.headers.get('location'), `/f/${f.slug}`);
  assert.equal((await call('GET', '/api/public/forms/kuis-tik-2026')).data.id, f.id);
  const page = await call('GET', '/f/kuis-tik-2026');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors \*/);
  const normal = await call('GET', `/f/${g.slug}`);
  assert.match(normal.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  const svg = await call('GET', `/api/forms/${f.id}/qr?kind=form`, { user: owner });
  assert.match(svg.headers.get('content-type'), /svg/);
  assert.match(svg.data.toString(), /<svg/);
  // 12 peserta: separuh pandai (benar semua), separuh hanya soal mudah
  for (let i = 0; i < 12; i += 1) {
    const a = (await start(f.slug, { name: `P${i}`, email: `p${i}@x.com` })).data.attempt;
    await submit(a.id, { [qs[0].id]: i < 11 ? 'a' : 'b', [qs[1].id]: i < 5 ? 'b' : 'a' });
  }
  const sum = (await call('GET', `/api/forms/${f.id}/summary`, { user: owner })).data;
  const hard = sum.questions.find((x) => x.id === qs[1].id);
  const easy = sum.questions.find((x) => x.id === qs[0].id);
  assert.ok(easy.difficulty > hard.difficulty);
  assert.equal(hard.difficulty_label, 'Sedang');
  assert.equal(easy.difficulty_label, 'Mudah');
  assert.ok(typeof hard.discrimination === 'number');
  const pdf = await call('GET', `/api/forms/${f.id}/report.pdf`, { user: owner });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
  assert.equal((await call('GET', `/api/forms/${f.id}/report.pdf`, { user: other })).status, 404);
});

test('sertifikat massal & notifikasi: tanpa SMTP ditolak dengan jelas', async () => {
  const f = await makeForm({ cert: { enabled: true }, questions: [{ id: uid(), type: 'short', title: 'x' }] });
  const r = await call('POST', `/api/forms/${f.id}/certificates/send-all`, { user: owner, body: {} });
  assert.equal(r.status, 503);
  assert.equal(r.data.error, 'smtp_not_configured');
  const list = (await call('GET', `/api/forms/${f.id}/certificates`, { user: owner })).data;
  assert.equal(list.smtp, false);
});

test('template Excel memuat tipe Peringkat & Unggah Berkas dan dapat diimpor', async () => {
  const f = await makeForm({ questions: [{ id: uid(), type: 'short', title: 'x' }] });
  const t = await call('GET', '/api/templates/survey.xlsx');
  const imp = await call('POST', `/api/forms/${f.id}/import-excel?mode=replace`, { user: owner, raw: t.data, headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(imp.status, 200, JSON.stringify(imp.data));
  const types = imp.data.questions.map((x) => x.type);
  assert.ok(types.includes('ranking') && types.includes('file'));
});

test('admin: lihat semua formulir, cari kata kunci pertanyaan, detail, ekspor, hapus', async () => {
  const f1 = await makeForm({ questions: [mcq('Berapa lama Anda belajar Python setiap minggu?'), { id: uid(), type: 'radio', title: 'Bahasa favorit', required: false, points: 0, correct: [], options: [{ id: 'a', text: 'Kotlin' }, { id: 'b', text: 'Golang' }] }] });
  const f2 = await makeForm({ questions: [mcq('Apakah dosen tepat waktu?')] });
  const o = await call('POST', '/api/forms', { user: other, body: { kind: 'form', title: 'Milik orang lain 100%_x' } });
  // bukan admin ditolak
  assert.equal((await call('GET', '/api/admin/forms', { user: owner })).status, 403);
  assert.equal((await call('DELETE', `/api/admin/forms/${f1.id}`, { user: owner })).status, 403);
  // semua formulir dari semua pembuat terlihat
  const all = (await call('GET', '/api/admin/forms', { user: admin })).data;
  const ids = all.rows.map((r) => r.id);
  assert.ok(ids.includes(f1.id) && ids.includes(f2.id) && ids.includes(o.data.id));
  assert.ok(all.rows.every((r) => r.owner_email));
  // kata kunci di judul pertanyaan & teks opsi; tidak peka huruf besar
  let r = (await call('GET', `/api/admin/forms?q=${encodeURIComponent('python')}&scope=question`, { user: admin })).data;
  assert.deepEqual(r.rows.map((x) => x.id), [f1.id]);
  assert.equal(r.rows[0].match_count, 1);
  assert.match(r.rows[0].matches[0].title, /Python/);
  r = (await call('GET', '/api/admin/forms?q=golang&scope=question', { user: admin })).data;
  assert.deepEqual(r.rows.map((x) => x.id), [f1.id]);
  r = (await call('GET', '/api/admin/forms?q=python&scope=title', { user: admin })).data;
  assert.equal(r.total, 0);
  // karakter wildcard SQL diperlakukan harfiah
  r = (await call('GET', `/api/admin/forms?q=${encodeURIComponent('100%_x')}&scope=title`, { user: admin })).data;
  assert.deepEqual(r.rows.map((x) => x.id), [o.data.id]);
  r = (await call('GET', '/api/admin/forms?q=%25&scope=title', { user: admin })).data;
  assert.ok(r.rows.every((x) => x.title.includes('%')));
  // pencarian berdasarkan pembuat
  r = (await call('GET', '/api/admin/forms?q=other%40uika&scope=owner', { user: admin })).data;
  assert.ok(r.rows.length >= 1 && r.rows.every((x) => x.owner_email === 'other@uika-bogor.ac.id'));
  // detail berisi semua pertanyaan
  const d = (await call('GET', `/api/admin/forms/${f1.id}`, { user: admin })).data;
  assert.equal(d.questions.length, 2); assert.equal(d.owner.email, 'owner@uika-bogor.ac.id');
  assert.equal(d.questions[0].correct[0], 'a');
  const x = await call('GET', `/api/admin/forms/${f1.id}/export.xlsx`, { user: admin });
  assert.equal(x.status, 200); assert.equal(x.data.subarray(0, 2).toString(), 'PK');
  // hapus satu & banyak
  assert.equal((await call('DELETE', `/api/admin/forms/${f1.id}`, { user: admin })).status, 200);
  assert.equal((await call('GET', `/api/admin/forms/${f1.id}`, { user: admin })).status, 404);
  assert.equal((await call('GET', `/api/forms/${f1.id}`, { user: owner })).status, 404);
  const del = await call('POST', '/api/admin/forms/delete', { user: admin, body: { ids: [f2.id, o.data.id, 'bukan-uuid'] } });
  assert.equal(del.data.deleted, 2);
  assert.equal((await call('POST', '/api/admin/forms/delete', { user: admin, body: { ids: [] } })).status, 422);
});
