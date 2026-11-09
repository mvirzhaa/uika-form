'use strict';
// Muat .env bila ada (Node >= 20.12)
try { process.loadEnvFile(); } catch { /* tidak ada .env: pakai variabel lingkungan */ }
const crypto = require('crypto');

const env = process.env;
const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
const list = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const BASE_URL = (env.BASE_URL || `http://localhost:${env.PORT || 8080}`).replace(/\/+$/, '');
const isProd = env.NODE_ENV === 'production';

if (isProd && !env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET wajib diisi di produksi');
}
if (isProd && bool(env.DEV_LOGIN)) {
  throw new Error('DEV_LOGIN harus false di produksi');
}

module.exports = {
  PORT: Number(env.PORT || 8080),
  BASE_URL,
  isProd,
  DATABASE_URL: env.DATABASE_URL || 'postgres://uikaform:uikaform@localhost:5432/uikaform',
  SESSION_SECRET: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  COOKIE_SECURE: BASE_URL.startsWith('https://'),
  TRUST_PROXY: Number(env.TRUST_PROXY ?? 1),
  DEV_LOGIN: bool(env.DEV_LOGIN),
  ADMIN_EMAILS: list(env.ADMIN_EMAILS),
  DEFAULT_ROLE: ['creator', 'user'].includes(env.DEFAULT_ROLE) ? env.DEFAULT_ROLE : 'creator',
  OIDC: {
    issuer: (env.OIDC_ISSUER || '').replace(/\/+$/, ''),
    clientId: env.OIDC_CLIENT_ID || '',
    clientSecret: env.OIDC_CLIENT_SECRET || '',
    scope: env.OIDC_SCOPE || 'openid profile email',
    // Nama klaim untuk NIM/NIP di id_token E-Portal (bisa disesuaikan)
    idClaim: env.OIDC_ID_CLAIM || 'preferred_username',
  },
  SMTP: {
    url: env.SMTP_URL || '',
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    secure: bool(env.SMTP_SECURE),
    from: env.MAIL_FROM || 'UIKA Form <no-reply@uika-bogor.ac.id>',
  },
  ORG_NAME: env.ORG_NAME || 'Universitas Ibn Khaldun Bogor',
  MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
};
