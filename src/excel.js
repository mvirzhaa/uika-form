'use strict';
const ExcelJS = require('exceljs');
const { cleanQuestion, newId } = require('./schema');
const { answerText } = require('./grading');

const TYPE_LABELS = {
  short: 'Jawaban Singkat', paragraph: 'Paragraf / Esai', radio: 'Pilihan Ganda', checkbox: 'Kotak Centang',
  dropdown: 'Dropdown', scale: 'Skala Linear', date: 'Tanggal', time: 'Waktu', section: 'Bagian / Judul',
  file: 'Unggah Berkas', ranking: 'Peringkat',
};
const TYPE_ALIASES = {
  short: 'short', 'jawaban singkat': 'short', singkat: 'short', isian: 'short', isian_singkat: 'short', 'short answer': 'short',
  paragraph: 'paragraph', paragraf: 'paragraph', esai: 'paragraph', essay: 'paragraph', 'paragraf / esai': 'paragraph', uraian: 'paragraph',
  radio: 'radio', 'pilihan ganda': 'radio', pg: 'radio', 'multiple choice': 'radio',
  checkbox: 'checkbox', 'kotak centang': 'checkbox', 'pilihan jamak': 'checkbox', checkboxes: 'checkbox',
  dropdown: 'dropdown', 'drop-down': 'dropdown', 'daftar pilihan': 'dropdown',
  scale: 'scale', 'skala linear': 'scale', skala: 'scale', 'linear scale': 'scale',
  date: 'date', tanggal: 'date', time: 'time', waktu: 'time',
  section: 'section', 'bagian / judul': 'section', bagian: 'section', judul: 'section',
  file: 'file', 'unggah berkas': 'file', berkas: 'file', upload: 'file', 'file upload': 'file',
  ranking: 'ranking', peringkat: 'ranking', urutan: 'ranking',
};
const MAX_OPTS = 8;
const HEAD = ['Tipe', 'Pertanyaan', 'Deskripsi (opsional)', 'Wajib (ya/tidak)',
  ...Array.from({ length: MAX_OPTS }, (_, i) => `Opsi ${i + 1}`), 'Kunci Jawaban', 'Poin'];

