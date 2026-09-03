const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { db, addLog } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Security: Persistent, cryptographically strong secret key
function getSecretKey() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const isVercel = Boolean(process.env.VERCEL);
  const keyDir = isVercel ? '/tmp' : path.join(__dirname, 'database');
  const keyPath = path.join(keyDir, '.secret_key');
  try {
    if (fs.existsSync(keyPath)) {
      return fs.readFileSync(keyPath, 'utf8').trim();
    }
    const newKey = crypto.randomBytes(64).toString('hex');
    fs.writeFileSync(keyPath, newKey, { mode: 0o600 });
    return newKey;
  } catch (err) {
    return 'smansa-pinrang-biologi-secure-key-2026';
  }
}
const SECRET_KEY = getSecretKey();

// Security: Disable X-Powered-By
app.disable('x-powered-by');

// Security: Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self';"
  );
  next();
});

// Parsers with size limits
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Security: Multer config with strict file filtering and limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.csv') {
      return cb(new Error('Hanya file berkas berekstensi .csv yang diperbolehkan.'));
    }
    cb(null, true);
  }
});

// Security: In-Memory Brute-Force Protection for Login
const loginRateLimit = new Map(); // ip -> { count, lockUntil }

function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginRateLimit.get(ip);
  if (!record) return { allowed: true };
  if (record.lockUntil && record.lockUntil > now) {
    const waitSeconds = Math.ceil((record.lockUntil - now) / 1000);
    return { allowed: false, waitSeconds };
  }
  if (record.lockUntil && record.lockUntil <= now) {
    loginRateLimit.delete(ip);
    return { allowed: true };
  }
  return { allowed: true };
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const record = loginRateLimit.get(ip) || { count: 0, firstAttempt: now };
  record.count += 1;
  if (record.count >= 5) {
    record.lockUntil = now + 5 * 60 * 1000; // 5 minute lock
  }
  loginRateLimit.set(ip, record);
}

function clearLoginAttempts(ip) {
  loginRateLimit.delete(ip);
}

