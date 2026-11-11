'use strict';
/* Admin: lihat, cari (termasuk kata kunci pertanyaan), ekspor, dan hapus SEMUA formulir dari semua pembuat. */
const express = require('express');
const { q } = require('../db');
const auth = require('../auth');
const schema = require('../schema');
const sv = require('../services');
const excel = require('../excel');

const router = express.Router();
router.use(auth.requireAdmin);

const PER_PAGE = 25;
const likePattern = (s) => `%${String(s).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Kondisi "pertanyaan cocok" untuk alias qq (judul, deskripsi, teks opsi, baris/kolom kisi). */
const Q_MATCH = `(qq.title ILIKE $1 OR qq.description ILIKE $1
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(qq.options)='array' THEN qq.options ELSE '[]'::jsonb END) o WHERE o->>'text' ILIKE $1)
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(qq.config->'rows','[]'::jsonb) || COALESCE(qq.config->'cols','[]'::jsonb)) g WHERE g->>'text' ILIKE $1))`;

router.get('/', async (req, res) => {
  const text = schema.str(String(req.query.q || ''), 200).trim();
  const scope = ['all', 'question', 'title', 'owner'].includes(req.query.scope) ? req.query.scope : 'all';
  const status = ['draft', 'published', 'closed'].includes(req.query.status) ? req.query.status : null;
  const kind = ['quiz', 'form'].includes(req.query.kind) ? req.query.kind : null;
  const sort = { updated: 'f.updated_at DESC', created: 'f.created_at DESC', title: 'lower(f.title) ASC', responses: 'rn DESC, f.updated_at DESC' }[req.query.sort] || 'f.updated_at DESC';
  const page = Math.max(1, Math.min(1000, Number(req.query.page) || 1));

  const params = text ? [likePattern(text)] : [];
  const where = [];
  if (text) {
    const qm = `EXISTS (SELECT 1 FROM questions qq WHERE qq.form_id=f.id AND ${Q_MATCH})`;
    const tm = '(f.title ILIKE $1 OR f.description ILIKE $1 OR f.slug ILIKE $1)';
    const om = '(u.name ILIKE $1 OR u.email ILIKE $1)';
    where.push(scope === 'question' ? qm : scope === 'title' ? tm : scope === 'owner' ? om : `(${tm} OR ${om} OR ${qm})`);
  }
  if (status) { params.push(status); where.push(`f.status=$${params.length}`); }
  if (kind) where.push(kind === 'quiz' ? "(f.settings->>'is_quiz')='true'" : "COALESCE(f.settings->>'is_quiz','false')<>'true'");
  const W = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(PER_PAGE, (page - 1) * PER_PAGE);

  const rows = (await q(
    `SELECT f.id, f.slug, f.title, f.description, f.status, f.created_at, f.updated_at,
            (f.settings->>'is_quiz')='true' AS is_quiz, (f.cert->>'enabled')='true' AS cert,
            u.name AS owner_name, u.email AS owner_email,
            (SELECT count(*)::int FROM questions qq WHERE qq.form_id=f.id AND qq.type<>'section') AS qn,
            (SELECT count(*)::int FROM responses r WHERE r.form_id=f.id AND r.status<>'in_progress') AS rn,
            ${text ? `(SELECT count(*)::int FROM questions qq WHERE qq.form_id=f.id AND ${Q_MATCH})` : '0'} AS match_count,
            ${text ? `(SELECT COALESCE(json_agg(m ORDER BY m.position), '[]') FROM (SELECT qq.position, qq.type, qq.title FROM questions qq WHERE qq.form_id=f.id AND ${Q_MATCH} ORDER BY qq.position LIMIT 3) m)` : "'[]'::json"} AS matches,
            count(*) OVER()::int AS total
       FROM forms f JOIN users u ON u.id=f.owner_id
       ${W}
      ORDER BY ${sort}
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params,
  )).rows;
  const totals = (await q(`SELECT count(*)::int AS forms, (SELECT count(*)::int FROM responses WHERE status<>'in_progress') AS responses,
      (SELECT count(DISTINCT owner_id)::int FROM forms) AS creators FROM forms`)).rows[0];
  res.json({
    total: rows[0]?.total || 0, page, per_page: PER_PAGE, totals,
    rows: rows.map(({ total, ...r }) => ({ ...r, description: r.description.slice(0, 200) })),
  });
});

async function loadForm(req, res, next) {
  if (!schema.UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const r = await q('SELECT f.*, u.name AS owner_name, u.email AS owner_email FROM forms f JOIN users u ON u.id=f.owner_id WHERE f.id=$1', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
  req.form = r.rows[0];
  return next();
}

router.get('/:id', loadForm, async (req, res) => {
  const f = req.form;
  const [questions, editors, counts] = await Promise.all([
    sv.loadQuestions(f.id),
    q('SELECT email, created_at FROM form_editors WHERE form_id=$1 ORDER BY created_at', [f.id]),
    q(`SELECT (SELECT count(*)::int FROM responses WHERE form_id=$1 AND status<>'in_progress') AS responses,
              (SELECT count(*)::int FROM responses WHERE form_id=$1 AND status='in_progress') AS in_progress,
              (SELECT count(*)::int FROM certificates WHERE form_id=$1) AS certificates,
              (SELECT count(*)::int FROM checkins WHERE form_id=$1) AS checkins,
              (SELECT count(*)::int FROM allowed_participants WHERE form_id=$1) AS allowed,
              (SELECT max(submitted_at) FROM responses WHERE form_id=$1) AS last_response`, [f.id]),
  ]);
  const settings = schema.cleanSettings(f.settings);
  const cert = schema.cleanCert(f.cert, settings);
  res.json({
    id: f.id, slug: f.slug, alias: f.alias || null, title: f.title, description: f.description, status: f.status,
    created_at: f.created_at, updated_at: f.updated_at, owner: { name: f.owner_name, email: f.owner_email },
    editors: editors.rows, counts: counts.rows[0], settings, theme: schema.cleanTheme(f.theme),
    cert: { enabled: cert.enabled, template: cert.template, min_percent: cert.min_percent, number_format: cert.number_format },
    questions,
  });
});

router.get('/:id/export.xlsx', loadForm, async (req, res) => {
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

router.delete('/:id', loadForm, async (req, res) => {
  await q('DELETE FROM forms WHERE id=$1', [req.form.id]);
  console.log(`[admin] ${req.user.email} menghapus formulir ${req.form.id} "${req.form.title}" milik ${req.form.owner_email}`);
  res.json({ ok: true, title: req.form.title });
});

/** Hapus banyak sekaligus (maks. 100). */
router.post('/delete', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.filter((x) => typeof x === 'string' && schema.UUID_RE.test(x)))] : [];
  if (!ids.length) return res.status(422).json({ error: 'no_ids', message: 'Pilih formulir yang akan dihapus' });
  if (ids.length > 100) return res.status(422).json({ error: 'too_many', message: 'Maksimal 100 formulir sekali hapus' });
  const r = await q('DELETE FROM forms WHERE id = ANY($1::uuid[]) RETURNING id, title', [ids]);
  console.log(`[admin] ${req.user.email} menghapus ${r.rowCount} formulir: ${r.rows.map((x) => x.id).join(', ')}`);
  res.json({ ok: true, deleted: r.rowCount });
});

module.exports = router;
