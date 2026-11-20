'use strict';
/* Membuat berkas SQL yang memasukkan "Kuesioner Pra-Penelitian untuk Dosen" ke database UIKA Form.
   Pemakaian:  node scripts/seed-kuesioner-dosen.js [--owner email@uika-bogor.ac.id] [--status published|draft] [--out seeds/kuesioner-pra-dosen.sql]
   Data dinormalisasi lewat schema.js yang sama dengan aplikasi, jadi hasilnya identik dengan form yang dibuat di Editor. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const schema = require('../src/schema');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const OWNER = arg('owner', 'GANTI_DENGAN_EMAIL_AKUN_ANDA@uika-bogor.ac.id');
const STATUS = ['draft', 'published', 'closed'].includes(arg('status')) ? arg('status') : 'published';
const OUT = path.resolve(arg('out', path.join(__dirname, '..', 'seeds', 'kuesioner-pra-dosen.sql')));
const SLUG = 'kuesioner-dosen-esai';

/** UUID tetap (turunan nama) → skrip aman dijalankan ulang & pertanyaan punya id stabil. */
const uid = (name) => {
  const h = crypto.createHash('sha1').update(`uika-form/kuesioner-pra-dosen/${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
};

const TITLE = 'Kuesioner Pra-Penelitian untuk Dosen: Koreksi Manual Ujian Esai pada Beberapa Kelas dalam Satu Mata Kuliah';
const DESC = 'Kuesioner ini bertujuan untuk mengetahui proses dan beban koreksi manual ujian esai yang dilakukan dosen, khususnya pada mata kuliah yang diampu di lebih dari satu kelas. Jawaban digunakan sebagai data pendukung latar belakang skripsi berjudul “Pengembangan Fitur CBT Auto-Grading pada Aplikasi UCL UIKA Berbantuan Google LLM”. Identitas responden dijaga kerahasiaannya.';

const radio = (key, title, opts) => ({
  id: uid(key), type: 'radio', title, required: true,
  options: opts.map((t, i) => ({ id: `${key}_${i + 1}`, text: t })),
});

const raw = [
  { id: uid('sec-identitas'), type: 'section', title: 'Identitas Responden', description: 'Isilah berdasarkan satu mata kuliah yang Bapak/Ibu ampu di lebih dari satu kelas dan menggunakan ujian esai (UTS/UAS) pada semester terakhir.' },
  { id: uid('nama'), type: 'short', title: 'Nama (boleh dikosongkan)' },
  { id: uid('prodi'), type: 'short', title: 'Program Studi', required: true },
  { id: uid('lama'), type: 'short', title: 'Lama mengajar', description: 'Contoh: 5 tahun', required: true },
  { id: uid('matkul'), type: 'short', title: 'Mata kuliah acuan', required: true },

  { id: uid('sec-a'), type: 'section', title: 'Bagian A. Gambaran Koreksi Ujian Esai', description: 'Pilih satu jawaban yang paling sesuai.' },
  radio('a1', 'A1. Berapa jumlah kelas yang Bapak/Ibu ampu untuk mata kuliah tersebut?', ['1 kelas', '2 kelas', '3 kelas', '4 kelas', '> 4 kelas']),
  radio('a2', 'A2. Berapa rata-rata jumlah mahasiswa per kelas?', ['< 30', '30–40', '41–50', '51–60', '> 60']),
  radio('a3', 'A3. Berapa jumlah soal esai dalam satu kali ujian?', ['1–2 soal', '3–5 soal', '6–10 soal', '> 10 soal']),
  radio('a4', 'A4. Berapa total lembar jawaban esai yang dikoreksi untuk mata kuliah tersebut dalam satu periode ujian (seluruh kelas)?', ['< 50', '50–100', '101–150', '151–200', '> 200']),
  radio('a5', 'A5. Berapa rata-rata waktu untuk mengoreksi satu lembar jawaban esai?', ['< 5 menit', '5–10 menit', '11–20 menit', '> 20 menit']),
  radio('a6', 'A6. Berapa lama waktu yang dibutuhkan sampai koreksi seluruh kelas selesai dan nilai diumumkan?', ['< 1 minggu', '1–2 minggu', '2–3 minggu', '> 3 minggu']),
  radio('a7', 'A7. Apakah Bapak/Ibu menggunakan rubrik penilaian tertulis saat mengoreksi esai?', ['Selalu', 'Kadang-kadang', 'Tidak pernah']),
  radio('a8', 'A8. Bentuk umpan balik apa yang biasanya Bapak/Ibu berikan kepada mahasiswa?', ['Nilai saja', 'Nilai dan catatan singkat', 'Nilai dan pembahasan jawaban']),

  { id: uid('sec-b'), type: 'section', title: 'Bagian B. Pendapat tentang Koreksi Esai Manual', description: 'Pilih satu kolom yang paling sesuai pada setiap pernyataan. Keterangan: STS = Sangat Tidak Setuju (1); TS = Tidak Setuju (2); N = Netral (3); S = Setuju (4); SS = Sangat Setuju (5).' },
  {
    id: uid('b'), type: 'grid', title: 'Seberapa setuju Bapak/Ibu dengan pernyataan berikut?', required: true,
    config: {
      multi: false,
      cols: ['STS (1)', 'TS (2)', 'N (3)', 'S (4)', 'SS (5)'].map((t, i) => ({ id: `c${i + 1}`, text: t })),
      rows: [
        'B1. Mengoreksi ujian esai dari beberapa kelas dalam satu mata kuliah merupakan beban kerja yang berat.',
        'B2. Koreksi ujian esai sering tertunda karena bersamaan dengan tugas lain (mengajar, penelitian, bimbingan, dan administrasi).',
        'B3. Saya sulit menjaga konsistensi penilaian antara lembar jawaban yang dikoreksi di awal dan di akhir.',
        'B4. Saya sulit menjaga keseragaman standar penilaian antarkelas pada mata kuliah yang sama.',
        'B5. Kelelahan saat mengoreksi dalam jumlah besar memengaruhi ketelitian penilaian saya.',
        'B6. Saya jarang memiliki waktu untuk memberikan umpan balik rinci kepada setiap mahasiswa.',
        'B7. Sistem yang memberikan skor awal jawaban esai secara otomatis akan membantu pekerjaan saya.',
        'B8. Saya bersedia menggunakan skor rekomendasi dari AI selama saya tetap memeriksa dan menetapkan nilai akhir.',
      ].map((t, i) => ({ id: `b${i + 1}`, text: t })),
    },
  },

  { id: uid('sec-c'), type: 'section', title: 'Bagian C. Pertanyaan Terbuka' },
  { id: uid('c1'), type: 'paragraph', title: 'C1. Kendala apa yang paling sering Bapak/Ibu hadapi saat mengoreksi ujian esai dari beberapa kelas?' },
  { id: uid('c2'), type: 'paragraph', title: 'C2. Apa syarat atau harapan Bapak/Ibu jika penilaian esai dibantu oleh sistem otomatis (AI)?' },
];
const questions = raw.map((x, i) => schema.cleanQuestion(x, i));

const settings = schema.cleanSettings({
  is_quiz: false, identity: 'none', one_response: false, number_questions: false,
  confirmation_message: 'Terima kasih atas kesediaan Bapak/Ibu mengisi kuesioner ini.',
});
const theme = schema.cleanTheme({});
const cert = schema.cleanCert({ enabled: false }, settings);

/** Literal teks aman lewat dollar-quoting (tanpa perlu escape tanda kutip). */
const lit = (s) => { const t = String(s); if (t.includes('$q$')) throw new Error('teks memuat $q$'); return `$q$${t}$q$`; };
const sq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const jb = (o) => `${lit(JSON.stringify(o))}::jsonb`;

const rows = questions.map((x) => `    (${lit(x.id)}::uuid, v_form, ${x.position}, ${lit(x.type)}, ${lit(x.title)}, ${lit(x.description)}, ${x.required}, ${jb(x.options)}, ${jb(x.correct)}, ${x.points}, ${jb(x.config)})`).join(',\n');

const sql = `-- =====================================================================
-- UIKA Form — seed: ${TITLE}
-- Dibuat otomatis oleh scripts/seed-kuesioner-dosen.js
--
-- CARA PAKAI
--   1. Pastikan pemilik form SUDAH PERNAH login ke UIKA Form (agar ada di tabel users).
--   2. Ubah owner_email (dan status bila perlu) di baris "CREATE TEMP TABLE" di bawah.
--   3. Jalankan:  psql "$DATABASE_URL" -f kuesioner-pra-dosen.sql
--      (atau tempel ke DBeaver / pgAdmin / psql — tidak butuh variabel psql)
--
-- Aman dijalankan ulang: bila form dengan slug '${SLUG}' sudah ada, tidak ada yang diubah.
-- Isi: 4 isian identitas + 8 soal pilihan (A1–A8) + kisi skala B1–B8 + 2 soal terbuka (C1–C2).
-- Tautan pengisian setelah terbit:  <BASE_URL>/s/${SLUG}
-- =====================================================================
BEGIN;

CREATE TEMP TABLE _seed_cfg ON COMMIT DROP AS
  SELECT ${sq(OWNER)}::text   AS owner_email,   -- <== GANTI: email akun pemilik form (akun E-Portal)
         ${sq(STATUS)}::text AS status;         -- 'published' = langsung bisa diisi, 'draft' = periksa dulu di Editor

DO $seed$
DECLARE
  v_owner uuid;
  v_form  uuid := ${lit(uid('form'))}::uuid;
  v_email text := (SELECT owner_email FROM _seed_cfg);
BEGIN
  SELECT id INTO v_owner FROM users WHERE lower(email) = lower(v_email);
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Pengguna dengan email % belum ada di tabel users. Login sekali ke UIKA Form dengan akun tersebut, atau ubah owner_email.', v_email;
  END IF;

  IF EXISTS (SELECT 1 FROM forms WHERE slug = ${lit(SLUG)} OR id = v_form) THEN
    RAISE NOTICE 'Form ${SLUG} sudah ada — dilewati (tidak ada perubahan).';
    RETURN;
  END IF;

  INSERT INTO forms (id, owner_id, slug, title, description, status, theme, settings, cert)
  VALUES (v_form, v_owner, ${lit(SLUG)}, ${lit(TITLE)}, ${lit(DESC)},
          (SELECT status FROM _seed_cfg), ${jb(theme)}, ${jb(settings)}, ${jb(cert)});

  INSERT INTO questions (id, form_id, position, type, title, description, required, options, correct, points, config) VALUES
${rows};

  RAISE NOTICE 'Form "%" dibuat untuk % (%). Tautan: /s/${SLUG}', ${lit(TITLE.slice(0, 40) + '…')}, v_email, ${lit(`${questions.filter((x) => x.type !== 'section').length} pertanyaan + ${questions.filter((x) => x.type === 'section').length} judul bagian`)};
END
$seed$;

COMMIT;
`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, sql);
console.log(`Tertulis: ${OUT} (${questions.length} entri, ${questions.filter((x) => x.type !== 'section').length} pertanyaan)`);
