-- =====================================================================
-- UIKA Form — seed: Kuesioner Pra-Penelitian untuk Mahasiswa: Kecepatan Umpan Balik Hasil Ujian Esai
-- Dibuat mengikuti pola kuesioner-pra-dosen.sql
--
-- CARA PAKAI
--   1. Pastikan pemilik form SUDAH PERNAH login ke UIKA Form (agar ada di tabel users).
--   2. Ubah owner_email (dan status bila perlu) di baris "CREATE TEMP TABLE" di bawah.
--   3. Jalankan:  psql "$DATABASE_URL" -f kuesioner-pra-mahasiswa.sql
--      (atau tempel ke DBeaver / pgAdmin / psql — tidak butuh variabel psql)
--
-- Aman dijalankan ulang: bila form dengan slug 'kuesioner-mahasiswa-esai' sudah ada, tidak ada yang diubah.
-- Isi: 4 isian identitas + 5 soal pilihan (A1–A5) + kisi skala B1–B9 + 2 soal terbuka (C1–C2).
-- Tautan pengisian setelah terbit:  <BASE_URL>/s/kuesioner-mahasiswa-esai
-- =====================================================================
BEGIN;

CREATE TEMP TABLE _seed_cfg ON COMMIT DROP AS
  SELECT 'muhamadvirzhaa@gmail.com'::text   AS owner_email,   -- <== email akun pemilik form
         'published'::text AS status;         -- 'published' = langsung bisa diisi, 'draft' = periksa dulu di Editor

