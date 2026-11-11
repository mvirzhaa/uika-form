'use strict';
/* Nilai bawaan + sanitasi masukan formulir (tema, pengaturan, sertifikat, pertanyaan). */
const crypto = require('crypto');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const TYPES = ['short', 'paragraph', 'radio', 'checkbox', 'dropdown', 'scale', 'date', 'time', 'section', 'file', 'grid', 'ranking'];
const CHOICE_TYPES = ['radio', 'checkbox', 'dropdown', 'ranking'];
const OPS = ['eq', 'neq', 'contains', 'gt', 'lt', 'answered', 'not_answered'];

const DEFAULT_THEME = {
  color: '#0071e3', bg: '#f2f2f7', header_style: 'gradient', header_image: null, font: 'system', mode: 'light',
};
const DEFAULT_SETTINGS = {
  is_quiz: false, duration_min: 0, identity: 'ask', one_response: false,
  shuffle_questions: false, shuffle_options: false, show_score: 'immediately', show_answers: false,
  confirmation_message: 'Terima kasih, jawaban Anda sudah direkam.', open_at: null, close_at: null,
  allowlist: { enabled: false, require_login: false },
  max_attempts: 0, score_policy: 'best', pick_count: 0,
  anticheat: { enabled: false, max_violations: 3, block_copy: true, fullscreen: false },
  attendance: { enabled: false, require_for_cert: false },
  notify_owner: false, confirm_email: false, allow_embed: false, language: 'id',
};
const DEFAULT_CERT = {
  enabled: false, title: 'SERTIFIKAT', subtitle: 'Diberikan kepada',
  body: 'atas partisipasinya sebagai peserta dalam kegiatan',
  event_text: '“{{judul}}”', footer: '', place: 'Bogor', sponsor_label: 'Didukung oleh', logo_image: null, layout: null,
  organizer: 'Universitas Ibn Khaldun Bogor', signer_name: '', signer_title: '',
  accent: '#0071e3', bg_color: '#ffffff', bg_image: null, signature_image: null,
  sponsors: { tl: null, tr: null, br: null }, min_percent: 60, auto_email: false,
  template: 'classic', number_format: '', number_start: 1,
};

