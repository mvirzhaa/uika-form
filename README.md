# UIKA Form

Aplikasi survei, formulir, kuis, dan sertifikat otomatis (gaya Google Form / SurveyMonkey dengan tampilan Apple).
Node.js 20+ · Express · PostgreSQL · SPA tanpa build.

## Fitur
- **Mode Editor** (hanya pemilik form + email yang ia daftarkan lewat *Bagikan*) dan **Mode Pengisian** (peserta; editor bisa pratinjau).
- Tipe pertanyaan: jawaban singkat, esai, pilihan ganda, kotak centang, dropdown, skala, **kisi (baris × kolom)**, **peringkat**, **unggah berkas** (PNG/JPG/PDF/Office, maks. 5 MB), tanggal, waktu, judul bagian; gambar dapat dipasang pada tiap pertanyaan.
- **Daftar pilihan** yang dipakai ulang: admin membuat daftar **global**, tiap pembuat form punya daftar **pribadi**. Dropdown tinggal memanggil daftar (mis. daftar dosen); perubahan daftar otomatis ikut. Menu: *Daftar pilihan* (pengguna) dan *Admin › Daftar pilihan global*.
- Tampilan: warna tema, latar, header (solid/gradien/gambar), jenis huruf.
- **Kuis**: penilaian otomatis (pilihan ganda, centang dengan nilai sebagian, isian singkat, skala), esai dinilai manual, durasi pengerjaan dengan **auto-submit** saat waktu habis, jawaban tersimpan otomatis dan dapat dilanjutkan setelah halaman dimuat ulang.
- **Sertifikat** per form (aktif/nonaktif): latar, logo sponsor kiri-atas/kanan-atas/kanan-bawah, tanda tangan, QR verifikasi (`/verify/<kode>`), unduh PDF atau kirim ke email, batas nilai kelulusan.
- **Rekap**: ringkasan dengan grafik, tabel pertanyaan, jawaban per peserta, ekspor Excel.
- **Template Excel** (survei & kuis) untuk diunduh, diisi, lalu diimpor kembali.
- **Siapa yang bisa mengisi**: tanpa login pun bisa (cukup nama + email); yang sudah masuk E-Portal terisi otomatis. Per form dapat dipilih *Wajib login E-Portal* atau *Anonim*.
- **Membuat/mengelola form wajib login E-Portal.**
- **Admin › Formulir**: tabel semua formulir dari semua pembuat (pembuat, jenis, status, jumlah soal & respons, terakhir diubah), pencarian kata kunci pada pertanyaan (judul, deskripsi, teks pilihan, baris/kolom kisi), judul, atau pembuat dengan sorotan hasil; filter status/jenis & urutan; detail isi lengkap (semua pertanyaan, pilihan, kunci jawaban, pengaturan, jumlah respons/sertifikat/kehadiran), unduh respons Excel, hapus satu atau banyak sekaligus (tercatat di log server). Admin tetap tidak masuk Mode Editor formulir orang lain.

