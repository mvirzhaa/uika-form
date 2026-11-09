'use strict';
/* API Pengisian: dipakai peserta (tanpa/dengan login). Kunci jawaban tidak pernah dikirim. */
const crypto = require('crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { q, tx } = require('../db');
const schema = require('../schema');
const sv = require('../services');
const config = require('../config');
const { gradeResponse } = require('../grading');
const { ensureCertificate } = require('../certificate');
const logic = require('../logic');
const mailer = require('../mailer');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GRACE_MS = 60 * 1000; // toleransi jaringan setelah batas waktu

const limiter = (limit, windowMs = 60 * 1000) => rateLimit({
  windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'too_many_requests' },
});
const general = limiter(Number(process.env.RATE_LIMIT_PER_MIN) || 300);
router.use(general);

const ipHash = (req) => crypto.createHash('sha256').update(`${req.ip}|${config.SESSION_SECRET}`).digest('hex').slice(0, 24);

async function formBySlug(slug) {
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/i.test(slug)) return null;
  const r = await q('SELECT * FROM forms WHERE slug=$1 OR lower(alias)=$1 ORDER BY (slug=$1) DESC LIMIT 1', [slug.toLowerCase()]);
  return r.rows[0] || null;
}

async function isEditor(user, formRow) {
  if (!user) return false;
  if (formRow.owner_id === user.id) return true;
  const r = await q('SELECT 1 FROM form_editors WHERE form_id=$1 AND email=lower($2)', [formRow.id, user.email]);
  return r.rowCount > 0;
}

/* ---------- baca formulir ---------- */
router.get('/forms/:slug', async (req, res) => {
  const f = await formBySlug(req.params.slug);
  if (!f) return res.status(404).json({ error: 'not_found' });
  let state = sv.openState(f);
  let preview = false;
  if (req.query.preview === '1' && (await isEditor(req.user, f))) { preview = true; state = 'open'; }
  const api = sv.formApi(f);
  const out = {
    id: f.id, slug: f.slug, title: f.title, description: f.description, theme: api.theme, state, preview,
    settings: {
      is_quiz: api.settings.is_quiz, duration_min: api.settings.duration_min, identity: api.settings.identity,
      shuffle_questions: api.settings.shuffle_questions, shuffle_options: api.settings.shuffle_options,
      one_response: api.settings.one_response, show_score: api.settings.show_score,
      open_at: api.settings.open_at, close_at: api.settings.close_at,
      max_attempts: api.settings.one_response ? 1 : api.settings.max_attempts, pick_count: api.settings.pick_count,
      anticheat: api.settings.anticheat, language: api.settings.language, allow_embed: api.settings.allow_embed,
      allowlist: api.settings.allowlist.enabled, attendance: api.settings.attendance,
    },
    certificate: api.cert.enabled, me: req.user ? { name: req.user.name, email: req.user.email, identifier: req.user.identifier } : null,
  };
  if (state === 'open') {
    const qs = await sv.loadQuestions(f.id);
    // soal acak: daftar soal baru dikirim saat percobaan dimulai (tidak membocorkan seluruh bank)
    const hidePool = api.settings.pick_count > 0 && !preview && logic.pickQuestionIds(qs, api.settings.pick_count) !== null;
    if (!hidePool) out.questions = sv.publicQuestions(qs);
    else {
      out.questions_on_start = true;
      const real = qs.filter((x) => x.type !== 'section'); const always = real.filter((x) => x.config?.always).length;
      out.question_count = always + Math.min(api.settings.pick_count, real.length - always);
    }
    out.total_points = hidePool ? null : qs.reduce((a, x) => a + (api.settings.is_quiz ? x.points : 0), 0);
  }
  res.json(out);
});

/* ---------- mulai ---------- */
async function allowedParticipant(formId, email, identifier) {
  const r = await q(
    `SELECT 1 FROM allowed_participants WHERE form_id=$1 AND ((email<>'' AND lower(email)=lower($2)) OR (identifier<>'' AND lower(identifier)=lower($3))) LIMIT 1`,
    [formId, email || '', identifier || ''],
  );
  return r.rowCount > 0;
}

