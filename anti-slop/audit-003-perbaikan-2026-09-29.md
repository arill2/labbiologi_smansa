# Audit Anti-Slop 003 - Laporan Perbaikan - 2026-09-29

Tindak lanjut `audit-001` dan `audit-002`. Semua perubahan ada di kode sumber (`public/index.html`, `public/css/style.css`, `public/js/app.js`) plus dokumen arah baru `DESIGN.md`. Tidak ada skrip patch; tidak ada file CSS/JS yang ditulis ulang lewat string-replace.

## Ringkasan

| Status | Jumlah |
|---|---|
| Hard Gate diperbaiki | 8 |
| Medium diperbaiki | 9 |
| Low diperbaiki | 3 |
| Diturunkan (bukan lagi temuan) | 1 |

## Perbaikan dan bukti

### Hard Gate

1. **R-02 em dash (temuan 1)**. `app.js:949` em dash diganti pemisah `•`. Bukti: `grep "—" public/js/app.js` = kosong.
2. **R-25 kontras brand (temuan 2)**. Token dipisah: `--primary` (teks/ikon) dan `--primary-strong` (isian di belakang teks putih), plus `--danger-strong`/`--success-strong`. Putih di `#0f766e` = **5.47:1**, putih di `#115e59` = **7.58:1**, teks brand terang `#0f766e` di putih = 5.47:1, gelap `#2dd4bf` di `#111827` = 9.53:1.
3. **R-27 loading state (temuan 3)**. Helper `setTableLoading`/`setListLoading` + spinner. Bukti: API ditunda 2.5s → `hasLoadingText=true, spinner=true`.
4. **R-37 arah desain (temuan 4)**. `DESIGN.md` dibuat: identitas, palet, tipografi, dial **ENERGY 1 / RHYTHM 1 / MOTION 1**, aturan gerak, dan baseline aksesibilitas.
5. **R-32 nama aksesibel (temuan 12)**. `aria-label` ditambahkan ke 7 kontrol (4 pencarian, 2 tanggal, 1 input file). Bukti: kontrol tanpa nama turun dari 12 ke 2, dan 2 sisanya `input[type=hidden]` yang memang dikecualikan.
6. **R-32 semantik dialog (temuan 13)**. 5 modal kini `role="dialog" aria-modal="true" aria-labelledby=...` dan tombol ✕ punya `aria-label="Tutup dialog"`. Bukti: semua 5 `labelledby` menunjuk judul yang benar.
7. **R-32 manajemen fokus modal (temuan 14)**. `openModal` memindah fokus ke dialog (defer 1 frame), Tab terjebak, `closeModal` mengembalikan fokus ke pemicu. Bukti: `focus on open inModal=true`, `trapped=true`, `Escape focusAfter=trigger`.
8. **R-32 sidebar off-canvas (temuan 15)**. `inert` + `aria-hidden` saat tertutup di mobile, dilepas saat dibuka. Bukti: 5 stop Tab tak terlihat menjadi **0**; `sidebar.inert` true saat tertutup, false saat dibuka, true lagi setelah nav dipilih.
9. **R-27 error state (temuan 16)**. Helper `setTableError`/`setListError` + tombol "Coba lagi". Bukti: API di-abort → tabel berisi "Gagal memuat data. Coba lagi".
10. **R-35 reflow (temuan 17)**. Dinilai ulang: pada lebar 320 CSS px (setara 400% pada 1280, target WCAG 1.4.10) seluruh tab tanpa overflow. Simulasi `zoom:2` di layar 390px menguji lebar efektif 195px, di bawah minimum yang disyaratkan WCAG, jadi bukan temuan valid. Status: terpenuhi pada target standar.
11. **Kredensial default di login (temuan 21)**. Blok "Akun Default Admin" dihapus dari `index.html`. Bukti: `grep adminlab123 public/` = kosong; halaman login tidak lagi memuatnya.

### Medium

