'use strict';
/* API Editor: hanya pembuat form dan email yang didaftarkan pembuat. */
const express = require('express');
const { q, tx } = require('../db');
const schema = require('../schema');
const { requireUser, requireCreator } = require('../auth');
const sv = require('../services');
const { gradeResponse, answerText } = require('../grading');
const { ensureCertificate } = require('../certificate');
const excel = require('../excel');
const mailer = require('../mailer');
const logic = require('../logic');
const QRCode = require('qrcode');
const config = require('../config');
const { buildSummary } = require('../summary');
const { renderReport } = require('../report');

const router = express.Router();
router.use(requireUser);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const notFound = (res) => res.status(404).json({ error: 'not_found' });

// Akses editor: pemilik atau email terdaftar. Selain itu → 404 (tidak membocorkan keberadaan form).
router.param('id', async (req, res, next, id) => {
  if (!schema.UUID_RE.test(id)) return notFound(res);
  const r = await q(
    `SELECT f.*, (f.owner_id=$2) AS is_owner FROM forms f
      WHERE f.id=$1 AND (f.owner_id=$2 OR EXISTS (SELECT 1 FROM form_editors e WHERE e.form_id=f.id AND e.email=lower($3)))`,
    [id, req.user.id, req.user.email],
  );
  if (!r.rowCount) return notFound(res);
  req.form = r.rows[0];
  req.isOwner = r.rows[0].is_owner;
  return next();
});
const ownerOnly = (req, res, next) => (req.isOwner ? next() : res.status(403).json({ error: 'owner_only' }));

/* ---------- daftar & buat ---------- */
router.get('/', async (req, res) => {
  const r = await q(
    `SELECT f.*, u.name AS owner_name, u.email AS owner_email, (f.owner_id=$1) AS is_owner,
            (SELECT count(*)::int FROM responses r WHERE r.form_id=f.id AND r.status<>'in_progress') AS response_count
       FROM forms f JOIN users u ON u.id=f.owner_id
      WHERE f.owner_id=$1 OR EXISTS (SELECT 1 FROM form_editors e WHERE e.form_id=f.id AND e.email=lower($2))
      ORDER BY f.updated_at DESC LIMIT 500`,
    [req.user.id, req.user.email],
  );
  res.json(r.rows.map((row) => ({
    ...sv.formApi(row), role: row.is_owner ? 'owner' : 'editor', owner_name: row.owner_name,
    owner_email: row.owner_email, response_count: row.response_count,
  })));
});

router.post('/', requireCreator, async (req, res) => {
  const kind = req.body?.kind === 'quiz' ? 'quiz' : 'form';
  const title = schema.str(req.body?.title, 200).trim() || (kind === 'quiz' ? 'Kuis tanpa judul' : 'Formulir tanpa judul');
  const settings = schema.cleanSettings({ ...schema.DEFAULT_SETTINGS, is_quiz: kind === 'quiz' });
  const out = await tx(async (c) => {
    const f = (await c.query(
      'INSERT INTO forms (owner_id, slug, title, theme, settings, cert) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.user.id, schema.slugify(), title, JSON.stringify(schema.cleanTheme()), JSON.stringify(settings), JSON.stringify(schema.cleanCert({}, settings))],
    )).rows[0];
    const first = {
      id: schema.newId(), type: 'radio', title: 'Pertanyaan tanpa judul', required: false,
      options: [{ id: 'o1', text: 'Opsi 1' }], correct: [], points: kind === 'quiz' ? 10 : 0,
    };
    await sv.saveQuestions(c, f.id, [first]);
    return f;
  });
  res.status(201).json(sv.formApi(out, { role: 'owner' }));
});

/* ---------- baca & simpan ---------- */
router.get('/:id', async (req, res) => {
  const questions = await sv.loadQuestions(req.form.id);
  const editors = await q('SELECT email FROM form_editors WHERE form_id=$1 ORDER BY created_at', [req.form.id]);
  res.json(sv.formApi(req.form, {
    role: req.isOwner ? 'owner' : 'editor', questions, editors: editors.rows.map((e) => e.email),
    response_count: (await q("SELECT count(*)::int n FROM responses WHERE form_id=$1 AND status<>'in_progress'", [req.form.id])).rows[0].n,
  }));
});

