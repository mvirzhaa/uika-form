'use strict';
/* Rekap formulir: ringkasan per pertanyaan, statistik nilai, dan analisis butir soal. */
const { q } = require('./db');
const schema = require('./schema');
const { gradeResponse } = require('./grading');
const { applyLogic, questionsFor } = require('./logic');

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

/** Satu respons per orang menurut kebijakan nilai (bila form mengizinkan banyak percobaan). */
function countedResponses(rows, settings) {
  if (settings.one_response || settings.max_attempts === 1) return rows;
  const pct = (r) => (r.max_score > 0 ? r.score / r.max_score : 0);
  const best = new Map();
  for (const r of rows) {
    const key = r.user_id || (r.email ? r.email.toLowerCase() : r.id);
    const cur = best.get(key);
    const t = new Date(r.submitted_at).getTime();
    let take = !cur;
    if (cur) {
      const ct = new Date(cur.submitted_at).getTime();
      if (settings.score_policy === 'last') take = t >= ct;
      else if (settings.score_policy === 'first') take = t < ct;
      else take = pct(r) > pct(cur) || (pct(r) === pct(cur) && t > ct);
    }
    if (take) best.set(key, r);
  }
  return [...best.values()].sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));
}

const level = (p) => (p === null ? null : p >= 0.7 ? 'Mudah' : p >= 0.3 ? 'Sedang' : 'Sulit');
const dLevel = (d) => (d === null ? null : d >= 0.4 ? 'Sangat baik' : d >= 0.3 ? 'Baik' : d >= 0.2 ? 'Perlu revisi' : d >= 0 ? 'Buruk' : 'Sangat buruk');