const attemptPayload = (qsAll, row) => sv.publicQuestions(logic.questionsFor(qsAll, row));

router.post('/forms/:slug/start', async (req, res) => {
  const f = await formBySlug(req.params.slug);
  if (!f) return res.status(404).json({ error: 'not_found' });
  const settings = schema.cleanSettings(f.settings);
  const body = req.body || {};
  const now = new Date();

  const preview = body.preview === true && (await isEditor(req.user, f));
  if (preview) {
    const qs = await sv.loadQuestions(f.id);
    return res.json({ attempt: { id: 'preview', started_at: now, answers: {}, deadline_at: settings.duration_min ? new Date(now.getTime() + settings.duration_min * 60000) : null }, questions: sv.publicQuestions(qs), server_now: now, preview: true });
  }
  const state = sv.openState(f, now);
  if (state !== 'open') return res.status(403).json({ error: state });

  // lanjutkan percobaan yang sedang berjalan (peserta tanpa login cukup membawa id percobaannya)
  if (typeof body.resume_id === 'string' && schema.UUID_RE.test(body.resume_id)) {
    const r = await q("SELECT * FROM responses WHERE id=$1 AND form_id=$2 AND status='in_progress'", [body.resume_id, f.id]);
    const ex = r.rows[0];
    if (ex && (!ex.user_id || ex.user_id === req.user?.id)) {
      const qsAll = await sv.loadQuestions(f.id);
      return res.json({ attempt: { id: ex.id, started_at: ex.started_at, deadline_at: ex.deadline_at, answers: ex.answers, attempt_no: ex.attempt_no }, questions: attemptPayload(qsAll, ex), server_now: now, resumed: true });
    }
  }

  // identitas
  let name = ''; let email = ''; let identifier = '';
  if (settings.identity === 'login' || (settings.allowlist.enabled && settings.allowlist.require_login)) {
    if (!req.user) return res.status(401).json({ error: 'login_required' });
  }
  if (req.user && settings.identity !== 'none') {
    ({ name, email } = req.user); identifier = req.user.identifier || '';
    if (settings.identity === 'ask') { name = schema.str(body.name, 200).trim() || name; identifier = schema.str(body.identifier, 60).trim() || identifier; }
  } else if (settings.identity === 'ask') {
    name = schema.str(body.name, 200).trim();
    email = schema.str(body.email, 200).trim().toLowerCase();
    identifier = schema.str(body.identifier, 60).trim();
    if (name.length < 2) return res.status(422).json({ error: 'name_required', message: 'Nama wajib diisi' });
    if (!EMAIL_RE.test(email)) return res.status(422).json({ error: 'email_required', message: 'Email tidak valid' });
  }

  // daftar peserta yang diizinkan
  if (settings.allowlist.enabled && !(await allowedParticipant(f.id, email || req.user?.email, identifier))) {
    return res.status(403).json({ error: 'not_allowed', message: 'Anda tidak terdaftar sebagai peserta formulir ini' });
  }

  // batas percobaan
  const limit = settings.one_response ? 1 : settings.max_attempts;
  let done = 0; let lastDone = null;
  if (req.user || email) {
    const dr = await q(
      `SELECT id FROM responses WHERE form_id=$1 AND status<>'in_progress'
         AND (($2::uuid IS NOT NULL AND user_id=$2::uuid) OR ($3<>'' AND lower(email)=lower($3))) ORDER BY submitted_at DESC`,
      [f.id, req.user?.id || null, req.user?.email || email || ''],
    );
    done = dr.rowCount; lastDone = dr.rows[0]?.id || null;
  }
  if (limit > 0 && done >= limit) {
    return res.status(409).json({
      error: limit === 1 ? 'already_submitted' : 'attempts_exhausted',
      message: limit === 1 ? 'Anda sudah mengisi formulir ini' : `Batas ${limit} percobaan sudah tercapai`,
      attempt_id: req.user ? lastDone : undefined,
    });
  }

  // percobaan belum selesai milik akun yang sama
  let existing = null;
  if (req.user) {
    const r = await q("SELECT * FROM responses WHERE form_id=$1 AND user_id=$2 AND status='in_progress' ORDER BY started_at DESC LIMIT 1", [f.id, req.user.id]);
    existing = r.rows[0] || null;
  }
  const qsAll = await sv.loadQuestions(f.id);
  if (existing) {
    return res.json({ attempt: { id: existing.id, started_at: existing.started_at, deadline_at: existing.deadline_at, answers: existing.answers, attempt_no: existing.attempt_no }, questions: attemptPayload(qsAll, existing), server_now: now, resumed: true });
  }

  const deadline = settings.is_quiz && settings.duration_min > 0 ? new Date(now.getTime() + settings.duration_min * 60000) : null;
  const questionIds = settings.pick_count > 0 ? logic.pickQuestionIds(qsAll, settings.pick_count) : null;
  const r = await q(
    `INSERT INTO responses (form_id, user_id, name, email, identifier, deadline_at, ip_hash, attempt_no, question_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, started_at, deadline_at, answers, attempt_no, question_ids`,
    [f.id, req.user?.id || null, name, email, identifier, deadline, ipHash(req), done + 1, questionIds ? JSON.stringify(questionIds) : null],
  );
  res.status(201).json({ attempt: r.rows[0], questions: attemptPayload(qsAll, r.rows[0]), server_now: now });
});