12. **R-10 glass (temuan 5)**. `backdrop-filter` kini hanya topbar + bottom nav (2 permukaan). Modal backdrop dan sidebar solid.
13. **R-13 glow (temuan 6)**. Glow hanya tersisa pada indikator fokus (3 aturan `:focus`). Tombol, ikon brand, nav aktif, dan login memakai shadow elevasi.
14. **R-01 gradient (temuan 7)**. Gradient identitas `#6366f1 → #0d9488` diganti gradient brand teal; glow radial indigo di login dihapus, tinggal satu radial teal halus. Tidak ada lagi gradient biru-ungu.
15. **R-29 palet (temuan 8)**. `--accent` dan `--accent-cyan` dihapus (warna tak terpakai). Inti = teal; aksen tunggal = indigo (hanya status info); warna status jadi semantic token. Hue aktif turun dari 6 ke teal + indigo + status.
16. **R-19 pulse infinite (temuan 9)**. Animasi `pulse` tanpa henti dihapus dari badge; diganti titik statis dengan ring.
17. **R-19 reduced motion (temuan 18)**. Blok `@media (prefers-reduced-motion: reduce)` menonaktifkan animasi dan transisi.
18. **R-25 kontras non-teks (temuan 19)**. Token `--border-control` (`#7d8a9e` terang, `#56688a` gelap) untuk field form/search/select. Bukti: border < 3:1 turun dari 10 ke **0** di dua tema (terang 3.50:1, gelap 3.16:1).
19. **R-25 placeholder gelap (temuan 20)**. Aturan `::placeholder { color: var(--text-muted); opacity: 1 }`. Bukti: placeholder < 4.5:1 turun ke 0 (sisa 1 adalah checkbox, false positive).
20. **R-32 indikator fokus select (temuan 22)**. `.select-control:focus` diberi ring `box-shadow` seperti input. Bukti: stop Tab tanpa indikator fokus turun dari 1/13 ke **0/13**.

### Low

21. **Emoji copy (temuan 11)**. `⚡` dan `📅` dihapus dari teks.
22. **Glass/shadow konsistensi**. Shadow tombol primary diarahkan ke skala elevasi, bukan glow.
23. **Entry file arah**. `DESIGN.md` menjadi sumber arah; aksen dan batasan glass/glow tercatat sebagai alasan (R-31).

## Verifikasi akhir

- Layout mobile: 12 kombinasi device/tab, `overflowX=false`, tap target >= 44px, **12/12 PASS**.
- Modal: 5 modal x 3 device, footer dan tombol simpan selalu terjangkau, **ALL PASS**; Escape + scroll lock PASS.
- Keyboard: 13 stop Tab, 0 tanpa indikator fokus; fokus modal masuk, terjebak, dan kembali ke pemicu.
- Sidebar mobile: 0 stop Tab ke kontrol tak terlihat.
- Kontras: semua pasangan kunci lolos AA (lihat bagian bukti); border kontrol >= 3:1; non-teks gelap/terang bersih.
- State: loading (teks + spinner) dan error (pesan + "Coba lagi") muncul; dashboard stats menampilkan `...` saat memuat dan `-` saat gagal.
- E2E: login, buka sidebar, tambah barang lewat modal, tersimpan dan tampil; 0 error halaman. Data uji dibersihkan kembali.
- Copy: tanpa em dash, emoji dekoratif, atau buzzword AI; kredensial default tidak ada.

## Catatan

- Perubahan warna adalah penyesuaian kontras pada hue brand yang sama (teal), bukan ganti identitas. Bila pemilik ingin warna/arah lain, ubah `DESIGN.md` lalu token di `public/css/style.css`.
- Sisa yang tidak disentuh: header tabel uppercase + tracking (R-06, konvensi tabel yang disengaja dan tercatat di `DESIGN.md`), dan `@import` Google Fonts (punya fallback system font; bukan temuan Hard Gate).