const BLUE = 'FF0071E3';
function styleHeader(ws) {
  const r = ws.getRow(1);
  r.height = 26;
  r.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

const SURVEY_ROWS = [
  ['Bagian / Judul', 'Data Diri', 'Bagian ini berisi identitas responden', '', ...Array(MAX_OPTS).fill(''), '', ''],
  ['Jawaban Singkat', 'Nama lengkap', 'Tulis sesuai KTM', 'ya', ...Array(MAX_OPTS).fill(''), '', ''],
  ['Dropdown', 'Fakultas', '', 'ya', 'Teknik', 'Ekonomi dan Bisnis', 'Hukum', 'Pertanian', 'Ilmu Sosial dan Politik', '', '', '', '', ''],
  ['Pilihan Ganda', 'Seberapa sering Anda menggunakan layanan kampus daring?', 'Pilih salah satu', 'ya', 'Setiap hari', 'Beberapa kali seminggu', 'Jarang', 'Tidak pernah', '', '', '', '', '', ''],
  ['Kotak Centang', 'Fasilitas mana yang pernah Anda gunakan?', 'Boleh lebih dari satu', 'tidak', 'Perpustakaan', 'Wi-Fi kampus', 'Laboratorium', 'Masjid', 'Kantin', '', '', '', '', ''],
  ['Skala Linear', 'Seberapa puas Anda dengan layanan akademik?', '', 'ya', '1', '5', 'Sangat tidak puas', 'Sangat puas', '', '', '', '', '', ''],
  ['Tanggal', 'Tanggal Anda mengikuti kegiatan', '', 'tidak', ...Array(MAX_OPTS).fill(''), '', ''],
  ['Waktu', 'Jam kedatangan', '', 'tidak', ...Array(MAX_OPTS).fill(''), '', ''],
  ['Peringkat', 'Urutkan materi berdasarkan yang paling Anda butuhkan', 'Peserta mengurutkan opsi dari yang terpenting', 'tidak', 'Pemrograman web', 'Basis data', 'Keamanan siber', 'Kecerdasan buatan', '', '', '', '', '', ''],
  ['Unggah Berkas', 'Unggah bukti kehadiran (PDF/PNG/JPG, maks 5 MB)', '', 'tidak', ...Array(MAX_OPTS).fill(''), '', ''],
  ['Paragraf / Esai', 'Saran dan masukan untuk kegiatan ini', 'Jawab dengan kalimat Anda sendiri', 'tidak', ...Array(MAX_OPTS).fill(''), '', ''],
];
const QUIZ_ROWS = [
  ['Bagian / Judul', 'Bagian A — Pilihan Ganda', 'Pilih satu jawaban yang paling tepat', '', ...Array(MAX_OPTS).fill(''), '', ''],
  ['Pilihan Ganda', 'Ibu kota Indonesia saat ini (2026) adalah…', '', 'ya', 'Jakarta', 'Bandung', 'Surabaya', 'Medan', '', '', '', '', '2', 10],
  ['Pilihan Ganda', 'Hasil dari 12 × 12 adalah…', '', 'ya', '124', '144', '154', '164', '', '', '', '', '2', 10],
  ['Dropdown', 'Bahasa pemrograman untuk halaman web di sisi browser adalah…', '', 'ya', 'Python', 'JavaScript', 'Java', 'C#', '', '', '', '', 'JavaScript', 10],
  ['Bagian / Judul', 'Bagian B — Jawaban Jamak', '', '', ...Array(MAX_OPTS).fill(''), '', ''],
  ['Kotak Centang', 'Pilih semua bilangan prima', 'Kunci boleh lebih dari satu: pisahkan dengan koma', 'ya', '2', '4', '5', '9', '11', '', '', '', '1,3,5', 15],
  ['Bagian / Judul', 'Bagian C — Isian & Esai', '', '', ...Array(MAX_OPTS).fill(''), '', ''],
  ['Jawaban Singkat', 'Siapa presiden pertama Republik Indonesia?', 'Beberapa kunci diterima: pisahkan dengan tanda |', 'ya', ...Array(MAX_OPTS).fill(''), 'Soekarno|Ir. Soekarno|Bung Karno', 10],
  ['Skala Linear', 'Pilih angka 3 (contoh skala dengan kunci)', '', 'tidak', '1', '5', 'Kecil', 'Besar', '', '', '', '', '3', 5],
  ['Paragraf / Esai', 'Jelaskan secara singkat manfaat belajar pemrograman.', 'Esai dinilai manual oleh pembuat kuis (maksimum = poin)', 'ya', ...Array(MAX_OPTS).fill(''), '', 20],
];

function instructionSheet(wb, kind) {
  const ws = wb.addWorksheet('Petunjuk');
  ws.columns = [{ width: 28 }, { width: 100 }];
  const rows = [
    [kind === 'quiz' ? 'Template Kuis / Ujian — UIKA Form' : 'Template Formulir / Survei — UIKA Form', ''],
    ['', ''],
    ['Cara pakai', 'Isi sheet "Soal" — satu baris = satu pertanyaan. Simpan sebagai .xlsx lalu unggah lewat Editor → Pertanyaan → Impor Excel.'],
    ['Kolom Tipe', 'Pilih dari daftar: ' + Object.values(TYPE_LABELS).join(' | ')],
    ['Kolom Pertanyaan', 'Teks pertanyaan atau judul bagian. Wajib diisi.'],
    ['Wajib', '"ya" atau "tidak" (kosong = tidak).'],
    ['Opsi 1 … Opsi 8', 'Untuk Pilihan Ganda, Kotak Centang, dan Dropdown: satu pilihan per kolom. Kolom kosong diabaikan.'],
    ['Skala Linear', 'Opsi 1 = angka awal (0 atau 1), Opsi 2 = angka akhir (2–10), Opsi 3 = label kiri, Opsi 4 = label kanan.'],
    ['Kunci Jawaban', 'Pilihan Ganda/Dropdown: nomor opsi (mis. 2) atau teks opsi. Kotak Centang: beberapa nomor dipisah koma (mis. 1,3). Jawaban Singkat: boleh beberapa jawaban benar dipisah tanda | . Skala: angka. Esai: dikosongkan (dinilai manual).'],
    ['Poin', 'Angka poin per soal (kuis). Kosong atau 0 = tidak dinilai. Untuk survei biasa, kosongkan kunci dan poin.'],
    ['Peringkat', 'Isi Opsi 1…8: peserta mengurutkan semua opsi. Tidak dinilai otomatis.'],
    ['Unggah Berkas', 'Peserta mengunggah satu berkas (PDF, PNG/JPG, atau dokumen Office, maks 5 MB). Di kuis dapat diberi poin dan dinilai manual seperti esai.'],
    ['Tanggal / Waktu', 'Tidak butuh opsi; peserta memilih lewat pemilih tanggal/jam.'],
    ['Kisi / Percabangan', 'Tipe Kisi (grid) dan logika percabangan diatur langsung di Editor, tidak lewat Excel.'],
    ['Bagian / Judul', 'Baris judul untuk mengelompokkan pertanyaan (tidak diisi peserta).'],
    ['Catatan', 'Pengaturan tampilan, durasi kuis, dan sertifikat diatur di aplikasi (tab Tampilan, Pengaturan, Sertifikat).'],
  ];
  rows.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true, size: 16, color: { argb: BLUE } };
  ws.getColumn(1).font = { bold: true };
  ws.eachRow((r) => { r.alignment = { vertical: 'top', wrapText: true }; });
}

