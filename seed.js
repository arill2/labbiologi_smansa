const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db, addLog } = require('./db');

function parseCSVLine(text) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

function cleanNum(s) {
  if (!s) return 0;
  const clean = s.replace(/[^0-9]/g, '');
  return clean ? parseInt(clean, 10) : 0;
}

function seedDatabase() {
  console.log('--- Mulai Seeding Database Lab Biologi SMANSA Pinrang ---');

  // 1. Reset tables
  db.exec(`
    DELETE FROM log_riwayat;
    DELETE FROM peminjaman;
    DELETE FROM barang;
    DELETE FROM admin;
  `);

  // 2. Insert Admin
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync('adminlab123', salt);
  const insertAdmin = db.prepare(`
    INSERT INTO admin (username, password_hash, nama_lengkap, nip)
    VALUES (?, ?, ?, ?)
  `);
  insertAdmin.run(
    'admin',
    passwordHash,
    'Juni Aswati, S.Si (Laboran Lab Biologi)',
    '19681231 199203 2 095'
  );
  console.log('✓ Admin default dibuat: username=admin, password=adminlab123');

  // 3. Read and Parse File 1: Daftar Inventarisasi
  const file1 = path.join(__dirname, 'data/LK KB 1 KP 1 Inventarisasi Alat Lab dan Format (2)-1. Daftar Inventarisasi.csv');
  const lines1 = fs.readFileSync(file1, 'utf8').split(/\r?\n/);

  let currentKategori = 'Alat Bahan Kaca';
  let currentSubKategori = 'Berskala';
  const insertBarang = db.prepare(`
    INSERT INTO barang (
      kode_barang, nama_barang, spesifikasi, kategori, sub_kategori,
      stok_total, stok_tersedia, stok_rusak, satuan, kondisi,
      lokasi_penyimpanan, sumber_dana, keterangan
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let countBarang = 0;

  for (let i = 0; i < lines1.length; i++) {
    const line = lines1[i].trim();
    if (!line) continue;

    if (line.includes('A. ALAT DARI BAHAN KACA')) {
      currentKategori = 'Alat Bahan Kaca';
      continue;
    }
    if (line.includes('1. Berskala')) {
      currentSubKategori = 'Berskala';
      continue;
    }
    if (line.includes('2. Tidak Berskala')) {
      currentSubKategori = 'Tidak Berskala';
      continue;
    }
    if (line.includes('B. ALAT DARI BAHAN PLASTIK')) {
      currentKategori = 'Alat Plastik, Kayu & Besi';
      currentSubKategori = 'Umum';
      continue;
    }
    if (line.includes('C. MEDIA PEMBELAJARA')) {
      currentKategori = 'Media Pembelajaran & Preparat';
      currentSubKategori = 'Preparat / Model';
      continue;
    }
    if (line.includes('NOMOR,KODE') || line.includes('BAIK,RUSAK') || line.includes('Kepala LAB') || line.includes('Pinrang,') || line.includes('Mengetahui,')) {
      continue;
    }

    const cols = parseCSVLine(line);
    if (cols.length < 7) continue;

    const nomor = cols[1];
    let kode = cols[2];
    const nama = cols[3];
    const spek = cols[4];
    const sumber = cols[5];
    const baik = cleanNum(cols[6]);
    const rusak = cleanNum(cols[7]);
    let lokasi = cols[10] || cols[9] || cols[8] || 'Lab Biologi';

    if (!nama || nama === '-' || nama === 'NAMA PERALATAN') continue;
    if (!nomor || isNaN(parseInt(nomor))) continue;
    if (kode === '-') kode = '';
    if (lokasi === '-' || !lokasi.trim()) lokasi = 'Lab Biologi';

    let satuan = 'Buah';
    const spekLower = (spek || '').toLowerCase();
    if (spekLower.includes('set')) satuan = 'Set';
    else if (spekLower.includes('dos')) satuan = 'Dos';
    else if (spekLower.includes('pak')) satuan = 'Pak';
    else if (spekLower.includes('pasang')) satuan = 'Pasang';
    else if (spekLower.includes('batang')) satuan = 'Batang';
    else if (spekLower.includes('lembar')) satuan = 'Lembar';

    let kondisi = 'Baik';
    if (baik === 0 && rusak > 0) kondisi = 'Rusak';
    else if (rusak > 0 && baik > 0) kondisi = 'Sebagian Rusak';

    insertBarang.run(
      kode,
      nama,
      spek,
      currentKategori,
      currentSubKategori,
      baik, // stok_total
      baik, // stok_tersedia
      rusak, // stok_rusak
      satuan,
      kondisi,
      lokasi,
      sumber,
      rusak > 0 ? `${rusak} unit kondisi rusak` : ''
    );
    countBarang++;
  }

  // 4. Read and Parse File 2: Aset Prasarana
  const file2 = path.join(__dirname, 'data/LK KB 1 KP 1 Inventarisasi Alat Lab dan Format (2)-Aset Prasarana.csv');
  if (fs.existsSync(file2)) {
    const lines2 = fs.readFileSync(file2, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines2.length; i++) {
      const line = lines2[i].trim();
      if (!line || line.includes('DAFTAR NAMA') || line.includes('SMAN 1') || line.includes('TAHUN') || line.includes('No,Kode') || line.includes('Baik,Rusak') || line.includes('Kepala LAB') || line.includes('Mengetahui')) continue;
      const cols = parseCSVLine(line);
      if (cols.length >= 6) {
        const no = cols[0];
        if (!no || isNaN(parseInt(no))) continue;
        const kode = cols[1] || '';
        const nama = cols[2];
        const spek = cols[3] || '';
        const sumber = cols[4] || '';
        const baik = cleanNum(cols[5]);
        const rusak = cleanNum(cols[6]);
        const lokasi = cols[7] || 'Ruang Lab Biologi';

        let kondisi = 'Baik';
        if (baik === 0 && rusak > 0) kondisi = 'Rusak';
        else if (rusak > 0 && baik > 0) kondisi = 'Sebagian Rusak';

        let satuan = 'Unit';
        if (nama.toLowerCase().includes('baju')) satuan = 'Lembar';

        insertBarang.run(
          kode,
          nama,
          spek,
          'Aset Prasarana',
          'Furnitur & Ruang',
          baik,
          baik,
          rusak,
          satuan,
          kondisi,
          lokasi,
          sumber,
          rusak > 0 ? `${rusak} unit rusak` : ''
        );
        countBarang++;
      }
    }
  }

  console.log(`✓ Total ${countBarang} barang inventaris berhasil diimpor ke database.`);

  // 5. Insert Sample Historical Borrowing Transactions from Format Peminjaman & Kartu Stok
  // Example 1: Historical completed loan (HJ. Haslinda, S.Pd. - Praktikum Uji Makanan)
  const itemGelasKimia = db.prepare("SELECT * FROM barang WHERE nama_barang LIKE '%Gelas Kimia%' AND spesifikasi LIKE '%250 ml%' LIMIT 1").get();
  const insertPinjam = db.prepare(`
    INSERT INTO peminjaman (
      nomor_formulir, barang_id, nama_peminjam, kelas_jabatan, keperluan,
      jumlah, tanggal_pinjam, tanggal_rencana_kembali, tanggal_kembali_aktual,
      kondisi_saat_pinjam, kondisi_saat_kembali, status, keterangan
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  if (itemGelasKimia) {
    const resPinjam1 = insertPinjam.run(
      'FP-2026/08/001',
      itemGelasKimia.id,
      'HJ. Haslinda, S.Pd.',
      'Guru Biologi',
      'Praktikum Uji Makanan (Kelas XI MIPA 1)',
      5,
      '2026-08-13',
      '2026-08-14',
      '2026-08-14',
      'Baik',
      'Baik',
      'dikembalikan',
      'Lengkap dan dikembalikan dalam kondisi bersih'
    );

    addLog({
      jenis: 'peminjaman',
      barangId: itemGelasKimia.id,
      peminjamanId: Number(resPinjam1.lastInsertRowid),
      deskripsi: `Peminjaman 5 unit "${itemGelasKimia.nama_barang} ${itemGelasKimia.spesifikasi}" oleh HJ. Haslinda, S.Pd. (Keperluan: Praktikum Uji Makanan)`,
      adminName: 'Juni Aswati, S.Si'
    });

    addLog({
      jenis: 'pengembalian',
      barangId: itemGelasKimia.id,
      peminjamanId: Number(resPinjam1.lastInsertRowid),
      deskripsi: `Pengembalian 5 unit "${itemGelasKimia.nama_barang} ${itemGelasKimia.spesifikasi}" oleh HJ. Haslinda, S.Pd. Kondisi: Baik`,
      adminName: 'Juni Aswati, S.Si'
    });
  }

  // Example 2: Currently Active Loan (Mikroskop Siswa borrowed by Guru)
  const itemMikroskop = db.prepare("SELECT * FROM barang WHERE nama_barang LIKE '%Mikroskop Siswa%' LIMIT 1").get();
  if (itemMikroskop && itemMikroskop.stok_tersedia >= 4) {
    const resPinjam2 = insertPinjam.run(
      'FP-2026/09/002',
      itemMikroskop.id,
      'Rini Rahmayani Sjam, S.Pd, M.Pd',
      'Guru Biologi / Kepala Lab',
      'Pengamatan Jaringan Daun Siswa Kelas XII MIPA 2',
      4,
      '2026-09-02',
      '2026-09-05',
      null,
      'Baik',
      null,
      'dipinjam',
      'Dipinjam 4 unit mikroskop siswa untuk meja kelompok 1-4'
    );

    // Update available stock
    db.prepare('UPDATE barang SET stok_tersedia = stok_tersedia - 4 WHERE id = ?').run(itemMikroskop.id);

    addLog({
      jenis: 'peminjaman',
      barangId: itemMikroskop.id,
      peminjamanId: Number(resPinjam2.lastInsertRowid),
      deskripsi: `Peminjaman 4 unit "${itemMikroskop.nama_barang}" oleh Rini Rahmayani Sjam, S.Pd, M.Pd (Kelas XII MIPA 2)`,
      adminName: 'Juni Aswati, S.Si'
    });
    console.log('✓ Contoh transaksi peminjaman aktif dan riwayat berhasil ditambahkan.');
  }

  // Example 3: Initial System CSV Import Log
  addLog({
    jenis: 'import_csv',
    deskripsi: `Inisialisasi Import Data: ${countBarang} barang laboratorium berhasil dimuat dari data inventaris resmi SMAN 1 Pinrang TA 2026/2027.`,
    adminName: 'Juni Aswati, S.Si'
  });

  console.log('✓ Seeding selesai! Database siap digunakan.');
}

if (require.main === module) {
  seedDatabase();
}

module.exports = { seedDatabase };
