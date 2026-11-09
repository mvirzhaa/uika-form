'use strict';
/* Fungsi bersama untuk rute editor dan rute pengisian. */
const { q } = require('./db');
const schema = require('./schema');
const { renderCertificate } = require('./certificate');
const mailer = require('./mailer');
const config = require('./config');
const { answerText, correctAnswerText } = require('./grading');
const logic = require('./logic');

const round1 = (n) => Math.round(n * 10) / 10;

async function loadQuestions(formId, client) {
  const r = await (client || { query: q }).query(
    'SELECT id, position, type, title, description, required, options, correct, points::float AS points, config FROM questions WHERE form_id=$1 ORDER BY position',
    [formId],
  );
  await applyLists(r.rows, client);
  return r.rows;
}

/** Dropdown yang terhubung ke daftar pilihan memakai isi daftar terbaru (bila daftar masih ada). */
async function applyLists(rows, client) {
  const ids = [...new Set(rows.filter((x) => x.type === 'dropdown' && x.config?.list_id).map((x) => x.config.list_id))];
  if (!ids.length) return;
  const lr = await (client || { query: q }).query('SELECT id, items FROM option_lists WHERE id = ANY($1::uuid[])', [ids]);
  const map = new Map(lr.rows.map((l) => [l.id, l.items]));
  for (const x of rows) {
    const items = x.type === 'dropdown' && x.config?.list_id ? map.get(x.config.list_id) : null;
    if (!items) continue;
    x.options = items;
    x.correct = x.correct.filter((c) => items.some((o) => o.id === c));
  }
}

function formApi(row, extra = {}) {
  const settings = schema.cleanSettings(row.settings);
  return {
    id: row.id, slug: row.slug, alias: row.alias || null, checkin_token: row.checkin_token, title: row.title, description: row.description, status: row.status,
    theme: schema.cleanTheme(row.theme), settings, cert: schema.cleanCert(row.cert, settings),
    created_at: row.created_at, updated_at: row.updated_at, ...extra,
  };
}

