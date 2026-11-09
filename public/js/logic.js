/* Salinan klien dari src/logic.js (percabangan & kelengkapan jawaban). Ubah keduanya bersamaan. */
const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

export function isAnswered(q, v) {
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
export function applyLogic(questions, answers) {
  const visible = new Set();
  const kept = {};
  const byId = new Map(questions.map((x) => [x.id, x]));
  for (const x of questions) {
    const rule = x.config?.show_if;
    let show = true;
    if (rule && Array.isArray(rule.conds) && rule.conds.length) {
      const results = rule.conds.map((c) => { const src = byId.get(c.qid); return src ? condMet(src, c, kept[c.qid]) : true; });
      show = rule.match === 'any' ? results.some(Boolean) : results.every(Boolean);
    }
    if (!show) continue;
    visible.add(x.id);
    if (x.type !== 'section' && answers[x.id] !== undefined) kept[x.id] = answers[x.id];
  }
  return { visible, answers: kept };
}

export const OP_LABEL = { eq: 'sama dengan', neq: 'tidak sama dengan', contains: 'mengandung', gt: 'lebih dari', lt: 'kurang dari', answered: 'sudah dijawab', not_answered: 'belum dijawab' };