router.put('/:id', async (req, res) => {
  const b = req.body || {};
  // Deteksi konflik: dua editor menyimpan bersamaan (lewati bila klien mengirim force=true)
  if (b.base_updated_at && !b.force && new Date(b.base_updated_at).getTime() !== new Date(req.form.updated_at).getTime()) {
    const latest = await sv.loadQuestions(req.form.id);
    return res.status(409).json({ error: 'conflict', message: 'Formulir ini baru saja diubah oleh editor lain', form: sv.formApi(req.form, { role: req.isOwner ? 'owner' : 'editor', questions: latest }) });
  }
  // bidang yang tidak dikirim tetap memakai nilai tersimpan (PUT parsial aman)
  const title = schema.str(b.title === undefined ? req.form.title : b.title, 200).trim() || 'Formulir tanpa judul';
  const description = schema.str(b.description === undefined ? req.form.description : b.description, 8000);
  const settings = schema.cleanSettings(b.settings === undefined ? req.form.settings : b.settings);
  const cert = schema.cleanCert(b.cert === undefined ? req.form.cert : b.cert, settings);
  if (cert.enabled && settings.identity === 'none') settings.identity = 'ask'; // sertifikat butuh nama
  const theme = schema.cleanTheme(b.theme === undefined ? req.form.theme : b.theme);
  const status = ['draft', 'published', 'closed'].includes(b.status) ? b.status : req.form.status;
  const questions = Array.isArray(b.questions) ? b.questions.slice(0, 500) : null;
  if (status === 'published' && questions && !questions.some((x) => x && x.type !== 'section')) {
    return res.status(422).json({ error: 'no_questions', message: 'Tambahkan minimal satu pertanyaan sebelum dipublikasikan' });
  }
  const saved = await tx(async (c) => {
    const f = (await c.query(
      'UPDATE forms SET title=$2, description=$3, status=$4, theme=$5, settings=$6, cert=$7, updated_at=now() WHERE id=$1 RETURNING *',
      [req.form.id, title, description, status, JSON.stringify(theme), JSON.stringify(settings), JSON.stringify(cert)],
    )).rows[0];
    const qs = questions ? await sv.saveQuestions(c, req.form.id, questions, req.user.id) : await sv.loadQuestions(req.form.id, c);
    return { f, qs };
  });
  res.json(sv.formApi(saved.f, { role: req.isOwner ? 'owner' : 'editor', questions: saved.qs }));
});

router.delete('/:id', ownerOnly, async (req, res) => {
  await q('DELETE FROM forms WHERE id=$1', [req.form.id]);
  res.json({ ok: true });
});