// Security: Cryptographically secure token creation & timing-safe verification
function createToken(adminId) {
  const payload = `${adminId}:${Date.now()}`;
  const hmac = crypto.createHmac('sha256', SECRET_KEY).update(payload).digest('hex');
  return `${payload}:${hmac}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split(':');
  if (parts.length !== 3) return null;
  const [adminIdStr, timestampStr, hmac] = parts;
  const adminId = parseInt(adminIdStr, 10);
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(adminId) || isNaN(timestamp) || adminId <= 0) return null;

  const now = Date.now();
  // Valid within 7 days, and not from the future (+60s tolerance)
  if (now - timestamp > 7 * 24 * 60 * 60 * 1000 || timestamp > now + 60000) {
    return null;
  }

  const expectedHmac = crypto.createHmac('sha256', SECRET_KEY).update(`${adminId}:${timestamp}`).digest('hex');
  if (hmac.length !== expectedHmac.length) return null;

  const hmacBuf = Buffer.from(hmac, 'utf8');
  const expectedBuf = Buffer.from(expectedHmac, 'utf8');
  if (!crypto.timingSafeEqual(hmacBuf, expectedBuf)) {
    return null;
  }

  return adminId;
}

function authMiddleware(req, res, next) {
  const token = req.cookies.auth_token || req.headers['authorization']?.replace('Bearer ', '');
  const adminId = verifyToken(token);
  if (!adminId) {
    return res.status(401).json({ error: 'Sesi telah berakhir atau tidak valid. Silakan login kembali.' });
  }

  const admin = db.prepare('SELECT id, username, nama_lengkap, nip FROM admin WHERE id = ?').get(adminId);
  if (!admin) {
    return res.status(401).json({ error: 'Akun admin tidak ditemukan.' });
  }
  req.admin = admin;
  next();
}

// Security: Formula Injection Mitigation for CSV Export
function sanitizeCSVCell(value) {
  if (value === null || value === undefined) return '""';
  let str = String(value).trim();
  // Prevent CSV / Formula Injection in Excel/Calc: prefix risky starting characters with a single quote
  if (/^[=\+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

// -------------------------------------------------------------
// AUTH ENDPOINTS
// -------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  const rateStatus = checkRateLimit(clientIp);
  if (!rateStatus.allowed) {
    return res.status(429).json({
      error: `Terlalu banyak percobaan login gagal. Silakan tunggu ${rateStatus.waitSeconds} detik sebelum mencoba kembali.`
    });
  }

  const { username, password } = req.body;
  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username dan password wajib diisi.' });
  }

  const cleanUsername = username.trim().slice(0, 100);
  const admin = db.prepare('SELECT * FROM admin WHERE username = ?').get(cleanUsername);

  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    recordFailedLogin(clientIp);
    return res.status(401).json({ error: 'Username atau password salah.' });
  }

  clearLoginAttempts(clientIp);
  const token = createToken(admin.id);

  res.cookie('auth_token', token, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  });

  res.json({
    success: true,
    token,
    admin: {
      id: admin.id,
      username: admin.username,
      nama_lengkap: admin.nama_lengkap,
      nip: admin.nip
    }
  });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ success: true, message: 'Berhasil keluar.' });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies.auth_token || req.headers['authorization']?.replace('Bearer ', '');
  const adminId = verifyToken(token);
  if (!adminId) {
    return res.status(401).json({ authenticated: false });
  }
  const admin = db.prepare('SELECT id, username, nama_lengkap, nip FROM admin WHERE id = ?').get(adminId);
  if (!admin) {
    return res.status(401).json({ authenticated: false });
  }
  res.json({ authenticated: true, admin });
});

app.post('/api/auth/change-password', authMiddleware, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password || typeof current_password !== 'string' || typeof new_password !== 'string') {
    return res.status(400).json({ error: 'Password lama dan baru wajib diisi.' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'Password baru minimal 8 karakter demi keamanan.' });
  }
  if (new_password.length > 128) {
    return res.status(400).json({ error: 'Password maksimal 128 karakter.' });
  }

  const admin = db.prepare('SELECT * FROM admin WHERE id = ?').get(req.admin.id);
  if (!bcrypt.compareSync(current_password, admin.password_hash)) {
    return res.status(400).json({ error: 'Password saat ini salah.' });
  }

  const newHash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE admin SET password_hash = ? WHERE id = ?').run(newHash, req.admin.id);

  addLog({
    jenis: 'edit_barang',
    deskripsi: `Admin "${admin.nama_lengkap}" memperbarui password akun.`,
    adminName: admin.nama_lengkap
  });

  res.json({ success: true, message: 'Password berhasil diperbarui.' });
});

// -------------------------------------------------------------
// DASHBOARD & STATS ENDPOINTS
// -------------------------------------------------------------
app.get('/api/dashboard/stats', authMiddleware, (req, res) => {
  const totalJenis = db.prepare('SELECT COUNT(*) as c FROM barang').get().c;
  const totalStokBaik = db.prepare('SELECT COALESCE(SUM(stok_total), 0) as s FROM barang').get().s;
  const totalStokTersedia = db.prepare('SELECT COALESCE(SUM(stok_tersedia), 0) as s FROM barang').get().s;
  const totalStokRusak = db.prepare('SELECT COALESCE(SUM(stok_rusak), 0) as s FROM barang').get().s;
  const totalDipinjam = db.prepare("SELECT COALESCE(SUM(jumlah), 0) as s FROM peminjaman WHERE status = 'dipinjam'").get().s;
  const peminjamanTerlambat = db.prepare(`
    SELECT COUNT(*) as c FROM peminjaman 
    WHERE status = 'dipinjam' 
      AND tanggal_rencana_kembali IS NOT NULL 
      AND tanggal_rencana_kembali < date('now')
  `).get().c;
  const stokMenipis = db.prepare('SELECT COUNT(*) as c FROM barang WHERE stok_tersedia <= 2 AND stok_total > 0').get().c;

  res.json({
    total_jenis: totalJenis,
    total_stok_baik: totalStokBaik,
    total_stok_tersedia: totalStokTersedia,
    total_stok_rusak: totalStokRusak,
    total_dipinjam: totalDipinjam,
    peminjaman_terlambat: peminjamanTerlambat,
    stok_menipis: stokMenipis
  });
});

// -------------------------------------------------------------
// ACTIVITY LOG ENDPOINTS
// -------------------------------------------------------------
app.get('/api/logs', authMiddleware, (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const jenis = typeof req.query.jenis === 'string' ? req.query.jenis.trim() : 'semua';
  const startDate = typeof req.query.start_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.start_date) ? req.query.start_date : null;
  const endDate = typeof req.query.end_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.end_date) ? req.query.end_date : null;

  const validJenis = ['semua', 'peminjaman', 'pengembalian', 'tambah_barang', 'edit_barang', 'hapus_barang', 'import_csv'];
  const safeJenis = validJenis.includes(jenis) ? jenis : 'semua';

  const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
  const offset = (pageNum - 1) * limitNum;

  let query = 'SELECT * FROM log_riwayat WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND (deskripsi LIKE ? OR admin_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (safeJenis !== 'semua') {
    query += ' AND jenis_aktivitas = ?';
    params.push(safeJenis);
  }
  if (startDate) {
    query += ' AND date(waktu) >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND date(waktu) <= ?';
    params.push(endDate);
  }

  const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
  const totalRows = db.prepare(countQuery).get(...params).total;

  query += ' ORDER BY waktu DESC LIMIT ? OFFSET ?';
  params.push(limitNum, offset);

  const logs = db.prepare(query).all(...params);

  res.json({
    logs,
    total: totalRows,
    page: pageNum,
    limit: limitNum
  });
});

// -------------------------------------------------------------
// INVENTORY (BARANG) ENDPOINTS
// -------------------------------------------------------------
app.get('/api/barang', authMiddleware, (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const kategori = typeof req.query.kategori === 'string' ? req.query.kategori.trim().slice(0, 100) : 'semua';
  const kondisi = typeof req.query.kondisi === 'string' ? req.query.kondisi.trim().slice(0, 50) : 'semua';
  const lokasi = typeof req.query.lokasi === 'string' ? req.query.lokasi.trim().slice(0, 100) : 'semua';
  const stokMenipis = req.query.stok_menipis === 'true';

  let query = 'SELECT * FROM barang WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND (nama_barang LIKE ? OR kode_barang LIKE ? OR spesifikasi LIKE ? OR keterangan LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (kategori && kategori !== 'semua') {
    query += ' AND kategori = ?';
    params.push(kategori);
  }
  if (kondisi && kondisi !== 'semua') {
    query += ' AND kondisi = ?';
    params.push(kondisi);
  }
  if (lokasi && lokasi !== 'semua') {
    query += ' AND lokasi_penyimpanan LIKE ?';
    params.push(`%${lokasi}%`);
  }
  if (stokMenipis) {
    query += ' AND stok_tersedia <= 2';
  }

  query += ' ORDER BY id ASC';
  const items = db.prepare(query).all(...params);
  res.json(items);
});

app.get('/api/barang/meta', authMiddleware, (req, res) => {
  const categories = db.prepare('SELECT DISTINCT kategori FROM barang ORDER BY kategori ASC').all().map(r => r.kategori);
  const locations = db.prepare("SELECT DISTINCT lokasi_penyimpanan FROM barang WHERE lokasi_penyimpanan != '' ORDER BY lokasi_penyimpanan ASC").all().map(r => r.lokasi_penyimpanan);
  res.json({ categories, locations });
});

app.get('/api/barang/:id', authMiddleware, (req, res) => {
  if (!req.params.id || !/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'ID barang tidak valid (harus berupa angka).' });
  }
  const id = parseInt(req.params.id, 10);
  if (id <= 0) {
    return res.status(400).json({ error: 'ID barang tidak valid.' });
  }

  const item = db.prepare('SELECT * FROM barang WHERE id = ?').get(id);
  if (!item) return res.status(404).json({ error: 'Barang tidak ditemukan.' });

  const historyPeminjaman = db.prepare(`
    SELECT * FROM peminjaman WHERE barang_id = ? ORDER BY created_at DESC LIMIT 10
  `).all(item.id);

  res.json({ item, historyPeminjaman });
});

app.post('/api/barang', authMiddleware, (req, res) => {
  let {
    kode_barang = '',
    nama_barang,
    spesifikasi = '',
    kategori,
    sub_kategori = '',
    stok_total,
    satuan = 'Buah',
    kondisi = 'Baik',
    lokasi_penyimpanan = 'Lab Biologi',
    sumber_dana = '',
    keterangan = ''
  } = req.body;

  if (!nama_barang || typeof nama_barang !== 'string' || !nama_barang.trim()) {
    return res.status(400).json({ error: 'Nama barang wajib diisi.' });
  }
  if (!kategori || typeof kategori !== 'string' || !kategori.trim()) {
    return res.status(400).json({ error: 'Kategori barang wajib diisi.' });
  }

  const total = parseInt(stok_total, 10);
  if (isNaN(total) || total < 0 || total > 1000000) {
    return res.status(400).json({ error: 'Stok total harus berupa angka valid (0 - 1.000.000).' });
  }

  const validKondisi = ['Baik', 'Sebagian Rusak', 'Rusak'];
  const safeKondisi = validKondisi.includes(kondisi) ? kondisi : 'Baik';

  const cleanNama = nama_barang.trim().slice(0, 200);
  const cleanKode = String(kode_barang).trim().slice(0, 50);
  const cleanSpek = String(spesifikasi).trim().slice(0, 200);
  const cleanKategori = kategori.trim().slice(0, 100);
  const cleanSubKat = String(sub_kategori).trim().slice(0, 100);
  const cleanSatuan = String(satuan).trim().slice(0, 50) || 'Buah';
  const cleanLokasi = String(lokasi_penyimpanan).trim().slice(0, 150) || 'Lab Biologi';
  const cleanSumber = String(sumber_dana).trim().slice(0, 100);
  const cleanKet = String(keterangan).trim().slice(0, 500);

  const tersedia = total;
  const rusak = safeKondisi === 'Rusak' ? total : 0;

  const stmt = db.prepare(`
    INSERT INTO barang (
      kode_barang, nama_barang, spesifikasi, kategori, sub_kategori,
      stok_total, stok_tersedia, stok_rusak, satuan, kondisi,
      lokasi_penyimpanan, sumber_dana, keterangan
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    cleanKode, cleanNama, cleanSpek, cleanKategori, cleanSubKat,
    total, tersedia, rusak, cleanSatuan, safeKondisi,
    cleanLokasi, cleanSumber, cleanKet
  );

  addLog({
    jenis: 'tambah_barang',
    barangId: Number(result.lastInsertRowid),
    deskripsi: `Penambahan barang baru: "${cleanNama} ${cleanSpek}" (Stok: ${total} ${cleanSatuan}, Lokasi: ${cleanLokasi})`,
    adminName: req.admin.nama_lengkap
  });

  res.json({ success: true, id: Number(result.lastInsertRowid), message: 'Barang berhasil ditambahkan.' });
});

