const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const dbDir = path.join(__dirname, 'database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'inventaris_lab_biologi.sqlite');
const db = new DatabaseSync(dbPath);

// Enable foreign keys and WAL mode for high reliability and concurrency
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nama_lengkap TEXT NOT NULL,
      nip TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS barang (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kode_barang TEXT,
      nama_barang TEXT NOT NULL,
      spesifikasi TEXT,
      kategori TEXT NOT NULL,
      sub_kategori TEXT,
      stok_total INTEGER NOT NULL DEFAULT 0,
      stok_tersedia INTEGER NOT NULL DEFAULT 0,
      stok_rusak INTEGER NOT NULL DEFAULT 0,
      satuan TEXT DEFAULT 'Buah',
      kondisi TEXT DEFAULT 'Baik',
      lokasi_penyimpanan TEXT,
      sumber_dana TEXT,
      keterangan TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS peminjaman (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nomor_formulir TEXT,
      barang_id INTEGER NOT NULL,
      nama_peminjam TEXT NOT NULL,
      kelas_jabatan TEXT,
      keperluan TEXT,
      jumlah INTEGER NOT NULL,
      tanggal_pinjam TEXT NOT NULL,
      tanggal_rencana_kembali TEXT,
      tanggal_kembali_aktual TEXT,
      kondisi_saat_pinjam TEXT DEFAULT 'Baik',
      kondisi_saat_kembali TEXT,
      status TEXT NOT NULL DEFAULT 'dipinjam',
      keterangan TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (barang_id) REFERENCES barang(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS log_riwayat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jenis_aktivitas TEXT NOT NULL,
      barang_id INTEGER,
      peminjaman_id INTEGER,
      deskripsi TEXT NOT NULL,
      detail_json TEXT,
      waktu DATETIME DEFAULT CURRENT_TIMESTAMP,
      admin_name TEXT DEFAULT 'Admin Lab Biologi'
    );

    CREATE INDEX IF NOT EXISTS idx_barang_nama ON barang(nama_barang);
    CREATE INDEX IF NOT EXISTS idx_barang_kategori ON barang(kategori);
    CREATE INDEX IF NOT EXISTS idx_peminjaman_status ON peminjaman(status);
    CREATE INDEX IF NOT EXISTS idx_log_waktu ON log_riwayat(waktu DESC);
  `);
}

initSchema();

function addLog({ jenis, barangId = null, peminjamanId = null, deskripsi, detail = null, adminName = 'Admin Lab' }) {
  try {
    const stmt = db.prepare(`
      INSERT INTO log_riwayat (jenis_aktivitas, barang_id, peminjaman_id, deskripsi, detail_json, admin_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      jenis,
      barangId,
      peminjamanId,
      deskripsi,
      detail ? JSON.stringify(detail) : null,
      adminName
    );
  } catch (err) {
    console.error('Failed to insert log:', err.message);
  }
}

module.exports = {
  db,
  addLog
};