async function buildTemplate(kind) {
  const quiz = kind === 'quiz';
  const wb = new ExcelJS.Workbook();
  wb.creator = 'UIKA Form';
  const ws = wb.addWorksheet('Soal');
  ws.addRow(HEAD);
  (quiz ? QUIZ_ROWS : SURVEY_ROWS).forEach((r) => ws.addRow(r));
  ws.columns = [{ width: 18 }, { width: 52 }, { width: 38 }, { width: 14 },
    ...Array.from({ length: MAX_OPTS }, () => ({ width: 18 })), { width: 30 }, { width: 8 }];
  styleHeader(ws);
  ws.eachRow((r, i) => { if (i > 1) r.alignment = { vertical: 'top', wrapText: true }; });
  for (let i = 2; i <= 200; i += 1) {
    ws.getCell(`A${i}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${Object.values(TYPE_LABELS).join(',')}"`] };
    ws.getCell(`D${i}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"ya,tidak"'] };
  }
  instructionSheet(wb, kind);
  return wb.xlsx.writeBuffer();
}

const cellText = (c) => {
  const v = c?.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text) return String(v.text);
    if (v.result !== undefined) return String(v.result);
    if (v instanceof Date) return v.toISOString();
  }
  return String(v);
};

/** Baca file Excel → daftar pertanyaan (sudah disanitasi) + peringatan. */
async function parseQuestions(buffer, startPos = 0) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Soal') || wb.worksheets[0];
  if (!ws) throw new Error('sheet "Soal" tidak ditemukan');
  const out = [];
  const warnings = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const typeRaw = cellText(row.getCell(1)).trim().toLowerCase();
    const title = cellText(row.getCell(2)).trim();
    if (!typeRaw && !title) return;
    const type = TYPE_ALIASES[typeRaw];
    if (!type) { warnings.push(`Baris ${n}: tipe "${typeRaw}" tidak dikenali, dilewati`); return; }
    if (!title) { warnings.push(`Baris ${n}: pertanyaan kosong, dilewati`); return; }
    const desc = cellText(row.getCell(3)).trim();
    const req = ['ya', 'y', 'yes', 'true', '1', 'wajib'].includes(cellText(row.getCell(4)).trim().toLowerCase());
    const opts = [];
    for (let i = 0; i < MAX_OPTS; i += 1) opts.push(cellText(row.getCell(5 + i)).trim());
    const keyRaw = cellText(row.getCell(5 + MAX_OPTS)).trim();
    const points = Number(cellText(row.getCell(6 + MAX_OPTS)).replace(',', '.')) || 0;

    const raw = { id: newId(), type, title, description: desc, required: req, points, options: [], correct: [], config: {} };
    if (type === 'ranking') {
      const texts = opts.filter(Boolean);
      if (texts.length < 2) { warnings.push(`Baris ${n}: peringkat butuh minimal 2 opsi, dilewati`); return; }
      raw.options = texts.map((t, i) => ({ id: `o${i + 1}`, text: t })); raw.points = 0;
    } else if (['radio', 'checkbox', 'dropdown'].includes(type)) {
      const texts = opts.filter(Boolean);
      if (texts.length < 1) { warnings.push(`Baris ${n}: tidak ada opsi, dilewati`); return; }
      raw.options = texts.map((t, i) => ({ id: `o${i + 1}`, text: t }));
      const parts = keyRaw ? keyRaw.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : [];
      const ids = [];
      for (const p of parts) {
        if (/^\d+$/.test(p) && raw.options[Number(p) - 1]) ids.push(raw.options[Number(p) - 1].id);
        else {
          const hit = raw.options.find((o) => o.text.toLowerCase() === p.toLowerCase());
          if (hit) ids.push(hit.id); else warnings.push(`Baris ${n}: kunci "${p}" tidak cocok dengan opsi`);
        }
      }
      raw.correct = ids;
      if (!keyRaw && points > 0) warnings.push(`Baris ${n}: poin diisi tetapi kunci jawaban kosong (tidak dinilai)`);
    } else if (type === 'scale') {
      const min = Number(opts[0]) === 0 ? 0 : 1;
      const max = Number(opts[1]) >= 2 ? Number(opts[1]) : 5;
      raw.config = { min, max, min_label: opts[2] || '', max_label: opts[3] || '' };
      if (keyRaw) raw.correct = [keyRaw];
    } else if (type === 'short') {
      raw.correct = keyRaw ? keyRaw.split('|').map((s) => s.trim()).filter(Boolean) : [];
    }
    out.push(cleanQuestion(raw, startPos + out.length));
  });
  if (!out.length) throw new Error('tidak ada pertanyaan yang bisa dibaca dari sheet "Soal"');
  return { questions: out, warnings };
}

/** Ekspor respons ke Excel. extra: { files: {id:nama}, violations: {respId:n}, checkins: [] } */
async function buildResponsesWorkbook(form, questions, responses, extra = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'UIKA Form';
  const ws = wb.addWorksheet('Respons');
  const qs = questions.filter((x) => x.type !== 'section');
  const quiz = !!form.settings?.is_quiz;
  const anti = !!form.settings?.anticheat?.enabled;
  const head = ['No', 'Percobaan', 'Mulai', 'Dikirim', 'Status', 'Nama', 'Email', 'NIM/NIP', ...(quiz ? ['Nilai', 'Maks', 'Persen'] : []), ...(anti ? ['Pelanggaran'] : []),
    ...qs.map((x) => x.title || '(tanpa judul)')];
  ws.addRow(head);
  const dt = (d) => (d ? new Date(d).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }) : '');
  responses.forEach((r, i) => {
    const pct = Number(r.max_score) > 0 ? Math.round((Number(r.score) / Number(r.max_score)) * 1000) / 10 : '';
    ws.addRow([
      i + 1, r.attempt_no || 1, dt(r.started_at), dt(r.submitted_at),
      { submitted: 'Terkirim', auto_submitted: 'Terkirim otomatis (waktu habis / pelanggaran)', in_progress: 'Belum selesai' }[r.status] || r.status,
      r.name, r.email, r.identifier,
      ...(quiz ? [Number(r.score), Number(r.max_score), pct] : []),
      ...(anti ? [Array.isArray(r.violations) ? r.violations.length : 0] : []),
      ...qs.map((x) => answerText(x, r.answers[x.id], { files: extra.files })),
    ]);
  });
  styleHeader(ws);
  ws.columns.forEach((c, i) => { c.width = i < 8 ? 20 : 28; });
  if (extra.checkins) {
    const wc = wb.addWorksheet('Kehadiran');
    wc.addRow(['No', 'Waktu absen', 'Nama', 'Email', 'NIM/NIP']);
    extra.checkins.forEach((c, i) => wc.addRow([i + 1, dt(c.created_at), c.name, c.email, c.identifier]));
    styleHeader(wc); wc.columns.forEach((c) => { c.width = 26; });
  }
  return wb.xlsx.writeBuffer();
}

module.exports = { buildTemplate, parseQuestions, buildResponsesWorkbook, TYPE_LABELS };