app.put('/api/barang/:id', authMiddleware, (req, res) => {
  if (!req.params.id || !/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'ID barang tidak valid (harus berupa angka).' });
  }
  const id = parseInt(req.params.id, 10);
  if (id <= 0) {
    return res.status(400).json({ error: 'ID barang tidak valid.' });
  }

  const item = db.prepare('SELECT * FROM barang WHERE id = ?').get(id);
  if (!item) return res.status(404).json({ error: 'Barang tidak ditemukan.' });

  const {
    kode_barang = item.kode_barang,
    nama_barang = item.nama_barang,
    spesifikasi = item.spesifikasi,
    kategori = item.kategori,
    sub_kategori = item.sub_kategori,
    stok_total = item.stok_total,
    satuan = item.satuan,
    kondisi = item.kondisi,
    lokasi_penyimpanan = item.lokasi_penyimpanan,
    sumber_dana = item.sumber_dana,
    keterangan = item.keterangan,
    stok_rusak = item.stok_rusak
  } = req.body;

  const newTotal = parseInt(stok_total, 10);
  if (isNaN(newTotal) || newTotal < 0 || newTotal > 1000000) {
    return res.status(400).json({ error: 'Stok total harus berupa angka valid (0 - 1.000.000).' });
  }

  const newRusak = Math.max(0, parseInt(stok_rusak, 10) || 0);

  // Calculate currently borrowed
  const borrowedSum = db.prepare("SELECT COALESCE(SUM(jumlah), 0) as s FROM peminjaman WHERE barang_id = ? AND status = 'dipinjam'").get(id).s;
  if (newTotal < borrowedSum) {
    return res.status(400).json({
      error: `Stok total tidak boleh lebih kecil dari jumlah yang sedang dipinjam (${borrowedSum} ${item.satuan})!`
    });
  }

  const newTersedia = Math.max(0, newTotal - borrowedSum);

  const cleanNama = String(nama_barang).trim().slice(0, 200);
  const cleanKode = String(kode_barang).trim().slice(0, 50);
  const cleanSpek = String(spesifikasi).trim().slice(0, 200);
  const cleanKategori = String(kategori).trim().slice(0, 100);
  const cleanSubKat = String(sub_kategori).trim().slice(0, 100);
  const cleanSatuan = String(satuan).trim().slice(0, 50) || 'Buah';
  const cleanLokasi = String(lokasi_penyimpanan).trim().slice(0, 150) || 'Lab Biologi';
  const cleanSumber = String(sumber_dana).trim().slice(0, 100);
  const cleanKet = String(keterangan).trim().slice(0, 500);

  const validKondisi = ['Baik', 'Sebagian Rusak', 'Rusak'];
  const safeKondisi = validKondisi.includes(kondisi) ? kondisi : item.kondisi;

  const stmt = db.prepare(`
    UPDATE barang SET
      kode_barang = ?, nama_barang = ?, spesifikasi = ?, kategori = ?, sub_kategori = ?,
      stok_total = ?, stok_tersedia = ?, stok_rusak = ?, satuan = ?, kondisi = ?,
      lokasi_penyimpanan = ?, sumber_dana = ?, keterangan = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  stmt.run(
    cleanKode, cleanNama, cleanSpek, cleanKategori, cleanSubKat,
    newTotal, newTersedia, newRusak, cleanSatuan, safeKondisi,
    cleanLokasi, cleanSumber, cleanKet, id
  );

  addLog({
    jenis: 'edit_barang',
    barangId: id,
    deskripsi: `Pembaruan data barang "${cleanNama}": Stok total diubah menjadi ${newTotal} ${cleanSatuan}, kondisi "${safeKondisi}".`,
    adminName: req.admin.nama_lengkap
  });

  res.json({ success: true, message: 'Data barang berhasil diperbarui.' });
});

app.delete('/api/barang/:id', authMiddleware, (req, res) => {
  if (!req.params.id || !/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'ID barang tidak valid (harus berupa angka).' });
  }
  const id = parseInt(req.params.id, 10);
  if (id <= 0) {
    return res.status(400).json({ error: 'ID barang tidak valid.' });
  }

  const item = db.prepare('SELECT * FROM barang WHERE id = ?').get(id);
  if (!item) return res.status(404).json({ error: 'Barang tidak ditemukan.' });

  const activeBorrow = db.prepare("SELECT COUNT(*) as c FROM peminjaman WHERE barang_id = ? AND status = 'dipinjam'").get(id).c;
  if (activeBorrow > 0) {
    return res.status(400).json({ error: 'Barang tidak dapat dihapus karena masih sedang dipinjam!' });
  }

  db.prepare('DELETE FROM barang WHERE id = ?').run(id);

  addLog({
    jenis: 'hapus_barang',
    deskripsi: `Penghapusan barang: "${item.nama_barang} ${item.spesifikasi || ''}" (ID: ${id}) oleh Admin.`,
    adminName: req.admin.nama_lengkap
  });

  res.json({ success: true, message: 'Barang berhasil dihapus.' });
});

// -------------------------------------------------------------
// CSV IMPORT PREVIEW & CONFIRM ENDPOINTS
// -------------------------------------------------------------
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
  const clean = s.toString().replace(/[^0-9]/g, '');
  return clean ? parseInt(clean, 10) : 0;
}

app.post('/api/import/preview', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'File CSV wajib diunggah.' });
  }

  const csvString = req.file.buffer.toString('utf8');
  const lines = csvString.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  if (lines.length === 0) {
    return res.status(400).json({ error: 'File CSV kosong.' });
  }

  const firstLines = lines.slice(0, 10).join(' ');
  const isSmansaFormat = firstLines.includes('DAFTAR NAMA') || firstLines.includes('ALAT DARI BAHAN') || firstLines.includes('Berskala') || firstLines.includes('BAIK,RUSAK');

  const validItems = [];
  const invalidRows = [];

  if (isSmansaFormat) {
    let curKategori = 'Alat Bahan Kaca';
    let curSubKategori = 'Berskala';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('A. ALAT DARI BAHAN KACA')) { curKategori = 'Alat Bahan Kaca'; continue; }
      if (line.includes('1. Berskala')) { curSubKategori = 'Berskala'; continue; }
      if (line.includes('2. Tidak Berskala')) { curSubKategori = 'Tidak Berskala'; continue; }
      if (line.includes('B. ALAT DARI BAHAN PLASTIK')) { curKategori = 'Alat Plastik, Kayu & Besi'; curSubKategori = 'Umum'; continue; }
      if (line.includes('C. MEDIA PEMBELAJARA')) { curKategori = 'Media Pembelajaran & Preparat'; curSubKategori = 'Preparat / Model'; continue; }
      if (line.includes('DAFTAR NAMA') || line.includes('NOMOR,KODE') || line.includes('BAIK,RUSAK') || line.includes('Kepala LAB') || line.includes('Mengetahui')) continue;

      const cols = parseCSVLine(line);
      if (cols.length < 5) continue;

      const nomor = cols[1];
      const kode = (cols[2] === '-' ? '' : cols[2]) || '';
      const nama = cols[3];
      const spek = cols[4] || '';
      const sumber = cols[5] || '';
      const baik = cleanNum(cols[6]);
      const rusak = cleanNum(cols[7]);
      let lokasi = cols[10] || cols[9] || cols[8] || 'Lab Biologi';
      if (lokasi === '-') lokasi = 'Lab Biologi';

      if (!nama || nama === '-' || nama === 'NAMA PERALATAN' || !nomor || isNaN(parseInt(nomor, 10))) {
        continue;
      }

      let satuan = 'Buah';
      const sp = spek.toLowerCase();
      if (sp.includes('set')) satuan = 'Set';
      else if (sp.includes('dos')) satuan = 'Dos';
      else if (sp.includes('pak')) satuan = 'Pak';
      else if (sp.includes('pasang')) satuan = 'Pasang';

      let kondisi = 'Baik';
      if (baik === 0 && rusak > 0) kondisi = 'Rusak';
      else if (rusak > 0 && baik > 0) kondisi = 'Sebagian Rusak';

      validItems.push({
        kode_barang: kode.slice(0, 50),
        nama_barang: nama.slice(0, 200),
        spesifikasi: spek.slice(0, 200),
        kategori: curKategori.slice(0, 100),
        sub_kategori: curSubKategori.slice(0, 100),
        stok_total: baik,
        stok_rusak: rusak,
        satuan: satuan.slice(0, 50),
        kondisi,
        lokasi_penyimpanan: lokasi.slice(0, 150),
        sumber_dana: sumber.slice(0, 100),
        keterangan: rusak > 0 ? `${rusak} unit rusak` : ''
      });
    }
  } else {
    const headerCols = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[\s_]+/g, '_'));
    const nameIdx = headerCols.findIndex(h => h.includes('nama'));
    const katIdx = headerCols.findIndex(h => h.includes('kategori'));
    const stokIdx = headerCols.findIndex(h => h.includes('stok') || h.includes('jumlah') || h.includes('banyak'));
    const satuanIdx = headerCols.findIndex(h => h.includes('satuan'));
    const kondisiIdx = headerCols.findIndex(h => h.includes('kondisi'));
    const lokasiIdx = headerCols.findIndex(h => h.includes('lokasi'));
    const spekIdx = headerCols.findIndex(h => h.includes('spek') || h.includes('spesifikasi'));
    const kodeIdx = headerCols.findIndex(h => h.includes('kode'));

    if (nameIdx === -1) {
      return res.status(400).json({ error: 'Kolom "nama_barang" tidak ditemukan dalam header CSV.' });
    }

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const cols = parseCSVLine(line);
      const nama = cols[nameIdx];
      if (!nama || !nama.trim()) {
        invalidRows.push({ row: i + 1, reason: 'Nama barang kosong' });
        continue;
      }

      const stok = stokIdx !== -1 ? cleanNum(cols[stokIdx]) : 1;
      validItems.push({
        nama_barang: nama.trim().slice(0, 200),
        kode_barang: kodeIdx !== -1 ? (cols[kodeIdx] || '').slice(0, 50) : '',
        kategori: katIdx !== -1 ? (cols[katIdx] || 'Lainnya').slice(0, 100) : 'Alat Lab Biologi',
        sub_kategori: 'Umum',
        spesifikasi: spekIdx !== -1 ? (cols[spekIdx] || '').slice(0, 200) : '',
        stok_total: stok,
        stok_rusak: 0,
        satuan: satuanIdx !== -1 ? (cols[satuanIdx] || 'Buah').slice(0, 50) : 'Buah',
        kondisi: kondisiIdx !== -1 ? (cols[kondisiIdx] || 'Baik').slice(0, 50) : 'Baik',
        lokasi_penyimpanan: lokasiIdx !== -1 ? (cols[lokasiIdx] || 'Lab Biologi').slice(0, 150) : 'Lab Biologi',
        sumber_dana: '',
        keterangan: ''
      });
    }
  }

  res.json({
    total_parsed: validItems.length,
    valid_count: validItems.length,
    invalid_count: invalidRows.length,
    invalid_rows: invalidRows,
    preview_items: validItems.slice(0, 50),
    all_items: validItems
  });
});

app.post('/api/import/confirm', authMiddleware, (req, res) => {
  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Tidak ada data barang yang valid untuk diimpor.' });
  }

  const insertStmt = db.prepare(`
    INSERT INTO barang (
      kode_barang, nama_barang, spesifikasi, kategori, sub_kategori,
      stok_total, stok_tersedia, stok_rusak, satuan, kondisi,
      lokasi_penyimpanan, sumber_dana, keterangan
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateStmt = db.prepare(`
    UPDATE barang SET
      spesifikasi = ?, kategori = ?, sub_kategori = ?, stok_total = ?, stok_tersedia = ?,
      stok_rusak = ?, satuan = ?, kondisi = ?, lokasi_penyimpanan = ?, sumber_dana = ?, keterangan = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  let added = 0;
  let updated = 0;

  for (const item of items) {
    if (!item.nama_barang || typeof item.nama_barang !== 'string' || !item.nama_barang.trim()) continue;

    const safeNama = item.nama_barang.trim().slice(0, 200);
    const safeKode = String(item.kode_barang || '').trim().slice(0, 50);
    const safeSpek = String(item.spesifikasi || '').trim().slice(0, 200);
    const safeKategori = String(item.kategori || 'Alat Lab Biologi').trim().slice(0, 100);
    const safeSubKat = String(item.sub_kategori || 'Umum').trim().slice(0, 100);
    const safeSatuan = String(item.satuan || 'Buah').trim().slice(0, 50);
    const safeLokasi = String(item.lokasi_penyimpanan || 'Lab Biologi').trim().slice(0, 150);
    const safeSumber = String(item.sumber_dana || '').trim().slice(0, 100);
    const safeKet = String(item.keterangan || '').trim().slice(0, 500);
    const total = Math.max(0, parseInt(item.stok_total, 10) || 0);
    const rusak = Math.max(0, parseInt(item.stok_rusak, 10) || 0);
    const kondisi = String(item.kondisi || 'Baik').trim().slice(0, 50);

    let existing = null;
    if (safeKode) {
      existing = db.prepare('SELECT id, stok_total, stok_tersedia FROM barang WHERE kode_barang = ?').get(safeKode);
    }
    if (!existing) {
      existing = db.prepare('SELECT id, stok_total, stok_tersedia FROM barang WHERE nama_barang = ? AND spesifikasi = ?').get(safeNama, safeSpek);
    }

    if (existing) {
      updateStmt.run(
        safeSpek, safeKategori, safeSubKat,
        total, total, rusak,
        safeSatuan, kondisi,
        safeLokasi, safeSumber, safeKet,
        existing.id
      );
      updated++;
    } else {
      insertStmt.run(
        safeKode, safeNama, safeSpek,
        safeKategori, safeSubKat,
        total, total, rusak,
        safeSatuan, kondisi,
        safeLokasi, safeSumber, safeKet
      );
      added++;
    }
  }

  addLog({
    jenis: 'import_csv',
    deskripsi: `Import CSV: Berhasil menambahkan ${added} barang baru dan memperbarui ${updated} barang inventaris.`,
    adminName: req.admin.nama_lengkap
  });

  res.json({
    success: true,
    added,
    updated,
    total: added + updated,
    message: `Berhasil mengimpor CSV: ${added} barang baru ditambahkan, ${updated} barang diperbarui.`
  });
});

// -------------------------------------------------------------
// PEMINJAMAN & PENGEMBALIAN ENDPOINTS (RACE-CONDITION RESISTANT)
// -------------------------------------------------------------
app.get('/api/peminjaman', authMiddleware, (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : 'semua';
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';

  const validStatus = ['semua', 'dipinjam', 'dikembalikan', 'terlambat'];
  const safeStatus = validStatus.includes(status) ? status : 'semua';

  let query = `
    SELECT 
      p.*,
      b.nama_barang,
      b.kode_barang,
      b.spesifikasi as barang_spesifikasi,
      b.satuan as barang_satuan,
      b.lokasi_penyimpanan as barang_lokasi,
      CASE 
        WHEN p.status = 'dipinjam' AND p.tanggal_rencana_kembali IS NOT NULL AND p.tanggal_rencana_kembali < date('now') THEN 1 
        ELSE 0 
      END as is_terlambat
    FROM peminjaman p
    JOIN barang b ON p.barang_id = b.id
    WHERE 1=1
  `;
  const params = [];

  if (safeStatus !== 'semua') {
    if (safeStatus === 'terlambat') {
      query += " AND p.status = 'dipinjam' AND p.tanggal_rencana_kembali IS NOT NULL AND p.tanggal_rencana_kembali < date('now')";
    } else {
      query += ' AND p.status = ?';
      params.push(safeStatus);
    }
  }

  if (search) {
    query += ' AND (p.nama_peminjam LIKE ? OR b.nama_barang LIKE ? OR p.nomor_formulir LIKE ? OR p.keperluan LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY p.id DESC';
  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

app.post('/api/peminjaman', authMiddleware, (req, res) => {
  const {
    barang_id,
    nama_peminjam,
    kelas_jabatan = '',
    keperluan = '',
    jumlah,
    tanggal_pinjam,
    tanggal_rencana_kembali = null,
    keterangan = ''
  } = req.body;

  const barangId = parseInt(barang_id, 10);
  const jml = parseInt(jumlah, 10);

  if (isNaN(barangId) || barangId <= 0) {
    return res.status(400).json({ error: 'Barang yang dipilih tidak valid.' });
  }
  if (!nama_peminjam || typeof nama_peminjam !== 'string' || !nama_peminjam.trim()) {
    return res.status(400).json({ error: 'Nama peminjam wajib diisi.' });
  }
  if (isNaN(jml) || jml <= 0 || jml > 10000) {
    return res.status(400).json({ error: 'Jumlah pinjam harus berupa angka positif (1 - 10.000).' });
  }
  if (!tanggal_pinjam || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal_pinjam)) {
    return res.status(400).json({ error: 'Format tanggal peminjaman harus YYYY-MM-DD.' });
  }
  if (tanggal_rencana_kembali && !/^\d{4}-\d{2}-\d{2}$/.test(tanggal_rencana_kembali)) {
    return res.status(400).json({ error: 'Format rencana tanggal pengembalian harus YYYY-MM-DD.' });
  }

  const barang = db.prepare('SELECT * FROM barang WHERE id = ?').get(barangId);
  if (!barang) {
    return res.status(404).json({ error: 'Barang tidak ditemukan.' });
  }

  // Atomic deduction of available stock to prevent race conditions
  const updateRes = db.prepare(`
    UPDATE barang 
    SET stok_tersedia = stok_tersedia - ? 
    WHERE id = ? AND stok_tersedia >= ?
  `).run(jml, barangId, jml);

  if (updateRes.changes === 0) {
    return res.status(400).json({
      error: `Stok tersedia tidak mencukupi! Tersedia saat ini: ${barang.stok_tersedia} ${barang.satuan}, diminta: ${jml} ${barang.satuan}.`
    });
  }

  // Generate automated transaction number
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const countToday = db.prepare("SELECT COUNT(*) as c FROM peminjaman WHERE tanggal_pinjam >= date('now', 'start of month')").get().c + 1;
  const noFormulir = `FP-${today}-${String(countToday).padStart(3, '0')}`;

  const cleanNama = nama_peminjam.trim().slice(0, 150);
  const cleanKelas = String(kelas_jabatan).trim().slice(0, 100);
  const cleanKeperluan = String(keperluan).trim().slice(0, 200);
  const cleanKet = String(keterangan).trim().slice(0, 500);

  const insertStmt = db.prepare(`
    INSERT INTO peminjaman (
      nomor_formulir, barang_id, nama_peminjam, kelas_jabatan, keperluan,
      jumlah, tanggal_pinjam, tanggal_rencana_kembali, kondisi_saat_pinjam,
      status, keterangan
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Baik', 'dipinjam', ?)
  `);

  const result = insertStmt.run(
    noFormulir, barangId, cleanNama, cleanKelas, cleanKeperluan,
    jml, tanggal_pinjam, tanggal_rencana_kembali, cleanKet
  );

  addLog({
    jenis: 'peminjaman',
    barangId: barang.id,
    peminjamanId: Number(result.lastInsertRowid),
    deskripsi: `Peminjaman ${jml} ${barang.satuan} "${barang.nama_barang} ${barang.spesifikasi || ''}" oleh ${cleanNama} (${cleanKelas || 'Umum'}). Rencana kembali: ${tanggal_rencana_kembali || 'Belum ditentukan'}`,
    adminName: req.admin.nama_lengkap
  });

  res.json({
    success: true,
    message: `Peminjaman ${jml} ${barang.satuan} berhasil dicatat.`,
    peminjaman_id: Number(result.lastInsertRowid),
    nomor_formulir: noFormulir
  });
});

app.post('/api/peminjaman/:id/kembalikan', authMiddleware, (req, res) => {
  if (!req.params.id || !/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'ID peminjaman tidak valid (harus berupa angka).' });
  }
  const id = parseInt(req.params.id, 10);
  if (id <= 0) {
    return res.status(400).json({ error: 'ID peminjaman tidak valid.' });
  }

  const {
    tanggal_kembali = new Date().toISOString().slice(0, 10),
    kondisi_kembali = 'Baik',
    jumlah_kembali,
    catatan = ''
  } = req.body;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal_kembali)) {
    return res.status(400).json({ error: 'Format tanggal kembali harus YYYY-MM-DD.' });
  }

  const validKondisi = ['Baik', 'Rusak'];
  const safeKondisi = validKondisi.includes(kondisi_kembali) ? kondisi_kembali : 'Baik';
  const cleanCatatan = String(catatan).trim().slice(0, 500);

  const pinjam = db.prepare('SELECT * FROM peminjaman WHERE id = ?').get(id);
  if (!pinjam) {
    return res.status(404).json({ error: 'Data transaksi peminjaman tidak ditemukan.' });
  }

  if (pinjam.status === 'dikembalikan') {
    return res.status(400).json({ error: 'Barang untuk transaksi ini sudah dikembalikan sebelumnya.' });
  }

  const jmlKembali = jumlah_kembali !== undefined ? parseInt(jumlah_kembali, 10) : pinjam.jumlah;
  if (isNaN(jmlKembali) || jmlKembali <= 0 || jmlKembali > pinjam.jumlah) {
    return res.status(400).json({ error: `Jumlah kembali tidak valid! Maksimal: ${pinjam.jumlah}.` });
  }

  const isPartial = jmlKembali < pinjam.jumlah;

  if (isPartial) {
    const sisa = pinjam.jumlah - jmlKembali;
    const updRes = db.prepare('UPDATE peminjaman SET jumlah = ? WHERE id = ? AND status = "dipinjam"').run(sisa, id);
    if (updRes.changes === 0) {
      return res.status(400).json({ error: 'Transaksi telah diubah oleh sesi lain.' });
    }

    db.prepare(`
      INSERT INTO peminjaman (
        nomor_formulir, barang_id, nama_peminjam, kelas_jabatan, keperluan,
        jumlah, tanggal_pinjam, tanggal_rencana_kembali, tanggal_kembali_aktual,
        kondisi_saat_pinjam, kondisi_saat_kembali, status, keterangan
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dikembalikan', ?)
    `).run(
      pinjam.nomor_formulir + '-PARTIAL', pinjam.barang_id, pinjam.nama_peminjam,
      pinjam.kelas_jabatan, pinjam.keperluan, jmlKembali, pinjam.tanggal_pinjam,
      pinjam.tanggal_rencana_kembali, tanggal_kembali, pinjam.kondisi_saat_pinjam,
      safeKondisi, `Pengembalian sebagian: ${cleanCatatan}`
    );
  } else {
    // Atomic status update to avoid double returns
    const updRes = db.prepare(`
      UPDATE peminjaman SET
        tanggal_kembali_aktual = ?,
        kondisi_saat_kembali = ?,
        status = 'dikembalikan',
        keterangan = CASE WHEN keterangan != '' THEN keterangan || ' | Catatan kembali: ' || ? ELSE ? END
      WHERE id = ? AND status = 'dipinjam'
    `).run(tanggal_kembali, safeKondisi, cleanCatatan, cleanCatatan, id);

    if (updRes.changes === 0) {
      return res.status(400).json({ error: 'Transaksi telah dikembalikan sebelumnya.' });
    }
  }

  // Restore inventory stock
  const barang = db.prepare('SELECT * FROM barang WHERE id = ?').get(pinjam.barang_id);
  if (barang) {
    if (safeKondisi === 'Rusak') {
      db.prepare('UPDATE barang SET stok_rusak = stok_rusak + ? WHERE id = ?').run(jmlKembali, barang.id);
    } else {
      db.prepare('UPDATE barang SET stok_tersedia = stok_tersedia + ? WHERE id = ?').run(jmlKembali, barang.id);
    }
  }

  const isEarly = Boolean(pinjam.tanggal_rencana_kembali && tanggal_kembali < pinjam.tanggal_rencana_kembali);
  const earlyTag = isEarly ? ' (Kembali Lebih Awal)' : '';

  addLog({
    jenis: 'pengembalian',
    barangId: pinjam.barang_id,
    peminjamanId: id,
    deskripsi: `Pengembalian ${jmlKembali} unit "${barang ? barang.nama_barang : 'Barang'}" oleh ${pinjam.nama_peminjam}${earlyTag}. Kondisi: ${safeKondisi}.${cleanCatatan ? ' Catatan: ' + cleanCatatan : ''}`,
    adminName: req.admin.nama_lengkap
  });

  res.json({
    success: true,
    is_early: isEarly,
    message: `Pengembalian ${jmlKembali} unit barang berhasil dicatat${earlyTag}.`
  });
});

// -------------------------------------------------------------
// EXPORT TO CSV ENDPOINTS (WITH FORMULA INJECTION DEFENSE)
// -------------------------------------------------------------
app.get('/api/export/inventaris', authMiddleware, (req, res) => {
  const items = db.prepare('SELECT * FROM barang ORDER BY id ASC').all();
  let csv = 'Kode,Nama Barang,Spesifikasi,Kategori,Sub Kategori,Stok Total,Stok Tersedia,Stok Rusak,Satuan,Kondisi,Lokasi Penyimpanan,Sumber Dana,Keterangan\n';
  for (const item of items) {
    const row = [
      sanitizeCSVCell(item.kode_barang),
      sanitizeCSVCell(item.nama_barang),
      sanitizeCSVCell(item.spesifikasi),
      sanitizeCSVCell(item.kategori),
      sanitizeCSVCell(item.sub_kategori),
      item.stok_total,
      item.stok_tersedia,
      item.stok_rusak,
      sanitizeCSVCell(item.satuan),
      sanitizeCSVCell(item.kondisi),
      sanitizeCSVCell(item.lokasi_penyimpanan),
      sanitizeCSVCell(item.sumber_dana),
      sanitizeCSVCell(item.keterangan)
    ].join(',');
    csv += row + '\n';
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Inventaris_Lab_Biologi_SMAN1Pinrang_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

app.get('/api/export/logs', authMiddleware, (req, res) => {
  const logs = db.prepare('SELECT * FROM log_riwayat ORDER BY waktu DESC').all();
  let csv = 'ID,Waktu,Jenis Aktivitas,Deskripsi,Admin\n';
  for (const log of logs) {
    const row = [
      log.id,
      sanitizeCSVCell(log.waktu),
      sanitizeCSVCell(log.jenis_aktivitas),
      sanitizeCSVCell(log.deskripsi),
      sanitizeCSVCell(log.admin_name)
    ].join(',');
    csv += row + '\n';
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Log_Aktivitas_Lab_Biologi_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

// -------------------------------------------------------------
// 404 HANDLER FOR API ROUTES (PREVENTS HTML FALLBACK FOR MISSING ENDPOINTS)
// -------------------------------------------------------------
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint API tidak ditemukan.' });
});

// Serve frontend for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err.message);
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Ukuran file melebihi batas maksimal (5MB).' });
    }
    return res.status(400).json({ error: `Kesalahan upload: ${err.message}` });
  }
  if (err.message && err.message.includes('Hanya file berkas berekstensi .csv')) {
    return res.status(400).json({ error: err.message });
  }
  res.status(err.status || 500).json({ error: 'Terjadi kesalahan pada server.' });
});

// Auto-seed if database has 0 items (useful for first-time cloud deployments)
try {
  const { seedDatabase } = require('./seed');
  const count = db.prepare('SELECT COUNT(*) as c FROM barang').get().c;
  if (count === 0) {
    console.log('Database kosong, menjalankan seeder awal otomatis...');
    seedDatabase();
  }
} catch (e) {
  console.error('Auto-seed check error:', e.message);
}

if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`  Sistem Inventarisasi Lab Biologi SMANSA Pinrang`);
    console.log(`  Server aktif di http://0.0.0.0:${PORT}`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
