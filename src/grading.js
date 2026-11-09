'use strict';
/* Penilaian otomatis — fungsi murni (mudah diuji). */

const CHOICE = new Set(['radio', 'dropdown', 'checkbox']);
const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Nilai satu pertanyaan.
 * @returns {{points:number, correct:(boolean|null), manual:boolean, gradable:boolean}}
 *  correct=null  → tidak dinilai otomatis (esai / tanpa kunci)
 */
function gradeQuestion(q, answer, essayScore) {
  const max = Number(q.points) || 0;
  const key = Array.isArray(q.correct) ? q.correct : [];
  if (q.type === 'paragraph' || q.type === 'file') {
    if (max <= 0) return { points: 0, correct: null, manual: false, gradable: false };
    const p = Math.min(max, Math.max(0, Number(essayScore) || 0));
    return { points: p, correct: null, manual: true, gradable: true };
  }
  if (max <= 0 || key.length === 0) return { points: 0, correct: null, manual: false, gradable: false };

  if (q.type === 'radio' || q.type === 'dropdown') {
    const ok = typeof answer === 'string' && answer === key[0];
    return { points: ok ? max : 0, correct: ok, manual: false, gradable: true };
  }
  if (q.type === 'checkbox') {
    const given = new Set(Array.isArray(answer) ? answer : []);
    const keySet = new Set(key);
    const right = [...given].filter((a) => keySet.has(a)).length;
    const wrong = given.size - right;
    const exact = right === keySet.size && wrong === 0;
    if (exact) return { points: max, correct: true, manual: false, gradable: true };
    if (q.config && q.config.partial) {
      const frac = Math.max(0, (right - wrong) / keySet.size);
      return { points: Math.round(max * frac * 100) / 100, correct: false, manual: false, gradable: true };
    }
    return { points: 0, correct: false, manual: false, gradable: true };
  }
  if (q.type === 'short') {
    const a = norm(answer);
    const ok = a !== '' && key.some((k) => norm(k) === a);
    return { points: ok ? max : 0, correct: ok, manual: false, gradable: true };
  }
  if (q.type === 'scale') {
    const ok = String(answer ?? '') === String(key[0]);
    return { points: ok ? max : 0, correct: ok, manual: false, gradable: true };
  }
  return { points: 0, correct: null, manual: false, gradable: false };
}

/**
 * Hitung nilai total satu respons.
 * @returns {{score:number, max:number, needsManual:boolean, details:Object}}
 */
function gradeResponse(questions, answers, essayScores = {}) {
  let score = 0;
  let max = 0;
  let needsManual = false;
  const details = {};
  for (const q of questions) {
    if (q.type === 'section') continue;
    const g = gradeQuestion(q, answers[q.id], essayScores[q.id]);
    details[q.id] = g;
    if (!g.gradable) continue;
    max += Number(q.points) || 0;
    score += g.points;
    if (g.manual && essayScores[q.id] === undefined) needsManual = true;
  }
  return { score: Math.round(score * 100) / 100, max, needsManual, details };
}

/** Teks kunci jawaban yang mudah dibaca (untuk tinjauan jawaban). */
function correctAnswerText(q) {
  const key = Array.isArray(q.correct) ? q.correct : [];
  if (CHOICE.has(q.type)) {
    const byId = new Map((q.options || []).map((o) => [o.id, o.text]));
    return key.map((k) => byId.get(k) ?? k);
  }
  return key.map(String);
}

/** Ubah nilai jawaban mentah menjadi teks (opsi → teks pilihan). ctx.files: {idBerkas: namaBerkas} */
function answerText(q, answer, ctx = {}) {
  if (answer === undefined || answer === null || answer === '') return '';
  const cfg = q.config || {};
  if (q.type === 'grid') {
    const rows = new Map((cfg.rows || []).map((r) => [r.id, r.text])); const cols = new Map((cfg.cols || []).map((c) => [c.id, c.text]));
    return Object.entries(answer).map(([rid, cv]) => `${rows.get(rid) ?? rid}: ${(Array.isArray(cv) ? cv : [cv]).map((c) => cols.get(c) ?? c).join(', ')}`).join('; ');
  }
  if (q.type === 'ranking') {
    const byId = new Map((q.options || []).map((o) => [o.id, o.text]));
    return (Array.isArray(answer) ? answer : []).map((a, i) => `${i + 1}. ${byId.get(a) ?? a}`).join('; ');
  }
  if (q.type === 'file') return (ctx.files && ctx.files[answer]) || '(berkas)';
  if (CHOICE.has(q.type)) {
    const byId = new Map((q.options || []).map((o) => [o.id, o.text]));
    if (Array.isArray(answer)) return answer.map((a) => byId.get(a) ?? a).join('; ');
    return byId.get(answer) ?? String(answer);
  }
  return Array.isArray(answer) ? answer.join('; ') : String(answer);
}

module.exports = { gradeQuestion, gradeResponse, correctAnswerText, answerText, norm };
