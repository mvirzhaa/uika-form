'use strict';
/* Laporan rekap PDF: ringkasan, grafik batang, per pertanyaan, analisis butir soal. */
const PDFDocument = require('pdfkit');
const config = require('./config');

const latin = (s) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/[^ -~ -ÿ‘’“”–—]/g, '?');
const W = 595.28; const H = 841.89; const M = 48; const CW = W - M * 2;
const TYPE_ID = { short: 'Jawaban singkat', paragraph: 'Esai', radio: 'Pilihan ganda', checkbox: 'Kotak centang', dropdown: 'Dropdown', scale: 'Skala', date: 'Tanggal', time: 'Waktu', file: 'Unggah berkas', grid: 'Kisi', ranking: 'Peringkat' };

async function renderReport({ form, summary, accent = '#0071e3' }) {
  const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: `Rekap ${form.title}`, Author: config.ORG_NAME } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res, rej) => { doc.on('end', () => res(Buffer.concat(chunks))); doc.on('error', rej); });

  const need = (h) => { if (doc.y + h > H - M - 20) doc.addPage(); };
  const text = (t, o = {}) => doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.size || 10).fillColor(o.color || '#1d1d1f').text(latin(t), o.x ?? M, o.y ?? doc.y, { width: o.width || CW, align: o.align || 'left', lineGap: 2 });
  const bar = (label, count, total, color = accent, extra = '') => {
    need(18);
    const y = doc.y; const lw = 200; const bw = CW - lw - 90;
    doc.font('Helvetica').fontSize(9).fillColor('#1d1d1f').text(latin(label), M, y, { width: lw - 6, height: 12, ellipsis: true, lineBreak: false });
    doc.save().roundedRect(M + lw, y + 1, bw, 9, 3).fill('#e5e5ea').restore();
    const pct = total ? count / total : 0;
    if (pct > 0) doc.save().roundedRect(M + lw, y + 1, Math.max(3, bw * pct), 9, 3).fill(color).restore();
    doc.font('Helvetica').fontSize(8.5).fillColor('#6e6e73').text(`${count}${total ? ` (${Math.round(pct * 100)}%)` : ''}${extra}`, M + lw + bw + 8, y, { width: 82, lineBreak: false });
    doc.y = y + 15;
  };
  const stat = (x, y, label, value) => {
    doc.save().roundedRect(x, y, 118, 46, 8).fill('#f5f5f7').restore();
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#1d1d1f').text(latin(String(value)), x + 10, y + 8, { width: 98, lineBreak: false });
    doc.font('Helvetica').fontSize(8.5).fillColor('#6e6e73').text(latin(label), x + 10, y + 30, { width: 98, lineBreak: false });
  };

  // Judul
  doc.save().rect(0, 0, W, 6).fill(accent).restore();
  text('REKAP HASIL', { size: 9, color: accent, bold: true, y: 30 });
  text(form.title || 'Formulir', { size: 22, bold: true, y: 44 });
  text(`${config.ORG_NAME} · dibuat ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'short' })}`, { size: 9, color: '#6e6e73' });
  doc.moveDown(1.2);

  // Statistik utama
  let y = doc.y;
  const stats = [['Respons', summary.total]];
  if (summary.attempts_total !== summary.total) stats.push(['Total percobaan', summary.attempts_total]);
  if (summary.is_quiz && summary.scores) {
    const sc = summary.scores;
    stats.push(['Rata-rata', sc.average === null ? '-' : `${sc.average}%`], ['Tertinggi', sc.highest === null ? '-' : `${sc.highest}%`], ['Terendah', sc.lowest === null ? '-' : `${sc.lowest}%`]);
    if (sc.pass_rate !== null) stats.push(['Lulus', `${sc.pass_rate}%`]);
    if (sc.with_violations) stats.push(['Ada pelanggaran', sc.with_violations]);
    if (summary.reliability) stats.push(['Reliabilitas KR-20', summary.reliability.kr20]);
  }
  stats.slice(0, 8).forEach(([l, v], i) => stat(M + (i % 4) * 126, y + Math.floor(i / 4) * 54, l, v));
  doc.y = y + Math.ceil(Math.min(stats.length, 8) / 4) * 54 + 6;

  if (summary.is_quiz && summary.scores) {
    need(150);
    text('Distribusi nilai (%)', { bold: true, size: 12 }); doc.moveDown(0.4);
    const mx = Math.max(1, ...summary.scores.histogram.map((b) => b.count));
    const base = doc.y + 90; const bw = CW / 10;
    summary.scores.histogram.forEach((b, i) => {
      const h = (b.count / mx) * 80;
      doc.save().roundedRect(M + i * bw + 6, base - h, bw - 12, h, 3).fill(accent).restore();
      doc.font('Helvetica').fontSize(8).fillColor('#1d1d1f').text(String(b.count), M + i * bw, base - h - 11, { width: bw, align: 'center', lineBreak: false });
      doc.fillColor('#6e6e73').text(b.label, M + i * bw, base + 4, { width: bw, align: 'center', lineBreak: false });
    });
    doc.y = base + 22;
  }

  // Per pertanyaan
  doc.moveDown(0.8);
  need(40); text('Ringkasan per pertanyaan', { bold: true, size: 14 }); doc.moveDown(0.5);
  summary.questions.forEach((it, idx) => {
    need(70);
    doc.save().moveTo(M, doc.y).lineTo(W - M, doc.y).lineWidth(0.5).strokeColor('#d2d2d7').stroke().restore(); doc.moveDown(0.5);
    text(`${idx + 1}. ${it.title || '(tanpa judul)'}`, { bold: true, size: 11 });
    text(`${TYPE_ID[it.type] || it.type} · ${it.answered}/${it.shown ?? summary.total} menjawab${it.correct_rate !== undefined && it.correct_rate !== null ? ` · benar ${it.correct_rate}%` : ''}`, { size: 8.5, color: '#6e6e73' });
    doc.moveDown(0.3);
    if (it.options) it.options.forEach((o) => bar(o.text || '(kosong)', o.count, it.answered, o.correct ? '#1f8a3b' : accent, o.correct ? ' ✓' : ''));
    else if (it.distribution) { it.distribution.forEach((d) => bar(String(d.value), d.count, it.answered)); if (it.average !== null) text(`Rata-rata: ${it.average}`, { size: 9, color: '#6e6e73' }); }
    else if (it.ranking) it.ranking.forEach((r) => bar(r.text, r.first, it.answered, accent, ` · rerata peringkat ${r.avg_rank ?? '-'}`));
    else if (it.grid) it.grid.forEach((row) => { need(30); text(row.text, { size: 9, bold: true }); row.cols.forEach((c) => bar(`  ${c.text}`, c.count, it.answered)); });
    else if (it.type === 'file') text(`${it.files} berkas diunggah`, { size: 9 });
    else if (it.texts && it.texts.length) it.texts.slice(0, 5).forEach((t) => { need(14); text(`• ${String(t.text).slice(0, 160)}`, { size: 9 }); });
    doc.moveDown(0.3);
  });

  // Analisis butir
  const items = summary.questions.filter((x) => x.difficulty !== undefined && x.difficulty !== null);
  if (summary.is_quiz && items.length) {
    doc.addPage();
    text('Analisis butir soal', { bold: true, size: 14 }); doc.moveDown(0.3);
    text('Tingkat kesukaran (P) = proporsi peserta yang menjawab benar. Daya pembeda (D) = selisih proporsi benar kelompok atas dan bawah (27%); dihitung bila peserta ≥ 10.', { size: 8.5, color: '#6e6e73' });
    doc.moveDown(0.6);
    const cols = [30, 230, 50, 70, 50, 70]; const xs = []; let acc = M; for (const c of cols) { xs.push(acc); acc += c; }
    const row = (cells, o = {}) => {
      need(20); const y0 = doc.y;
      if (o.head) doc.save().rect(M, y0 - 3, CW, 16).fill('#f5f5f7').restore();
      cells.forEach((c, i) => doc.font(o.head ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('#1d1d1f').text(latin(String(c)), xs[i], y0, { width: cols[i] - 4, height: 11, ellipsis: true, lineBreak: false }));
      doc.y = y0 + 17;
    };
    row(['No', 'Soal', 'P', 'Tingkat', 'D', 'Daya beda'], { head: true });
    items.forEach((it, i) => row([i + 1, it.title || '(tanpa judul)', it.difficulty, it.difficulty_label, it.discrimination ?? '-', it.discrimination_label ?? '-']));
    if (summary.reliability) { doc.moveDown(0.8); text(`Reliabilitas (KR-20): ${summary.reliability.kr20} — ${summary.reliability.items} butir, ${summary.reliability.respondents} peserta`, { size: 9 }); }
  }

  // nomor halaman
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(8).fillColor('#8e8e93').text(`Halaman ${i + 1} dari ${range.count}`, M, H - 32, { width: CW, align: 'center', lineBreak: false });
  }
  doc.end();
  return done;
}

module.exports = { renderReport };
