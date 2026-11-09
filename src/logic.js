'use strict';
/* Logika percabangan & kelengkapan jawaban — fungsi murni.
   CATATAN: salinan klien ada di public/js/logic.js; ubah keduanya bersamaan. */

const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Apakah jawaban dianggap terisi (untuk "wajib" dan syarat percabangan)? */
function isAnswered(q, v) {
  if (v === undefined || v === null || v === '') return false;
  if (q.type === 'checkbox' || q.type === 'ranking') {
    if (!Array.isArray(v) || !v.length) return false;
    return q.type === 'ranking' ? v.length === (q.options || []).length : true;
  }
  if (q.type === 'grid') {
    if (!v || typeof v !== 'object') return false;
    const rows = q.config?.rows || [];
    return rows.length > 0 && rows.every((r) => v[r.id] !== undefined && (!Array.isArray(v[r.id]) || v[r.id].length));
  }
  return true;
}

function condMet(source, cond, v) {
  const answered = isAnswered(source, v);
  switch (cond.op) {
    case 'answered': return answered;
    case 'not_answered': return !answered;
    case 'eq':
      if (!answered) return false;
      return Array.isArray(v) ? v.map(String).includes(String(cond.value)) : String(v) === String(cond.value);
    case 'neq':
      if (!answered) return true;
      return Array.isArray(v) ? !v.map(String).includes(String(cond.value)) : String(v) !== String(cond.value);
    case 'contains': return answered && norm(v).includes(norm(cond.value));
    case 'gt': return answered && Number(v) > Number(cond.value);
    case 'lt': return answered && Number(v) < Number(cond.value);
    default: return true;
  }
}

/** Evaluasi berurutan: jawaban pertanyaan yang tersembunyi dianggap kosong. */
function applyLogic(questions, answers) {
  const visible = [];
  const kept = {};
  const byId = new Map(questions.map((x) => [x.id, x]));
  for (const x of questions) {
    const rule = x.config?.show_if;
    let show = true;
    if (rule && Array.isArray(rule.conds) && rule.conds.length) {
      const results = rule.conds.map((c) => {
        const src = byId.get(c.qid);
        return src ? condMet(src, c, kept[c.qid]) : true;
      });
      show = rule.match === 'any' ? results.some(Boolean) : results.every(Boolean);
    }
    if (!show) continue;
    visible.push(x);
    if (x.type !== 'section' && answers[x.id] !== undefined) kept[x.id] = answers[x.id];
  }
  return { visible, answers: kept };
}

/** Pilih soal acak untuk satu percobaan: soal bertanda "selalu" tetap muncul. */
function pickQuestionIds(questions, count, rnd = Math.random) {
  const real = questions.filter((x) => x.type !== 'section');
  const pool = real.filter((x) => !x.config?.always);
  if (!count || count <= 0 || pool.length <= count) return null; // null = semua soal
  const idx = pool.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const chosen = new Set(idx.slice(0, count).map((i) => pool[i].id));
  const out = [];
  let block = []; let head = null;
  const flush = () => {
    const has = block.some((b) => b.type !== 'section');
    if (head && (has || !block.length)) out.push(head.id);
    out.push(...block.map((b) => b.id));
    block = [];
  };
  for (const x of questions) {
    if (x.type === 'section') { flush(); head = x; continue; }
    if (x.config?.always || chosen.has(x.id)) block.push(x);
  }
  flush();
  return out;
}

/** Soal untuk satu respons (subset acak bila ada), urutan mengikuti form. */
function questionsFor(questions, resp) {
  const ids = resp && Array.isArray(resp.question_ids) ? new Set(resp.question_ids) : null;
  return ids ? questions.filter((x) => ids.has(x.id)) : questions;
}

module.exports = { isAnswered, condMet, applyLogic, pickQuestionIds, questionsFor, norm };