/* ---------- simpan sementara ---------- */
async function loadAttempt(id) {
  if (!schema.UUID_RE.test(id)) return null;
  const r = await q('SELECT r.*, row_to_json(f) AS form FROM responses r JOIN forms f ON f.id=r.form_id WHERE r.id=$1', [id]);
  if (!r.rowCount) return null;
  const { form, ...resp } = r.rows[0];
  return { resp, form };
}

router.put('/attempts/:id/save', async (req, res) => {
  const a = await loadAttempt(req.params.id);
  if (!a) return res.status(404).json({ error: 'not_found' });
  if (a.resp.status !== 'in_progress') return res.status(409).json({ error: 'already_submitted' });
  if (a.resp.deadline_at && Date.now() > new Date(a.resp.deadline_at).getTime() + GRACE_MS) return res.status(409).json({ error: 'expired' });
  const sub = logic.questionsFor(await sv.loadQuestions(a.form.id), a.resp);
  const { answers } = await sv.prepareAnswers(sub, req.body?.answers, a.resp.id);
  await q('UPDATE responses SET answers=$2 WHERE id=$1', [a.resp.id, JSON.stringify(answers)]);
  res.json({ ok: true, server_now: new Date() });
});

/* ---------- kirim ---------- */
async function finalize({ form, resp, qs, answers, auto }) {
  const g = gradeResponse(qs, answers, {});
  const quiz = schema.cleanSettings(form.settings).is_quiz;
  const upd = (await q(
    `UPDATE responses SET answers=$2, status=$3, submitted_at=now(), score=$4, max_score=$5, graded=$6
      WHERE id=$1 AND status='in_progress' RETURNING *`,
    [resp.id, JSON.stringify(answers), auto ? 'auto_submitted' : 'submitted', quiz ? g.score : 0, quiz ? g.max : 0, quiz ? !g.needsManual : true],
  )).rows[0];
  return { upd, g };
}

/** Hasil untuk peserta: nilai, tinjauan, status sertifikat (soal sesuai subset & percabangan). */
async function resultFor(form, resp) {
  const settings = schema.cleanSettings(form.settings);
  const qsAll = await sv.loadQuestions(form.id);
  const { visible } = logic.applyLogic(logic.questionsFor(qsAll, resp), resp.answers || {});
  const g = gradeResponse(visible, resp.answers, resp.essay_scores || {});
  const ctx = { files: await sv.fileNames([resp.id]) };
  if (settings.attendance.enabled && settings.attendance.require_for_cert) ctx.attended = await sv.hasCheckin(form.id, resp);
  if (resp.cert_code) ctx.cert_number = (await q('SELECT number FROM certificates WHERE code=$1', [resp.cert_code])).rows[0]?.number || null;
  return sv.buildResult(form, visible, { ...resp, details: g.details }, ctx);
}