const str = (v, max, d = '') => (typeof v === 'string' ? v.slice(0, max) : d);
const bool = (v, d = false) => (typeof v === 'boolean' ? v : d);
const hex = (v, d) => (typeof v === 'string' && HEX_RE.test(v) ? v.toLowerCase() : d);
const uuidOrNull = (v) => (typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null);
const oneOf = (v, arr, d) => (arr.includes(v) ? v : d);
const dateOrNull = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const intRange = (v, min, max, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

function cleanTheme(t = {}) {
  return {
    color: hex(t.color, DEFAULT_THEME.color),
    bg: hex(t.bg, DEFAULT_THEME.bg),
    header_style: oneOf(t.header_style, ['solid', 'gradient', 'image'], 'gradient'),
    header_image: uuidOrNull(t.header_image),
    font: oneOf(t.font, ['system', 'serif', 'rounded', 'mono'], 'system'),
    mode: oneOf(t.mode, ['light', 'dark'], 'light'),
  };
}

function cleanSettings(s = {}) {
  const out = {
    is_quiz: bool(s.is_quiz),
    duration_min: intRange(s.duration_min, 0, 720, 0),
    identity: oneOf(s.identity, ['login', 'ask', 'none'], 'ask'),
    one_response: bool(s.one_response),
    shuffle_questions: bool(s.shuffle_questions),
    shuffle_options: bool(s.shuffle_options),
    show_score: oneOf(s.show_score, ['immediately', 'never'], 'immediately'),
    show_answers: bool(s.show_answers),
    confirmation_message: str(s.confirmation_message, 2000, DEFAULT_SETTINGS.confirmation_message),
    open_at: dateOrNull(s.open_at),
    close_at: dateOrNull(s.close_at),
    allowlist: { enabled: bool(s.allowlist?.enabled), require_login: bool(s.allowlist?.require_login) },
    max_attempts: intRange(s.max_attempts, 0, 50, 0),
    score_policy: oneOf(s.score_policy, ['best', 'last', 'first'], 'best'),
    pick_count: intRange(s.pick_count, 0, 500, 0),
    anticheat: {
      enabled: bool(s.anticheat?.enabled), max_violations: intRange(s.anticheat?.max_violations, 1, 20, 3),
      block_copy: bool(s.anticheat?.block_copy, true), fullscreen: bool(s.anticheat?.fullscreen),
    },
    attendance: { enabled: bool(s.attendance?.enabled), require_for_cert: bool(s.attendance?.require_for_cert) },
    notify_owner: bool(s.notify_owner),
    confirm_email: bool(s.confirm_email),
    allow_embed: bool(s.allow_embed),
    language: oneOf(s.language, ['id', 'en'], 'id'),
  };
  if (!out.is_quiz) { out.duration_min = 0; out.show_answers = false; out.anticheat.enabled = false; out.pick_count = 0; }
  if (out.allowlist.enabled && out.identity === 'none') out.identity = 'ask'; // daftar peserta butuh identitas
  if (out.confirm_email && out.identity === 'none') out.identity = 'ask';
  if (!out.attendance.enabled) out.attendance.require_for_cert = false;
  return out;
}

function cleanCert(c = {}, settings) {
  const sp = c.sponsors || {};
  const out = {
    enabled: bool(c.enabled),
    title: str(c.title, 80, DEFAULT_CERT.title),
    subtitle: str(c.subtitle, 100, DEFAULT_CERT.subtitle),
    body: str(c.body, 600, DEFAULT_CERT.body),
    organizer: str(c.organizer, 150, DEFAULT_CERT.organizer),
    signer_name: str(c.signer_name, 100),
    signer_title: str(c.signer_title, 100),
    accent: hex(c.accent, DEFAULT_CERT.accent),
    bg_color: hex(c.bg_color, DEFAULT_CERT.bg_color),
    bg_image: uuidOrNull(c.bg_image),
    signature_image: uuidOrNull(c.signature_image),
    sponsors: { tl: uuidOrNull(sp.tl), tr: uuidOrNull(sp.tr), br: uuidOrNull(sp.br) },
    min_percent: intRange(c.min_percent, 0, 100, 60),
    auto_email: bool(c.auto_email),
    template: oneOf(c.template, ['classic', 'modern', 'elegant', 'minimal'], 'classic'),
    number_format: str(c.number_format, 120),
    number_start: intRange(c.number_start, 1, 999999, 1),
    event_text: str(c.event_text, 200, DEFAULT_CERT.event_text),
    footer: str(c.footer, 400, DEFAULT_CERT.footer),
    place: str(c.place, 80, DEFAULT_CERT.place),
    sponsor_label: str(c.sponsor_label, 60, DEFAULT_CERT.sponsor_label),
    logo_image: uuidOrNull(c.logo_image),
    layout: require('./certLayout').cleanLayout(c.layout),
  };
  return out;
}

function newId() { return crypto.randomUUID(); }

function cleanQuestion(raw = {}, position) {
  const type = TYPES.includes(raw.type) ? raw.type : 'short';
  const id = typeof raw.id === 'string' && UUID_RE.test(raw.id) ? raw.id.toLowerCase() : newId();
  const q = {
    id, position, type,
    title: str(raw.title, 2000),
    description: str(raw.description, 4000),
    required: type === 'section' ? false : bool(raw.required),
    options: [], correct: [], points: 0, config: {},
  };
  if (CHOICE_TYPES.includes(type)) {
    const seen = new Set();
    const listId = type === 'dropdown' && typeof raw.config?.list_id === 'string' && UUID_RE.test(raw.config.list_id) ? raw.config.list_id.toLowerCase() : null;
    if (listId) q.config.list_id = listId;
    q.options = (Array.isArray(raw.options) ? raw.options : []).slice(0, listId ? 2000 : 200).map((o, i) => {
      let oid = typeof o?.id === 'string' && /^[\w-]{1,40}$/.test(o.id) ? o.id : `o${i + 1}_${crypto.randomBytes(3).toString('hex')}`;
      while (seen.has(oid)) oid += 'x';
      seen.add(oid);
      return { id: oid, text: str(o?.text, 500) };
    });
    const ids = new Set(q.options.map((o) => o.id));
    q.correct = (Array.isArray(raw.correct) ? raw.correct : []).filter((c) => typeof c === 'string' && ids.has(c));
    if (type !== 'checkbox') q.correct = q.correct.slice(0, 1);
    if (type === 'checkbox') q.config.partial = bool(raw.config?.partial);
    if (type === 'ranking') q.correct = [];
  } else if (type === 'short') {
    q.correct = (Array.isArray(raw.correct) ? raw.correct : []).map((c) => str(String(c ?? ''), 300).trim()).filter(Boolean).slice(0, 30);
  } else if (type === 'scale') {
    const min = intRange(raw.config?.min, 0, 1, 1);
    const max = intRange(raw.config?.max, 2, 10, 5);
    q.config = { min, max, min_label: str(raw.config?.min_label, 60), max_label: str(raw.config?.max_label, 60) };
    const k = Array.isArray(raw.correct) ? Number(raw.correct[0]) : NaN;
    if (Number.isInteger(k) && k >= min && k <= max) q.correct = [String(k)];
  } else if (type === 'grid') {
    const clean = (arr, p) => {
      const seen = new Set();
      return (Array.isArray(arr) ? arr : []).slice(0, 30).map((o, i) => {
        let oid = typeof o?.id === 'string' && /^[\w-]{1,40}$/.test(o.id) ? o.id : `${p}${i + 1}_${crypto.randomBytes(3).toString('hex')}`;
        while (seen.has(oid)) oid += 'x';
        seen.add(oid);
        return { id: oid, text: str(o?.text, 300) };
      });
    };
    q.config = { rows: clean(raw.config?.rows, 'r'), cols: clean(raw.config?.cols, 'c'), multi: bool(raw.config?.multi) };
  } else if (type === 'file') {
    q.config = { accept: oneOf(raw.config?.accept, ['any', 'image', 'pdf', 'doc'], 'any'), max_mb: intRange(raw.config?.max_mb, 1, 5, 5) };
  }
  // pengaturan umum
  const img = uuidOrNull(raw.config?.image);
  if (img && type !== 'section') q.config.image = img;
  if (bool(raw.config?.always) && type !== 'section') q.config.always = true;
  const rule = raw.config?.show_if;
  if (rule && Array.isArray(rule.conds)) {
    const conds = rule.conds.slice(0, 5).map((c) => ({
      qid: typeof c?.qid === 'string' && UUID_RE.test(c.qid) ? c.qid.toLowerCase() : null,
      op: oneOf(c?.op, OPS, 'eq'), value: str(String(c?.value ?? ''), 500),
    })).filter((c) => c.qid);
    if (conds.length) q.config.show_if = { match: rule.match === 'any' ? 'any' : 'all', conds };
  }
  q.points = ['section', 'date', 'time', 'grid', 'ranking'].includes(type) ? 0 : Math.min(1000, Math.max(0, Math.round((Number(raw.points) || 0) * 100) / 100));
  return q;
}

/** Normalisasi isian jawaban peserta sesuai tipe pertanyaan. */
function cleanAnswers(questions, raw = {}) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const q of questions) {
    if (q.type === 'section') continue;
    let v = raw[q.id];
    if (v === undefined || v === null || v === '') continue;
    if (q.type === 'checkbox') {
      const ids = new Set(q.options.map((o) => o.id));
      v = (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string' && ids.has(x));
      if (!v.length) continue;
    } else if (q.type === 'ranking') {
      const ids = new Set(q.options.map((o) => o.id));
      if (!Array.isArray(v) || v.length !== ids.size || new Set(v).size !== ids.size || !v.every((x) => ids.has(x))) continue;
    } else if (q.type === 'grid') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const rows = new Set((q.config.rows || []).map((r) => r.id)); const cols = new Set((q.config.cols || []).map((c) => c.id));
      const o = {};
      for (const [rid, cv] of Object.entries(v)) {
        if (!rows.has(rid)) continue;
        if (q.config.multi) { const arr = (Array.isArray(cv) ? cv : [cv]).filter((x) => cols.has(x)); if (arr.length) o[rid] = [...new Set(arr)]; } else if (typeof cv === 'string' && cols.has(cv)) o[rid] = cv;
      }
      if (!Object.keys(o).length) continue;
      v = o;
    } else if (q.type === 'file') {
      if (typeof v !== 'string' || !UUID_RE.test(v)) continue;
      v = v.toLowerCase();
    } else if (q.type === 'radio' || q.type === 'dropdown') {
      if (typeof v !== 'string' || !q.options.some((o) => o.id === v)) continue;
    } else if (q.type === 'scale') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < (q.config.min ?? 1) || n > (q.config.max ?? 5)) continue;
      v = String(n);
    } else if (q.type === 'date') {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) continue;
    } else if (q.type === 'time') {
      if (typeof v !== 'string' || !/^\d{2}:\d{2}$/.test(v)) continue;
    } else {
      v = str(String(v), q.type === 'short' ? 1000 : 20000).trim();
      if (!v) continue;
    }
    out[q.id] = v;
  }
  return out;
}

function slugify() {
  // 10 karakter acak yang tidak ambigu (tanpa 0/o/1/l)
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const b = crypto.randomBytes(10);
  let s = '';
  for (const x of b) s += alphabet[x % alphabet.length];
  return s;
}

module.exports = {
  UUID_RE, TYPES, CHOICE_TYPES, OPS, DEFAULT_THEME, DEFAULT_SETTINGS, DEFAULT_CERT,
  cleanTheme, cleanSettings, cleanCert, cleanQuestion, cleanAnswers, newId, slugify, str,
};
