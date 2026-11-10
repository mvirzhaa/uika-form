'use strict';
const crypto = require('crypto');
const { SignJWT, jwtVerify, createRemoteJWKSet } = require('jose');
const config = require('./config');
const { q } = require('./db');

const secretKey = new TextEncoder().encode(config.SESSION_SECRET);
const COOKIE = 'uf_session';
const FLOW_COOKIE = 'uf_oidc';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sha256b64url = (s) => crypto.createHash('sha256').update(s).digest('base64url');

function safeNext(n) {
  if (typeof n !== 'string' || !n.startsWith('/') || n.startsWith('//') || n.includes('\\')) return '/';
  return n;
}

async function signSession(uid) {
  return new SignJWT({ uid }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d').sign(secretKey);
}

function setSession(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: config.COOKIE_SECURE, maxAge: 7 * 24 * 3600 * 1000, path: '/',
  });
}

/** Middleware: isi req.user bila ada sesi valid (tidak menolak). */
async function loadUser(req, _res, next) {
  req.user = null;
  const t = req.cookies && req.cookies[COOKIE];
  if (t) {
    try {
      const { payload } = await jwtVerify(t, secretKey, { algorithms: ['HS256'] });
      const r = await q('SELECT id, email, name, identifier, role FROM users WHERE id=$1', [payload.uid]);
      if (r.rowCount) req.user = r.rows[0];
    } catch { /* sesi tidak valid */ }
  }
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  next();
}
function requireCreator(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  if (req.user.role === 'user') return res.status(403).json({ error: 'not_creator' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}

async function upsertUser({ sub, email, name, identifier }) {
  email = String(email || '').trim().toLowerCase();
  if (!email) throw new Error('email tidak tersedia dari penyedia identitas');
  const role = config.ADMIN_EMAILS.includes(email) ? 'admin' : config.DEFAULT_ROLE;
  const r = await q(
    `INSERT INTO users (sub, email, name, identifier, role, last_login)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (lower(email)) DO UPDATE
       SET sub = COALESCE(EXCLUDED.sub, users.sub),
           name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE users.name END,
           identifier = CASE WHEN EXCLUDED.identifier <> '' THEN EXCLUDED.identifier ELSE users.identifier END,
           role = CASE WHEN $6 THEN 'admin' ELSE users.role END,
           last_login = now()
     RETURNING id, email, name, identifier, role`,
    [sub || null, email, String(name || '').slice(0, 200), String(identifier || '').slice(0, 60), role, config.ADMIN_EMAILS.includes(email)],
  );
  return r.rows[0];
}

/* ---------- SSO E-Portal UIKA (Introspect Token) ---------- */
const ssoEnabled = () => !!(config.SSO && config.SSO.enabled && config.SSO.clientId);

async function introspectToken(token, appModuleId) {
  let targetModuleId = appModuleId || config.SSO.appModuleId;

  // Ekstrak metadata dari token jika ada
  let tokenIss = null;
  try {
    const parts = (token || '').split('.');
    if (parts.length >= 2) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (payload.iss && typeof payload.iss === 'string') tokenIss = payload.iss;
      if (!targetModuleId && payload.appModule_id) targetModuleId = payload.appModule_id;
    }
  } catch {}

  const candidates = [];
  const base = (config.SSO.baseUrl || '').replace(/\/+$/, '');
  if (base) {
    if (base.endsWith('/api') || base.includes('/api/')) {
      candidates.push(`${base}/sso/introspect`);
    } else {
      candidates.push(`${base}/eportal-api/api/sso/introspect`);
      candidates.push(`${base}/api/sso/introspect`);
      candidates.push(`${base}/sso/introspect`);
    }
  }
  candidates.push('https://eportal.uika-bogor.ac.id/eportal-api/api/sso/introspect');
  candidates.push('http://eportal.uika-bogor.ac.id/eportal-api/api/sso/introspect');
  candidates.push('https://eportal.uika-bogor.ac.id/api/sso/introspect');
  candidates.push('http://eportal.uika-bogor.ac.id/api/sso/introspect');
  candidates.push('http://172.16.18.141/eportal-api/api/sso/introspect');
  candidates.push('http://172.16.18.141/api/sso/introspect');

  const uniqueCandidates = [...new Set(candidates)];
  let lastError = null;

  for (const candidateBase of uniqueCandidates) {
    try {
      const url = new URL(candidateBase);
      if (targetModuleId) url.searchParams.set('appModule_id', targetModuleId);

      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-SSO-Client-ID': config.SSO.clientId,
          'X-SSO-Client-Secret': config.SSO.clientSecret,
          Host: 'eportal.uika-bogor.ac.id',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (res.status === 404) {
        lastError = new Error(`Endpoint tidak ditemukan (404) di ${url.origin}${url.pathname}`);
        continue;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = body?.message || `HTTP ${res.status}`;
        lastError = new Error(`SSO introspect gagal: ${msg}`);
        continue;
      }
      return body;
    } catch (err) {
      lastError = err;
      continue;
    }
  }

  // Fallback validasi tanda tangan JWT jika HTTP introspect terkendala jaringan kampus
  if (config.SSO.jwtSecret) {
    try {
      const parts = (token || '').split('.');
      if (parts.length === 3) {
        const [headerB64, payloadB64, sigB64] = parts;
        const expectedSig = crypto.createHmac('sha256', config.SSO.jwtSecret).update(`${headerB64}.${payloadB64}`).digest('base64url');
        if (sigB64.length === expectedSig.length && crypto.timingSafeEqual(Buffer.from(sigB64), Buffer.from(expectedSig))) {
          const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
          if (!payload.exp || payload.exp * 1000 >= Date.now()) {
            return {
              valid: true,
              user: {
                user_id: payload.id || payload.sub,
                email: payload.email || '',
                name: payload.name || payload.email?.split('@')[0] || 'Pengguna E-Portal',
                institutional_role: payload.role || 'user',
                nidn: payload.nidn || null,
                npm: payload.npm || null,
                nip: payload.nip || null,
              },
              access: {
                has_access: true,
                role_name: payload.role_name || payload.role,
                unit_name: payload.unit_name,
                permissions: payload.permissions || ['*'],
              },
            };
          }
        }
      }
    } catch {}
  }

  throw lastError || new Error('SSO introspect gagal: semua endpoint tidak dapat dihubungi');
}

/* ---------- OIDC (Authorization Code + PKCE) ---------- */
let discovery = null;
let jwks = null;
async function getDiscovery() {
  if (discovery && discovery.exp > Date.now()) return discovery.doc;
  const url = `${config.OIDC.issuer}/.well-known/openid-configuration`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`discovery gagal (${r.status})`);
  const doc = await r.json();
  discovery = { doc, exp: Date.now() + 3600 * 1000 };
  jwks = createRemoteJWKSet(new URL(doc.jwks_uri));
  return doc;
}