/** Terbitkan sertifikat (bila berhak) + email otomatis + notifikasi. */
async function afterSubmit(form, upd) {
  const code = await ensureCertificate(form, upd);
  if (code) upd.cert_code = code;
  const cert = schema.cleanCert(form.cert);
  if (code && cert.auto_email && upd.email && mailer.configured()) {
    const c = (await q('SELECT * FROM certificates WHERE code=$1', [code])).rows[0];
    sv.emailCertificate(form, c, upd).catch((e) => console.error('email sertifikat gagal:', e.message));
  }
  sv.notifySubmission(form, upd).catch((e) => console.error('notifikasi gagal:', e.message));
}

router.post('/attempts/:id/submit', async (req, res) => {
  const body = req.body || {};

  // pratinjau editor: hitung nilai tanpa menyimpan
  if (req.params.id === 'preview') {
    const f = await formBySlug(String(body.slug || ''));
    if (!f || !(await isEditor(req.user, f))) return res.status(403).json({ error: 'forbidden' });
    const qs = await sv.loadQuestions(f.id);
    const { visible, answers } = await sv.prepareAnswers(qs, body.answers, null);
    const quiz = schema.cleanSettings(f.settings).is_quiz;
    const g = gradeResponse(visible, answers, {});
    const fake = { id: 'preview', status: 'submitted', submitted_at: new Date(), score: g.score, max_score: g.max, graded: !g.needsManual, answers, details: g.details, name: req.user.name, email: req.user.email, cert_code: null };
    const out = sv.buildResult(f, visible, quiz ? fake : { ...fake, score: 0, max_score: 0 });
    out.preview = true;
    return res.json(out);
  }

  const a = await loadAttempt(req.params.id);
  if (!a) return res.status(404).json({ error: 'not_found' });

  if (a.resp.status !== 'in_progress') return res.json(await resultFor(a.form, a.resp)); // idempoten

  const sub = logic.questionsFor(await sv.loadQuestions(a.form.id), a.resp);
  const late = a.resp.deadline_at && Date.now() > new Date(a.resp.deadline_at).getTime() + GRACE_MS;
  const auto = !!body.auto || !!late;
  const prepared = await sv.prepareAnswers(sub, late ? a.resp.answers : body.answers, a.resp.id);
  const { visible, answers } = prepared;

  if (!auto) {
    const missing = visible.filter((x) => x.required && x.type !== 'section' && !logic.isAnswered(x, answers[x.id])).map((x) => x.id);
    if (missing.length) return res.status(422).json({ error: 'required', message: 'Ada pertanyaan wajib yang belum diisi', missing });
  }

  const { upd } = await finalize({ form: a.form, resp: a.resp, qs: visible, answers, auto });
  if (!upd) return res.status(409).json({ error: 'already_submitted' });
  await afterSubmit(a.form, upd);
  res.json(await resultFor(a.form, upd));
});

router.get('/attempts/:id/result', async (req, res) => {
  const a = await loadAttempt(req.params.id);
  if (!a || a.resp.status === 'in_progress') return res.status(404).json({ error: 'not_found' });
  res.json(await resultFor(a.form, a.resp));
});

