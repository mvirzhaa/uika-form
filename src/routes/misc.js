'use strict';
const express = require('express');
const { q } = require('../db');
const config = require('../config');
const schema = require('../schema');
const auth = require('../auth');
const excel = require('../excel');

const router = express.Router();

router.get('/me', (req, res) => {
  res.json({
    user: req.user,
    login: { oidc: auth.oidcEnabled(), dev: config.DEV_LOGIN },
    org: config.ORG_NAME,
    base_url: config.BASE_URL,
  });
});

/* ---------- template Excel (publik) ---------- */
router.get('/templates/:kind.xlsx', async (req, res) => {
  const kind = req.params.kind === 'quiz' ? 'quiz' : req.params.kind === 'survey' ? 'survey' : null;
  if (!kind) return res.status(404).json({ error: 'not_found' });
  const buf = await excel.buildTemplate(kind);
  res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('content-disposition', `attachment; filename="template-${kind === 'quiz' ? 'kuis' : 'formulir'}-uika-form.xlsx"`);
  res.send(Buffer.from(buf));
});

/* ---------- unggah gambar (latar, logo sponsor, tanda tangan) ---------- */
const isPng = (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

router.post('/uploads', auth.requireUser,
  express.raw({ type: ['image/png', 'image/jpeg'], limit: config.MAX_UPLOAD_BYTES }),
  async (req, res) => {
    const b = req.body;
    if (!Buffer.isBuffer(b) || !b.length) return res.status(415).json({ error: 'unsupported', message: 'Gunakan gambar PNG atau JPG (maks 5 MB)' });
    const mime = isPng(b) ? 'image/png' : isJpg(b) ? 'image/jpeg' : null;
    if (!mime) return res.status(415).json({ error: 'unsupported', message: 'Isi berkas bukan PNG/JPG yang valid' });
    const n = (await q("SELECT count(*)::int n FROM uploads WHERE owner_id=$1 AND created_at > now() - interval '1 day'", [req.user.id])).rows[0].n;
    if (n >= 200) return res.status(429).json({ error: 'quota' });
    const r = await q('INSERT INTO uploads (owner_id, mime, data) VALUES ($1,$2,$3) RETURNING id', [req.user.id, mime, b]);
    res.status(201).json({ id: r.rows[0].id, url: `/uploads/${r.rows[0].id}` });
  });

/* ---------- admin: kelola peran pengguna ---------- */
router.get('/admin/users', auth.requireAdmin, async (req, res) => {
  const s = `%${String(req.query.search || '').toLowerCase()}%`;
  const r = await q(
    `SELECT id, email, name, identifier, role, created_at, last_login,
            (SELECT count(*)::int FROM forms f WHERE f.owner_id=users.id) AS forms
       FROM users WHERE lower(email) LIKE $1 OR lower(name) LIKE $1 ORDER BY last_login DESC NULLS LAST LIMIT 200`, [s],
  );
  res.json(r.rows);
});

router.patch('/admin/users/:id', auth.requireAdmin, async (req, res) => {
  if (!schema.UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const role = req.body?.role;
  if (!['admin', 'creator', 'user'].includes(role)) return res.status(422).json({ error: 'invalid_role' });
  if (req.params.id === req.user.id && role !== 'admin') {
    const admins = (await q("SELECT count(*)::int n FROM users WHERE role='admin'")).rows[0].n;
    if (admins <= 1) return res.status(422).json({ error: 'last_admin', message: 'Tidak bisa menurunkan admin terakhir' });
  }
  const r = await q('UPDATE users SET role=$2 WHERE id=$1 RETURNING id, email, name, role', [req.params.id, role]);
  if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
  res.json(r.rows[0]);
});

module.exports = router;
