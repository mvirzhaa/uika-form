-- =====================================================================
-- UIKA Form — seed: Kuesioner Pra-Penelitian untuk Dosen: Koreksi Manual Ujian Esai pada Beberapa Kelas dalam Satu Mata Kuliah
-- Dibuat otomatis oleh scripts/seed-kuesioner-dosen.js
--
-- CARA PAKAI
--   1. Pastikan pemilik form SUDAH PERNAH login ke UIKA Form (agar ada di tabel users).
--   2. Ubah owner_email (dan status bila perlu) di baris "CREATE TEMP TABLE" di bawah.
--   3. Jalankan:  psql "$DATABASE_URL" -f kuesioner-pra-dosen.sql
--      (atau tempel ke DBeaver / pgAdmin / psql — tidak butuh variabel psql)
--
-- Aman dijalankan ulang: bila form dengan slug 'kuesioner-dosen-esai' sudah ada, tidak ada yang diubah.
-- Isi: 4 isian identitas + 8 soal pilihan (A1–A8) + kisi skala B1–B8 + 2 soal terbuka (C1–C2).
-- Tautan pengisian setelah terbit:  <BASE_URL>/s/kuesioner-dosen-esai
-- =====================================================================
BEGIN;

CREATE TEMP TABLE _seed_cfg ON COMMIT DROP AS
  SELECT 'GANTI_DENGAN_EMAIL_AKUN_ANDA@uika-bogor.ac.id'::text   AS owner_email,   -- <== GANTI: email akun pemilik form (akun E-Portal)
         'published'::text AS status;         -- 'published' = langsung bisa diisi, 'draft' = periksa dulu di Editor

DO $seed$
DECLARE
  v_owner uuid;
  v_form  uuid := $q$757f0272-8371-5d83-936a-c24a03c86fed$q$::uuid;
  v_email text := (SELECT owner_email FROM _seed_cfg);
  v_actual_email text;
