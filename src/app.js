'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const config = require('./config');
const auth = require('./auth');
const { q } = require('./db');
const schema = require('./schema');

function createApp() {
  const app = express();
  app.set('trust proxy', config.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'frame-src': ["'self'"],
        'object-src': ["'self'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.COOKIE_SECURE,
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));

  // Tolak permintaan lintas-situs yang mengubah data (pertahanan tambahan selain SameSite=Lax)
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin) {
      try {
        const o = new URL(origin).host;
        const allowed = [new URL(config.BASE_URL).host, req.headers.host, req.headers['x-forwarded-host']].filter(Boolean);
        if (!allowed.includes(o)) return res.status(403).json({ error: 'bad_origin' });
      } catch { return res.status(403).json({ error: 'bad_origin' }); }
    }
    return next();
  });

  app.use(auth.loadUser);

  /* ---------- integrasi SSO E-Portal UIKA (?token=...) ---------- */
  app.use(async (req, res, next) => {
    const token = req.query.token;
    if (token && typeof token === 'string' && config.SSO && config.SSO.enabled) {
      try {
        const data = await auth.introspectToken(token, req.query.appModule_id);
        if (!data || !data.valid) throw new Error(data?.message || 'Token SSO tidak valid.');
        const isAuthorized = data.access?.has_access ?? true;
        if (!isAuthorized) throw new Error('Akun Anda tidak memiliki izin untuk mengakses modul UIKA Form.');

        const u = data.user || {};
        const email = u.email || `${u.user_id || u.sso_id}@uika-bogor.ac.id`;
        const name = u.name || email.split('@')[0];
        const identifier = u.nidn || u.npm || u.nip || '';

        // Tentukan role pengguna berdasarkan permissions & role institusional E-Portal
        const perms = data.access?.permissions || [];
        const instRole = String(u.institutional_role || data.access?.role_name || '').toLowerCase();
        let assignedRole = config.DEFAULT_ROLE;

        if (config.ADMIN_EMAILS.includes(email.toLowerCase()) || perms.includes('u-form.manage') || instRole === 'admin' || instRole === 'super-admin') {
          assignedRole = 'admin';
        } else if (perms.includes('u-form.create') || perms.includes('*')) {
          assignedRole = 'creator';
        } else {
          assignedRole = 'user';
        }

        const user = await auth.upsertUser({
          sub: String(u.user_id || u.sso_id || ''),
          email,
          name,
          identifier,
          role: assignedRole,
        });

        auth.setSession(res, await auth.signSession(user.id));

        // Bersihkan token dari URL di address bar
        const cleanUrl = req.path || '/';
        return res.redirect(cleanUrl);
      } catch (err) {
        console.error('[sso] Login SSO gagal:', err.message);
        return res.status(401).send(`<!doctype html><meta charset="utf-8"><title>Autentikasi E-Portal Gagal</title>
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:80px auto;padding:32px;border:1px solid #e2e8f0;border-radius:16px;text-align:center;box-shadow:0 10px 25px rgba(0,0,0,0.05)">
  <h2 style="color:#e11d48;margin-top:0">Login SSO Gagal</h2>
  <p style="color:#475569;line-height:1.6">${err.message}</p>
  <a href="${config.SSO.eportalUrl}" style="display:inline-block;margin-top:16px;padding:10px 24px;background:#0071e3;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Buka E-Portal UIKA</a>
</div>`);
      }
    }
    next();
  });

  /* ---------- autentikasi ---------- */
  const authLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
  app.get('/auth/login', authLimiter, async (req, res) => {
    if (auth.ssoEnabled()) {
      return res.redirect(config.SSO.eportalUrl);
    }
    if (auth.oidcEnabled()) {
      try { return await auth.startOidc(req, res); } catch (e) { return res.status(502).send(`Login E-Portal gagal dimulai: ${e.message}`); }
    }
    if (config.DEV_LOGIN) return res.redirect(`/auth/dev?next=${encodeURIComponent(auth.safeNext(req.query.next))}`);
    return res.status(503).send('Login belum dikonfigurasi (isi SSO_CLIENT_ID atau OIDC_CLIENT_ID).');
  });
  app.get('/auth/callback', authLimiter, async (req, res) => {
    try { await auth.finishOidc(req, res); } catch (e) {
      console.error('callback oidc gagal:', e.message);
      res.status(401).send('Login gagal. Silakan <a href="/auth/login">coba lagi</a>.');
    }
  });
  if (config.DEV_LOGIN) {
    app.get('/auth/dev', (req, res) => {
      const next = auth.safeNext(req.query.next);
      res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login uji coba</title>
<style>body{font:16px -apple-system,Segoe UI,Roboto,sans-serif;background:#f2f2f7;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#fff;padding:28px;border-radius:20px;width:min(360px,90vw);box-shadow:0 10px 40px #0002;display:grid;gap:12px}
input{padding:12px 14px;border:1px solid #d2d2d7;border-radius:12px;font:inherit}button{padding:12px;border:0;border-radius:12px;background:#0071e3;color:#fff;font:600 16px inherit;cursor:pointer}
small{color:#b45309}</style>
<form method="post" action="/auth/dev"><h2 style="margin:0">Login uji coba</h2><small>DEV_LOGIN aktif — nonaktifkan di produksi</small>
<input name="email" type="email" placeholder="email@uika-bogor.ac.id" required><input name="name" placeholder="Nama"><input name="identifier" placeholder="NIM/NIP (opsional)">
<input type="hidden" name="next" value="${next.replace(/"/g, '&quot;')}"><button>Masuk</button></form>`);
    });
    app.post('/auth/dev', authLimiter, async (req, res) => {
      const email = String(req.body?.email || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(422).json({ error: 'invalid_email' });
      const user = await auth.upsertUser({ email, name: req.body.name || email.split('@')[0], identifier: req.body.identifier || '' });
      auth.setSession(res, await auth.signSession(user.id));
      if (req.is('application/json')) return res.json({ user });
      return res.redirect(auth.safeNext(req.body.next));
    });
  }
  app.all('/auth/logout', (req, res) => {
    res.clearCookie(auth.COOKIE, { path: '/' });
    const target = config.SSO.eportalUrl || 'https://eportal.uika-bogor.ac.id';
    return res.redirect(target);
  });

  /* ---------- API ---------- */
  app.use('/api/public', require('./routes/public'));
  app.use('/api/forms', require('./routes/forms'));
  app.use('/api/lists', require('./routes/lists'));
  app.use('/api/banks', require('./routes/banks'));
  app.use('/api', require('./routes/misc'));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

  // Gambar unggahan (latar, logo, tanda tangan) — publik karena tampil di formulir/sertifikat
  app.get('/uploads/:id', async (req, res) => {
    if (!schema.UUID_RE.test(req.params.id)) return res.status(404).end();
    const r = await q('SELECT mime, data FROM uploads WHERE id=$1', [req.params.id]);
    if (!r.rowCount) return res.status(404).end();
    res.setHeader('content-type', r.rows[0].mime);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    return res.send(r.rows[0].data);
  });

  // Tautan pendek: /s/<alias atau kode> → halaman pengisian
  app.get('/s/:code', async (req, res) => {
    const code = String(req.params.code || '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(code)) return res.redirect(302, '/');
    const r = await q('SELECT slug FROM forms WHERE slug=$1 OR lower(alias)=$1 ORDER BY (slug=$1) DESC LIMIT 1', [code]);
    if (!r.rowCount) return res.redirect(302, '/');
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(302, `/f/${r.rows[0].slug}${qs}`);
  });

  // Halaman pengisian boleh disematkan (iframe) hanya bila pembuat mengizinkannya
  const CSP = (ancestors) => ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'", "frame-src 'self'", "object-src 'self'", "base-uri 'self'", "form-action 'self'", `frame-ancestors ${ancestors}`].join('; ');
  app.get('/f/:slug', async (req, res, next) => {
    try {
      const slug = String(req.params.slug || '').toLowerCase();
      if (/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) {
        const r = await q('SELECT settings FROM forms WHERE slug=$1 OR lower(alias)=$1 LIMIT 1', [slug]);
        if (r.rowCount && schema.cleanSettings(r.rows[0].settings).allow_embed) {
          res.setHeader('Content-Security-Policy', CSP('*'));
          res.removeHeader('X-Frame-Options');
        }
      }
    } catch { /* abaikan: pakai header bawaan */ }
    return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'), (e) => { if (e) next(e); });
  });

  /* ---------- berkas statis + SPA ---------- */
  app.use('/vendor/chart.js', express.static(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js'), { maxAge: '7d' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    maxAge: 0,
    etag: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));
  app.get(/^\/(?!api\/|auth\/|uploads\/|vendor\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    console.error(`[${req.method} ${req.path}]`, err);
    return res.status(500).json({ error: 'server_error' });
  });
  return app;
}

module.exports = { createApp };
