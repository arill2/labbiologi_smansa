require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { db } = require('./db');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const isSupabase = Boolean(supabaseUrl && supabaseKey);
let supabase = null;

if (isSupabase) {
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
  });
  console.log('✓ Connected to Supabase Cloud Database:', supabaseUrl);
} else {
  console.log('✓ Using Local SQLite Database');
}

// -------------------------------------------------------------
// ADMIN SERVICES
// -------------------------------------------------------------
async function getAdminByUsername(username) {
  if (isSupabase) {
    const { data, error } = await supabase
      .from('admin')
      .select('*')
      .eq('username', username)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
  return db.prepare('SELECT * FROM admin WHERE username = ?').get(username);
}

async function getAdminById(id) {
  if (isSupabase) {
    const { data, error } = await supabase
      .from('admin')
      .select('id, username, nama_lengkap, nip')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
  return db.prepare('SELECT id, username, nama_lengkap, nip FROM admin WHERE id = ?').get(id);
}

async function updateAdminProfile(id, nama_lengkap, nip) {
  if (isSupabase) {
    const { error } = await supabase
      .from('admin')
      .update({ nama_lengkap, nip })
      .eq('id', id);
    if (error) throw error;
    return true;
  }
  db.prepare('UPDATE admin SET nama_lengkap = ?, nip = ? WHERE id = ?').run(nama_lengkap, nip, id);
  return true;
}

async function updateAdminPassword(id, password_hash) {
  if (isSupabase) {
    const { error } = await supabase
      .from('admin')
      .update({ password_hash })
      .eq('id', id);
    if (error) throw error;
    return true;
  }
  db.prepare('UPDATE admin SET password_hash = ? WHERE id = ?').run(password_hash, id);
  return true;
}

// -------------------------------------------------------------
// DASHBOARD STATS
// -------------------------------------------------------------
async function getDashboardStats() {
  if (isSupabase) {
    const { data: barangs, error: bErr } = await supabase
      .from('barang')
      .select('stok_total, stok_tersedia, stok_rusak');
    if (bErr) throw bErr;

    const totalJenis = barangs ? barangs.length : 0;
    let totalStokBaik = 0;
    let totalStokTersedia = 0;
    let totalStokRusak = 0;
    let stokMenipis = 0;

    (barangs || []).forEach(b => {
      totalStokBaik += (b.stok_total || 0);
      totalStokTersedia += (b.stok_tersedia || 0);
      totalStokRusak += (b.stok_rusak || 0);
      if (b.stok_tersedia <= 2 && b.stok_total > 0) {
        stokMenipis++;
      }
    });

    const { data: loans, error: lErr } = await supabase
      .from('peminjaman')
      .select('jumlah, status, tanggal_rencana_kembali')
      .eq('status', 'dipinjam');
    if (lErr) throw lErr;

    const todayStr = new Date().toISOString().slice(0, 10);
    let totalDipinjam = 0;
    let peminjamanTerlambat = 0;

    (loans || []).forEach(l => {
      totalDipinjam += (l.jumlah || 0);
      if (l.tanggal_rencana_kembali && l.tanggal_rencana_kembali < todayStr) {
        peminjamanTerlambat++;
      }
    });

    return {
      total_jenis: totalJenis,
      total_stok_baik: totalStokBaik,
      total_stok_tersedia: totalStokTersedia,
      total_stok_rusak: totalStokRusak,
      total_dipinjam: totalDipinjam,
      peminjaman_terlambat: peminjamanTerlambat,
      stok_menipis: stokMenipis
    };
  }

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

  return {
    total_jenis: totalJenis,
    total_stok_baik: totalStokBaik,
    total_stok_tersedia: totalStokTersedia,
    total_stok_rusak: totalStokRusak,
    total_dipinjam: totalDipinjam,
    peminjaman_terlambat: peminjamanTerlambat,
    stok_menipis: stokMenipis
  };
}

// -------------------------------------------------------------
// LOGS
// -------------------------------------------------------------
async function addLog({ jenis, barangId = null, peminjamanId = null, deskripsi, adminName = 'Admin' }) {
  try {
    if (isSupabase) {
      await supabase.from('log_riwayat').insert({
        jenis_aktivitas: jenis,
        barang_id: barangId ? Number(barangId) : null,
        peminjaman_id: peminjamanId ? Number(peminjamanId) : null,
        deskripsi,
        admin_name: adminName
      });
      return;
    }
    db.prepare(`
      INSERT INTO log_riwayat (jenis_aktivitas, barang_id, peminjaman_id, deskripsi, admin_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(jenis, barangId ? Number(barangId) : null, peminjamanId ? Number(peminjamanId) : null, deskripsi, adminName);
  } catch (err) {
    console.error('Failed to write log:', err.message);
  }
}

async function getLogs({ search = '', jenis = 'semua', startDate = null, endDate = null, page = 1, limit = 50 }) {
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const offset = (pageNum - 1) * limitNum;

  if (isSupabase) {
    let query = supabase.from('log_riwayat').select('*', { count: 'exact' });

    if (search) {
      query = query.or(`deskripsi.ilike.%${search}%,admin_name.ilike.%${search}%`);
    }
    if (jenis && jenis !== 'semua') {
      query = query.eq('jenis_aktivitas', jenis);
    }
    if (startDate) {
      query = query.gte('waktu', `${startDate}T00:00:00Z`);
    }
    if (endDate) {
      query = query.lte('waktu', `${endDate}T23:59:59Z`);
    }

    query = query.order('waktu', { ascending: false }).range(offset, offset + limitNum - 1);
    const { data, count, error } = await query;
    if (error) throw error;

    return {
      logs: data || [],
      total: count || 0,
      page: pageNum,
      limit: limitNum
    };
  }

  let query = 'SELECT * FROM log_riwayat WHERE 1=1';
  const params = [];
  if (search) {
    query += ' AND (deskripsi LIKE ? OR admin_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (jenis !== 'semua') {
    query += ' AND jenis_aktivitas = ?';
    params.push(jenis);
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

  return {
    logs,
    total: totalRows,
    page: pageNum,
    limit: limitNum
  };
}

// -------------------------------------------------------------
// BARANG (INVENTARIS)
// -------------------------------------------------------------
async function getBarangList({ search = '', kategori = 'semua', kondisi = 'semua', lokasi = 'semua', stokMenipis = false }) {
  if (isSupabase) {
    let query = supabase.from('barang').select('*');

    if (search) {
      query = query.or(`nama_barang.ilike.%${search}%,kode_barang.ilike.%${search}%,spesifikasi.ilike.%${search}%,keterangan.ilike.%${search}%`);
    }
    if (kategori && kategori !== 'semua') {
      query = query.eq('kategori', kategori);
    }
    if (kondisi && kondisi !== 'semua') {
      query = query.eq('kondisi', kondisi);
    }
    if (lokasi && lokasi !== 'semua') {
      query = query.ilike('lokasi_penyimpanan', `%${lokasi}%`);
    }
    if (stokMenipis) {
      query = query.lte('stok_tersedia', 2);
    }

    query = query.order('id', { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

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
  return db.prepare(query).all(...params);
}

async function getBarangMeta() {
  if (isSupabase) {
    const { data, error } = await supabase.from('barang').select('kategori, lokasi_penyimpanan');
    if (error) throw error;
    const catSet = new Set();
    const locSet = new Set();
    (data || []).forEach(r => {
      if (r.kategori) catSet.add(r.kategori);
      if (r.lokasi_penyimpanan) locSet.add(r.lokasi_penyimpanan);
    });
    return {
      categories: Array.from(catSet).sort(),
      locations: Array.from(locSet).sort()
    };
  }

  const categories = db.prepare('SELECT DISTINCT kategori FROM barang ORDER BY kategori ASC').all().map(r => r.kategori);
  const locations = db.prepare("SELECT DISTINCT lokasi_penyimpanan FROM barang WHERE lokasi_penyimpanan != '' ORDER BY lokasi_penyimpanan ASC").all().map(r => r.lokasi_penyimpanan);
  return { categories, locations };
}

async function getBarangById(id) {
  if (isSupabase) {
    const { data: item, error } = await supabase.from('barang').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!item) return null;

    const { data: history } = await supabase
      .from('peminjaman')
      .select('*')
      .eq('barang_id', id)
      .order('created_at', { ascending: false })
      .limit(10);

    return { item, historyPeminjaman: history || [] };
  }

  const item = db.prepare('SELECT * FROM barang WHERE id = ?').get(id);
  if (!item) return null;
  const historyPeminjaman = db.prepare(`
    SELECT * FROM peminjaman WHERE barang_id = ? ORDER BY created_at DESC LIMIT 10
  `).all(item.id);
  return { item, historyPeminjaman };
}

async function createBarang(data) {
  if (isSupabase) {
    const { data: inserted, error } = await supabase
      .from('barang')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return inserted.id;
  }

  const stmt = db.prepare(`
    INSERT INTO barang (
      kode_barang, nama_barang, spesifikasi, kategori, sub_kategori,
      stok_total, stok_tersedia, stok_rusak, satuan, kondisi,
      lokasi_penyimpanan, sumber_dana, keterangan
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const res = stmt.run(
    data.kode_barang, data.nama_barang, data.spesifikasi, data.kategori, data.sub_kategori,
    data.stok_total, data.stok_tersedia, data.stok_rusak, data.satuan, data.kondisi,
    data.lokasi_penyimpanan, data.sumber_dana, data.keterangan
  );
  return Number(res.lastInsertRowid);
}

async function updateBarang(id, data) {
  if (isSupabase) {
    const { error } = await supabase
      .from('barang')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    return true;
  }

  const stmt = db.prepare(`
    UPDATE barang SET
      kode_barang = ?, nama_barang = ?, spesifikasi = ?, kategori = ?, sub_kategori = ?,
      stok_total = ?, stok_tersedia = ?, stok_rusak = ?, satuan = ?, kondisi = ?,
      lokasi_penyimpanan = ?, sumber_dana = ?, keterangan = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  stmt.run(
    data.kode_barang, data.nama_barang, data.spesifikasi, data.kategori, data.sub_kategori,
    data.stok_total, data.stok_tersedia, data.stok_rusak, data.satuan, data.kondisi,
    data.lokasi_penyimpanan, data.sumber_dana, data.keterangan, id
  );
  return true;
}

async function deleteBarang(id) {
  if (isSupabase) {
    const { count, error: cErr } = await supabase
      .from('peminjaman')
      .select('*', { count: 'exact', head: true })
      .eq('barang_id', id)
      .eq('status', 'dipinjam');
    if (cErr) throw cErr;
    if (count > 0) {
      throw new Error('Barang tidak dapat dihapus karena masih sedang dipinjam!');
    }

    const { error } = await supabase.from('barang').delete().eq('id', id);
    if (error) throw error;
    return true;
  }

  const activeBorrow = db.prepare("SELECT COUNT(*) as c FROM peminjaman WHERE barang_id = ? AND status = 'dipinjam'").get(id).c;
  if (activeBorrow > 0) {
    throw new Error('Barang tidak dapat dihapus karena masih sedang dipinjam!');
  }
  db.prepare('DELETE FROM barang WHERE id = ?').run(id);
  return true;
}

// -------------------------------------------------------------
// PEMINJAMAN
// -------------------------------------------------------------
async function getPeminjamanList({ status = 'semua', search = '' }) {
  const todayStr = new Date().toISOString().slice(0, 10);

  if (isSupabase) {
    let query = supabase.from('peminjaman').select('*');
    if (status && status !== 'semua') {
      query = query.eq('status', status);
    }
    if (search) {
      query = query.or(`nama_peminjam.ilike.%${search}%,nomor_formulir.ilike.%${search}%,keperluan.ilike.%${search}%`);
    }
    query = query.order('id', { ascending: false });
    const { data: rows, error } = await query;
    if (error) throw error;

    // Fetch barang info for each row
    const barangIds = Array.from(new Set((rows || []).map(r => r.barang_id)));
    let barangMap = {};
    if (barangIds.length > 0) {
      const { data: barangs } = await supabase.from('barang').select('id, nama_barang, satuan, spesifikasi').in('id', barangIds);
      (barangs || []).forEach(b => { barangMap[b.id] = b; });
    }

    return (rows || []).map(r => {
      const b = barangMap[r.barang_id] || {};
      const isTerlambat = (r.status === 'dipinjam' && r.tanggal_rencana_kembali && r.tanggal_rencana_kembali < todayStr) ? 1 : 0;
      return {
        ...r,
        nama_barang: b.nama_barang || 'Barang Terhapus',
        barang_satuan: b.satuan || 'Unit',
        barang_spesifikasi: b.spesifikasi || '',
        is_terlambat: isTerlambat
      };
    });
  }

  let query = `
    SELECT 
      p.*,
      b.nama_barang,
      b.satuan as barang_satuan,
      b.spesifikasi as barang_spesifikasi,
      CASE 
        WHEN p.status = 'dipinjam' AND p.tanggal_rencana_kembali IS NOT NULL AND p.tanggal_rencana_kembali < date('now') THEN 1 
        ELSE 0 
      END as is_terlambat
    FROM peminjaman p
    LEFT JOIN barang b ON p.barang_id = b.id
    WHERE 1=1
  `;
  const params = [];

  if (status && status !== 'semua') {
    query += ' AND p.status = ?';
    params.push(status);
  }
  if (search) {
    query += ' AND (p.nama_peminjam LIKE ? OR p.nomor_formulir LIKE ? OR b.nama_barang LIKE ? OR p.keperluan LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY p.id DESC';
  return db.prepare(query).all(...params);
}

async function createPeminjaman(data) {
  if (isSupabase) {
    // 1. Get barang
    const { data: barang, error: bErr } = await supabase.from('barang').select('*').eq('id', data.barang_id).single();
    if (bErr || !barang) throw new Error('Barang tidak ditemukan.');

    if (barang.stok_tersedia < data.jumlah) {
      throw new Error(`Stok tersedia tidak mencukupi! Tersedia: ${barang.stok_tersedia} ${barang.satuan}, diminta: ${data.jumlah} ${barang.satuan}.`);
    }

    // 2. Decrement stock
    const newStock = barang.stok_tersedia - data.jumlah;
    const { error: updErr } = await supabase.from('barang').update({ stok_tersedia: newStock }).eq('id', data.barang_id);
    if (updErr) throw updErr;

    // 3. Generate form number
    const todayNum = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const { count } = await supabase.from('peminjaman').select('*', { count: 'exact', head: true });
    const noFormulir = `FP-${todayNum}-${String((count || 0) + 1).padStart(3, '0')}`;

    // 4. Insert loan
    const { data: inserted, error: pErr } = await supabase.from('peminjaman').insert({
      nomor_formulir: noFormulir,
      barang_id: data.barang_id,
      nama_peminjam: data.nama_peminjam,
      kelas_jabatan: data.kelas_jabatan,
      keperluan: data.keperluan,
      jumlah: data.jumlah,
      tanggal_pinjam: data.tanggal_pinjam,
      tanggal_rencana_kembali: data.tanggal_rencana_kembali || null,
      keterangan: data.keterangan || ''
    }).select().single();

    if (pErr) throw pErr;

    return {
      peminjaman_id: inserted.id,
      nomor_formulir: noFormulir,
      barang
    };
  }

  // SQLite execution
  const barang = db.prepare('SELECT * FROM barang WHERE id = ?').get(data.barang_id);
  if (!barang) throw new Error('Barang tidak ditemukan.');

  const updateRes = db.prepare(`
    UPDATE barang 
    SET stok_tersedia = stok_tersedia - ? 
    WHERE id = ? AND stok_tersedia >= ?
  `).run(data.jumlah, data.barang_id, data.jumlah);

  if (updateRes.changes === 0) {
    throw new Error(`Stok tersedia tidak mencukupi! Tersedia: ${barang.stok_tersedia} ${barang.satuan}, diminta: ${data.jumlah} ${barang.satuan}.`);
  }

  const todayNum = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const countToday = db.prepare("SELECT COUNT(*) as c FROM peminjaman WHERE tanggal_pinjam >= date('now', 'start of month')").get().c + 1;
  const noFormulir = `FP-${todayNum}-${String(countToday).padStart(3, '0')}`;

  const insertStmt = db.prepare(`
    INSERT INTO peminjaman (
      nomor_formulir, barang_id, nama_peminjam, kelas_jabatan, keperluan,
      jumlah, tanggal_pinjam, tanggal_rencana_kembali, keterangan
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insertStmt.run(
    noFormulir, data.barang_id, data.nama_peminjam, data.kelas_jabatan, data.keperluan,
    data.jumlah, data.tanggal_pinjam, data.tanggal_rencana_kembali || null, data.keterangan || ''
  );

  return {
    peminjaman_id: Number(result.lastInsertRowid),
    nomor_formulir: noFormulir,
    barang
  };
}

async function kembalikanPeminjaman(id, { jumlah_kembali, tanggal_kembali, kondisi_kembali, catatan, adminName }) {
  if (isSupabase) {
    const { data: pinjam, error: pErr } = await supabase.from('peminjaman').select('*').eq('id', id).single();
    if (pErr || !pinjam) throw new Error('Data peminjaman tidak ditemukan.');
    if (pinjam.status === 'dikembalikan') throw new Error('Barang untuk transaksi ini sudah dikembalikan sebelumnya.');

    const jmlKembali = jumlah_kembali !== undefined ? parseInt(jumlah_kembali, 10) : pinjam.jumlah;
    if (isNaN(jmlKembali) || jmlKembali <= 0 || jmlKembali > pinjam.jumlah) {
      throw new Error(`Jumlah kembali tidak valid! Maksimal: ${pinjam.jumlah}.`);
    }

    const isPartial = jmlKembali < pinjam.jumlah;
    const isEarly = Boolean(pinjam.tanggal_rencana_kembali && tanggal_kembali < pinjam.tanggal_rencana_kembali);
    const earlyTag = isEarly ? ' (Kembali Lebih Awal)' : '';

    if (isPartial) {
      const sisa = pinjam.jumlah - jmlKembali;
      await supabase.from('peminjaman').update({ jumlah: sisa }).eq('id', id);
      await supabase.from('peminjaman').insert({
        nomor_formulir: pinjam.nomor_formulir + '-PARTIAL',
        barang_id: pinjam.barang_id,
        nama_peminjam: pinjam.nama_peminjam,
        kelas_jabatan: pinjam.kelas_jabatan,
        keperluan: pinjam.keperluan,
        jumlah: jmlKembali,
        tanggal_pinjam: pinjam.tanggal_pinjam,
        tanggal_rencana_kembali: pinjam.tanggal_rencana_kembali,
        tanggal_kembali_aktual: tanggal_kembali,
        kondisi_saat_pinjam: pinjam.kondisi_saat_pinjam,
        kondisi_saat_kembali: kondisi_kembali,
        status: 'dikembalikan',
        keterangan: `Pengembalian sebagian: ${catatan}`
      });
    } else {
      await supabase.from('peminjaman').update({
        tanggal_kembali_aktual: tanggal_kembali,
        kondisi_saat_kembali: kondisi_kembali,
        status: 'dikembalikan',
        keterangan: pinjam.keterangan ? `${pinjam.keterangan} | Catatan kembali: ${catatan}` : catatan
      }).eq('id', id);
    }

    // Restore stock
    const { data: barang } = await supabase.from('barang').select('*').eq('id', pinjam.barang_id).single();
    if (barang) {
      if (kondisi_kembali === 'Rusak') {
        await supabase.from('barang').update({ stok_rusak: (barang.stok_rusak || 0) + jmlKembali }).eq('id', barang.id);
      } else {
        await supabase.from('barang').update({ stok_tersedia: (barang.stok_tersedia || 0) + jmlKembali }).eq('id', barang.id);
      }
    }

    await addLog({
      jenis: 'pengembalian',
      barangId: pinjam.barang_id,
      peminjamanId: id,
      deskripsi: `Pengembalian ${jmlKembali} unit "${barang ? barang.nama_barang : 'Barang'}" oleh ${pinjam.nama_peminjam}${earlyTag}. Kondisi: ${kondisi_kembali}.${catatan ? ' Catatan: ' + catatan : ''}`,
      adminName
    });

    return {
      success: true,
      is_early: isEarly,
      message: `Pengembalian ${jmlKembali} unit barang berhasil dicatat${earlyTag}.`
    };
  }

  // SQLite implementation
  const pinjam = db.prepare('SELECT * FROM peminjaman WHERE id = ?').get(id);
  if (!pinjam) throw new Error('Data peminjaman tidak ditemukan.');
  if (pinjam.status === 'dikembalikan') throw new Error('Barang untuk transaksi ini sudah dikembalikan sebelumnya.');

  const jmlKembali = jumlah_kembali !== undefined ? parseInt(jumlah_kembali, 10) : pinjam.jumlah;
  if (isNaN(jmlKembali) || jmlKembali <= 0 || jmlKembali > pinjam.jumlah) {
    throw new Error(`Jumlah kembali tidak valid! Maksimal: ${pinjam.jumlah}.`);
  }

  const isPartial = jmlKembali < pinjam.jumlah;
  const isEarly = Boolean(pinjam.tanggal_rencana_kembali && tanggal_kembali < pinjam.tanggal_rencana_kembali);
  const earlyTag = isEarly ? ' (Kembali Lebih Awal)' : '';

  if (isPartial) {
    const sisa = pinjam.jumlah - jmlKembali;
    db.prepare('UPDATE peminjaman SET jumlah = ? WHERE id = ? AND status = "dipinjam"').run(sisa, id);
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
      kondisi_kembali, `Pengembalian sebagian: ${catatan}`
    );
  } else {
    db.prepare(`
      UPDATE peminjaman SET
        tanggal_kembali_aktual = ?,
        kondisi_saat_kembali = ?,
        status = 'dikembalikan',
        keterangan = CASE WHEN keterangan != '' THEN keterangan || ' | Catatan kembali: ' || ? ELSE ? END
      WHERE id = ? AND status = 'dipinjam'
    `).run(tanggal_kembali, kondisi_kembali, catatan, catatan, id);
  }

  const barang = db.prepare('SELECT * FROM barang WHERE id = ?').get(pinjam.barang_id);
  if (barang) {
    if (kondisi_kembali === 'Rusak') {
      db.prepare('UPDATE barang SET stok_rusak = stok_rusak + ? WHERE id = ?').run(jmlKembali, barang.id);
    } else {
      db.prepare('UPDATE barang SET stok_tersedia = stok_tersedia + ? WHERE id = ?').run(jmlKembali, barang.id);
    }
  }

  await addLog({
    jenis: 'pengembalian',
    barangId: pinjam.barang_id,
    peminjamanId: id,
    deskripsi: `Pengembalian ${jmlKembali} unit "${barang ? barang.nama_barang : 'Barang'}" oleh ${pinjam.nama_peminjam}${earlyTag}. Kondisi: ${kondisi_kembali}.${catatan ? ' Catatan: ' + catatan : ''}`,
    adminName
  });

  return {
    success: true,
    is_early: isEarly,
    message: `Pengembalian ${jmlKembali} unit barang berhasil dicatat${earlyTag}.`
  };
}

module.exports = {
  isSupabase,
  getAdminByUsername,
  getAdminById,
  updateAdminProfile,
  updateAdminPassword,
  getDashboardStats,
  addLog,
  getLogs,
  getBarangList,
  getBarangMeta,
  getBarangById,
  createBarang,
  updateBarang,
  deleteBarang,
  getPeminjamanList,
  createPeminjaman,
  kembalikanPeminjaman
};