BEGIN
  SELECT id, email INTO v_owner, v_actual_email FROM users WHERE lower(email) = lower(v_email);
  IF v_owner IS NULL THEN
    -- Fallback: gunakan akun admin pertama atau akun terdaftar pertama di database
    SELECT id, email INTO v_owner, v_actual_email FROM users ORDER BY (role = 'admin') DESC, id ASC LIMIT 1;
    IF v_owner IS NOT NULL THEN
      RAISE NOTICE 'owner_email (%) tidak ditemukan, otomatis memakai akun: %', v_email, v_actual_email;
    END IF;
  END IF;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Belum ada pengguna terdaftar di tabel users. Silakan login ke UIKA Form sekali terlebih dahulu.';
  END IF;

  IF EXISTS (SELECT 1 FROM forms WHERE slug = $q$kuesioner-dosen-esai$q$ OR id = v_form) THEN
    RAISE NOTICE 'Form kuesioner-dosen-esai sudah ada — dilewati (tidak ada perubahan).';
    RETURN;
  END IF;

  INSERT INTO forms (id, owner_id, slug, title, description, status, theme, settings, cert)
  VALUES (v_form, v_owner, $q$kuesioner-dosen-esai$q$, $q$Kuesioner Pra-Penelitian untuk Dosen: Koreksi Manual Ujian Esai pada Beberapa Kelas dalam Satu Mata Kuliah$q$, $q$Kuesioner ini bertujuan untuk mengetahui proses dan beban koreksi manual ujian esai yang dilakukan dosen, khususnya pada mata kuliah yang diampu di lebih dari satu kelas. Jawaban digunakan sebagai data pendukung latar belakang skripsi berjudul “Pengembangan Fitur CBT Auto-Grading pada Aplikasi UCL UIKA Berbantuan Google LLM”. Identitas responden dijaga kerahasiaannya.$q$,
          (SELECT status FROM _seed_cfg), $q${"color":"#0071e3","bg":"#f2f2f7","header_style":"gradient","header_image":null,"font":"system","mode":"light"}$q$::jsonb, $q${"is_quiz":false,"duration_min":0,"identity":"none","one_response":false,"shuffle_questions":false,"shuffle_options":false,"show_score":"immediately","show_answers":false,"confirmation_message":"Terima kasih atas kesediaan Bapak/Ibu mengisi kuesioner ini.","open_at":null,"close_at":null,"allowlist":{"enabled":false,"require_login":false},"max_attempts":0,"score_policy":"best","pick_count":0,"anticheat":{"enabled":false,"max_violations":3,"block_copy":true,"fullscreen":false},"attendance":{"enabled":false,"require_for_cert":false},"notify_owner":false,"confirm_email":false,"allow_embed":false,"language":"id","number_questions":false}$q$::jsonb, $q${"enabled":false,"title":"SERTIFIKAT","subtitle":"Diberikan kepada","body":"atas partisipasinya sebagai peserta dalam kegiatan","organizer":"Universitas Ibn Khaldun Bogor","signer_name":"","signer_title":"","accent":"#0071e3","bg_color":"#ffffff","bg_image":null,"signature_image":null,"sponsors":{"tl":null,"tr":null,"br":null},"min_percent":60,"auto_email":false,"template":"classic","number_format":"","number_start":1,"event_text":"“{{judul}}”","footer":"","place":"Bogor","sponsor_label":"Didukung oleh","logo_image":null,"layout":null}$q$::jsonb);

  INSERT INTO questions (id, form_id, position, type, title, description, required, options, correct, points, config) VALUES
    ($q$4e1f7bd2-bd5d-5ce7-9d47-3be6b231515f$q$::uuid, v_form, 0, $q$section$q$, $q$Identitas Responden$q$, $q$Isilah berdasarkan satu mata kuliah yang Bapak/Ibu ampu di lebih dari satu kelas dan menggunakan ujian esai (UTS/UAS) pada semester terakhir.$q$, false, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$1344c88f-3001-5a76-b43c-2bf2b107e8ac$q$::uuid, v_form, 1, $q$short$q$, $q$Nama (boleh dikosongkan)$q$, $q$$q$, false, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$40395ba6-4cab-51c6-85b8-a12e532b9482$q$::uuid, v_form, 2, $q$short$q$, $q$Program Studi$q$, $q$$q$, true, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$f9821e15-efaa-5624-92bb-07b267b05d09$q$::uuid, v_form, 3, $q$short$q$, $q$Lama mengajar$q$, $q$Contoh: 5 tahun$q$, true, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$0ab14915-a007-5ea8-86f7-99f1bd30c44e$q$::uuid, v_form, 4, $q$short$q$, $q$Mata kuliah acuan$q$, $q$$q$, true, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$0a024bbc-4d91-5412-a80d-03469b6da7a6$q$::uuid, v_form, 5, $q$section$q$, $q$Bagian A. Gambaran Koreksi Ujian Esai$q$, $q$Pilih satu jawaban yang paling sesuai.$q$, false, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$608d6766-07f4-5261-b473-1fa3d3d2f76b$q$::uuid, v_form, 6, $q$radio$q$, $q$A1. Berapa jumlah kelas yang Bapak/Ibu ampu untuk mata kuliah tersebut?$q$, $q$$q$, true, $q$[{"id":"a1_1","text":"1 kelas"},{"id":"a1_2","text":"2 kelas"},{"id":"a1_3","text":"3 kelas"},{"id":"a1_4","text":"4 kelas"},{"id":"a1_5","text":"> 4 kelas"}]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$b58c5455-9f1e-5e4b-9eee-0c7aabb8e26d$q$::uuid, v_form, 7, $q$radio$q$, $q$A2. Berapa rata-rata jumlah mahasiswa per kelas?$q$, $q$$q$, true, $q$[{"id":"a2_1","text":"< 30"},{"id":"a2_2","text":"30–40"},{"id":"a2_3","text":"41–50"},{"id":"a2_4","text":"51–60"},{"id":"a2_5","text":"> 60"}]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$e270918a-6a96-50be-905c-8e47d107b0fb$q$::uuid, v_form, 8, $q$radio$q$, $q$A3. Berapa jumlah soal esai dalam satu kali ujian?$q$, $q$$q$, true, $q$[{"id":"a3_1","text":"1–2 soal"},{"id":"a3_2","text":"3–5 soal"},{"id":"a3_3","text":"6–10 soal"},{"id":"a3_4","text":"> 10 soal"}]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$b31ace1b-cdea-583a-b04e-1af96dc5fdaf$q$::uuid, v_form, 9, $q$radio$q$, $q$A4. Berapa total lembar jawaban esai yang dikoreksi untuk mata kuliah tersebut dalam satu periode ujian (seluruh kelas)?$q$, $q$$q$, true, $q$[{"id":"a4_1","text":"< 50"},{"id":"a4_2","text":"50–100"},{"id":"a4_3","text":"101–150"},{"id":"a4_4","text":"151–200"},{"id":"a4_5","text":"> 200"}]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$4def4b3e-e755-5053-a966-9e682ceea65e$q$::uuid, v_form, 10, $q$radio$q$, $q$A5. Berapa rata-rata waktu untuk mengoreksi satu lembar jawaban esai?$q$, $q$$q$, true, $q$[{"id":"a5_1","text":"< 5 menit"},{"id":"a5_2","text":"5–10 menit"},{"id":"a5_3","text":"11–20 menit"},{"id":"a5_4","text":"> 20 menit"}]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$e986bcba-a144-5ab8-80df-d00580f64c0c$q$::uuid, v_form, 11, $q$radio$q$, $q$A6. Berapa lama waktu yang dibutuhkan sampai koreksi seluruh kelas selesai dan nilai diumumkan?$q$, $q$$q$, true, $q$[{"id":"a6_1","text":"< 1 minggu"},{"id":"a6_2","text":"1–2 minggu"},{"id":"a6_3","text":"2–3 minggu"},{"id":"a6_4","text":"> 3 minggu"}]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$c23a2bda-c2ba-5227-b6e0-11371dfe8cbe$q$::uuid, v_form, 12, $q$radio$q$, $q$A7. Apakah Bapak/Ibu menggunakan rubrik penilaian tertulis saat mengoreksi esai?$q$, $q$$q$, true, $q$[{"id":"a7_1","text":"Selalu"},{"id":"a7_2","text":"Kadang-kadang"},{"id":"a7_3","text":"Tidak pernah"}]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$b654a39b-d70f-5a02-a913-32969904e497$q$::uuid, v_form, 13, $q$radio$q$, $q$A8. Bentuk umpan balik apa yang biasanya Bapak/Ibu berikan kepada mahasiswa?$q$, $q$$q$, true, $q$[{"id":"a8_1","text":"Nilai saja"},{"id":"a8_2","text":"Nilai dan catatan singkat"},{"id":"a8_3","text":"Nilai dan pembahasan jawaban"}]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$78f6df83-d84b-51d9-bde7-21fce654d2ee$q$::uuid, v_form, 14, $q$section$q$, $q$Bagian B. Pendapat tentang Koreksi Esai Manual$q$, $q$Pilih satu kolom yang paling sesuai pada setiap pernyataan. Keterangan: STS = Sangat Tidak Setuju (1); TS = Tidak Setuju (2); N = Netral (3); S = Setuju (4); SS = Sangat Setuju (5).$q$, false, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$2d13a3e7-6f10-52c1-94e3-6fc0bda73eee$q$::uuid, v_form, 15, $q$grid$q$, $q$Seberapa setuju Bapak/Ibu dengan pernyataan berikut?$q$, $q$$q$, true, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${"rows":[{"id":"b1","text":"B1. Mengoreksi ujian esai dari beberapa kelas dalam satu mata kuliah merupakan beban kerja yang berat."},{"id":"b2","text":"B2. Koreksi ujian esai sering tertunda karena bersamaan dengan tugas lain (mengajar, penelitian, bimbingan, dan administrasi)."},{"id":"b3","text":"B3. Saya sulit menjaga konsistensi penilaian antara lembar jawaban yang dikoreksi di awal dan di akhir."},{"id":"b4","text":"B4. Saya sulit menjaga keseragaman standar penilaian antarkelas pada mata kuliah yang sama."},{"id":"b5","text":"B5. Kelelahan saat mengoreksi dalam jumlah besar memengaruhi ketelitian penilaian saya."},{"id":"b6","text":"B6. Saya jarang memiliki waktu untuk memberikan umpan balik rinci kepada setiap mahasiswa."},{"id":"b7","text":"B7. Sistem yang memberikan skor awal jawaban esai secara otomatis akan membantu pekerjaan saya."},{"id":"b8","text":"B8. Saya bersedia menggunakan skor rekomendasi dari AI selama saya tetap memeriksa dan menetapkan nilai akhir."}],"cols":[{"id":"c1","text":"STS (1)"},{"id":"c2","text":"TS (2)"},{"id":"c3","text":"N (3)"},{"id":"c4","text":"S (4)"},{"id":"c5","text":"SS (5)"}],"multi":false}$q$::jsonb),
    ($q$908671d7-878d-5e42-9f4b-ed5271917a01$q$::uuid, v_form, 16, $q$section$q$, $q$Bagian C. Pertanyaan Terbuka$q$, $q$$q$, false, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$9262e31a-d289-51cd-945f-bf0809a4e71a$q$::uuid, v_form, 17, $q$paragraph$q$, $q$C1. Kendala apa yang paling sering Bapak/Ibu hadapi saat mengoreksi ujian esai dari beberapa kelas?$q$, $q$$q$, false, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$cc06da56-2921-50f8-95f7-377c9543632f$q$::uuid, v_form, 18, $q$paragraph$q$, $q$C2. Apa syarat atau harapan Bapak/Ibu jika penilaian esai dibantu oleh sistem otomatis (AI)?$q$, $q$$q$, false, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb);

  RAISE NOTICE 'Form "%" dibuat untuk % (%). Tautan: /s/kuesioner-dosen-esai', $q$Kuesioner Pra-Penelitian untuk Dosen$q$, v_actual_email, $q$15 pertanyaan + 4 bagian$q$;
END
$seed$;

COMMIT;
