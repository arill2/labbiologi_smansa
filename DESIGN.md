# DESIGN.md - Sistem Inventarisasi Lab Biologi SMANSA Pinrang

Arah desain untuk aplikasi inventaris lab. Dokumen ini mencatat identitas yang sudah dipakai dan alasan tiap keputusan, sesuai aturan "setiap keputusan punya alasan tertulis".

## Produk dan pengguna

- Produk: aplikasi web internal untuk mencatat inventaris alat/bahan lab biologi, peminjaman, pengembalian, dan log aktivitas.
- Pengguna: admin lab dan guru (satu peran admin), sering dipakai di desktop ruang lab dan ponsel saat mengecek di lapangan.
- Konsekuensi: desktop-first untuk pekerjaan tabel, tetapi alur tambah barang, peminjaman, dan pengembalian harus nyaman di ponsel.

## Design Read

> Aplikasi admin internal untuk staf lab, bahasa visual "Emerald Lab Tech" yang tenang dan rapi, dial **ENERGY 1 / RHYTHM 1 / MOTION 1**.

## Dial

| Dial | Nilai | Alasan |
|---|---|---|
| ENERGY | 1 (Calm) | Alat kerja harian; fokus ke keterbacaan data, bukan kesan dramatis. |
| RHYTHM | 1 (Uniform) | Konsistensi kartu/tabel membantu admin memindai data cepat; variasi komposisi tidak menambah fungsi. |
| MOTION | 1 (Hover/feedback only) | Animasi hanya untuk umpan balik (fade tab, slide toast, spinner muat), bukan dekorasi. |

## Identitas

- Motif: teal laboratorium dipadukan permukaan putih bersih dan ikon garis labu, sebagai penanda "lab sains" yang spesifik, bukan gradien biru-ungu generik.
- Aksen tunggal: teal dipakai untuk aksi utama, tautan, dan fokus. Aksen kedua (indigo) hanya untuk status informasi.

## Palet

Core 1: **teal (brand)**. Accent 1: **indigo (status info saja)**. Warna bahaya/peringatan/sukses adalah semantic token, bukan bagian palet inti.

| Token | Terang | Gelap | Alasan |
|---|---|---|---|
| `--primary` | `#0f766e` | `#2dd4bf` | Teal untuk teks, ikon, border. Terang lolos AA di atas putih; gelap dipilih lebih terang agar lolos AA di atas latar gelap. |
| `--primary-strong` | `#0f766e` | `#0f766e` | Isian tombol/nav aktif di belakang teks putih. Dipisah dari `--primary` agar putih selalu lolos 4.5:1 di dua tema. |
| `--primary-hover` | `#115e59` | `#115e59` | Status hover; lebih gelap dari isian dasar. |
| `--secondary` | `#4f46e5` | `#a5b4fc` | Indigo sebagai satu-satunya aksen, khusus status informasi. |
| `--danger` / `--success` / `--warning` | `#b91c1c` / `#047857` / `#92400e` | `#f87171` / `#34d399` / `#fbbf24` | Warna teks status; versi `-strong` dipakai sebagai isian tombol agar putih lolos AA. |
| `--border-control` | `#7d8a9e` | `#56688a` | Border field form, minimal 3:1 terhadap permukaan (WCAG 1.4.11). Border dekoratif kartu tetap `--border-color`. |

Tidak ada gradien sebagai warna utama. Gradient hanya dipakai sebagai shading halus pada isian brand (tombol/nav/logo) untuk memberi kedalaman, bukan sebagai identitas warna.

## Tipografi

- Heading: **Outfit** (geometris, tegas) untuk judul halaman dan angka metrik; memberi karakter tanpa mengorbankan keterbacaan.
- Body: **Plus Jakarta Sans** (netral, ramah) untuk tabel dan formulir berisi teks Indonesia.
- Tidak ada monospace dekoratif dan tidak ada label uppercase bertracking lebar, kecuali header tabel (konvensi tabel, ditulis di sini sebagai pengecualian yang disengaja).

## Bentuk dan ruang

- Radius: 8 / 12 / 16 px + pill hanya untuk badge dan kontrol kapsul (tema). Variasi radius menandai hierarki (kartu vs tombol vs badge), bukan semua pill.
- Shadow: dipakai sebagai penanda elevasi (kartu, modal), bukan default semua komponen. Glow dibatasi hanya pada indikator fokus.

## Glass

- `backdrop-filter` maksimal dua permukaan: topbar dan bottom nav. Modal, sidebar, dan kartu memakai permukaan solid agar hierarki tetap jelas.

## Gerak

- Fade saat ganti tab, slide pada toast, spinner saat memuat. Tidak ada animasi berulang tanpa henti.
- Menghormati `prefers-reduced-motion`: seluruh animasi/transisi dinonaktifkan bila pengguna meminta gerak minimal.

## Aksesibilitas

- Kontras teks minimal AA (4.5:1 normal, 3:1 teks besar); border kontrol minimal 3:1.
- Semua kontrol punya nama aksesibel; modal ber-`role="dialog"`, fokus dipindah ke dialog, dijebak, dan dikembalikan ke pemicu saat ditutup.
- Sidebar off-canvas memakai `inert` saat tertutup di mobile agar tidak masuk urutan Tab.
- Data view punya tiga state: memuat, kosong, dan error dengan tombol "Coba lagi".

## Catatan

- Dokumen ini mencatat arah yang sudah ada di kode, bukan mengarang identitas baru. Bila pemilik produk ingin arah berbeda, ubah dokumen ini lebih dulu, lalu sesuaikan token di `public/css/style.css`.
