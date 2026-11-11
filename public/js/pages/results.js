/* Tab Respons di Editor: Ringkasan (grafik), Pertanyaan (satu per satu), Individual (jawaban per peserta + penilaian esai). */
import { h, clear, icon, api, toast, confirmDialog, debounce, loadChart, PALETTE, fmtDateTime, num, errMsg } from '../core.js';

const STATUS = { submitted: ['Terkirim', 'ok'], auto_submitted: ['Otomatis (waktu habis)', 'warn'], in_progress: ['Belum selesai', ''] };

export function responsesTab(host, form, ctx) {
  let sub = 'summary';
  let charts = [];
  let alive = true;
  let summary = null;
  let qIndex = 0;
  const destroyCharts = () => { charts.forEach((c) => { try { c.destroy(); } catch { /* abaikan */ } }); charts = []; };

  const head = h('div'); const view = h('div');
  host.append(head, view);

  async function loadSummary() { summary = await api('GET', `/api/forms/${form.id}/summary`); ctx.refreshCount?.(summary.total); return summary; }

  function drawHead() {
    clear(head);
    const t = (k, l, ic) => h('button', { class: sub === k ? 'on' : '', onclick: () => { sub = k; drawHead(); draw(); } }, icon(ic, 16), l);
    head.append(h('div', { class: 'row wrap', style: { margin: '14px 0' } },
      h('div', { class: 'grow' }, h('h2', null, `${summary ? summary.total : '…'} respons`), summary?.in_progress ? h('div', { class: 'small muted' }, `${summary.in_progress} sedang mengerjakan`) : null),
      h('button', { class: 'btn icon', title: 'Muat ulang', onclick: async () => { await loadSummary(); drawHead(); draw(); } }, icon('refresh')),
      h('a', { class: 'btn', href: `/api/forms/${form.id}/report.pdf` }, icon('file', 16), 'Laporan PDF'),
      h('a', { class: 'btn', href: `/api/forms/${form.id}/export.xlsx` }, icon('download', 16), 'Unduh Excel')),
    h('div', { style: { display: 'flex', justifyContent: 'center', marginBottom: '14px' } }, h('div', { class: 'seg seg-fill' }, t('summary', 'Ringkasan', 'chart'), t('question', 'Pertanyaan', 'list'), t('individual', 'Individual', 'user'))));
  }

  async function draw() {
    destroyCharts(); clear(view);
    if (!summary) view.append(h('div', { class: 'spinner' }));
    if (sub === 'summary') await drawSummary(); else if (sub === 'question') await drawQuestion(); else await drawIndividual();
  }

  /* ---------- grafik ---------- */
  async function chart(canvas, cfg) {
    const Chart = await loadChart();
    if (!alive) return;
    const c = new Chart(canvas, cfg); charts.push(c);
  }
  const pieCfg = (labels, data) => ({ type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: PALETTE, borderWidth: 2, borderColor: '#fff' }] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 12 } } } }, cutout: '58%' } });
  const barCfg = (labels, data, horizontal, color = '#0a84ff') => ({ type: 'bar', data: { labels, datasets: [{ data, backgroundColor: color, borderRadius: 6, maxBarThickness: 36 }] }, options: { indexAxis: horizontal ? 'y' : 'x', maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { [horizontal ? 'x' : 'y']: { beginAtZero: true, ticks: { precision: 0 } } } } });

  function questionBlock(q, big) {
    const box = h('div', { class: 'card' });
    box.append(h('div', { class: 'row', style: { alignItems: 'flex-start' } }, h('div', { class: 'grow' }, h('h3', null, q.title || '(tanpa judul)'), h('div', { class: 'small muted' }, `${q.answered} jawaban`)),
      q.correct_rate !== undefined && q.correct_rate !== null && h('span', { class: `pill ${q.correct_rate >= 70 ? 'ok' : q.correct_rate >= 40 ? 'warn' : 'bad'}` }, `${num(q.correct_rate)}% benar`)));
    if (q.options) {
      if (!q.answered) { box.append(h('p', { class: 'muted small' }, 'Belum ada jawaban.')); return box; }
      const useDonut = q.type !== 'checkbox';
      const cv = h('canvas'); box.append(h('div', { class: `chartbox ${big ? '' : 'sm'}`, style: { marginTop: '10px' } }, cv));
      chart(cv, useDonut ? pieCfg(q.options.map((o) => o.text), q.options.map((o) => o.count)) : barCfg(q.options.map((o) => o.text), q.options.map((o) => o.count), true));
      const total = Math.max(1, q.answered);
      box.append(h('div', { class: 'bars', style: { marginTop: '10px' } }, q.options.map((o) => h('div', { class: `b ${o.correct ? 'ok' : ''}` }, h('span', null, o.text, o.correct && ' ✓'), h('div', { class: 'track' }, h('i', { style: { width: `${(o.count / total) * 100}%` } })), h('span', { class: 'muted' }, `${o.count} (${Math.round((o.count / total) * 100)}%)`)))));
    } else if (q.ranking) {
      if (!q.answered) { box.append(h('p', { class: 'muted small' }, 'Belum ada jawaban.')); return box; }
      box.append(h('div', { class: 'small muted', style: { margin: '6px 0' } }, 'Urut dari rata-rata peringkat terbaik (1 = paling atas)'),
        h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Opsi'), h('th', { class: 'num' }, 'Rata-rata'), h('th', { class: 'num' }, 'Peringkat 1'))),
          h('tbody', null, q.ranking.map((r, i) => h('tr', null, h('td', null, String(i + 1)), h('td', null, r.text), h('td', { class: 'num' }, num(r.avg_rank)), h('td', { class: 'num' }, String(r.first)))))));
    } else if (q.grid) {
      if (!q.answered) { box.append(h('p', { class: 'muted small' }, 'Belum ada jawaban.')); return box; }
      const cols = q.grid[0]?.cols || [];
      box.append(h('div', { style: { overflowX: 'auto', marginTop: '8px' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, ''), cols.map((c) => h('th', { class: 'num' }, c.text)))),
        h('tbody', null, q.grid.map((row) => { const mx = Math.max(1, ...row.cols.map((c) => c.count)); return h('tr', null, h('td', null, row.text), row.cols.map((c) => h('td', { class: 'num', style: { background: `color-mix(in srgb, var(--accent) ${Math.round((c.count / mx) * 38)}%, transparent)` } }, String(c.count)))); })))));
    } else if (q.files !== undefined) {
      box.append(h('p', { class: 'muted small' }, `${q.files} berkas diunggah. Unduh dari tab Individual.`));
    } else if (q.distribution) {
      if (!q.answered) { box.append(h('p', { class: 'muted small' }, 'Belum ada jawaban.')); return box; }
      const cv = h('canvas'); box.append(h('div', { class: 'row', style: { margin: '6px 0' } }, h('span', { class: 'pill blue' }, `Rata-rata ${num(q.average)}`)), h('div', { class: `chartbox ${big ? '' : 'sm'}` }, cv));
      chart(cv, barCfg(q.distribution.map((d) => String(d.value)), q.distribution.map((d) => d.count), false, '#ff9f0a'));
    } else {
      if (!q.texts.length) { box.append(h('p', { class: 'muted small' }, 'Belum ada jawaban.')); return box; }
      const items = big ? q.texts : q.texts.slice(0, 4);
      box.append(h('ul', { class: 'textlist', style: { marginTop: '10px' } }, items.map((t) => h('li', null, t.text, t.name && h('small', null, t.name)))));
      if (!big && q.texts.length > 4) box.append(h('button', { class: 'btn sm ghost', onclick: () => { sub = 'question'; qIndex = summary.questions.indexOf(q); drawHead(); draw(); } }, `Lihat ${q.texts.length} jawaban`));
    }
    return box;
  }

  async function drawSummary() {
    if (!summary) { try { await loadSummary(); } catch (e) { clear(view); view.append(h('p', null, errMsg(e))); return; } drawHead(); }
    clear(view);
    if (!summary.total) { view.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, '📭'), h('p', null, 'Belum ada respons. Bagikan tautan pengisian untuk mulai mengumpulkan jawaban.'))); return; }
    const stats = h('div', { class: 'stats' });
    const stat = (v, l) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l));
    stats.append(stat(summary.total, summary.attempts_total > summary.total ? `Peserta (dari ${summary.attempts_total} percobaan)` : 'Total respons'));
    if (summary.scores) {
      const s = summary.scores;
      stats.append(stat(s.average === null ? '—' : `${num(s.average)}%`, 'Rata-rata nilai'), stat(s.highest === null ? '—' : `${num(s.highest)}%`, 'Tertinggi'), stat(s.lowest === null ? '—' : `${num(s.lowest)}%`, 'Terendah'),
        stat(s.median === null ? '—' : `${num(s.median)}%`, 'Median'), stat(s.std_dev === null ? '—' : num(s.std_dev), 'Simpangan baku'),
        s.pass_rate !== null && stat(`${num(s.pass_rate)}%`, 'Lulus (memenuhi nilai sertifikat)'),
        stat(s.ungraded, 'Menunggu penilaian manual'), stat(s.auto_submitted, 'Terkirim otomatis'), s.with_violations > 0 && stat(s.with_violations, 'Peserta dengan pelanggaran'));
    }
    view.append(stats);
    if (summary.policy) view.append(h('div', { class: 'small muted', style: { margin: '-6px 0 12px' } }, `Peserta yang mengulang dihitung satu kali berdasarkan kebijakan: ${{ best: 'nilai tertinggi', last: 'percobaan terakhir', first: 'percobaan pertama' }[summary.policy]}.`));
    if (summary.scores && summary.scores.count) {
      const cv = h('canvas');
      view.append(h('div', { class: 'card' }, h('h3', null, 'Distribusi nilai (%)'), h('div', { class: 'chartbox', style: { marginTop: '10px' } }, cv)));
      chart(cv, barCfg(summary.scores.histogram.map((b) => b.label), summary.scores.histogram.map((b) => b.count), false, '#0a84ff'));
    }
    if (summary.timeline.length > 1) {
      const cv = h('canvas');
      view.append(h('div', { class: 'card' }, h('h3', null, 'Respons per hari'), h('div', { class: 'chartbox sm', style: { marginTop: '10px' } }, cv)));
      chart(cv, barCfg(summary.timeline.map((t) => t.date), summary.timeline.map((t) => t.count), false, '#30d158'));
    }
    if (summary.is_quiz) view.append(itemAnalysis());
    summary.questions.forEach((q) => view.append(questionBlock(q, false)));
  }

  const LVL = { Mudah: 'g', Sedang: 'y', Sulit: 'r', 'Sangat baik': 'g', Baik: 'g', 'Perlu revisi': 'y', Buruk: 'r', 'Sangat buruk': 'r' };
  function itemAnalysis() {
    const rows = summary.questions.filter((x) => x.difficulty !== undefined && x.difficulty !== null);
    const card = h('div', { class: 'card' }, h('h3', null, 'Analisis butir soal'),
      h('p', { class: 'small muted' }, 'P = proporsi peserta yang menjawab benar (tingkat kesukaran). D = daya pembeda (kelompok atas − bawah 27%), dihitung bila ≥10 peserta. Soal dengan D rendah/negatif layak ditinjau.'));
    if (summary.reliability) card.append(h('div', { class: 'row wrap', style: { margin: '8px 0' } }, h('span', { class: 'pill blue' }, `Reliabilitas KR-20: ${num(summary.reliability.kr20)}`), h('span', { class: 'tiny muted' }, `${summary.reliability.items} soal · ${summary.reliability.respondents} peserta · ≥0,7 umumnya dianggap baik`)));
    if (!rows.length) { card.append(h('p', { class: 'small muted' }, 'Belum ada soal pilihan/isian berkunci yang dapat dianalisis.')); return card; }
    card.append(h('div', { style: { overflowX: 'auto' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Soal'), h('th', { class: 'num' }, 'P'), h('th', null, 'Kesukaran'), h('th', { class: 'num' }, 'D'), h('th', null, 'Daya pembeda'))),
      h('tbody', null, rows.map((x) => h('tr', null, h('td', null, (x.title || '(tanpa judul)').slice(0, 70)), h('td', { class: 'num' }, num(x.difficulty)), h('td', null, h('span', { class: `lvl ${LVL[x.difficulty_label] || ''}` }, x.difficulty_label)),
        h('td', { class: 'num' }, x.discrimination === null ? '—' : num(x.discrimination)), h('td', null, x.discrimination_label ? h('span', { class: `lvl ${LVL[x.discrimination_label] || ''}` }, x.discrimination_label) : h('span', { class: 'tiny muted' }, 'butuh ≥10 peserta'))))))));
    return card;
  }

  async function drawQuestion() {
    if (!summary) { try { await loadSummary(); drawHead(); } catch (e) { clear(view); view.append(h('p', null, errMsg(e))); return; } }
    clear(view);
    if (!summary.questions.length) { view.append(h('div', { class: 'empty' }, 'Belum ada pertanyaan.')); return; }
    qIndex = Math.max(0, Math.min(qIndex, summary.questions.length - 1));
    const sel = h('select', { class: 'in', onchange: (e) => { qIndex = Number(e.target.value); draw(); } }, summary.questions.map((q, i) => h('option', { value: i, selected: i === qIndex }, `${i + 1}. ${q.title || '(tanpa judul)'}`.slice(0, 90))));
    view.append(h('div', { class: 'row', style: { marginBottom: '12px' } }, h('button', { class: 'btn icon', disabled: qIndex === 0, onclick: () => { qIndex -= 1; draw(); } }, icon('back')), h('div', { class: 'grow' }, sel),
      h('button', { class: 'btn icon', disabled: qIndex === summary.questions.length - 1, onclick: () => { qIndex += 1; draw(); } }, icon('send'))), questionBlock(summary.questions[qIndex], true));
  }

  /* ---------- individual ---------- */
  let search = ''; let rows = []; let total = 0; let selected = null; let detailEl;
  async function drawIndividual() {
    clear(view);
    const listEl = h('div', { class: 'card' }); detailEl = h('div');
    const inp = h('input', { class: 'in', placeholder: 'Cari nama / email / NIM…', value: search, oninput: debounce((e) => { search = e.target.value; loadRows(true); }, 300) });
    view.append(h('div', { class: 'split' }, h('div', null, h('div', { style: { marginBottom: '10px' } }, inp), listEl), detailEl));
    const loadRows = async (reset) => {
      if (reset) { rows = []; }
      try {
        const r = await api('GET', `/api/forms/${form.id}/responses?limit=50&offset=${rows.length}&search=${encodeURIComponent(search)}`);
        rows = rows.concat(r.rows); total = r.total;
      } catch (e) { toast(errMsg(e), 'err'); }
      paintRows();
    };
    const paintRows = () => {
      clear(listEl);
      if (!rows.length) { listEl.append(h('p', { class: 'muted small', style: { textAlign: 'center' } }, 'Tidak ada respons.')); return; }
      listEl.append(h('table', { class: 't' }, h('tbody', null, rows.map((r, i) => h('tr', { class: `click ${selected === r.id ? 'sel' : ''}`, onclick: () => { selected = r.id; paintRows(); loadDetail(r.id); } },
        h('td', { style: { width: '28px', color: 'var(--muted)' } }, String(i + 1)),
        h('td', null, h('b', null, r.name || '(tanpa nama)'), h('div', { class: 'tiny muted' }, r.email || fmtDateTime(r.submitted_at))),
        h('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } }, r.attempt_no > 1 && h('span', { class: 'pill', title: 'Percobaan ke-' }, `#${r.attempt_no}`), ' ', r.violations > 0 && h('span', { class: 'pill viol', title: 'Pelanggaran anti-curang' }, `⚠ ${r.violations}`), ' ',
          form.settings.is_quiz ? h('span', { class: `pill ${r.graded ? 'blue' : 'warn'}` }, `${num(r.score)}/${num(r.max_score)}`) : null))))));
      if (rows.length < total) listEl.append(h('button', { class: 'btn sm', style: { width: '100%', marginTop: '8px' }, onclick: () => loadRows(false) }, `Muat lagi (${total - rows.length})`));
    };
    await loadRows(true);
    if (!selected && rows.length) selected = rows[0].id;
    if (selected) { paintRows(); loadDetail(selected); } else detailEl.append(h('div', { class: 'empty' }, 'Belum ada respons'));
  }

  async function loadDetail(rid) {
    clear(detailEl); detailEl.append(h('div', { class: 'spinner' }));
    let d;
    try { d = await api('GET', `/api/forms/${form.id}/responses/${rid}`); } catch (e) { clear(detailEl); detailEl.append(h('p', null, errMsg(e))); return; }
    clear(detailEl);
    const quiz = form.settings.is_quiz;
    const [stLabel, stCls] = STATUS[d.status] || [d.status, ''];
    const card = h('div', { class: 'card' });
    card.append(h('div', { class: 'row wrap', style: { alignItems: 'flex-start' } },
      h('div', { class: 'grow' }, h('h2', null, d.name || '(tanpa nama)'), h('div', { class: 'small muted' }, [d.email, d.identifier].filter(Boolean).join(' · ')), h('div', { class: 'tiny muted', style: { marginTop: '4px' } }, `Mulai ${fmtDateTime(d.started_at)} · Kirim ${fmtDateTime(d.submitted_at)}${d.attempt_no > 1 ? ` · Percobaan ke-${d.attempt_no}` : ''}`)),
      h('span', { class: `pill ${stCls}` }, stLabel),
      quiz && h('div', { class: 'stat', style: { padding: '8px 16px', boxShadow: 'none', background: 'var(--card-2)' } }, h('b', { style: { fontSize: '24px' } }, `${num(d.score)}`), h('span', null, `dari ${num(d.max_score)} poin`))));

    if (d.violations?.length) {
      const VT = { hidden: 'Berpindah tab/aplikasi', blur: 'Jendela kehilangan fokus', fullscreen: 'Keluar layar penuh' };
      card.append(h('div', { class: 'subbox', style: { marginTop: '12px' } }, h('div', { class: 'row' }, icon('warn', 16), h('b', null, `${d.violations.length} pelanggaran tercatat`)),
        h('ul', { class: 'small', style: { margin: '6px 0 0', paddingLeft: '18px' } }, d.violations.map((v) => h('li', null, `${VT[v.type] || v.type} — ${fmtDateTime(v.t)}`)))));
    }
    const gradeInputs = new Map();
    d.items.forEach((it, i) => {
      const mark = it.correct === true ? h('span', { class: 'pill ok' }, 'Benar') : it.correct === false ? h('span', { class: 'pill bad' }, 'Salah') : null;
      const row = h('div', { style: { padding: '14px 0', borderTop: '.5px solid var(--line)' } },
        h('div', { class: 'row', style: { alignItems: 'flex-start' } }, h('b', { class: 'grow' }, `${i + 1}. ${it.title || '(tanpa judul)'}`), quiz && mark, quiz && it.points_max > 0 && h('span', { class: 'pill' }, `${num(it.points)}/${num(it.points_max)}`)),
        h('div', { style: { marginTop: '6px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--card-2)', borderRadius: '12px', padding: '10px 12px' } },
          it.file_id ? h('div', { class: 'row wrap' }, icon('file', 16), h('span', { class: 'grow' }, it.answer), h('a', { class: 'btn sm', href: `/api/forms/${form.id}/files/${it.file_id}` }, icon('download', 14), 'Unduh')) : (it.answer || h('span', { class: 'muted' }, '— tidak dijawab —'))));
      if (quiz && it.manual) {
        const gi = h('input', { class: 'in', type: 'number', min: 0, max: it.points_max, step: 'any', value: it.graded_manually ? it.points : '', placeholder: '0', style: { width: '90px', padding: '6px 10px' } });
        gradeInputs.set(it.id, gi);
        row.append(h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'small muted' }, `Nilai manual (maks ${num(it.points_max)}):`), gi,
          !it.graded_manually && h('span', { class: 'pill warn' }, 'Belum dinilai')));
      }
      card.append(row);
    });
    if (gradeInputs.size) {
      card.append(h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn primary', onclick: async () => {
        const scores = {}; gradeInputs.forEach((inp, id) => { if (inp.value !== '') scores[id] = Number(inp.value); });
        if (!Object.keys(scores).length) { toast('Isi nilai dulu', 'err'); return; }
        try { const nd = await api('PATCH', `/api/forms/${form.id}/responses/${rid}/grade`, { scores }); toast(nd.cert_code && !d.cert_code ? 'Nilai disimpan · sertifikat diterbitkan' : 'Nilai disimpan'); summary = null; selected = rid; drawIndividual(); } catch (e) { toast(errMsg(e), 'err'); }
      } }, icon('check', 16), 'Simpan nilai manual')));
    }

    if (form.cert.enabled) {
      const certRow = h('div', { class: 'certbox', style: { marginTop: '14px' } }, h('div', { class: 'ico' }, icon('award', 22)));
      if (d.cert_code) {
        certRow.append(h('div', { class: 'grow' }, h('b', null, 'Sertifikat terbit'), h('div', { class: 'small muted' }, d.cert_code)),
          h('a', { class: 'btn sm', href: `/api/public/certificates/${d.cert_code}/pdf?download=1` }, icon('download', 16), 'PDF'),
          h('button', { class: 'btn sm primary', disabled: !d.email, title: d.email ? '' : 'Peserta tidak punya email', onclick: async (ev) => { ev.target.disabled = true; try { await api('POST', `/api/forms/${form.id}/responses/${rid}/certificate/email`); toast(`Terkirim ke ${d.email}`); } catch (e) { toast(errMsg(e), 'err'); } ev.target.disabled = false; } }, icon('mail', 16), 'Kirim email'));
      } else certRow.append(h('div', { class: 'grow' }, h('b', null, 'Belum ada sertifikat'), h('div', { class: 'small muted' }, d.status === 'in_progress' ? 'Peserta belum mengirim.' : !d.graded ? 'Menunggu penilaian esai.' : `Nilai di bawah batas ${form.cert.min_percent}%.`)));
      card.append(certRow);
    }
    card.append(h('div', { style: { marginTop: '14px', textAlign: 'right' } }, h('button', { class: 'btn danger sm', onclick: async () => {
      if (!await confirmDialog('Hapus respons ini?', 'Respons dan sertifikatnya akan dihapus permanen.', 'Hapus', true)) return;
      try { await api('DELETE', `/api/forms/${form.id}/responses/${rid}`); toast('Respons dihapus'); rows = rows.filter((r) => r.id !== rid); total -= 1; selected = rows[0]?.id || null; summary = null; drawIndividual(); } catch (e) { toast(errMsg(e), 'err'); }
    } }, icon('trash', 16), 'Hapus respons')));
    detailEl.append(card);
  }

  (async () => { try { await loadSummary(); } catch (e) { toast(errMsg(e), 'err'); } drawHead(); draw(); })();
  drawHead();
  return () => { alive = false; destroyCharts(); };
}