async function buildSummary(form, questions) {
  const settings = schema.cleanSettings(form.settings);
  const all = (await q(
    `SELECT id, user_id, name, email, answers, essay_scores, question_ids, score::float AS score, max_score::float AS max_score,
            status, graded, submitted_at, started_at, jsonb_array_length(violations) AS violations
       FROM responses WHERE form_id=$1 AND status<>'in_progress' ORDER BY submitted_at`, [form.id],
  )).rows;
  const inProgress = (await q("SELECT count(*)::int n FROM responses WHERE form_id=$1 AND status='in_progress'", [form.id])).rows[0].n;
  const rs = countedResponses(all, settings);
  const multi = rs.length !== all.length;

  const out = { total: rs.length, attempts_total: all.length, in_progress: inProgress, is_quiz: settings.is_quiz, policy: multi ? settings.score_policy : null, questions: [] };

  const perDay = {};
  for (const r of all) {
    const d = new Date(r.submitted_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
    perDay[d] = (perDay[d] || 0) + 1;
  }
  out.timeline = Object.entries(perDay).map(([date, count]) => ({ date, count }));

  // soal yang tampil untuk tiap respons (subset acak + percabangan)
  const shownMap = new Map();
  for (const r of rs) shownMap.set(r.id, new Set(applyLogic(questionsFor(questions, r), r.answers).visible.map((x) => x.id)));

  const pctOf = (r) => (r.max_score > 0 ? (r.score / r.max_score) * 100 : null);
  if (settings.is_quiz) {
    const pcts = rs.map(pctOf).filter((p) => p !== null).sort((a, b) => a - b);
    const buckets = Array.from({ length: 10 }, (_, i) => ({ label: `${i * 10}–${i === 9 ? 100 : i * 10 + 9}`, count: 0 }));
    pcts.forEach((p) => { buckets[Math.min(9, Math.floor(p / 10))].count += 1; });
    const sum = pcts.reduce((a, b) => a + b, 0);
    const avg = pcts.length ? sum / pcts.length : null;
    const sd = pcts.length > 1 ? Math.sqrt(pcts.reduce((a, b) => a + (b - avg) ** 2, 0) / (pcts.length - 1)) : null;
    const cert = schema.cleanCert(form.cert, settings);
    out.scores = {
      count: pcts.length, average: avg === null ? null : round1(avg), std_dev: sd === null ? null : round1(sd),
      highest: pcts.length ? round1(pcts[pcts.length - 1]) : null, lowest: pcts.length ? round1(pcts[0]) : null,
      median: pcts.length ? round1(pcts[Math.floor((pcts.length - 1) / 2)]) : null,
      pass_rate: cert.enabled && pcts.length ? round1((pcts.filter((p) => p >= cert.min_percent).length / pcts.length) * 100) : null,
      histogram: buckets, ungraded: rs.filter((r) => !r.graded).length,
      auto_submitted: rs.filter((r) => r.status === 'auto_submitted').length,
      with_violations: rs.filter((r) => r.violations > 0).length,
    };
  }

  // analisis butir: kelompok atas/bawah 27%
  const ranked = rs.filter((r) => r.max_score > 0).sort((a, b) => b.score / b.max_score - a.score / a.max_score);
  const nGroup = Math.max(1, Math.ceil(ranked.length * 0.27));
  const upper = ranked.slice(0, nGroup); const lower = ranked.slice(-nGroup);

  const autoItems = [];

  for (const x of questions) {
    if (x.type === 'section') continue;
    const item = { id: x.id, title: x.title, type: x.type, points: x.points, answered: 0, shown: 0 };
    const shown = rs.filter((r) => shownMap.get(r.id).has(x.id));
    item.shown = shown.length;
    const vals = shown.map((r) => ({ v: r.answers[x.id], name: r.name })).filter((a) => a.v !== undefined);
    item.answered = vals.length;
    if (['radio', 'dropdown', 'checkbox'].includes(x.type)) {
      const counts = new Map(x.options.map((o) => [o.id, 0]));
      vals.forEach((a) => (Array.isArray(a.v) ? a.v : [a.v]).forEach((id) => counts.has(id) && counts.set(id, counts.get(id) + 1)));
      item.options = x.options.map((o) => ({ id: o.id, text: o.text, count: counts.get(o.id), correct: x.correct.includes(o.id) }));
    } else if (x.type === 'ranking') {
      const sums = new Map(x.options.map((o) => [o.id, { sum: 0, first: 0 }]));
      vals.forEach((a) => a.v.forEach((id, i) => { const s = sums.get(id); if (s) { s.sum += i + 1; if (i === 0) s.first += 1; } }));
      item.ranking = x.options.map((o) => ({ id: o.id, text: o.text, avg_rank: vals.length ? round2(sums.get(o.id).sum / vals.length) : null, first: sums.get(o.id).first }))
        .sort((a, b) => (a.avg_rank ?? 99) - (b.avg_rank ?? 99));
    } else if (x.type === 'grid') {
      item.grid = (x.config.rows || []).map((row) => ({
        id: row.id, text: row.text,
        cols: (x.config.cols || []).map((c) => ({ id: c.id, text: c.text, count: vals.filter((a) => { const cv = a.v[row.id]; return Array.isArray(cv) ? cv.includes(c.id) : cv === c.id; }).length })),
      }));
    } else if (x.type === 'scale') {
      const lo = x.config.min ?? 1; const hi = x.config.max ?? 5;
      const dist = Array.from({ length: hi - lo + 1 }, (_, i) => ({ value: lo + i, count: 0 }));
      let sum = 0;
      vals.forEach((a) => { const n = Number(a.v); if (dist[n - lo]) { dist[n - lo].count += 1; sum += n; } });
      item.distribution = dist; item.average = vals.length ? round2(sum / vals.length) : null;
    } else if (x.type === 'file') {
      item.files = vals.length;
    } else {
      item.texts = vals.slice(-100).reverse().map((a) => ({ name: a.name, text: String(a.v) }));
    }
    if (settings.is_quiz && x.points > 0 && x.type !== 'paragraph' && x.type !== 'file') {
      const probe = gradeResponse([x], {}, {});
      if (probe.max > 0) {
        const ok = (r) => gradeResponse([x], r.answers, {}).score >= x.points;
        const nOk = shown.filter(ok).length;
        const p = shown.length ? nOk / shown.length : null;
        item.correct_rate = p === null ? null : round1(p * 100);
        item.difficulty = p === null ? null : round2(p);
        item.difficulty_label = level(p);
        const u = upper.filter((r) => shownMap.get(r.id).has(x.id)); const l = lower.filter((r) => shownMap.get(r.id).has(x.id));
        item.discrimination = ranked.length >= 10 && u.length && l.length ? round2(u.filter(ok).length / u.length - l.filter(ok).length / l.length) : null;
        item.discrimination_label = dLevel(item.discrimination);
        autoItems.push({ x, ok });
      }
    }
    out.questions.push(item);
  }

  // reliabilitas KR-20 (hanya bila semua responden memperoleh butir yang sama)
  if (settings.is_quiz && settings.pick_count === 0 && autoItems.length >= 2 && rs.length >= 10) {
    const k = autoItems.length;
    const totals = rs.map((r) => autoItems.reduce((a, it) => a + (it.ok(r) ? 1 : 0), 0));
    const mean = totals.reduce((a, b) => a + b, 0) / rs.length;
    const variance = totals.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length;
    const pq = autoItems.reduce((a, it) => { const p = rs.filter(it.ok).length / rs.length; return a + p * (1 - p); }, 0);
    if (variance > 0) out.reliability = { kr20: round2((k / (k - 1)) * (1 - pq / variance)), items: k, respondents: rs.length };
  }
  return out;
}

module.exports = { buildSummary, countedResponses, round1 };
