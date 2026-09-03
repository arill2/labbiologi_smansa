# PRD: Sistem Inventarisasi Lab Biologi SMANSA Pinrang

## 1. Latar Belakang
Lab Biologi SMANSA Pinrang membutuhkan sistem pencatatan inventaris berbasis web yang dikelola oleh admin lab. Saat ini data inventaris tersimpan dalam file CSV. Sistem ini akan menggantikan pencatatan manual dengan web app yang mencatat stok barang, riwayat perubahan (log), dan proses peminjaman barang secara terintegrasi.

## 2. Tujuan
- Memudahkan admin lab mencatat dan mengelola inventaris barang lab Biologi.
- Mencatat riwayat (log) setiap perubahan stok barang (tambah/kurang/edit).
- Menyediakan sistem peminjaman barang yang otomatis mengurangi stok dan mencatat siapa, kapan meminjam, dan kapan mengembalikan.
- Semua aktivitas (perubahan inventaris & peminjaman) tercatat di satu log riwayat terpusat di halaman Home.

## 3. Target Pengguna
- **Admin Lab Biologi** (single admin, login dengan username & password) — satu-satunya pengguna sistem yang mengelola semua data.

## 4. Lingkup Fitur (Scope)

### 4.1 Autentikasi
- Login sederhana: 1 akun admin (username + password).
- Password disimpan ter-hash (bcrypt), bukan plain text.
- Session/token login (misal JWT atau session cookie) agar admin tetap login selama sesi aktif.
- Semua halaman (kecuali login) hanya bisa diakses setelah login.
- Fitur logout.

### 4.2 Import Data Inventaris via CSV
- Admin bisa upload file CSV kapan saja (bukan hanya sekali di awal) untuk:
  - Import data inventaris baru (tambah barang secara massal), atau
  - Update data inventaris yang sudah ada.
- Format CSV minimal berisi kolom: `nama_barang`, `kategori`, `jumlah_stok`, `satuan`, `kondisi`, `lokasi_penyimpanan`, `keterangan` (kolom dapat disesuaikan dengan CSV asli milik user — perlu konfirmasi struktur kolom asli sebelum development, lihat Lampiran).
- Sistem menampilkan preview data sebelum konfirmasi import, agar admin bisa cek kesalahan sebelum data masuk ke database.
- Setiap proses import CSV tercatat di log riwayat (misal: "Import CSV: 25 barang ditambahkan/diperbarui — [tanggal & waktu]").
- Validasi sederhana: baris dengan data tidak lengkap/format salah akan di-skip dan dilaporkan ke admin (bukan menggagalkan seluruh proses import).

### 4.3 Halaman Home / Dashboard
Menampilkan ringkasan sistem:
- Statistik singkat: total jenis barang, total stok barang, jumlah barang sedang dipinjam, jumlah peminjaman terlambat (opsional, jika ada due date).
- **Log Riwayat Aktivitas** (bagian utama Home): daftar kronologis (terbaru di atas) yang mencatat semua aktivitas:
  - Penambahan barang (manual atau via import CSV)
  - Pengurangan/edit stok barang
  - Penghapusan barang
  - Peminjaman barang (barang apa, siapa peminjam, tanggal pinjam)
  - Pengembalian barang (tanggal kembali)
- Setiap entri log menampilkan: jenis aktivitas, nama barang, jumlah, siapa peminjam (jika relevan), waktu kejadian (timestamp), dan admin yang melakukan aksi (karena hanya 1 admin, ini bisa default ke nama admin).
- Log bisa difilter (misal: filter by jenis aktivitas, filter by tanggal) dan dicari (search by nama barang/peminjam).
- Log bersifat read-only (tidak bisa diedit/dihapus admin, demi menjaga integritas riwayat) — hanya bisa dilihat dan difilter.

### 4.4 Halaman Inventaris (Manajemen Barang)
- Tabel daftar semua barang inventaris dengan kolom: nama barang, kategori, stok tersedia, stok total, kondisi, lokasi, keterangan.
- Fitur CRUD manual (selain via CSV):
  - **Tambah barang baru** (form manual, tanpa CSV).
  - **Edit barang** (ubah nama, kategori, stok, kondisi, lokasi, dll).
  - **Hapus barang.**
