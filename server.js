require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const dataService = require('./dataService');
const { db } = require('./db');

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
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.supabase.co;"
  );
  next();
});

// Middleware
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
const loginRateLimit = new Map();

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

// Token creation & timing-safe verification
function createToken(adminId) {
  const timestamp = Date.now();
  const payload = `${adminId}:${timestamp}`;
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

async function authMiddleware(req, res, next) {
  const token = req.cookies.auth_token || req.headers['authorization']?.replace('Bearer ', '');
  const adminId = verifyToken(token);
  if (!adminId) {
    return res.status(401).json({ error: 'Sesi telah berakhir atau tidak valid. Silakan login kembali.' });
  }

  try {
    const admin = await dataService.getAdminById(adminId);
    if (!admin) {
      return res.status(401).json({ error: 'Akun admin tidak ditemukan.' });
    }
    req.admin = admin;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Kesalahan otentikasi.' });
  }
}

// Security: Formula Injection Mitigation for CSV Export
function sanitizeCSVCell(value) {
  if (value === null || value === undefined) return '""';
  let str = String(value).trim();
  if (/^[=\+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

// -------------------------------------------------------------
// AUTH ENDPOINTS
// -------------------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
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

  try {
    const admin = await dataService.getAdminByUsername(cleanUsername);

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
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Terjadi kesalahan sistem saat login.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ success: true, message: 'Berhasil keluar.' });
});

app.get('/api/auth/me', async (req, res) => {
  const token = req.cookies.auth_token || req.headers['authorization']?.replace('Bearer ', '');
  const adminId = verifyToken(token);
  if (!adminId) {
    return res.status(401).json({ authenticated: false });
  }
  try {
    const admin = await dataService.getAdminById(adminId);
    if (!admin) {
      return res.status(401).json({ authenticated: false });
    }
    res.json({ authenticated: true, admin });
  } catch (err) {
    res.status(500).json({ authenticated: false });
  }
});

app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
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

  try {
    const admin = await dataService.getAdminByUsername(req.admin.username);
    if (!bcrypt.compareSync(current_password, admin.password_hash)) {
      return res.status(400).json({ error: 'Password saat ini salah.' });
    }

    const newHash = bcrypt.hashSync(new_password, 10);
    await dataService.updateAdminPassword(req.admin.id, newHash);

    await dataService.addLog({
      jenis: 'edit_barang',
      deskripsi: `Admin "${admin.nama_lengkap}" memperbarui password akun.`,
      adminName: admin.nama_lengkap
    });

    res.json({ success: true, message: 'Password berhasil diperbarui.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// DASHBOARD & STATS ENDPOINTS
// -------------------------------------------------------------
app.get('/api/dashboard/stats', authMiddleware, async (req, res) => {
  try {
    const stats = await dataService.getDashboardStats();
    res.json(stats);
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// ACTIVITY LOG ENDPOINTS
// -------------------------------------------------------------
app.get('/api/logs', authMiddleware, async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const jenis = typeof req.query.jenis === 'string' ? req.query.jenis.trim() : 'semua';
  const startDate = typeof req.query.start_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.start_date) ? req.query.start_date : null;
  const endDate = typeof req.query.end_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.end_date) ? req.query.end_date : null;

  const validJenis = ['semua', 'peminjaman', 'pengembalian', 'tambah_barang', 'edit_barang', 'hapus_barang', 'import_csv'];
  const safeJenis = validJenis.includes(jenis) ? jenis : 'semua';

  try {
    const result = await dataService.getLogs({
      search,
      jenis: safeJenis,
      startDate,
      endDate,
      page: req.query.page,
      limit: req.query.limit
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// INVENTORY (BARANG) ENDPOINTS
// -------------------------------------------------------------
app.get('/api/barang', authMiddleware, async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const kategori = typeof req.query.kategori === 'string' ? req.query.kategori.trim().slice(0, 100) : 'semua';
  const kondisi = typeof req.query.kondisi === 'string' ? req.query.kondisi.trim().slice(0, 50) : 'semua';
  const lokasi = typeof req.query.lokasi === 'string' ? req.query.lokasi.trim().slice(0, 100) : 'semua';
  const stokMenipis = req.query.stok_menipis === 'true';

  try {
    const items = await dataService.getBarangList({
      search,
      kategori,
      kondisi,
      lokasi,
      stokMenipis
    });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/barang/meta', authMiddleware, async (req, res) => {
  try {
    const meta = await dataService.getBarangMeta();
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/barang/:id', authMiddleware, async (req, res) => {
  if (!req.params.id || !/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'ID barang tidak valid (harus berupa angka).' });
  }
  const id = parseInt(req.params.id, 10);
  if (id <= 0) {
    return res.status(400).json({ error: 'ID barang tidak valid.' });
  }

  try {
    const result = await dataService.getBarangById(id);
    if (!result) return res.status(404).json({ error: 'Barang tidak ditemukan.' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/barang', authMiddleware, async (req, res) => {
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

  try {
    const id = await dataService.createBarang({
      kode_barang: cleanKode,
      nama_barang: cleanNama,
      spesifikasi: cleanSpek,
      kategori: cleanKategori,
      sub_kategori: cleanSubKat,
      stok_total: total,
      stok_tersedia: tersedia,
      stok_rusak: rusak,
      satuan: cleanSatuan,
      kondisi: safeKondisi,
      lokasi_penyimpanan: cleanLokasi,
      sumber_dana: cleanSumber,
      keterangan: cleanKet
    });

    await dataService.addLog({
      jenis: 'tambah_barang',
      barangId: id,
      deskripsi: `Penambahan barang baru: "${cleanNama} ${cleanSpek}" (Stok: ${total} ${cleanSatuan}, Lokasi: ${cleanLokasi})`,
      adminName: req.admin.nama_lengkap
    });

    res.json({ success: true, id, message: 'Barang berhasil ditambahkan.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/barang/:id', authMiddleware, async (req, res) => {
  if (!req.params.id || !/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'ID barang tidak valid (harus berupa angka).' });
  }
  const id = parseInt(req.params.id, 10);
  if (id <= 0) {
    return res.status(400).json({ error: 'ID barang tidak valid.' });
  }

  try {
    const itemData = await dataService.getBarangById(id);
    if (!itemData || !itemData.item) return res.status(404).json({ error: 'Barang tidak ditemukan.' });
    const item = itemData.item;

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
    const validKondisi = ['Baik', 'Sebagian Rusak', 'Rusak'];
    const safeKondisi = validKondisi.includes(kondisi) ? kondisi : item.kondisi;

    const cleanNama = String(nama_barang).trim().slice(0, 200);
    const cleanKode = String(kode_barang).trim().slice(0, 50);
    const cleanSpek = String(spesifikasi).trim().slice(0, 200);
    const cleanKategori = String(kategori).trim().slice(0, 100);
    const cleanSubKat = String(sub_kategori).trim().slice(0, 100);
    const cleanSatuan = String(satuan).trim().slice(0, 50) || 'Buah';
    const cleanLokasi = String(lokasi_penyimpanan).trim().slice(0, 150) || 'Lab Biologi';
    const cleanSumber = String(sumber_dana).trim().slice(0, 100);
    const cleanKet = String(keterangan).trim().slice(0, 500);

    const newTersedia = Math.max(0, newTotal - newRusak);

    await dataService.updateBarang(id, {
      kode_barang: cleanKode,
      nama_barang: cleanNama,
      spesifikasi: cleanSpek,
      kategori: cleanKategori,
      sub_kategori: cleanSubKat,
      stok_total: newTotal,
      stok_tersedia: newTersedia,
      stok_rusak: newRusak,
      satuan: cleanSatuan,
      kondisi: safeKondisi,
      lokasi_penyimpanan: cleanLokasi,
      sumber_dana: cleanSumber,
      keterangan: cleanKet
    });

    await dataService.addLog({
      jenis: 'edit_barang',
      barangId: id,
      deskripsi: `Pembaruan data barang "${cleanNama}": Stok total diubah menjadi ${newTotal} ${cleanSatuan}, kondisi "${safeKondisi}".`,
      adminName: req.admin.nama_lengkap
    });

    res.json({ success: true, message: 'Data barang berhasil diperbarui.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/barang/:id', authMiddleware, async (req, res) => {
  if (!req.params.id || !/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'ID barang tidak valid (harus berupa angka).' });
  }
  const id = parseInt(req.params.id, 10);
  if (id <= 0) {
    return res.status(400).json({ error: 'ID barang tidak valid.' });
  }

  try {
    const itemData = await dataService.getBarangById(id);
    if (!itemData || !itemData.item) return res.status(404).json({ error: 'Barang tidak ditemukan.' });

    await dataService.deleteBarang(id);

    await dataService.addLog({
      jenis: 'hapus_barang',
      deskripsi: `Penghapusan barang: "${itemData.item.nama_barang} ${itemData.item.spesifikasi || ''}" (ID: ${id}) oleh Admin.`,
      adminName: req.admin.nama_lengkap
    });

    res.json({ success: true, message: 'Barang berhasil dihapus.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// CSV IMPORT PREVIEW & COMMIT
// -------------------------------------------------------------
app.post('/api/import/preview', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Silakan pilih berkas CSV yang valid.' });
  }

  try {
    const content = req.file.buffer.toString('utf8');
    const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) {
      return res.status(400).json({ error: 'Berkas CSV kosong atau tidak memiliki baris data.' });
    }

    const parsedItems = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
      if (parts.length >= 2 && parts[1]) {
        parsedItems.push({
          kode_barang: parts[0] || '',
          nama_barang: parts[1],
          spesifikasi: parts[2] || '',
          kategori: parts[3] || 'Alat Lab Biologi',
          sub_kategori: parts[4] || 'Umum',
          stok_total: parseInt(parts[5], 10) || 1,
          satuan: parts[6] || 'Buah',
          kondisi: parts[7] || 'Baik',
          lokasi_penyimpanan: parts[8] || 'Lab Biologi'
        });
      }
    }

    res.json({
      success: true,
      total_rows: parsedItems.length,
      valid_count: parsedItems.length,
      preview_items: parsedItems.slice(0, 10),
      all_items: parsedItems
    });
  } catch (err) {
    res.status(400).json({ error: `Gagal memproses CSV: ${err.message}` });
  }
});

app.post('/api/import/commit', authMiddleware, async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Tidak ada data barang yang valid untuk diimpor.' });
  }

  let added = 0;
  let updated = 0;

  try {
    const existingList = await dataService.getBarangList({});
    const existingMap = new Map();
    existingList.forEach(b => {
      const key = `${b.nama_barang.toLowerCase().trim()}::${(b.spesifikasi || '').toLowerCase().trim()}`;
      existingMap.set(key, b);
      if (b.kode_barang) existingMap.set(b.kode_barang.toLowerCase().trim(), b);
    });

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

      const key = `${safeNama.toLowerCase().trim()}::${safeSpek.toLowerCase().trim()}`;
      const existing = existingMap.get(key) || (safeKode ? existingMap.get(safeKode.toLowerCase().trim()) : null);

      if (existing) {
        await dataService.updateBarang(existing.id, {
          kode_barang: safeKode || existing.kode_barang,
          nama_barang: safeNama,
          spesifikasi: safeSpek,
          kategori: safeKategori,
          sub_kategori: safeSubKat,
          stok_total: total,
          stok_tersedia: total,
          stok_rusak: rusak,
          satuan: safeSatuan,
          kondisi,
          lokasi_penyimpanan: safeLokasi,
          sumber_dana: safeSumber,
          keterangan: safeKet
        });
        updated++;
      } else {
        await dataService.createBarang({
          kode_barang: safeKode,
          nama_barang: safeNama,
          spesifikasi: safeSpek,
          kategori: safeKategori,
          sub_kategori: safeSubKat,
          stok_total: total,
          stok_tersedia: total,
          stok_rusak: rusak,
          satuan: safeSatuan,
          kondisi,
          lokasi_penyimpanan: safeLokasi,
          sumber_dana: safeSumber,
          keterangan: safeKet
        });
        added++;
      }
    }

    await dataService.addLog({
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// PEMINJAMAN & PENGEMBALIAN ENDPOINTS
// -------------------------------------------------------------
app.get('/api/peminjaman', authMiddleware, async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : 'semua';
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';

  try {
    const rows = await dataService.getPeminjamanList({ status, search });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/peminjaman', authMiddleware, async (req, res) => {
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

  const cleanNama = nama_peminjam.trim().slice(0, 150);
  const cleanKelas = String(kelas_jabatan).trim().slice(0, 100);
  const cleanKeperluan = String(keperluan).trim().slice(0, 200);
  const cleanKet = String(keterangan).trim().slice(0, 500);

  try {
    const result = await dataService.createPeminjaman({
      barang_id: barangId,
      nama_peminjam: cleanNama,
      kelas_jabatan: cleanKelas,
      keperluan: cleanKeperluan,
      jumlah: jml,
      tanggal_pinjam,
      tanggal_rencana_kembali,
      keterangan: cleanKet
    });

    await dataService.addLog({
      jenis: 'peminjaman',
      barangId: result.barang.id,
      peminjamanId: result.peminjaman_id,
      deskripsi: `Peminjaman ${jml} ${result.barang.satuan} "${result.barang.nama_barang} ${result.barang.spesifikasi || ''}" oleh ${cleanNama} (${cleanKelas || 'Umum'}). Rencana kembali: ${tanggal_rencana_kembali || 'Belum ditentukan'}`,
      adminName: req.admin.nama_lengkap
    });

    res.json({
      success: true,
      message: `Peminjaman ${jml} ${result.barang.satuan} berhasil dicatat.`,
      peminjaman_id: result.peminjaman_id,
      nomor_formulir: result.nomor_formulir
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/peminjaman/:id/kembalikan', authMiddleware, async (req, res) => {
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

  try {
    const result = await dataService.kembalikanPeminjaman(id, {
      jumlah_kembali,
      tanggal_kembali,
      kondisi_kembali: safeKondisi,
      catatan: cleanCatatan,
      adminName: req.admin.nama_lengkap
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// EXPORT TO CSV ENDPOINTS
// -------------------------------------------------------------
app.get('/api/export/inventaris', authMiddleware, async (req, res) => {
  try {
    const items = await dataService.getBarangList({});
    let csv = 'Kode,Nama Barang,Spesifikasi,Kategori,Sub Kategori,Stok Total,Stok Tersedia,Stok Rusak,Satuan,Kondisi,Lokasi Penyimpanan,Sumber Dana,Keterangan\n';
    for (const item of items) {
      csv += [
        sanitizeCSVCell(item.kode_barang || ''),
        sanitizeCSVCell(item.nama_barang || ''),
        sanitizeCSVCell(item.spesifikasi || ''),
        sanitizeCSVCell(item.kategori || ''),
        sanitizeCSVCell(item.sub_kategori || ''),
        item.stok_total,
        item.stok_tersedia,
        item.stok_rusak,
        sanitizeCSVCell(item.satuan || 'Buah'),
        sanitizeCSVCell(item.kondisi || 'Baik'),
        sanitizeCSVCell(item.lokasi_penyimpanan || ''),
        sanitizeCSVCell(item.sumber_dana || ''),
        sanitizeCSVCell(item.keterangan || '')
      ].join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="inventaris_lab_biologi.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/export/logs', authMiddleware, async (req, res) => {
  try {
    const { logs } = await dataService.getLogs({ limit: 10000 });
    let csv = 'ID,Waktu,Jenis Aktivitas,Deskripsi,Admin\n';
    for (const log of logs) {
      csv += [
        log.id,
        sanitizeCSVCell(log.waktu),
        sanitizeCSVCell(log.jenis_aktivitas),
        sanitizeCSVCell(log.deskripsi),
        sanitizeCSVCell(log.admin_name || 'Admin')
      ].join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="log_riwayat_aktivitas.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 404 HANDLER FOR API ROUTES
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

// Auto-seed if database has 0 items (when using local SQLite)
if (!dataService.isSupabase) {
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