/** Simpan pertanyaan secara menyeluruh (hapus yang tidak ada, upsert sisanya). */
async function saveQuestions(client, formId, questions, userId) {
  const cleaned = questions.map((x, i) => schema.cleanQuestion(x, i));
  // daftar pilihan: hanya global / milik pemilik form / milik pengguna yang menyimpan
  const ownerId = (await client.query('SELECT owner_id FROM forms WHERE id=$1', [formId])).rows[0]?.owner_id;
  const allowed = [ownerId, userId].filter(Boolean);
  const linked = cleaned.filter((x) => x.config.list_id);
  if (linked.length) {
    const lr = await client.query('SELECT id, items FROM option_lists WHERE id = ANY($1::uuid[]) AND (owner_id IS NULL OR owner_id = ANY($2::uuid[]))', [linked.map((x) => x.config.list_id), allowed]);
    const map = new Map(lr.rows.map((l) => [l.id, l.items]));
    for (const x of linked) {
      const items = map.get(x.config.list_id);
      if (!items) { delete x.config.list_id; continue; } // daftar sudah dihapus / tidak boleh dipakai: pertahankan salinan opsi
      x.options = items;
      x.correct = x.correct.filter((c) => items.some((o) => o.id === c));
    }
  }
  // percabangan hanya boleh merujuk pertanyaan non-judul yang ada SEBELUMNYA
  const earlier = new Set();
  for (const x of cleaned) {
    const rule = x.config.show_if;
    if (rule) {
      rule.conds = rule.conds.filter((c) => earlier.has(c.qid));
      if (!rule.conds.length) delete x.config.show_if;
    }
    if (x.type !== 'section') earlier.add(x.id);
  }
  const keep = cleaned.map((x) => x.id);
  await client.query('DELETE FROM questions WHERE form_id=$1 AND NOT (id = ANY($2::uuid[]))', [formId, keep]);
  for (const x of cleaned) {
    const vals = [x.id, formId, x.position, x.type, x.title, x.description, x.required,
      JSON.stringify(x.options), JSON.stringify(x.correct), x.points, JSON.stringify(x.config)];
    const up = await client.query(
      `INSERT INTO questions (id, form_id, position, type, title, description, required, options, correct, points, config)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET position=EXCLUDED.position, type=EXCLUDED.type, title=EXCLUDED.title,
         description=EXCLUDED.description, required=EXCLUDED.required, options=EXCLUDED.options,
         correct=EXCLUDED.correct, points=EXCLUDED.points, config=EXCLUDED.config
       WHERE questions.form_id = EXCLUDED.form_id`,
      vals,
    );
    if (!up.rowCount) { // id milik formulir lain: pakai id baru
      x.id = schema.newId();
      vals[0] = x.id;
      await client.query(
        `INSERT INTO questions (id, form_id, position, type, title, description, required, options, correct, points, config)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, vals,
      );
    }
  }
  return cleaned;
}

/** Bersihkan jawaban peserta: sesuai tipe, berkas valid, lalu terapkan percabangan. */
async function prepareAnswers(qs, raw, respId) {
  const cleaned = schema.cleanAnswers(qs, raw);
  const fileQs = qs.filter((x) => x.type === 'file' && cleaned[x.id] !== undefined);
  if (fileQs.length && respId) {
    const r = await q('SELECT id, question_id FROM response_files WHERE response_id=$1', [respId]);
    const ok = new Set(r.rows.map((f) => `${f.id}|${f.question_id}`));
    for (const x of fileQs) if (!ok.has(`${cleaned[x.id]}|${x.id}`)) delete cleaned[x.id];
  } else for (const x of fileQs) delete cleaned[x.id];
  return logic.applyLogic(qs, cleaned); // {visible, answers}
}

async function fileNames(respIds) {
  if (!respIds.length) return {};
  const r = await q('SELECT id, filename FROM response_files WHERE response_id = ANY($1::uuid[])', [respIds]);
  return Object.fromEntries(r.rows.map((f) => [f.id, f.filename]));
}

/** Apakah peserta sudah absen? (cocokkan akun atau email) */
async function hasCheckin(formId, resp) {
  if (!resp.email && !resp.user_id) return false;
  const r = await q('SELECT 1 FROM checkins WHERE form_id=$1 AND (lower(email)=lower($2) OR ($3::uuid IS NOT NULL AND user_id=$3::uuid)) LIMIT 1', [formId, resp.email || '', resp.user_id || null]);
  return r.rowCount > 0;
}

/** Hilangkan kunci jawaban sebelum dikirim ke peserta. */
function publicQuestions(questions) {
  return questions.map((x) => ({
    id: x.id, type: x.type, title: x.title, description: x.description, required: x.required,
    options: x.options, config: x.config, points: x.points,
  }));
}

function openState(form, now = new Date()) {
  const s = schema.cleanSettings(form.settings);
  if (form.status === 'draft') return 'draft';
  if (form.status === 'closed') return 'closed';
  if (s.open_at && now < new Date(s.open_at)) return 'not_open';
  if (s.close_at && now > new Date(s.close_at)) return 'closed';
  return 'open';
}

function buildResult(form, questions, r, ctx = {}) {
  const settings = schema.cleanSettings(form.settings);
  const cert = schema.cleanCert(form.cert, settings);
  const quiz = settings.is_quiz;
  const max = Number(r.max_score);
  const score = Number(r.score);
  const res = {
    id: r.id, status: r.status, submitted_at: r.submitted_at, quiz,
    message: settings.confirmation_message, name: r.name,
  };
  if (quiz) {
    res.graded = r.graded;
    if (settings.show_score === 'immediately') {
      res.score = score; res.max_score = max; res.percent = max > 0 ? round1((score / max) * 100) : null;
    }
    if (settings.show_answers) {
      const details = r.details || {};
      res.review = questions.filter((x) => x.type !== 'section').map((x) => {
        const d = details[x.id] || {};
        return {
          id: x.id, title: x.title, type: x.type, answer: answerText(x, r.answers[x.id], { files: ctx.files }),
          correct_text: d.gradable && d.correct !== null ? correctAnswerText(x) : null,
          correct: d.correct ?? null, points: d.points ?? 0, max: x.points,
        };
      });
    }
  }
  if (cert.enabled) {
    res.certificate = {
      code: r.cert_code || null,
      pending: !r.cert_code && quiz && !r.graded,
      needs_attendance: !r.cert_code && cert.enabled && settings.attendance.enabled && settings.attendance.require_for_cert && ctx.attended === false,
      number: ctx.cert_number || null,
      min_percent: quiz ? cert.min_percent : null,
      has_email: !!r.email,
    };
  }
  return res;
}

async function certPdfFor(form, certRow, resp) {
  const settings = schema.cleanSettings(form.settings);
  const cert = schema.cleanCert(form.cert, settings);
  let score = null;
  if (settings.is_quiz && resp) score = Number(resp.score);
  return renderCertificate({
    cert, formTitle: form.title, name: certRow.name, date: certRow.issued_at, score, code: certRow.code, number: certRow.number || '',
  });
}

/** Kirim sertifikat lewat email dan catat waktu kirim. */
async function emailCertificate(form, certRow, resp, toEmail) {
  const to = toEmail || certRow.email;
  if (!to) { const e = new Error('email penerima kosong'); e.code = 'no_email'; throw e; }
  const { pdf, verifyUrl } = await certPdfFor(form, certRow, resp);
  await mailer.sendCertificate({ to, name: certRow.name, formTitle: form.title, code: certRow.code, verifyUrl, pdf });
  await q('UPDATE certificates SET emailed_at=now() WHERE code=$1', [certRow.code]);
}

/* ---------- notifikasi email (pemilik & peserta) ---------- */
const ownerBuf = new Map(); // formId -> {count, timer, last}
async function notifySubmission(form, resp) {
  const settings = schema.cleanSettings(form.settings);
  if (!mailer.configured()) return;
  const lang = settings.language;
  if (settings.confirm_email && resp.email) {
    const cert = schema.cleanCert(form.cert, settings);
    const score = settings.is_quiz && settings.show_score === 'immediately' && resp.graded && Number(resp.max_score) > 0
      ? { score: Number(resp.score), max: Number(resp.max_score), percent: round1((Number(resp.score) / Number(resp.max_score)) * 100) } : null;
    mailer.sendConfirmation({ to: resp.email, name: resp.name || resp.email, title: form.title, score, lang, certNote: cert.enabled && cert.auto_email && !!resp.cert_code })
      .catch((e) => console.error('email konfirmasi gagal:', e.message));
  }
  if (settings.notify_owner) {
    const st = ownerBuf.get(form.id) || { count: 0, timer: null, last: 0, who: '', extra: '' };
    st.count += 1; st.who = `${resp.name || '-'} <${resp.email || '-'}>`;
    st.extra = settings.is_quiz && resp.graded ? `Nilai: ${Number(resp.score)} / ${Number(resp.max_score)}` : '';
    ownerBuf.set(form.id, st);
    const flush = async () => {
      const cur = ownerBuf.get(form.id); ownerBuf.delete(form.id);
      if (!cur) return;
      try {
        const o = (await q('SELECT email FROM users WHERE id=$1', [form.owner_id])).rows[0];
        if (o?.email) await mailer.sendOwnerNotice({ to: o.email, title: form.title, count: cur.count, who: cur.count > 1 ? `Terakhir: ${cur.who}` : cur.who, extra: cur.count > 1 ? '' : cur.extra, url: `${config.BASE_URL}/forms/${form.id}/edit`, lang });
      } catch (e) { console.error('email pemilik gagal:', e.message); }
    };
    // gabungkan respons yang datang berdekatan: kirim paling cepat setiap 5 menit per form
    if (!st.timer) { const wait = Math.max(0, st.last + 5 * 60 * 1000 - Date.now()); st.last = Date.now() + wait; st.timer = setTimeout(flush, wait || 50); if (st.timer.unref) st.timer.unref(); }
  }
}

module.exports = {
  notifySubmission,
  loadQuestions, formApi, saveQuestions, prepareAnswers, fileNames, hasCheckin, publicQuestions, openState, buildResult, certPdfFor, emailCertificate, round1, config,
};