/* ---------- anti-curang: catat pelanggaran (pindah tab / keluar layar penuh) ---------- */
router.post('/attempts/:id/violation', limiter(60), async (req, res) => {
  const a = await loadAttempt(req.params.id);
  if (!a) return res.status(404).json({ error: 'not_found' });
  const settings = schema.cleanSettings(a.form.settings);
  if (!settings.anticheat.enabled) return res.json({ ok: true, count: 0, max: 0 });
  if (a.resp.status !== 'in_progress') return res.json({ ok: true, submitted: true });
  const type = ['hidden', 'blur', 'fullscreen'].includes(req.body?.type) ? req.body.type : 'hidden';
  const upd = await q(
    `UPDATE responses SET violations = (CASE WHEN jsonb_array_length(violations) < 200 THEN violations || $2::jsonb ELSE violations END)
      WHERE id=$1 AND status='in_progress' RETURNING jsonb_array_length(violations) AS n`,
    [a.resp.id, JSON.stringify([{ t: new Date().toISOString(), type }])],
  );
  const count = upd.rows[0]?.n || 0;
  const max = settings.anticheat.max_violations;
  if (count < max) return res.json({ ok: true, count, max });

  // batas terlampaui: kirim otomatis memakai jawaban terakhir (dari klien bila ada)
  const sub = logic.questionsFor(await sv.loadQuestions(a.form.id), a.resp);
  const { visible, answers } = await sv.prepareAnswers(sub, req.body?.answers || a.resp.answers, a.resp.id);
  const { upd: done } = await finalize({ form: a.form, resp: a.resp, qs: visible, answers, auto: true });
  if (done) await afterSubmit(a.form, done);
  const fresh = done || (await q('SELECT * FROM responses WHERE id=$1', [a.resp.id])).rows[0];
  res.json({ ok: true, count, max, submitted: true, result: await resultFor(a.form, fresh) });
});