DO $seed$
DECLARE
  v_owner uuid;
  v_form  uuid := $q$240b218b-0f66-54a6-8aff-f0759c0de9c1$q$::uuid;
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

  IF EXISTS (SELECT 1 FROM forms WHERE slug = $q$kuesioner-mahasiswa-esai$q$ OR id = v_form) THEN
    RAISE NOTICE 'Form kuesioner-mahasiswa-esai sudah ada — dilewati (tidak ada perubahan).';
    RETURN;
  END IF;

  INSERT INTO forms (id, owner_id, slug, title, description, status, theme, settings, cert)
  VALUES (v_form, v_owner, $q$kuesioner-mahasiswa-esai$q$, $q$Kuesioner Pra-Penelitian untuk Mahasiswa: Kecepatan Umpan Balik Hasil Ujian Esai$q$, $q$Kuesioner ini bertujuan untuk mengetahui pengalaman mahasiswa dalam menerima umpan balik (nilai dan penjelasan) hasil ujian esai. Jawaban digunakan sebagai data pendukung latar belakang skripsi berjudul “Pengembangan Fitur CBT Auto-Grading pada Aplikasi UCL UIKA Berbantuan Google LLM”. Identitas responden dijaga kerahasiaannya dan tidak berpengaruh terhadap nilai akademik.$q$,
          (SELECT status FROM _seed_cfg), $q${"color":"#0071e3","bg":"#f2f2f7","header_style":"gradient","header_image":null,"font":"system","mode":"light"}$q$::jsonb, $q${"is_quiz":false,"duration_min":0,"identity":"none","one_response":false,"shuffle_questions":false,"shuffle_options":false,"show_score":"immediately","show_answers":false,"confirmation_message":"Terima kasih atas kesediaan Anda mengisi kuesioner ini.","open_at":null,"close_at":null,"allowlist":{"enabled":false,"require_login":false},"max_attempts":0,"score_policy":"best","pick_count":0,"anticheat":{"enabled":false,"max_violations":3,"block_copy":true,"fullscreen":false},"attendance":{"enabled":false,"require_for_cert":false},"notify_owner":false,"confirm_email":false,"allow_embed":false,"language":"id","number_questions":false}$q$::jsonb, $q${"enabled":false,"title":"SERTIFIKAT","subtitle":"Diberikan kepada","body":"atas partisipasinya sebagai peserta dalam kegiatan","organizer":"Universitas Ibn Khaldun Bogor","signer_name":"","signer_title":"","accent":"#0071e3","bg_color":"#ffffff","bg_image":null,"signature_image":null,"sponsors":{"tl":null,"tr":null,"br":null},"min_percent":60,"auto_email":false,"template":"classic","number_format":"","number_start":1,"event_text":"“{{judul}}”","footer":"","place":"Bogor","sponsor_label":"Didukung oleh","logo_image":null,"layout":null}$q$::jsonb);

  INSERT INTO questions (id, form_id, position, type, title, description, required, options, correct, points, config) VALUES
    ($q$c3b1b72b-1241-596e-bc24-174cfc363dd4$q$::uuid, v_form, 0, $q$section$q$, $q$Identitas Responden$q$, $q$Isilah sesuai pengalaman Anda selama dua semester terakhir.$q$, false, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$819cc5a4-0f75-5474-99f2-e968ae292400$q$::uuid, v_form, 1, $q$short$q$, $q$Nama (boleh dikosongkan)$q$, $q$$q$, false, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$fb5b1277-4bee-5b65-8d2a-eea13683b1c4$q$::uuid, v_form, 2, $q$short$q$, $q$Program Studi$q$, $q$$q$, true, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$f88c47b6-5dbf-5e6e-b288-42e1517dd6c3$q$::uuid, v_form, 3, $q$short$q$, $q$Semester$q$, $q$Contoh: 5$q$, true, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$ca72699f-048c-56f5-a17f-1902671c0881$q$::uuid, v_form, 4, $q$short$q$, $q$Jumlah MK dengan ujian esai$q$, $q$Contoh: 3$q$, true, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$8726bf47-8726-5900-9b5c-bca734174f31$q$::uuid, v_form, 5, $q$section$q$, $q$Bagian A. Pengalaman Menerima Hasil Ujian Esai$q$, $q$Pilih satu jawaban yang paling sesuai.$q$, false, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$fd83575d-935e-557d-9f6b-d2f2a09d2279$q$::uuid, v_form, 6, $q$radio$q$, $q$A1. Setelah ujian esai (UTS/UAS) selesai, berapa lama biasanya Anda baru mengetahui nilainya?$q$, $q$$q$, true, $q$[{"id":"a1_1","text":"≤ 1 minggu"},{"id":"a1_2","text":"> 1–2 minggu"},{"id":"a1_3","text":"> 2–4 minggu"},{"id":"a1_4","text":"> 4 minggu"},{"id":"a1_5","text":"Baru diketahui sebagai nilai akhir semester"}]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$38a37332-c8d3-50ea-9b53-dfd8e08c1371$q$::uuid, v_form, 7, $q$radio$q$, $q$A2. Dalam bentuk apa hasil ujian esai biasanya Anda terima?$q$, $q$$q$, true, $q$[{"id":"a2_1","text":"Angka/huruf mutu saja"},{"id":"a2_2","text":"Angka disertai catatan singkat"},{"id":"a2_3","text":"Angka disertai penjelasan bagian jawaban yang kurang tepat"},{"id":"a2_4","text":"Tidak ditampilkan, hanya nilai akhir semester"}]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$93d528fe-3e89-5920-8fb2-fc3e778a9781$q$::uuid, v_form, 8, $q$radio$q$, $q$A3. Seberapa sering Anda mendapat penjelasan tentang bagian jawaban esai yang salah atau kurang lengkap?$q$, $q$$q$, true, $q$[{"id":"a3_1","text":"Tidak pernah"},{"id":"a3_2","text":"Jarang"},{"id":"a3_3","text":"Kadang-kadang"},{"id":"a3_4","text":"Sering"},{"id":"a3_5","text":"Selalu"}]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$ad2710d6-9f46-5438-a319-c61678cbcbe9$q$::uuid, v_form, 9, $q$radio$q$, $q$A4. Menurut Anda, kapan waktu yang ideal untuk mengetahui hasil ujian esai?$q$, $q$$q$, true, $q$[{"id":"a4_1","text":"Segera setelah jawaban dikumpulkan"},{"id":"a4_2","text":"1–3 hari"},{"id":"a4_3","text":"≤ 1 minggu"},{"id":"a4_4","text":"≤ 2 minggu"}]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$e9efe5f0-c6d3-5fac-9863-d7aa7769c1c1$q$::uuid, v_form, 10, $q$radio$q$, $q$A5. Perangkat apa yang paling sering Anda gunakan untuk mengakses layanan akademik kampus?$q$, $q$$q$, true, $q$[{"id":"a5_1","text":"Smartphone"},{"id":"a5_2","text":"Laptop/komputer pribadi"},{"id":"a5_3","text":"Komputer kampus"},{"id":"a5_4","text":"Tablet"}]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$a12ae170-9b11-5d6b-bcb2-8b7d6b50416a$q$::uuid, v_form, 11, $q$section$q$, $q$Bagian B. Pendapat tentang Kecepatan Umpan Balik$q$, $q$Pilih satu kolom yang paling sesuai pada setiap pernyataan. Keterangan: STS = Sangat Tidak Setuju (1); TS = Tidak Setuju (2); N = Netral (3); S = Setuju (4); SS = Sangat Setuju (5).$q$, false, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$ac2872ce-f702-5cf0-bd4b-647fc7f02243$q$::uuid, v_form, 12, $q$grid$q$, $q$Seberapa setuju Anda dengan pernyataan berikut?$q$, $q$$q$, true, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${"rows":[{"id":"b1","text":"B1. Saya harus menunggu terlalu lama untuk mengetahui nilai ujian esai."},{"id":"b2","text":"B2. Keterlambatan nilai membuat saya sulit mengetahui apakah pemahaman saya terhadap materi sudah benar."},{"id":"b3","text":"B3. Keterlambatan nilai menyulitkan saya memperbaiki cara belajar sebelum materi berikutnya."},{"id":"b4","text":"B4. Keterlambatan nilai memengaruhi rencana pengambilan mata kuliah atau jumlah SKS semester berikutnya."},{"id":"b5","text":"B5. Saya merasa cemas selama menunggu nilai ujian esai diumumkan."},{"id":"b6","text":"B6. Saya membutuhkan penjelasan tentang bagian jawaban yang perlu diperbaiki, bukan hanya angka nilai."},{"id":"b7","text":"B7. Saya ingin mengetahui perkiraan nilai ujian esai segera setelah jawaban dikumpulkan."},{"id":"b8","text":"B8. Saya bersedia mengerjakan ujian esai melalui aplikasi di smartphone."},{"id":"b9","text":"B9. Saya dapat menerima skor awal dari sistem penilai otomatis (AI) selama nilai akhir tetap diperiksa dan ditetapkan oleh dosen."}],"cols":[{"id":"c1","text":"STS (1)"},{"id":"c2","text":"TS (2)"},{"id":"c3","text":"N (3)"},{"id":"c4","text":"S (4)"},{"id":"c5","text":"SS (5)"}],"multi":false}$q$::jsonb),
    ($q$6375436c-5708-56de-bc39-c30d661301cc$q$::uuid, v_form, 13, $q$section$q$, $q$Bagian C. Pertanyaan Terbuka$q$, $q$$q$, false, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$315007c6-cf72-5d35-a676-2abb973ebd7a$q$::uuid, v_form, 14, $q$paragraph$q$, $q$C1. Ceritakan pengalaman Anda saat menunggu nilai ujian esai. Apa dampaknya bagi Anda?$q$, $q$$q$, false, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb),
    ($q$8d10c1f5-cf45-519e-96d0-df1e49f2083c$q$::uuid, v_form, 15, $q$paragraph$q$, $q$C2. Apa harapan Anda terhadap cara penyampaian hasil ujian esai?$q$, $q$$q$, false, $q$[]$q$::jsonb, $q$[]$q$::jsonb, 0, $q${}$q$::jsonb);

  RAISE NOTICE 'Form "%" dibuat untuk % (%). Tautan: /s/kuesioner-mahasiswa-esai', $q$Kuesioner Pra-Penelitian untuk Mahasiswa$q$, v_actual_email, $q$12 pertanyaan + 4 bagian$q$;
END
$seed$;

COMMIT;