- Setiap aksi tambah/edit/hapus otomatis tercatat ke log riwayat di Home.
- Search & filter barang (by nama, kategori, kondisi, status ketersediaan).
- Indikator stok menipis (misal warna merah jika stok di bawah ambang batas tertentu — opsional, bisa dikonfigurasi).
- Stok yang ditampilkan adalah **stok tersedia** (stok total dikurangi barang yang sedang dipinjam).

### 4.5 Halaman Peminjaman Barang
- Form **Peminjaman Baru**:
  - Pilih barang dari daftar inventaris (searchable dropdown).
  - Jumlah barang yang dipinjam.
  - Nama peminjam (input teks bebas — nama siswa/guru).
  - Keterangan tambahan (opsional, misal: kelas, tujuan peminjaman).
  - Tanggal pinjam (default: hari ini, bisa diubah).
  - Tanggal rencana kembali (opsional, untuk pengingat/deteksi keterlambatan).
  - Validasi: jumlah pinjam tidak boleh melebihi stok tersedia.
  - Saat submit: stok tersedia barang tersebut otomatis berkurang sesuai jumlah dipinjam, dan tercatat di log riwayat.
- **Daftar Peminjaman Aktif** (barang yang sedang dipinjam, belum dikembalikan):
  - Menampilkan nama barang, jumlah, peminjam, tanggal pinjam, tanggal rencana kembali, status (dipinjam/terlambat).
  - Tombol **"Kembalikan"** pada setiap baris:
    - Saat diklik, mencatat tanggal kembali (default: hari ini, bisa diubah).
    - Stok barang otomatis bertambah kembali sesuai jumlah yang dikembalikan.
    - Status peminjaman berubah jadi "Dikembalikan".
    - Tercatat di log riwayat (siapa, barang apa, kapan dikembalikan).
  - Mendukung pengembalian sebagian (misal pinjam 10, kembali 6 dulu — opsional, tentukan saat development apakah dibutuhkan atau pengembalian selalu penuh).
- **Riwayat Peminjaman** (histori peminjaman yang sudah selesai/dikembalikan): tabel terpisah atau filter status di tabel yang sama.
- Search & filter peminjaman (by nama peminjam, nama barang, status, rentang tanggal).

### 4.6 Relasi Data Antar Fitur
- Setiap transaksi peminjaman terhubung ke satu entri barang inventaris (mengurangi stok saat pinjam, menambah saat kembali).
- Setiap transaksi (baik dari Inventaris maupun Peminjaman) menghasilkan satu entri di Log Riwayat pusat — log adalah "sumber kebenaran" riwayat seluruh sistem.

## 5. Alur Pengguna Utama (User Flow)

**Alur 1 — Import inventaris awal via CSV:**
1. Admin login.
2. Buka halaman Inventaris → klik "Import CSV".
3. Upload file CSV → sistem tampilkan preview.
4. Admin konfirmasi → data masuk ke database.
5. Log riwayat tercatat otomatis.

**Alur 2 — Peminjaman barang:**
1. Admin buka halaman Peminjaman → klik "Peminjaman Baru".
2. Pilih barang, isi jumlah, nama peminjam, tanggal.
3. Submit → stok barang berkurang, entri masuk ke "Peminjaman Aktif", log tercatat.

**Alur 3 — Pengembalian barang:**
1. Admin buka halaman Peminjaman → tab "Peminjaman Aktif".
2. Klik "Kembalikan" pada entri terkait, isi tanggal kembali.
3. Submit → stok barang bertambah kembali, status berubah "Dikembalikan", log tercatat.

**Alur 4 — Cek riwayat di Home:**
1. Admin login → langsung melihat Home dengan ringkasan & log riwayat terbaru.
2. Admin bisa filter/cari log tertentu (misal cari nama peminjam "Andi").