router.post('/:id/duplicate', async (req, res) => {
  const qs = await sv.loadQuestions(req.form.id);
  const out = await tx(async (c) => {
    const f = (await c.query(
      `INSERT INTO forms (owner_id, slug, title, description, theme, settings, cert)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, schema.slugify(), `${req.form.title} (salinan)`.slice(0, 200), req.form.description,
        JSON.stringify(req.form.theme), JSON.stringify(req.form.settings), JSON.stringify(req.form.cert)],
    )).rows[0];
    await sv.saveQuestions(c, f.id, qs.map((x) => ({ ...x, id: schema.newId() })));
    return f;
  });
  res.status(201).json(sv.formApi(out, { role: 'owner' }));
});

/* ---------- editor tambahan (berbagi lewat email) ---------- */
router.get('/:id/editors', async (req, res) => {
  const r = await q(
    `SELECT e.email, e.created_at, u.name, (u.id IS NOT NULL) AS joined
       FROM form_editors e LEFT JOIN users u ON lower(u.email)=e.email WHERE e.form_id=$1 ORDER BY e.created_at`,
    [req.form.id],
  );
  const owner = await q('SELECT email, name FROM users WHERE id=$1', [req.form.owner_id]);
  res.json({ owner: owner.rows[0], editors: r.rows, can_manage: req.isOwner });
});

router.post('/:id/editors', ownerOnly, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) return res.status(422).json({ error: 'invalid_email' });
  if (email === req.user.email.toLowerCase()) return res.status(422).json({ error: 'is_owner', message: 'Itu email Anda sendiri (pemilik)' });
  const n = (await q('SELECT count(*)::int n FROM form_editors WHERE form_id=$1', [req.form.id])).rows[0].n;
  if (n >= 50) return res.status(422).json({ error: 'too_many' });
  await q('INSERT INTO form_editors (form_id, email, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.form.id, email, req.user.id]);
  res.status(201).json({ ok: true, email });
});

router.delete('/:id/editors/:email', async (req, res) => {
  const email = String(req.params.email || '').toLowerCase();
  if (!req.isOwner && email !== req.user.email.toLowerCase()) return res.status(403).json({ error: 'owner_only' });
  await q('DELETE FROM form_editors WHERE form_id=$1 AND email=$2', [req.form.id, email]);
  res.json({ ok: true });
});

/* ---------- Excel ---------- */
router.post('/:id/import-excel', express.raw({ type: '*/*', limit: '8mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'empty_file' });
  const mode = req.query.mode === 'replace' ? 'replace' : 'append';
  let parsed;
  try {
    const existing = mode === 'append' ? await sv.loadQuestions(req.form.id) : [];
    parsed = await excel.parseQuestions(req.body, existing.length);
    const settings = schema.cleanSettings(req.form.settings);
    if (!settings.is_quiz) parsed.questions.forEach((x) => { x.points = 0; x.correct = []; });
    await tx(async (c) => { await sv.saveQuestions(c, req.form.id, [...existing, ...parsed.questions], req.user.id); });
    await q('UPDATE forms SET updated_at=now() WHERE id=$1', [req.form.id]);
  } catch (e) {
    return res.status(422).json({ error: 'import_failed', message: e.message });
  }
  res.json({ imported: parsed.questions.length, warnings: parsed.warnings, questions: await sv.loadQuestions(req.form.id) });
});

router.get('/:id/export.xlsx', async (req, res) => {
  const questions = await sv.loadQuestions(req.form.id);
  const rs = await q("SELECT * FROM responses WHERE form_id=$1 AND status<>'in_progress' ORDER BY submitted_at", [req.form.id]);
  const settings = schema.cleanSettings(req.form.settings);
  const extra = { files: await sv.fileNames(rs.rows.map((r) => r.id)) };
  if (settings.attendance.enabled) extra.checkins = (await q('SELECT * FROM checkins WHERE form_id=$1 ORDER BY created_at', [req.form.id])).rows;
  const buf = await excel.buildResponsesWorkbook({ ...req.form, settings }, questions, rs.rows, extra);
  res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('content-disposition', `attachment; filename="respons-${req.form.slug}.xlsx"`);
  res.send(Buffer.from(buf));
});

/* ---------- ringkasan / rekap ---------- */
router.get('/:id/summary', async (req, res) => {
  res.json(await buildSummary(req.form, await sv.loadQuestions(req.form.id)));
});

router.get('/:id/report.pdf', async (req, res) => {
  const summary = await buildSummary(req.form, await sv.loadQuestions(req.form.id));
  const theme = schema.cleanTheme(req.form.theme);
  const pdf = await renderReport({ form: req.form, summary, accent: theme.color });
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `attachment; filename="rekap-${req.form.slug}.pdf"`);
  res.send(pdf);
});

/* ---------- respons per peserta ---------- */
router.get('/:id/responses', async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const search = String(req.query.search || '').trim().toLowerCase();
  const where = ["form_id=$1", req.query.status === 'all' ? 'true' : "status<>'in_progress'"];
  const params = [req.form.id];
  if (search) { params.push(`%${search}%`); where.push(`(lower(name) LIKE $${params.length} OR lower(email) LIKE $${params.length} OR lower(identifier) LIKE $${params.length})`); }
  const w = where.join(' AND ');
  const total = (await q(`SELECT count(*)::int n FROM responses WHERE ${w}`, params)).rows[0].n;
  const rows = (await q(
    `SELECT id, name, email, identifier, status, graded, score::float AS score, max_score::float AS max_score, attempt_no,
            jsonb_array_length(violations) AS violations, started_at, submitted_at, cert_code FROM responses WHERE ${w}
       ORDER BY COALESCE(submitted_at, started_at) DESC LIMIT ${limit} OFFSET ${offset}`, params,
  )).rows;
  res.json({ total, rows });
});

async function loadResponse(req, res) {
  if (!schema.UUID_RE.test(req.params.rid)) { notFound(res); return null; }
  const r = await q('SELECT * FROM responses WHERE id=$1 AND form_id=$2', [req.params.rid, req.form.id]);
  if (!r.rowCount) { notFound(res); return null; }
  return r.rows[0];
}

async function responseDetail(form, questions, r) {
  const { visible } = logic.applyLogic(logic.questionsFor(questions, r), r.answers || {});
  const g = gradeResponse(visible, r.answers, r.essay_scores);
  const files = await sv.fileNames([r.id]);
  return {
    id: r.id, name: r.name, email: r.email, identifier: r.identifier, status: r.status, graded: r.graded, attempt_no: r.attempt_no,
    score: Number(r.score), max_score: Number(r.max_score), started_at: r.started_at, submitted_at: r.submitted_at,
    deadline_at: r.deadline_at, cert_code: r.cert_code, violations: r.violations || [],
    items: visible.filter((x) => x.type !== 'section').map((x) => ({
      id: x.id, title: x.title, type: x.type, points_max: x.points,
      answer: answerText(x, r.answers[x.id], { files }), raw: r.answers[x.id] ?? null,
      file_id: x.type === 'file' && r.answers[x.id] ? r.answers[x.id] : null,
      correct: g.details[x.id]?.correct ?? null, points: g.details[x.id]?.points ?? 0,
      manual: !!g.details[x.id]?.manual, graded_manually: r.essay_scores[x.id] !== undefined,
    })),
  };
}

router.get('/:id/responses/:rid', async (req, res) => {
  const r = await loadResponse(req, res); if (!r) return;
  res.json(await responseDetail(req.form, await sv.loadQuestions(req.form.id), r));
});

router.patch('/:id/responses/:rid/grade', async (req, res) => {
  const r = await loadResponse(req, res); if (!r) return;
  const questions = await sv.loadQuestions(req.form.id);
  const essay = { ...r.essay_scores };
  for (const [qid, v] of Object.entries(req.body?.scores || {})) {
    const x = questions.find((y) => y.id === qid && (y.type === 'paragraph' || y.type === 'file') && y.points > 0);
    if (!x) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    essay[qid] = Math.min(x.points, Math.max(0, Math.round(n * 100) / 100));
  }
  const g = gradeResponse(logic.applyLogic(logic.questionsFor(questions, r), r.answers || {}).visible, r.answers, essay);
  const upd = (await q(
    'UPDATE responses SET essay_scores=$2, score=$3, max_score=$4, graded=$5 WHERE id=$1 RETURNING *',
    [r.id, JSON.stringify(essay), g.score, g.max, !g.needsManual],
  )).rows[0];
  const form = { ...req.form, id: req.form.id };
  const code = await ensureCertificate(form, upd);
  if (code) upd.cert_code = code;
  const cert = schema.cleanCert(req.form.cert);
  if (code && cert.auto_email && upd.email && mailer.configured()) {
    const c = (await q('SELECT * FROM certificates WHERE code=$1', [code])).rows[0];
    if (c && !c.emailed_at) sv.emailCertificate(form, c, upd).catch((e) => console.error('email sertifikat gagal:', e.message));
  }
  res.json(await responseDetail(req.form, questions, upd));
});

router.delete('/:id/responses/:rid', async (req, res) => {
  const r = await loadResponse(req, res); if (!r) return;
  await q('DELETE FROM responses WHERE id=$1', [r.id]);
  res.json({ ok: true });
});

router.post('/:id/responses/:rid/certificate/email', async (req, res) => {
  const r = await loadResponse(req, res); if (!r) return;
  const code = await ensureCertificate(req.form, r);
  if (!code) return res.status(422).json({ error: 'not_eligible', message: 'Peserta belum memenuhi syarat sertifikat' });
  const c = (await q('SELECT * FROM certificates WHERE code=$1', [code])).rows[0];
  try {
    await sv.emailCertificate(req.form, c, r);
  } catch (e) {
    const status = e.code === 'smtp_not_configured' ? 503 : e.code === 'no_email' ? 422 : 502;
    return res.status(status).json({ error: e.code || 'email_failed', message: e.message });
  }
  res.json({ ok: true });
});

router.get('/:id/certificate-preview.pdf', async (req, res) => {
  const cert = schema.cleanCert(req.form.cert);
  const { renderCertificate } = require('../certificate');
  const { pdf } = await renderCertificate({
    cert, formTitle: req.form.title, name: schema.str(String(req.query.name || ''), 80) || 'Nama Peserta',
    date: new Date(), score: schema.cleanSettings(req.form.settings).is_quiz ? 100 : null, code: 'UIKA-CONTOH-0000-00',
    number: cert.number_format ? require('../certificate').formatNumber(cert.number_format, cert.number_start || 1, new Date()) : '',
  });
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', 'inline; filename="contoh-sertifikat.pdf"');
  res.send(pdf);
});

/* ---------- daftar peserta yang diizinkan ---------- */
const MAX_ALLOWED = 5000;
router.get('/:id/allowlist', async (req, res) => {
  const rows = (await q(
    `SELECT a.email, a.identifier, a.name, a.created_at,
            EXISTS (SELECT 1 FROM responses r WHERE r.form_id=a.form_id AND r.status<>'in_progress'
                      AND ((a.email<>'' AND lower(r.email)=lower(a.email)) OR (a.identifier<>'' AND lower(r.identifier)=lower(a.identifier)))) AS submitted,
            EXISTS (SELECT 1 FROM checkins c WHERE c.form_id=a.form_id AND a.email<>'' AND lower(c.email)=lower(a.email)) AS attended
       FROM allowed_participants a WHERE a.form_id=$1 ORDER BY lower(a.name), lower(a.email) LIMIT ${MAX_ALLOWED}`, [req.form.id],
  )).rows;
  res.json({ total: rows.length, submitted: rows.filter((r) => r.submitted).length, attended: rows.filter((r) => r.attended).length, rows });
});

/** Masukan: teks (satu baris "email, NIM, nama" / "nama<TAB>email") atau array objek. */
function parseAllowed(input) {
  const out = []; const warn = [];
  const lines = Array.isArray(input) ? input : String(input || '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    if (raw && typeof raw === 'object') { out.push({ email: String(raw.email || '').trim().toLowerCase(), identifier: String(raw.identifier || '').trim(), name: String(raw.name || '').trim() }); return; }
    const line = String(raw || '').trim();
    if (!line || /^(email|nama|name|nim)\b/i.test(line) && i === 0) return;
    const parts = line.split(/[,;\t]/).map((x) => x.trim().replace(/^"|"$/g, ''));
    let email = ''; let identifier = ''; const rest = [];
    for (const p of parts) {
      if (!p) continue;
      if (!email && EMAIL_RE.test(p)) email = p.toLowerCase();
      else if (!identifier && /^[\w.-]{4,30}$/.test(p) && /\d/.test(p)) identifier = p;
      else rest.push(p);
    }
    if (!email && !identifier) { warn.push(`Baris ${i + 1}: tidak ada email atau NIM`); return; }
    out.push({ email, identifier, name: rest.join(' ') });
  });
  return { out, warn };
}

router.post('/:id/allowlist', async (req, res) => {
  const { out, warn } = parseAllowed(req.body?.items ?? req.body?.text);
  if (!out.length) return res.status(422).json({ error: 'empty', message: 'Tidak ada data peserta yang dapat dibaca', warnings: warn });
  if (req.body?.replace === true) await q('DELETE FROM allowed_participants WHERE form_id=$1', [req.form.id]);
  const have = (await q('SELECT count(*)::int n FROM allowed_participants WHERE form_id=$1', [req.form.id])).rows[0].n;
  if (have + out.length > MAX_ALLOWED + 500) return res.status(422).json({ error: 'too_many', message: `Maksimum ${MAX_ALLOWED} peserta` });
  let added = 0;
  await tx(async (c) => {
    for (const x of out.slice(0, MAX_ALLOWED)) {
      const r = await c.query('INSERT INTO allowed_participants (form_id, email, identifier, name) VALUES ($1,$2,$3,$4) ON CONFLICT (form_id, email, identifier) DO UPDATE SET name=CASE WHEN EXCLUDED.name<>\'\' THEN EXCLUDED.name ELSE allowed_participants.name END RETURNING (xmax = 0) AS inserted',
        [req.form.id, x.email.slice(0, 200), x.identifier.slice(0, 60), x.name.slice(0, 200)]);
      if (r.rows[0].inserted) added += 1;
    }
  });
  res.status(201).json({ added, total: out.length, warnings: warn });
});

router.delete('/:id/allowlist', async (req, res) => {
  const email = String(req.query.email || ''); const identifier = String(req.query.identifier || '');
  if (req.query.all === '1') await q('DELETE FROM allowed_participants WHERE form_id=$1', [req.form.id]);
  else await q('DELETE FROM allowed_participants WHERE form_id=$1 AND email=$2 AND identifier=$3', [req.form.id, email, identifier]);
  res.json({ ok: true });
});

/* ---------- absensi ---------- */
router.get('/:id/checkins', async (req, res) => {
  const rows = (await q('SELECT id, name, email, identifier, created_at FROM checkins WHERE form_id=$1 ORDER BY created_at DESC LIMIT 5000', [req.form.id])).rows;
  res.json({ total: rows.length, rows, token: req.form.checkin_token, url: `${config.BASE_URL}/checkin/${req.form.checkin_token}` });
});
router.post('/:id/checkins', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase(); const name = schema.str(req.body?.name, 200).trim();
  if (!EMAIL_RE.test(email) || name.length < 2) return res.status(422).json({ error: 'invalid', message: 'Nama dan email yang valid wajib diisi' });
  const r = await q('INSERT INTO checkins (form_id, name, email, identifier) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id', [req.form.id, name, email, schema.str(req.body?.identifier, 60).trim()]);
  const s = schema.cleanSettings(req.form.settings);
  if (r.rowCount && s.attendance.require_for_cert) {
    const rs = (await q("SELECT * FROM responses WHERE form_id=$1 AND status<>'in_progress' AND cert_code IS NULL AND lower(email)=lower($2)", [req.form.id, email])).rows;
    for (const x of rs) await ensureCertificate(req.form, x);
  }
  res.status(201).json({ ok: true, already: !r.rowCount });
});
router.delete('/:id/checkins/:cid', async (req, res) => {
  if (!schema.UUID_RE.test(req.params.cid)) return notFound(res);
  await q('DELETE FROM checkins WHERE id=$1 AND form_id=$2', [req.params.cid, req.form.id]);
  res.json({ ok: true });
});
router.post('/:id/checkin-token', async (req, res) => {
  const r = await q("UPDATE forms SET checkin_token=substr(replace(gen_random_uuid()::text,'-',''),1,16) WHERE id=$1 RETURNING checkin_token", [req.form.id]);
  res.json({ token: r.rows[0].checkin_token, url: `${config.BASE_URL}/checkin/${r.rows[0].checkin_token}` });
});

/* ---------- tautan pendek, QR, embed ---------- */
const ALIAS_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;
const RESERVED = new Set(['admin', 'api', 'new', 'lists', 'banks', 'verify', 'checkin', 'forms', 'login', 'logout', 'auth', 'static', 'vendor', 'uploads']);
router.put('/:id/alias', async (req, res) => {
  const alias = String(req.body?.alias || '').trim().toLowerCase();
  if (!alias) { await q('UPDATE forms SET alias=NULL WHERE id=$1', [req.form.id]); return res.json({ alias: null }); }
  if (!ALIAS_RE.test(alias) || RESERVED.has(alias)) return res.status(422).json({ error: 'invalid_alias', message: 'Alias 3–40 karakter: huruf kecil, angka, tanda minus' });
  const clash = await q('SELECT 1 FROM forms WHERE id<>$1 AND (lower(alias)=$2 OR slug=$2)', [req.form.id, alias]);
  if (clash.rowCount) return res.status(409).json({ error: 'alias_taken', message: 'Alias sudah dipakai' });
  await q('UPDATE forms SET alias=$2 WHERE id=$1', [req.form.id, alias]);
  res.json({ alias });
});

router.get('/:id/qr', async (req, res) => {
  const kind = req.query.kind === 'checkin' ? 'checkin' : 'form';
  const url = kind === 'checkin' ? `${config.BASE_URL}/checkin/${req.form.checkin_token}` : `${config.BASE_URL}/s/${req.form.alias || req.form.slug}`;
  const opts = { margin: 2, errorCorrectionLevel: 'M', width: 640, color: { dark: '#1d1d1f', light: '#ffffff' } };
  if (req.query.format === 'png') {
    res.setHeader('content-type', 'image/png');
    if (req.query.download === '1') res.setHeader('content-disposition', `attachment; filename="qr-${kind}-${req.form.slug}.png"`);
    return res.send(await QRCode.toBuffer(url, opts));
  }
  res.setHeader('content-type', 'image/svg+xml');
  res.send(await QRCode.toString(url, { ...opts, type: 'svg' }));
});

/* ---------- unduh berkas jawaban peserta ---------- */
router.get('/:id/files/:fid', async (req, res) => {
  if (!schema.UUID_RE.test(req.params.fid)) return notFound(res);
  const r = await q('SELECT f.filename, f.mime, f.data FROM response_files f JOIN responses r ON r.id=f.response_id WHERE f.id=$1 AND r.form_id=$2', [req.params.fid, req.form.id]);
  if (!r.rowCount) return notFound(res);
  const f = r.rows[0];
  res.setHeader('content-type', f.mime);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('content-security-policy', "default-src 'none'; sandbox");
  res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
  res.send(f.data);
});

/* ---------- kirim sertifikat massal ---------- */
const certJobs = new Map(); // formId -> {total, sent, failed, skipped, done, errors, startedAt}
router.post('/:id/certificates/send-all', async (req, res) => {
  if (!mailer.configured()) return res.status(503).json({ error: 'smtp_not_configured', message: 'Pengiriman email belum diaktifkan di server' });
  const cur = certJobs.get(req.form.id);
  if (cur && !cur.done) return res.status(409).json({ error: 'running', message: 'Pengiriman sebelumnya masih berjalan', job: cur });
  const resend = req.body?.resend === true;
  const rs = (await q("SELECT * FROM responses WHERE form_id=$1 AND status<>'in_progress' AND graded AND email<>'' ORDER BY submitted_at", [req.form.id])).rows;
  const job = { total: rs.length, sent: 0, failed: 0, skipped: 0, done: false, errors: [], startedAt: new Date() };
  certJobs.set(req.form.id, job);
  const form = req.form;
  (async () => {
    for (const r of rs) {
      try {
        const code = await ensureCertificate(form, r);
        if (!code) { job.skipped += 1; continue; }
        const c = (await q('SELECT * FROM certificates WHERE code=$1', [code])).rows[0];
        if (c.emailed_at && !resend) { job.skipped += 1; continue; }
        await sv.emailCertificate(form, c, r);
        job.sent += 1;
      } catch (e) { job.failed += 1; if (job.errors.length < 5) job.errors.push(`${r.email}: ${e.message}`); }
      await new Promise((ok) => setTimeout(ok, 120)); // jaga laju kirim
    }
    job.done = true;
  })().catch((e) => { job.done = true; job.errors.push(e.message); });
  res.status(202).json(job);
});
router.get('/:id/certificates/send-all', (req, res) => {
  res.json(certJobs.get(req.form.id) || { total: 0, sent: 0, failed: 0, skipped: 0, done: true, errors: [] });
});

router.get('/:id/certificates', async (req, res) => {
  const r = await q('SELECT code, number, name, email, issued_at, emailed_at FROM certificates WHERE form_id=$1 ORDER BY issued_at DESC LIMIT 5000', [req.form.id]);
  res.json({ total: r.rowCount, rows: r.rows, smtp: mailer.configured() });
});

module.exports = router;
