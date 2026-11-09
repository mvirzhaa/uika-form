'use strict';
/* Daftar pilihan (dropdown) yang dipakai ulang: global (admin) dan pribadi (pembuat form). */
const crypto = require('crypto');
const express = require('express');
const { q } = require('../db');
const schema = require('../schema');
const { requireUser, requireCreator } = require('../auth');

const router = express.Router();
router.use(requireUser);

const MAX_ITEMS = 2000;

/** Ubah daftar teks menjadi item {id,text}; id lama dipertahankan bila teksnya sama. */
function buildItems(lines, previous = []) {
  const byText = new Map(previous.map((i) => [i.text, i.id]));
  const seen = new Set();
  const items = [];
  const src = Array.isArray(lines) ? lines : String(lines || '').split(/\r?\n/);
  for (const raw of src) {
    const text = schema.str(typeof raw === 'string' ? raw : raw?.text, 300).replace(/\s+/g, ' ').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    items.push({ id: byText.get(text) || `l${crypto.randomBytes(5).toString('hex')}`, text });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

const canRead = (u, l) => l.owner_id === null || l.owner_id === u.id;
const canEdit = (u, l) => (l.owner_id === null ? u.role === 'admin' : l.owner_id === u.id);
const cleanName = (v) => schema.str(v, 120).trim();

async function find(req, res) {
  if (!schema.UUID_RE.test(req.params.id)) { res.status(404).json({ error: 'not_found' }); return null; }
  const r = await q('SELECT * FROM option_lists WHERE id=$1', [req.params.id]);
  const l = r.rows[0];
  if (!l || !canRead(req.user, l)) { res.status(404).json({ error: 'not_found' }); return null; }
  return l;
}

const meta = (u, l) => ({ id: l.id, name: l.name, is_global: l.owner_id === null, count: l.items.length, updated_at: l.updated_at, can_edit: canEdit(u, l) });

router.get('/', async (req, res) => {
  const r = await q('SELECT * FROM option_lists WHERE owner_id IS NULL OR owner_id=$1 ORDER BY (owner_id IS NULL) DESC, lower(name)', [req.user.id]);
  res.json(r.rows.map((l) => meta(req.user, l)));
});

router.get('/:id', async (req, res) => {
  const l = await find(req, res); if (!l) return;
  res.json({ ...meta(req.user, l), items: l.items });
});

router.post('/', requireCreator, async (req, res) => {
  const body = req.body || {};
  const name = cleanName(body.name);
  if (!name) return res.status(422).json({ error: 'name_required', message: 'Nama daftar wajib diisi' });
  const global = body.global === true;
  if (global && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden', message: 'Hanya admin yang dapat membuat daftar global' });
  if (!global) {
    const n = (await q('SELECT count(*)::int n FROM option_lists WHERE owner_id=$1', [req.user.id])).rows[0].n;
    if (n >= 100) return res.status(422).json({ error: 'quota', message: 'Maksimum 100 daftar pribadi' });
  }
  const items = buildItems(body.items);
  const r = await q('INSERT INTO option_lists (owner_id, name, items) VALUES ($1,$2,$3) RETURNING *', [global ? null : req.user.id, name, JSON.stringify(items)]);
  res.status(201).json({ ...meta(req.user, r.rows[0]), items });
});

router.put('/:id', async (req, res) => {
  const l = await find(req, res); if (!l) return;
  if (!canEdit(req.user, l)) return res.status(403).json({ error: 'forbidden', message: 'Anda tidak dapat mengubah daftar ini' });
  const body = req.body || {};
  const name = body.name === undefined ? l.name : cleanName(body.name);
  if (!name) return res.status(422).json({ error: 'name_required', message: 'Nama daftar wajib diisi' });
  const items = body.items === undefined ? l.items : buildItems(body.items, l.items);
  const r = await q('UPDATE option_lists SET name=$2, items=$3, updated_at=now() WHERE id=$1 RETURNING *', [l.id, name, JSON.stringify(items)]);
  res.json({ ...meta(req.user, r.rows[0]), items });
});

router.delete('/:id', async (req, res) => {
  const l = await find(req, res); if (!l) return;
  if (!canEdit(req.user, l)) return res.status(403).json({ error: 'forbidden', message: 'Anda tidak dapat menghapus daftar ini' });
  await q('DELETE FROM option_lists WHERE id=$1', [l.id]);
  res.status(204).end();
});

module.exports = router;