const oidcEnabled = () => !!(config.OIDC.issuer && config.OIDC.clientId);

async function startOidc(req, res) {
  const doc = await getDiscovery();
  const state = b64url(crypto.randomBytes(16));
  const nonce = b64url(crypto.randomBytes(16));
  const verifier = b64url(crypto.randomBytes(32));
  const flow = await new SignJWT({ state, nonce, verifier, next: safeNext(req.query.next) })
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('10m').sign(secretKey);
  res.cookie(FLOW_COOKIE, flow, { httpOnly: true, sameSite: 'lax', secure: config.COOKIE_SECURE, maxAge: 600000, path: '/auth' });
  const u = new URL(doc.authorization_endpoint);
  u.search = new URLSearchParams({
    response_type: 'code', client_id: config.OIDC.clientId, redirect_uri: `${config.BASE_URL}/auth/callback`,
    scope: config.OIDC.scope, state, nonce, code_challenge: sha256b64url(verifier), code_challenge_method: 'S256',
  }).toString();
  res.redirect(u.toString());
}

async function finishOidc(req, res) {
  const flowToken = req.cookies[FLOW_COOKIE];
  if (!flowToken) throw new Error('sesi login kedaluwarsa, ulangi');
  const { payload: flow } = await jwtVerify(flowToken, secretKey, { algorithms: ['HS256'] });
  if (!req.query.code || req.query.state !== flow.state) throw new Error('state tidak cocok');
  const doc = await getDiscovery();
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: `${config.BASE_URL}/auth/callback`,
    client_id: config.OIDC.clientId, code_verifier: flow.verifier,
  });
  if (config.OIDC.clientSecret) body.set('client_secret', config.OIDC.clientSecret);
  const tr = await fetch(doc.token_endpoint, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000),
  });
  const tok = await tr.json();
  if (!tr.ok || !tok.id_token) throw new Error(`penukaran kode gagal: ${tok.error || tr.status}`);
  const { payload } = await jwtVerify(tok.id_token, jwks, {
    issuer: doc.issuer || config.OIDC.issuer, audience: config.OIDC.clientId,
  });
  if (payload.nonce !== flow.nonce) throw new Error('nonce tidak cocok');
  let claims = payload;
  if (!claims.email && doc.userinfo_endpoint && tok.access_token) {
    const ui = await fetch(doc.userinfo_endpoint, { headers: { authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(10000) });
    if (ui.ok) claims = { ...(await ui.json()), ...payload };
  }
  const user = await upsertUser({
    sub: payload.sub, email: claims.email, name: claims.name || claims.given_name || '',
    identifier: claims[config.OIDC.idClaim] || '',
  });
  setSession(res, await signSession(user.id));
  res.clearCookie(FLOW_COOKIE, { path: '/auth' });
  res.redirect(safeNext(flow.next));
}

module.exports = {
  loadUser, requireUser, requireCreator, requireAdmin, upsertUser, signSession, setSession,
  introspectToken, ssoEnabled, startOidc, finishOidc, oidcEnabled, safeNext, COOKIE,
};