### Fitur lanjutan
- **Daftar peserta (whitelist)** per form: tempel / unggah .csv/.txt berisi email dan/atau NIM; status "sudah mengisi" & "hadir" terlihat. Opsi *wajib login E-Portal* untuk keamanan penuh.
- **Anti-curang kuis**: deteksi pindah tab/aplikasi, hilang fokus, keluar layar penuh; blokir salin/tempel/klik kanan; batas pelanggaran → kirim otomatis; pelanggaran tercatat per peserta. **Soal acak** (ambil N soal dari kumpulan, soal "selalu sertakan") dan acak urutan.
- **Bank soal** pribadi & global (admin): simpan soal dari Editor, ambil semua atau N acak ke form lain. Halaman: *Bank soal*.
- **Percobaan ulang**: batas jumlah percobaan dan kebijakan nilai (tertinggi / terakhir / pertama).
- **Absensi QR**: QR/tautan `/checkin/<token>` per form, token dapat diganti, catat manual, sheet *Kehadiran* di Excel; sertifikat opsional hanya untuk yang hadir.
- **Percabangan**: "tampilkan pertanyaan bila jawaban sebelumnya …" (sama dengan, tidak sama, mengandung, lebih/kurang dari, sudah/belum dijawab; semua/salah satu syarat).
- **Sertifikat**: 4 templat (klasik, modern, elegan, minimalis), **nomor resmi** (`{{no:3}}/UIKA/{{bulan}}/{{tahun}}`), **kirim massal** ke email dengan progres.
- **Desain sertifikat visual** (tab Sertifikat › *Buka desain sertifikat*): pratinjau A4 yang elemennya bisa diklik & digeser (atau tombol panah), panel kanan berisi daftar elemen (logo sponsor kiri/kanan atas, logo & nama penyelenggara, judul, nomor, kalimat pengantar, nama peserta, teks isi, judul kegiatan, teks penutup, tempat & tanggal, tanda tangan, nama & jabatan penanda tangan, QR, kode verifikasi, logo “Didukung oleh”) dengan pengaturan tampil/sembunyi, ukuran huruf, lebar area, posisi X/Y, rata kiri/tengah/kanan, warna, jenis huruf, tebal/miring/kapital, spasi huruf. PDF memakai tata letak yang sama (`src/certLayout.js`).
- **Email**: notifikasi ke pemilik saat ada respons baru (dirangkum ≥5 menit) dan konfirmasi ke peserta.
- **Rekap**: laporan **PDF**, **analisis butir soal** (tingkat kesukaran, daya pembeda, reliabilitas KR-20), ringkasan kisi/peringkat, unduh berkas jawaban.
- **Tautan pendek** `/s/<alias>`, **QR formulir** (PNG/SVG), kode **embed iframe** (`?embed=1`, harus diizinkan di Pengaturan).
- **Mode terang / gelap**: aplikasi bawaan terang; tombol matahari/bulan di bilah atas menyimpan pilihan pengguna. Tiap formulir punya *Mode tampilan* (Terang/Gelap) dan palet latar sendiri di tab Tampilan; peserta tetap bisa menggantinya.
- **Nyaman di HP** (diuji di lebar 320–430 px, tanpa geser ke samping): bilah atas ringkas dengan tombol menu ⋯ (Mode Pengisian, Bagikan, bahasa, tema, keluar), tab Editor 5 kolom berikon, baris pengaturan otomatis turun ke bawah, tombol minimal ±40 px untuk jari, input 16 px (tanpa zoom otomatis iOS), pita timer/pelanggaran padat saat kuis, desainer sertifikat dengan pratinjau yang menempel di atas.
- **Bahasa Indonesia / English**: tombol EN/ID di bilah atas, `?lang=en`, atau *Bahasa formulir* (tab Tampilan/Pengaturan).

## Menjalankan
```bash
cp .env.example .env      # isi SESSION_SECRET, OIDC_*, DATABASE_URL, dst.
docker compose up -d --build
```
Atau tanpa Docker: siapkan PostgreSQL, isi `.env`, lalu `npm ci && npm start` (migrasi otomatis saat start).

Pengembangan lokal tanpa E-Portal: set `DEV_LOGIN=true` (ditolak di produksi), buka `/auth/dev`.

## Login E-Portal (OIDC)
- Redirect URI yang didaftarkan di E-Portal: `{BASE_URL}/auth/callback`.
- Isi `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`. Aplikasi memakai discovery (`/.well-known/openid-configuration`), PKCE, dan memverifikasi id_token via JWKS.
- NIM/NIP dibaca dari klaim `OIDC_ID_CLAIM` (default `preferred_username`).
- `ADMIN_EMAILS` menjadikan email tertentu admin; `DEFAULT_ROLE` menentukan peran pengguna baru.

## Di belakang nginx
Teruskan `Host` dan `X-Forwarded-For/Proto`, set `TRUST_PROXY=1`, dan pastikan `BASE_URL` memakai https. Batas unggah: `client_max_body_size 6m;`.

## Tes
`npm test` (butuh database `uikaform_test`; lihat `test/api.test.js` untuk `TEST_DATABASE_URL`).

## Keterbatasan
- Whitelist tanpa login hanya mencocokkan email/NIM yang diketik peserta (bisa dipalsukan); aktifkan *wajib login* untuk jaminan penuh.
- Anti-curang berbasis browser tidak dapat mencegah perangkat lain; layar penuh tidak didukung di iPhone.
- Embed iframe + login E-Portal dapat terhalang kebijakan cookie pihak ketiga; formulir tanpa login tetap berfungsi.
- Terjemahan English berbasis kamus: teks yang belum terdaftar (mis. sebagian pesan galat server) tetap berbahasa Indonesia; isi pertanyaan tidak diterjemahkan.
- Kisi tidak dapat diimpor dari Excel (dibuat lewat Editor). Pengiriman email massal berjalan di memori server (hilang bila server restart).
- Font sertifikat bawaan PDFKit (Latin-1); karakter di luar itu perlu font tambahan.
- Pengiriman email membutuhkan SMTP; tanpa SMTP, tombol kirim menjawab 503 dan unduh PDF tetap bisa.
- Menghapus/mengganti teks item daftar pilihan mengubah id item; jawaban lama pada item itu tidak lagi terpetakan ke teksnya.
