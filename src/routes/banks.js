'use strict';
/* Bank soal: kumpulan pertanyaan yang dipakai ulang (pribadi atau global oleh admin). */
const express = require('express');
const { q } = require('../db');
const schema = require('../schema');
const { requireUser, requireCreator } = require('../auth');

const router = express.Router();
router.use(requireUser, requireCreator);

const MAX_Q = 1000;
const canEdit = (u, b) => (b.owner_id === null ? u.role === 'admin' : b.owner_id === u.id);
const canRead = (u, b) => b.owner_id === null || b.owner_id === u.id;
const meta = (u, b) => ({ id: b.id, name: b.name, is_global: b.owner_id === null, count: b.questions.length, updated_at: b.updated_at, can_edit: canEdit(u, b) });

/** Bersihkan pertanyaan untuk disimpan di bank (tanpa id & percabangan agar bisa dipakai di form mana pun). */
function cleanBankQuestions(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_Q).map((x, i) => {
    const c = schema.cleanQuestion({ ...x, id: schema.newId() }, i);
    delete c.config.show_if; delete c.config.list_id;
    return { type: c.type, title: c.title, description: c.description, required: c.required, options: c.options, correct: c.correct, points: c.points, config: c.config };
  }).filter((x) => x.type !== 'section' && x.title.trim());
}

async function find(req, res) {
  if (!schema.UUID_RE.test(req.params.id)) { res.status(404).json({ error: 'not_found' }); return null; }
  const b = (await q('SELECT * FROM question_banks WHERE id=$1', [req.params.id])).rows[0];
  if (!b || !canRead(req.user, b)) { res.status(404).json({ error: 'not_found' }); return null; }
  return b;
}

router.get('/', async (req, res) => {
  const r = await q('SELECT * FROM question_banks WHERE owner_id IS NULL OR owner_id=$1 ORDER BY (owner_id IS NULL) DESC, lower(name)', [req.user.id]);
  res.json(r.rows.map((b) => meta(req.user, b)));
});

router.get('/:id', async (req, res) => {
  const b = await find(req, res); if (!b) return;
  res.json({ ...meta(req.user, b), questions: b.questions });
});

router.post('/', async (req, res) => {
  const name = schema.str(req.body?.name, 120).trim();
  if (!name) return res.status(422).json({ error: 'name_required', message: 'Nama bank soal wajib diisi' });
  const global = req.body?.global === true;
  if (global && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden', message: 'Hanya admin yang dapat membuat bank global' });
  if (!global && (await q('SELECT count(*)::int n FROM question_banks WHERE owner_id=$1', [req.user.id])).rows[0].n >= 100) return res.status(422).json({ error: 'quota', message: 'Maksimum 100 bank soal pribadi' });
  const qs = cleanBankQuestions(req.body?.questions);
  const r = await q('INSERT INTO question_banks (owner_id, name, questions) VALUES ($1,$2,$3) RETURNING *', [global ? null : req.user.id, name, JSON.stringify(qs)]);
  res.status(201).json({ ...meta(req.user, r.rows[0]), questions: qs });
});

router.put('/:id', async (req, res) => {
  const b = await find(req, res); if (!b) return;
  if (!canEdit(req.user, b)) return res.status(403).json({ error: 'forbidden' });
  const name = req.body?.name === undefined ? b.name : schema.str(req.body.name, 120).trim();
  if (!name) return res.status(422).json({ error: 'name_required', message: 'Nama bank soal wajib diisi' });
  let qs = b.questions;
  if (Array.isArray(req.body?.questions)) qs = req.body.append === true ? [...b.questions, ...cleanBankQuestions(req.body.questions)].slice(0, MAX_Q) : cleanBankQuestions(req.body.questions);
  const r = await q('UPDATE question_banks SET name=$2, questions=$3, updated_at=now() WHERE id=$1 RETURNING *', [b.id, name, JSON.stringify(qs)]);
  res.json({ ...meta(req.user, r.rows[0]), questions: qs });
});

router.delete('/:id', async (req, res) => {
  const b = await find(req, res); if (!b) return;
  if (!canEdit(req.user, b)) return res.status(403).json({ error: 'forbidden' });
  await q('DELETE FROM question_banks WHERE id=$1', [b.id]);
  res.status(204).end();
});

module.exports = router;