/* ---------- unggah berkas peserta (pertanyaan tipe "file") ---------- */
const MAX_FILE = 5 * 1024 * 1024;
const MAX_FILES_TOTAL = 25 * 1024 * 1024;
function sniffFile(buf, filename) {
  const ext = (String(filename).toLowerCase().match(/\.([a-z0-9]{1,5})$/) || [])[1] || '';
  const starts = (...bytes) => bytes.every((b, i) => buf[i] === b);
  if (buf.length > 8 && starts(0x89, 0x50, 0x4e, 0x47)) return { mime: 'image/png', kind: 'image' };
  if (buf.length > 3 && starts(0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', kind: 'image' };
  if (buf.length > 5 && starts(0x25, 0x50, 0x44, 0x46)) return { mime: 'application/pdf', kind: 'pdf' };
  const office = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
  if (buf.length > 4 && starts(0x50, 0x4b, 0x03, 0x04) && office[ext]) return { mime: office[ext], kind: 'doc' };
  const ole = { doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint' };
  if (buf.length > 8 && starts(0xd0, 0xcf, 0x11, 0xe0) && ole[ext]) return { mime: ole[ext], kind: 'doc' };
  return null;
}
const cleanFilename = (v) => String(v || 'berkas').replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_').replace(/^\.+/, '').trim().slice(0, 120) || 'berkas';

router.post('/attempts/:id/files/:qid', limiter(30), express.raw({ type: '*/*', limit: MAX_FILE + 1024 }), async (req, res) => {
  const a = await loadAttempt(req.params.id);
  if (!a || !schema.UUID_RE.test(req.params.qid)) return res.status(404).json({ error: 'not_found' });
  if (a.resp.status !== 'in_progress') return res.status(409).json({ error: 'already_submitted' });
  if (a.resp.deadline_at && Date.now() > new Date(a.resp.deadline_at).getTime() + GRACE_MS) return res.status(409).json({ error: 'expired' });
  const qs = logic.questionsFor(await sv.loadQuestions(a.form.id), a.resp);
  const x = qs.find((y) => y.id === req.params.qid.toLowerCase() && y.type === 'file');
  if (!x) return res.status(404).json({ error: 'not_found' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'empty_file', message: 'Berkas kosong' });
  const limit = Math.min(MAX_FILE, (x.config.max_mb || 5) * 1024 * 1024);
  if (buf.length > limit) return res.status(413).json({ error: 'too_large', message: `Ukuran berkas maksimal ${Math.round(limit / 1048576)} MB` });
  let filename = '';
  try { filename = cleanFilename(decodeURIComponent(String(req.headers['x-filename'] || ''))); } catch { filename = 'berkas'; }
  const sn = sniffFile(buf, filename);
  const accept = x.config.accept || 'any';
  const okKind = sn && (accept === 'any' || (accept === 'image' && sn.kind === 'image') || (accept === 'pdf' && sn.kind === 'pdf') || (accept === 'doc' && (sn.kind === 'pdf' || sn.kind === 'doc')));
  if (!okKind) return res.status(415).json({ error: 'unsupported', message: 'Jenis berkas tidak diizinkan (PDF, PNG/JPG, atau dokumen Office)' });
  const used = (await q('SELECT COALESCE(sum(size),0)::int n FROM response_files WHERE response_id=$1 AND question_id<>$2', [a.resp.id, x.id])).rows[0].n;
  if (used + buf.length > MAX_FILES_TOTAL) return res.status(413).json({ error: 'quota', message: 'Total ukuran berkas terlalu besar' });
  const out = await tx(async (c) => {
    await c.query('DELETE FROM response_files WHERE response_id=$1 AND question_id=$2', [a.resp.id, x.id]);
    return (await c.query('INSERT INTO response_files (response_id, question_id, filename, mime, size, data) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, filename, size', [a.resp.id, x.id, filename, sn.mime, buf.length, buf])).rows[0];
  });
  res.status(201).json(out);
});

router.delete('/attempts/:id/files/:qid', async (req, res) => {
  const a = await loadAttempt(req.params.id);
  if (!a || !schema.UUID_RE.test(req.params.qid)) return res.status(404).json({ error: 'not_found' });
  if (a.resp.status !== 'in_progress') return res.status(409).json({ error: 'already_submitted' });
  await q('DELETE FROM response_files WHERE response_id=$1 AND question_id=$2', [a.resp.id, req.params.qid.toLowerCase()]);
  res.json({ ok: true });
});

/* ---------- absensi (check-in) lewat QR ---------- */
async function formByToken(token) {
  if (!/^[a-f0-9]{16}$/.test(String(token))) return null;
  return (await q('SELECT * FROM forms WHERE checkin_token=$1', [token])).rows[0] || null;
}

router.get('/checkin/:token', async (req, res) => {
  const f = await formByToken(req.params.token);
  if (!f) return res.status(404).json({ error: 'not_found' });
  const api = sv.formApi(f);
  const enabled = api.settings.attendance.enabled && f.status === 'published';
  const done = enabled && req.user ? (await q('SELECT 1 FROM checkins WHERE form_id=$1 AND lower(email)=lower($2)', [f.id, req.user.email])).rowCount > 0 : false;
  res.json({
    title: f.title, theme: api.theme, enabled, language: api.settings.language, already: done,
    me: req.user ? { name: req.user.name, email: req.user.email, identifier: req.user.identifier } : null,
    allowlist: api.settings.allowlist.enabled, require_login: api.settings.allowlist.enabled && api.settings.allowlist.require_login,
  });
});

router.post('/checkin/:token', limiter(20), async (req, res) => {
  const f = await formByToken(req.params.token);
  if (!f) return res.status(404).json({ error: 'not_found' });
  const settings = schema.cleanSettings(f.settings);
  if (!settings.attendance.enabled || f.status !== 'published') return res.status(403).json({ error: 'not_enabled', message: 'Absensi belum dibuka' });
  const body = req.body || {};
  let name; let email; let identifier;
  if (settings.allowlist.enabled && settings.allowlist.require_login && !req.user) return res.status(401).json({ error: 'login_required' });
  if (req.user) {
    ({ name, email } = req.user); identifier = req.user.identifier || schema.str(body.identifier, 60).trim();
    name = schema.str(body.name, 200).trim() || name;
  } else {
    name = schema.str(body.name, 200).trim(); email = schema.str(body.email, 200).trim().toLowerCase(); identifier = schema.str(body.identifier, 60).trim();
    if (name.length < 2) return res.status(422).json({ error: 'name_required', message: 'Nama wajib diisi' });
    if (!EMAIL_RE.test(email)) return res.status(422).json({ error: 'email_required', message: 'Email tidak valid' });
  }
  if (settings.allowlist.enabled && !(await allowedParticipant(f.id, email, identifier))) {
    return res.status(403).json({ error: 'not_allowed', message: 'Anda tidak terdaftar sebagai peserta' });
  }
  const ins = await q('INSERT INTO checkins (form_id, user_id, name, email, identifier) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id', [f.id, req.user?.id || null, name, email.toLowerCase(), identifier]);
  if (ins.rowCount && settings.attendance.require_for_cert) {
    // peserta yang sudah mengisi sebelum absen: terbitkan sertifikatnya sekarang
    const rs = (await q("SELECT * FROM responses WHERE form_id=$1 AND status<>'in_progress' AND cert_code IS NULL AND lower(email)=lower($2)", [f.id, email])).rows;
    for (const r of rs) await afterSubmit(f, r).catch((e) => console.error(e.message));
  }
  res.json({ ok: true, already: !ins.rowCount, name });
});

/* ---------- sertifikat & verifikasi ---------- */
const CODE_RE = /^UIKA-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{2}$/;

router.get('/certificates/:code/pdf', async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  if (!CODE_RE.test(code)) return res.status(404).json({ error: 'not_found' });
  const r = await q(
    `SELECT c.*, row_to_json(f) AS form, row_to_json(r) AS resp FROM certificates c
       JOIN forms f ON f.id=c.form_id JOIN responses r ON r.id=c.response_id WHERE c.code=$1`, [code],
  );
  if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
  const { form, resp, ...cert } = r.rows[0];
  const { pdf } = await sv.certPdfFor(form, cert, resp);
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="sertifikat-${code}.pdf"`);
  res.send(pdf);
});

router.post('/certificates/:code/email', limiter(6, 10 * 60 * 1000), async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  if (!CODE_RE.test(code)) return res.status(404).json({ error: 'not_found' });
  const r = await q(
    `SELECT c.*, row_to_json(f) AS form, row_to_json(r) AS resp FROM certificates c
       JOIN forms f ON f.id=c.form_id JOIN responses r ON r.id=c.response_id WHERE c.code=$1`, [code],
  );
  if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
  const { form, resp, ...cert } = r.rows[0];
  // hanya ke email yang tercatat pada respons; bila kosong, peserta boleh mengisi sendiri
  let to = cert.email;
  if (!to) {
    to = schema.str(req.body?.email, 200).trim().toLowerCase();
    if (!EMAIL_RE.test(to)) return res.status(422).json({ error: 'invalid_email', message: 'Email tidak valid' });
  }
  try {
    await sv.emailCertificate(form, cert, resp, to);
  } catch (e) {
    const status = e.code === 'smtp_not_configured' ? 503 : 502;
    return res.status(status).json({ error: e.code || 'email_failed', message: e.code === 'smtp_not_configured' ? 'Pengiriman email belum diaktifkan di server' : 'Gagal mengirim email' });
  }
  res.json({ ok: true, sent_to: to.replace(/^(.).*(@.*)$/, '$1***$2') });
});

router.get('/verify/:code', limiter(60), async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  if (!CODE_RE.test(code)) return res.json({ valid: false });
  const r = await q(
    `SELECT c.code, c.name, c.number, c.issued_at, f.title, f.cert FROM certificates c JOIN forms f ON f.id=c.form_id WHERE c.code=$1`, [code],
  );
  if (!r.rowCount) return res.json({ valid: false });
  const x = r.rows[0];
  res.json({ valid: true, code: x.code, number: x.number || null, name: x.name, title: x.title, issued_at: x.issued_at, organizer: schema.cleanCert(x.cert).organizer || config.ORG_NAME });
});

module.exports = router;