## 6. Kebutuhan Non-Fungsional
- **Tech stack (arahan):** HTML/CSS/JS di sisi frontend (boleh vanilla atau ringan seperti sedikit library), backend ringan menggunakan Node.js + Express.
- **Database:** disarankan SQLite (ringan, cocok untuk single-admin & skala sekolah, tanpa perlu setup server database terpisah) — bisa upgrade ke MySQL/PostgreSQL bila diperlukan skala lebih besar.
- **Responsif:** tampilan idealnya bisa diakses dari desktop maupun tablet/HP (admin lab bisa jadi mengecek dari HP).
- **Keamanan dasar:** hash password, validasi input untuk mencegah SQL Injection, sanitasi upload CSV (batasi tipe & ukuran file).
- **Backup data:** disarankan ada fitur export data inventaris & log ke CSV/Excel sebagai backup (opsional, bisa masuk fase 2).
- **Bahasa antarmuka:** Bahasa Indonesia.

## 7. Struktur Data (Awal, Bisa Disesuaikan)

### Tabel `barang` (inventaris)
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | integer (PK) | |
| nama_barang | string | |
| kategori | string | |
| stok_total | integer | |
| stok_tersedia | integer | dihitung: stok_total - stok_dipinjam |
| satuan | string | misal: buah, set, botol |
| kondisi | string | misal: baik, rusak, perlu perbaikan |
| lokasi_penyimpanan | string | |
| keterangan | text | opsional |
| created_at | datetime | |
| updated_at | datetime | |

### Tabel `peminjaman`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | integer (PK) | |
| barang_id | integer (FK) | |
| nama_peminjam | string | |
| jumlah | integer | |
| tanggal_pinjam | date | |
| tanggal_rencana_kembali | date | opsional |
| tanggal_kembali_aktual | date | null jika belum dikembalikan |
| status | enum | 'dipinjam' / 'dikembalikan' / 'terlambat' |
| keterangan | text | opsional |
| created_at | datetime | |

### Tabel `log_riwayat`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | integer (PK) | |
| jenis_aktivitas | enum | 'tambah_barang', 'edit_barang', 'hapus_barang', 'import_csv', 'peminjaman', 'pengembalian' |
| barang_id | integer (FK, nullable) | |
| peminjaman_id | integer (FK, nullable) | |
| deskripsi | text | ringkasan aktivitas untuk ditampilkan di UI |
| detail_json | json (opsional) | data before/after untuk keperluan audit |
| waktu | datetime | timestamp aktivitas |

### Tabel `admin`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | integer (PK) | |
| username | string | |
| password_hash | string | |

## 8. Di Luar Lingkup (Out of Scope) — Fase Ini
- Multi-admin / role & permission berbeda-beda.
- Notifikasi otomatis (email/WA) untuk keterlambatan pengembalian.
- Aplikasi mobile native.
- Approval workflow (misal siswa request pinjam sendiri lalu admin approve) — saat ini semua input dilakukan admin.
- Barcode/QR code scanning barang.

## 9. Pertanyaan Terbuka / Perlu Konfirmasi Sebelum Development
1. Struktur kolom asli file CSV inventaris (nama kolom persis) — perlu contoh file CSV nyata agar mapping import akurat.
2. Apakah dibutuhkan due date/tanggal rencana kembali dan status "terlambat" otomatis, atau cukup tanggal pinjam & kembali saja?
3. Apakah pengembalian sebagian (partial return) dibutuhkan, atau pengembalian selalu untuk seluruh jumlah yang dipinjam?
4. Apakah perlu ambang batas "stok menipis" dan berapa nilainya per kategori barang?
5. Apakah perlu fitur export log/inventaris ke CSV sebagai backup di fase ini atau fase berikutnya?

## 10. Kriteria Selesai (Definition of Done)
- Admin bisa login dan logout dengan aman.
- Admin bisa upload CSV dan data masuk ke inventaris dengan benar (dengan preview & validasi).
- Admin bisa tambah/edit/hapus barang secara manual dari UI.
- Admin bisa mencatat peminjaman barang, stok otomatis berkurang.
- Admin bisa mencatat pengembalian barang, stok otomatis bertambah kembali.
- Semua aktivitas di atas otomatis muncul di Log Riwayat pada halaman Home, lengkap dengan waktu dan detail terkait.
- Log riwayat dan daftar peminjaman bisa difilter/dicari.
