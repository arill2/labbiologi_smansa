// Sistem Inventarisasi Lab Biologi SMANSA Pinrang
// Client-side Application Logic

document.addEventListener('DOMContentLoaded', () => {
  // State Management
  const state = {
    currentUser: null,
    activeTab: 'tab-home',
    barangList: [],
    categories: [],
    locations: [],
    peminjamanList: [],
    currentPinjamSubtab: 'dipinjam',
    importParsedItems: [],
    auditPage: 1,
    auditLimit: 20
  };

  // DOM Elements
  const loginView = document.getElementById('login-view');
  const mainApp = document.getElementById('main-app');
  const loginForm = document.getElementById('login-form');
  const btnLogout = document.getElementById('btn-logout');
  const themeToggle = document.getElementById('theme-toggle');
  const themeText = document.getElementById('theme-text');
  const pageHeading = document.getElementById('page-heading');

  // Navigation Items
  const navItems = document.querySelectorAll('.nav-item');
  const tabViews = document.querySelectorAll('.tab-view');

  // Init Theme
  function initTheme() {
    const savedTheme = localStorage.getItem('lab_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeButton(savedTheme);
  }

  function updateThemeButton(theme) {
    if (theme === 'dark') {
      themeText.textContent = 'Mode Gelap';
    } else {
      themeText.textContent = 'Mode Terang';
    }
  }

  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('lab_theme', next);
    updateThemeButton(next);
  });

  // Toast System
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconSvg = '';
    if (type === 'success') {
      iconSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
    } else if (type === 'error') {
      iconSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
    } else {
      iconSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    }

    toast.innerHTML = `${iconSvg}<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Auth Functions
  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data.authenticated && data.admin) {
        setLoggedIn(data.admin);
      } else {
        setLoggedOut();
      }
    } catch (e) {
      setLoggedOut();
    }
  }

  function setLoggedIn(admin) {
    state.currentUser = admin;
    loginView.style.display = 'none';
    mainApp.style.display = 'flex';

    document.getElementById('sidebar-user-name').textContent = admin.nama_lengkap || admin.username;
    document.getElementById('sidebar-user-initials').textContent = (admin.nama_lengkap || 'Admin')
      .split(' ')
      .map(w => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

    // Load Initial Data
    loadDashboardStats();
    loadDashboardLogs();
    loadBarangMeta();
    loadBarangList();
    loadPeminjamanList();
    loadAuditLogs();
  }

  function setLoggedOut() {
    state.currentUser = null;
    loginView.style.display = 'flex';
    mainApp.style.display = 'none';
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Login berhasil! Selamat datang di Lab Biologi SMANSA.', 'success');
        setLoggedIn(data.admin);
      } else {
        showToast(data.error || 'Login gagal.', 'error');
      }
    } catch (err) {
      showToast('Terjadi kesalahan saat menghubung ke server.', 'error');
    }
  });

  btnLogout.addEventListener('click', async () => {
    if (!confirm('Apakah Anda yakin ingin keluar dari sistem?')) return;
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      showToast('Anda telah berhasil keluar.', 'info');
      setLoggedOut();
    } catch (err) {
      setLoggedOut();
    }
  });

  // Tab Navigation
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });

  function switchTab(tabId) {
    state.activeTab = tabId;
    navItems.forEach(n => {
      if (n.getAttribute('data-tab') === tabId) {
        n.classList.add('active');
      } else {
        n.classList.remove('active');
      }
    });

    tabViews.forEach(v => {
      if (v.id === tabId) {
        v.classList.add('active');
      } else {
        v.classList.remove('active');
      }
    });

    // Update Heading Title
    if (tabId === 'tab-home') {
      pageHeading.textContent = 'Dashboard & Riwayat Aktivitas';
      loadDashboardStats();
      loadDashboardLogs();
    } else if (tabId === 'tab-inventaris') {
      pageHeading.textContent = 'Inventaris Peralatan & Bahan Lab';
      loadBarangList();
    } else if (tabId === 'tab-peminjaman') {
      pageHeading.textContent = 'Peminjaman & Pengembalian Alat';
      loadPeminjamanList();
    } else if (tabId === 'tab-logs') {
      pageHeading.textContent = 'Arsip Lengkap Log Riwayat Sistem';
      loadAuditLogs();
    }
  }

  // -------------------------------------------------------------
  // DASHBOARD FUNCTIONS
  // -------------------------------------------------------------
  async function loadDashboardStats() {
    try {
      const res = await fetch('/api/dashboard/stats');
      if (!res.ok) return;
      const data = await res.json();

      document.getElementById('stat-total-jenis').textContent = data.total_jenis || 0;
      document.getElementById('stat-stok-tersedia').textContent = data.total_stok_tersedia || 0;
      document.getElementById('stat-total-dipinjam').textContent = data.total_dipinjam || 0;
      document.getElementById('stat-stok-rusak').textContent = data.total_stok_rusak || 0;

      // Update sidebar badges
      document.getElementById('badge-total-barang').textContent = data.total_jenis || 0;
      document.getElementById('badge-total-pinjam').textContent = data.total_dipinjam || 0;
    } catch (e) {
      console.error(e);
    }
  }

  async function loadDashboardLogs() {
    const search = document.getElementById('filter-log-search').value.trim();
    const jenis = document.getElementById('filter-log-jenis').value;

    try {
      const url = new URL('/api/logs', window.location.origin);
      url.searchParams.set('limit', '25');
      if (search) url.searchParams.set('search', search);
      if (jenis && jenis !== 'semua') url.searchParams.set('jenis', jenis);

      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      renderDashboardLogs(data.logs || []);
    } catch (e) {
      console.error(e);
    }
  }

  function renderDashboardLogs(logs) {
    const container = document.getElementById('dashboard-log-list');
    container.innerHTML = '';

    if (logs.length === 0) {
      container.innerHTML = `
        <div style="padding: 30px; text-align: center; color: var(--text-muted);">
          Belum ada riwayat aktivitas yang tercatat.
        </div>
      `;
      return;
    }

    logs.forEach(log => {
      const item = document.createElement('div');
      item.className = 'log-item';

      let badgeClass = 'badge-info';
      let iconColor = 'indigo';
      let typeLabel = log.jenis_aktivitas;

      if (log.jenis_aktivitas === 'peminjaman') {
        badgeClass = 'badge-warning';
        iconColor = 'amber';
        typeLabel = 'Peminjaman';
      } else if (log.jenis_aktivitas === 'pengembalian') {
        badgeClass = 'badge-success';
        iconColor = 'emerald';
        typeLabel = 'Pengembalian';
      } else if (log.jenis_aktivitas === 'tambah_barang') {
        badgeClass = 'badge-primary';
        iconColor = 'emerald';
        typeLabel = 'Tambah Barang';
      } else if (log.jenis_aktivitas === 'edit_barang') {
        badgeClass = 'badge-info';
        iconColor = 'indigo';
        typeLabel = 'Edit Barang';
      } else if (log.jenis_aktivitas === 'hapus_barang') {
        badgeClass = 'badge-danger';
        iconColor = 'rose';
        typeLabel = 'Hapus Barang';
      } else if (log.jenis_aktivitas === 'import_csv') {
        badgeClass = 'badge-primary';
        iconColor = 'emerald';
        typeLabel = 'Import CSV';
      }

      // Format Date
      const dateObj = new Date(log.waktu);
      const timeStr = dateObj.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      item.innerHTML = `
        <div class="log-icon-wrap stat-icon ${iconColor}">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 11 12 14 22 4"/>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
        </div>
        <div class="log-content">
          <div class="log-header">
            <span class="badge ${badgeClass}">${typeLabel}</span>
            <span style="font-size: 0.76rem; color: var(--text-subtle);">${timeStr}</span>
          </div>
          <div class="log-desc">${escapeHtml(log.deskripsi)}</div>
          <div class="log-meta">
            Dicatat oleh: <strong>${escapeHtml(log.admin_name || 'Admin')}</strong>
          </div>
        </div>
      `;
      container.appendChild(item);
    });
  }

  document.getElementById('filter-log-search').addEventListener('input', debounce(loadDashboardLogs, 300));
  document.getElementById('filter-log-jenis').addEventListener('change', loadDashboardLogs);

  // -------------------------------------------------------------
  // INVENTARIS BARANG FUNCTIONS
  // -------------------------------------------------------------
  async function loadBarangMeta() {
    try {
      const res = await fetch('/api/barang/meta');
      if (!res.ok) return;
      const data = await res.json();
      state.categories = data.categories || [];
      state.locations = data.locations || [];

      // Populate filter dropdown
      const filterSelect = document.getElementById('filter-barang-kategori');
      const formSelect = document.getElementById('barang-kategori');

      filterSelect.innerHTML = '<option value="semua">Semua Kategori</option>';
      state.categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        filterSelect.appendChild(opt);
      });
    } catch (e) {
      console.error(e);
    }
  }

  async function loadBarangList() {
    const search = document.getElementById('filter-barang-search').value.trim();
    const kategori = document.getElementById('filter-barang-kategori').value;
    const kondisi = document.getElementById('filter-barang-kondisi').value;
    const stokMenipis = document.getElementById('filter-barang-stok-menipis').checked;

    try {
      const url = new URL('/api/barang', window.location.origin);
      if (search) url.searchParams.set('search', search);
      if (kategori && kategori !== 'semua') url.searchParams.set('kategori', kategori);
      if (kondisi && kondisi !== 'semua') url.searchParams.set('kondisi', kondisi);
      if (stokMenipis) url.searchParams.set('stok_menipis', 'true');

      const res = await fetch(url);
      if (!res.ok) return;
      const items = await res.json();
      state.barangList = items;
      renderBarangTable(items);
    } catch (e) {
      console.error(e);
    }
  }

  function renderBarangTable(items) {
    const tbody = document.getElementById('table-barang-body');
    const emptyState = document.getElementById('barang-empty-state');
    tbody.innerHTML = '';

    if (items.length === 0) {
      emptyState.style.display = 'block';
      return;
    }
    emptyState.style.display = 'none';

    items.forEach((item, index) => {
      const tr = document.createElement('tr');

      // Status Kondisi
      let kondisiBadge = 'badge-success';
      if (item.kondisi === 'Rusak') kondisiBadge = 'badge-danger';
      else if (item.kondisi === 'Sebagian Rusak') kondisiBadge = 'badge-warning';

      // Stok status
      let stokBadge = 'badge-success';
      let stokStatusText = '';
      if (item.stok_tersedia === 0) {
        stokBadge = 'badge-danger badge-pulse';
        stokStatusText = ' (Habis)';
      } else if (item.stok_tersedia <= 2) {
        stokBadge = 'badge-warning badge-pulse';
        stokStatusText = ' (Menipis)';
      }

      tr.innerHTML = `
        <td style="color: var(--text-subtle);">${index + 1}</td>
        <td><code>${escapeHtml(item.kode_barang || '-')}</code></td>
        <td>
          <strong style="color: var(--text-main);">${escapeHtml(item.nama_barang)}</strong>
          ${item.keterangan ? `<div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(item.keterangan)}</div>` : ''}
        </td>
        <td>${escapeHtml(item.spesifikasi || '-')}</td>
        <td>
          <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted);">${escapeHtml(item.kategori)}</span>
          ${item.sub_kategori && item.sub_kategori !== 'Umum' ? `<div style="font-size: 0.72rem; color: var(--text-subtle);">${escapeHtml(item.sub_kategori)}</div>` : ''}
        </td>
        <td>
          <span class="badge ${stokBadge}">
            ${item.stok_tersedia} ${escapeHtml(item.satuan || 'Buah')}${stokStatusText}
          </span>
        </td>
        <td><strong>${item.stok_total}</strong> ${escapeHtml(item.satuan || 'Buah')}</td>
        <td><span class="badge ${kondisiBadge}">${escapeHtml(item.kondisi)}</span></td>
        <td>
          <span style="font-size: 0.82rem; color: var(--text-muted);">
            📍 ${escapeHtml(item.lokasi_penyimpanan || '-')}
          </span>
        </td>
        <td style="text-align: right;">
          <div style="display: inline-flex; gap: 6px;">
            <button class="btn btn-secondary btn-sm btn-edit-barang" data-id="${item.id}" title="Edit Data Barang">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="btn btn-secondary btn-sm btn-delete-barang" data-id="${item.id}" title="Hapus Barang" style="color: var(--danger);">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Attach row events
    document.querySelectorAll('.btn-edit-barang').forEach(b => {
      b.addEventListener('click', () => openEditBarangModal(b.getAttribute('data-id')));
    });

    document.querySelectorAll('.btn-delete-barang').forEach(b => {
      b.addEventListener('click', () => handleDeleteBarang(b.getAttribute('data-id')));
    });
  }

  document.getElementById('filter-barang-search').addEventListener('input', debounce(loadBarangList, 300));
  document.getElementById('filter-barang-kategori').addEventListener('change', loadBarangList);
  document.getElementById('filter-barang-kondisi').addEventListener('change', loadBarangList);
  document.getElementById('filter-barang-stok-menipis').addEventListener('change', loadBarangList);

  // Modal Tambah / Edit Barang
  const modalBarang = document.getElementById('modal-barang');
  const formBarang = document.getElementById('form-barang');

  document.getElementById('btn-open-add-barang').addEventListener('click', () => {
    formBarang.reset();
    document.getElementById('barang-id').value = '';
    document.getElementById('modal-barang-title').textContent = 'Tambah Barang Inventaris';
    openModal(modalBarang);
  });

  function openEditBarangModal(id) {
    const item = state.barangList.find(b => b.id == id);
    if (!item) return;

    document.getElementById('barang-id').value = item.id;
    document.getElementById('barang-kode').value = item.kode_barang || '';
    document.getElementById('barang-nama').value = item.nama_barang;
    document.getElementById('barang-spesifikasi').value = item.spesifikasi || '';
    document.getElementById('barang-kategori').value = item.kategori;
    document.getElementById('barang-subkategori').value = item.sub_kategori || '';
    document.getElementById('barang-satuan').value = item.satuan || 'Buah';
    document.getElementById('barang-stok-total').value = item.stok_total;
    document.getElementById('barang-stok-rusak').value = item.stok_rusak || 0;
    document.getElementById('barang-kondisi').value = item.kondisi || 'Baik';
    document.getElementById('barang-lokasi').value = item.lokasi_penyimpanan || '';
    document.getElementById('barang-sumber').value = item.sumber_dana || '';
    document.getElementById('barang-keterangan').value = item.keterangan || '';

    document.getElementById('modal-barang-title').textContent = 'Edit Data Barang Inventaris';
    openModal(modalBarang);
  }

  formBarang.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('barang-id').value;
    const payload = {
      kode_barang: document.getElementById('barang-kode').value.trim(),
      nama_barang: document.getElementById('barang-nama').value.trim(),
      spesifikasi: document.getElementById('barang-spesifikasi').value.trim(),
      kategori: document.getElementById('barang-kategori').value,
      sub_kategori: document.getElementById('barang-subkategori').value.trim(),
      satuan: document.getElementById('barang-satuan').value.trim(),
      stok_total: parseInt(document.getElementById('barang-stok-total').value, 10),
      stok_rusak: parseInt(document.getElementById('barang-stok-rusak').value, 10) || 0,
      kondisi: document.getElementById('barang-kondisi').value,
      lokasi_penyimpanan: document.getElementById('barang-lokasi').value.trim(),
      sumber_dana: document.getElementById('barang-sumber').value.trim(),
      keterangan: document.getElementById('barang-keterangan').value.trim()
    };

    try {
      const url = id ? `/api/barang/${id}` : '/api/barang';
      const method = id ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (res.ok && data.success) {
        showToast(data.message, 'success');
        closeModal(modalBarang);
        loadBarangList();
        loadBarangMeta();
        loadDashboardStats();
        loadDashboardLogs();
      } else {
        showToast(data.error || 'Gagal menyimpan barang.', 'error');
      }
    } catch (err) {
      showToast('Gagal menghubungi server.', 'error');
    }
  });

  async function handleDeleteBarang(id) {
    const item = state.barangList.find(b => b.id == id);
    const nama = item ? item.nama_barang : 'barang ini';
    if (!confirm(`Apakah Anda yakin ingin menghapus "${nama}" dari inventaris?`)) return;

    try {
      const res = await fetch(`/api/barang/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(data.message, 'success');
        loadBarangList();
        loadDashboardStats();
        loadDashboardLogs();
      } else {
        showToast(data.error || 'Gagal menghapus barang.', 'error');
      }
    } catch (err) {
      showToast('Terjadi kesalahan jaringan.', 'error');
    }
  }

  // Export Inventaris & Logs
  document.getElementById('btn-export-inventaris').addEventListener('click', () => {
    window.location.href = '/api/export/inventaris';
    showToast('Mengunduh berkas CSV inventaris...', 'info');
  });

  document.getElementById('btn-export-logs').addEventListener('click', () => {
    window.location.href = '/api/export/logs';
    showToast('Mengunduh berkas CSV log riwayat...', 'info');
  });

  // -------------------------------------------------------------
  // IMPORT CSV WITH PREVIEW
  // -------------------------------------------------------------
  const modalImport = document.getElementById('modal-import');
  const importFileInput = document.getElementById('import-csv-file');
  const importDropzone = document.getElementById('import-dropzone');
  const importPreviewSection = document.getElementById('import-preview-section');
  const importTableBody = document.getElementById('import-preview-table-body');
  const btnConfirmImport = document.getElementById('btn-confirm-import');

  document.getElementById('btn-open-import-modal').addEventListener('click', () => {
    importFileInput.value = '';
    importPreviewSection.style.display = 'none';
    btnConfirmImport.style.display = 'none';
    state.importParsedItems = [];
    openModal(modalImport);
  });

  importDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    importDropzone.classList.add('dragover');
  });

  importDropzone.addEventListener('dragleave', () => {
    importDropzone.classList.remove('dragover');
  });

  importDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    importDropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleCSVFile(e.dataTransfer.files[0]);
    }
  });

  importFileInput.addEventListener('change', () => {
    if (importFileInput.files.length > 0) {
      handleCSVFile(importFileInput.files[0]);
    }
  });

  async function handleCSVFile(file) {
    if (!file.name.endsWith('.csv')) {
      showToast('Mohon pilih berkas dengan format .csv', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      showToast('Sedang membaca dan memvalidasi file CSV...', 'info');
      const res = await fetch('/api/import/preview', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || 'Gagal memproses CSV.', 'error');
        return;
      }

      state.importParsedItems = data.all_items || [];
      document.getElementById('import-valid-count').textContent = data.valid_count || 0;

      // Render preview rows
      importTableBody.innerHTML = '';
      (data.preview_items || []).forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><code>${escapeHtml(item.kode_barang || '-')}</code></td>
          <td><strong>${escapeHtml(item.nama_barang)}</strong></td>
          <td>${escapeHtml(item.spesifikasi || '-')}</td>
          <td>${escapeHtml(item.kategori)}</td>
          <td>${item.stok_total} ${escapeHtml(item.satuan || 'Buah')}</td>
          <td>${escapeHtml(item.kondisi)}</td>
          <td>${escapeHtml(item.lokasi_penyimpanan)}</td>
        `;
        importTableBody.appendChild(tr);
      });

      importPreviewSection.style.display = 'block';
      btnConfirmImport.style.display = 'inline-flex';
      showToast(`Berhasil membaca ${data.valid_count} data barang dari CSV. Silakan cek preview.`, 'success');
    } catch (err) {
      showToast('Gagal memproses file CSV.', 'error');
    }
  }

  btnConfirmImport.addEventListener('click', async () => {
    if (!state.importParsedItems || state.importParsedItems.length === 0) return;

    try {
      btnConfirmImport.disabled = true;
      btnConfirmImport.textContent = 'Menyimpan ke database...';

      const res = await fetch('/api/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: state.importParsedItems })
      });
      const data = await res.json();

      btnConfirmImport.disabled = false;
      btnConfirmImport.textContent = 'Konfirmasi & Masukkan ke Database';

      if (res.ok && data.success) {
        showToast(data.message, 'success');
        closeModal(modalImport);
        loadBarangList();
        loadBarangMeta();
        loadDashboardStats();
        loadDashboardLogs();
      } else {
        showToast(data.error || 'Gagal mengimpor data.', 'error');
      }
    } catch (err) {
      btnConfirmImport.disabled = false;
      btnConfirmImport.textContent = 'Konfirmasi & Masukkan ke Database';
      showToast('Terjadi kesalahan saat menyimpan import.', 'error');
    }
  });

  // -------------------------------------------------------------
  // PEMINJAMAN & PENGEMBALIAN FUNCTIONS
  // -------------------------------------------------------------
  const modalPinjam = document.getElementById('modal-pinjam');
  const formPinjam = document.getElementById('form-pinjam');
  const modalKembalikan = document.getElementById('modal-kembalikan');
  const formKembalikan = document.getElementById('form-kembalikan');

  // Subtab switching
  document.querySelectorAll('.pinjam-subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pinjam-subtab-btn').forEach(b => {
        b.className = 'btn btn-sm btn-secondary pinjam-subtab-btn';
      });
      btn.className = 'btn btn-sm btn-primary pinjam-subtab-btn';
      state.currentPinjamSubtab = btn.getAttribute('data-status');
      loadPeminjamanList();
    });
  });

  async function loadPeminjamanList() {
    const search = document.getElementById('filter-pinjam-search').value.trim();
    const status = state.currentPinjamSubtab;

    try {
      const url = new URL('/api/peminjaman', window.location.origin);
      if (status && status !== 'semua') url.searchParams.set('status', status);
      if (search) url.searchParams.set('search', search);

      const res = await fetch(url);
      if (!res.ok) return;
      const rows = await res.json();
      state.peminjamanList = rows;
      renderPeminjamanTable(rows);
    } catch (e) {
      console.error(e);
    }
  }

  function renderPeminjamanTable(rows) {
    const tbody = document.getElementById('table-peminjaman-body');
    const emptyState = document.getElementById('pinjam-empty-state');
    tbody.innerHTML = '';

    if (rows.length === 0) {
      emptyState.style.display = 'block';
      return;
    }
    emptyState.style.display = 'none';

    rows.forEach(row => {
      const tr = document.createElement('tr');

      // Status badge
      let statusBadge = '';
      if (row.status === 'dikembalikan') {
        statusBadge = '<span class="badge badge-success">Dikembalikan</span>';
      } else if (row.is_terlambat === 1) {
        statusBadge = '<span class="badge badge-danger badge-pulse">TERLAMBAT</span>';
      } else {
        statusBadge = '<span class="badge badge-warning">Dipinjam</span>';
      }

      tr.innerHTML = `
        <td><code>${escapeHtml(row.nomor_formulir || '-')}</code></td>
        <td>
          <strong style="color: var(--text-main);">${escapeHtml(row.nama_peminjam)}</strong>
          ${row.keperluan ? `<div style="font-size: 0.76rem; color: var(--text-muted);">${escapeHtml(row.keperluan)}</div>` : ''}
        </td>
        <td>${escapeHtml(row.kelas_jabatan || '-')}</td>
        <td>
          <strong>${escapeHtml(row.nama_barang)}</strong>
          ${row.barang_spesifikasi ? `<span style="font-size: 0.78rem; color: var(--text-subtle);">(${escapeHtml(row.barang_spesifikasi)})</span>` : ''}
        </td>
        <td><span class="badge badge-info">${row.jumlah} ${escapeHtml(row.barang_satuan || 'Unit')}</span></td>
        <td>${escapeHtml(row.tanggal_pinjam)}</td>
        <td>${escapeHtml(row.tanggal_rencana_kembali || '-')}</td>
        <td>${statusBadge}</td>
        <td style="text-align: right;">
          ${row.status === 'dipinjam' ? `
            <button class="btn btn-success btn-sm btn-return-action" data-id="${row.id}" title="Kembalikan barang ini">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 11 12 14 22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
              <span>Kembalikan Alat</span>
            </button>
          ` : `
            <span style="font-size: 0.76rem; color: var(--text-subtle);">Selesai (${escapeHtml(row.tanggal_kembali_aktual || '-')})</span>
          `}
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-return-action').forEach(b => {
      b.addEventListener('click', () => openKembalikanModal(b.getAttribute('data-id')));
    });
  }

  document.getElementById('filter-pinjam-search').addEventListener('input', debounce(loadPeminjamanList, 300));

  // Modal Peminjaman Baru
  document.getElementById('btn-open-pinjam-modal').addEventListener('click', () => {
    formPinjam.reset();
    populatePinjamBarangSelect();
    document.getElementById('pinjam-tgl-pinjam').value = new Date().toISOString().slice(0, 10);
    openModal(modalPinjam);
  });

  function populatePinjamBarangSelect() {
    const select = document.getElementById('pinjam-barang-id');
    select.innerHTML = '<option value="">-- Pilih Alat Lab --</option>';

    state.barangList.forEach(item => {
      if (item.stok_tersedia > 0) {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = `${item.nama_barang} ${item.spesifikasi ? '(' + item.spesifikasi + ')' : ''} [Tersedia: ${item.stok_tersedia} ${item.satuan}]`;
        select.appendChild(opt);
      }
    });

    select.addEventListener('change', () => {
      const selected = state.barangList.find(b => b.id == select.value);
      const indicator = document.getElementById('pinjam-stok-indicator');
      const inputJumlah = document.getElementById('pinjam-jumlah');
      if (selected) {
        indicator.textContent = `✓ Stok Tersedia: ${selected.stok_tersedia} ${selected.satuan} (Lokasi: ${selected.lokasi_penyimpanan || 'Lab'})`;
        inputJumlah.max = selected.stok_tersedia;
      } else {
        indicator.textContent = '';
      }
    });
  }

  formPinjam.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      barang_id: parseInt(document.getElementById('pinjam-barang-id').value, 10),
      nama_peminjam: document.getElementById('pinjam-nama').value.trim(),
      kelas_jabatan: document.getElementById('pinjam-kelas').value.trim(),
      keperluan: document.getElementById('pinjam-keperluan').value.trim(),
      jumlah: parseInt(document.getElementById('pinjam-jumlah').value, 10),
      tanggal_pinjam: document.getElementById('pinjam-tgl-pinjam').value,
      tanggal_rencana_kembali: document.getElementById('pinjam-tgl-kembali').value || null,
      keterangan: document.getElementById('pinjam-keterangan').value.trim()
    };

    try {
      const res = await fetch('/api/peminjaman', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (res.ok && data.success) {
        showToast(data.message, 'success');
        closeModal(modalPinjam);
        loadPeminjamanList();
        loadBarangList();
        loadDashboardStats();
        loadDashboardLogs();
      } else {
        showToast(data.error || 'Gagal menyimpan peminjaman.', 'error');
      }
    } catch (err) {
      showToast('Terjadi kesalahan jaringan.', 'error');
    }
  });

  // Modal Pengembalian
  const btnOpenKembaliModal = document.getElementById('btn-open-kembali-modal');
  if (btnOpenKembaliModal) {
    btnOpenKembaliModal.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/peminjaman?status=dipinjam');
        const activeLoans = await res.json();
        if (!activeLoans || activeLoans.length === 0) {
          showToast('Saat ini tidak ada alat yang sedang dipinjam.', 'info');
          return;
        }
        openKembalikanModalGlobal(activeLoans);
      } catch (err) {
        showToast('Gagal memuat data peminjaman aktif.', 'error');
      }
    });
  }

  function updateEarlyReturnNotice(row, returnDate) {
    const earlyAlert = document.getElementById('kembali-early-alert');
    const earlyText = document.getElementById('kembali-early-text');
    const catatanInput = document.getElementById('kembali-catatan');

    if (row && row.tanggal_rencana_kembali && returnDate && returnDate < row.tanggal_rencana_kembali) {
      earlyAlert.style.display = 'flex';
      earlyText.innerHTML = `<strong>⚡ Pengembalian Lebih Awal:</strong> Batas pengembalian adalah <strong>${row.tanggal_rencana_kembali}</strong>. Alat dikembalikan lebih awal pada <strong>${returnDate}</strong>.`;
      if (!catatanInput.value || catatanInput.value === 'Dikembalikan tepat waktu') {
        catatanInput.value = 'Dikembalikan lebih awal';
      }
    } else {
      earlyAlert.style.display = 'none';
      if (catatanInput.value === 'Dikembalikan lebih awal') {
        catatanInput.value = '';
      }
    }
  }

  function setupKembalikanForLoan(row) {
    document.getElementById('kembali-peminjaman-id').value = row.id;
    document.getElementById('kembali-info-peminjam').textContent = `${row.nama_peminjam} (${row.kelas_jabatan || 'Umum'})`;
    document.getElementById('kembali-info-alat').textContent = `Alat: ${row.nama_barang} ${row.barang_spesifikasi ? '(' + row.barang_spesifikasi + ')' : ''} — Dipinjam: ${row.jumlah} ${row.barang_satuan || 'Unit'}`;

    const infoJadwal = document.getElementById('kembali-info-jadwal');
    if (infoJadwal) {
      infoJadwal.textContent = `📅 Tanggal Pinjam: ${row.tanggal_pinjam} | Batas Rencana Kembali: ${row.tanggal_rencana_kembali || 'Tidak ada batas waktu'}`;
    }

    document.getElementById('kembali-jumlah').value = row.jumlah;
    document.getElementById('kembali-jumlah').max = row.jumlah;
    document.getElementById('kembali-max-hint').textContent = `Maksimal: ${row.jumlah} ${row.barang_satuan || 'Unit'}`;
    const todayStr = new Date().toISOString().slice(0, 10);
    document.getElementById('kembali-tgl').value = todayStr;
    document.getElementById('kembali-kondisi').value = 'Baik';
    document.getElementById('kembali-catatan').value = '';

    updateEarlyReturnNotice(row, todayStr);
  }

  function openKembalikanModalGlobal(activeLoans) {
    const selectGroup = document.getElementById('kembali-select-group');
    const selectElem = document.getElementById('kembali-select-peminjaman');
    selectGroup.style.display = 'block';

    selectElem.innerHTML = '';
    activeLoans.forEach(loan => {
      const opt = document.createElement('option');
      opt.value = loan.id;
      const tglBatas = loan.tanggal_rencana_kembali ? ` (Batas: ${loan.tanggal_rencana_kembali})` : '';
      opt.textContent = `${loan.nama_peminjam} - ${loan.nama_barang} [${loan.jumlah} ${loan.barang_satuan || 'Unit'}]${tglBatas}`;
      selectElem.appendChild(opt);
    });

    selectElem.onchange = () => {
      const selected = activeLoans.find(l => l.id == selectElem.value);
      if (selected) {
        setupKembalikanForLoan(selected);
      }
    };

    if (activeLoans.length > 0) {
      selectElem.value = activeLoans[0].id;
      setupKembalikanForLoan(activeLoans[0]);
    }

    document.getElementById('kembali-tgl').onchange = (e) => {
      const curId = document.getElementById('kembali-peminjaman-id').value;
      const curLoan = activeLoans.find(l => l.id == curId);
      updateEarlyReturnNotice(curLoan, e.target.value);
    };

    openModal(modalKembalikan);
  }

  function openKembalikanModal(peminjamanId) {
    const row = state.peminjamanList.find(r => r.id == peminjamanId);
    if (!row) return;

    const selectGroup = document.getElementById('kembali-select-group');
    if (selectGroup) selectGroup.style.display = 'none';

    setupKembalikanForLoan(row);

    document.getElementById('kembali-tgl').onchange = (e) => {
      updateEarlyReturnNotice(row, e.target.value);
    };

    openModal(modalKembalikan);
  }

  formKembalikan.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('kembali-peminjaman-id').value;
    const payload = {
      jumlah_kembali: parseInt(document.getElementById('kembali-jumlah').value, 10),
      tanggal_kembali: document.getElementById('kembali-tgl').value,
      kondisi_kembali: document.getElementById('kembali-kondisi').value,
      catatan: document.getElementById('kembali-catatan').value.trim()
    };

    try {
      const res = await fetch(`/api/peminjaman/${id}/kembalikan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (res.ok && data.success) {
        showToast(data.message, 'success');
        closeModal(modalKembalikan);
        loadPeminjamanList();
        loadBarangList();
        loadDashboardStats();
        loadDashboardLogs();
      } else {
        showToast(data.error || 'Gagal menyimpan pengembalian.', 'error');
      }
    } catch (err) {
      showToast('Gagal menghubungi server.', 'error');
    }
  });

  // -------------------------------------------------------------
  // AUDIT LOGS FUNCTIONS
  // -------------------------------------------------------------
  async function loadAuditLogs() {
    const search = document.getElementById('audit-log-search').value.trim();
    const jenis = document.getElementById('audit-log-jenis').value;
    const startDate = document.getElementById('audit-log-start').value;
    const endDate = document.getElementById('audit-log-end').value;

    try {
      const url = new URL('/api/logs', window.location.origin);
      url.searchParams.set('page', state.auditPage);
      url.searchParams.set('limit', state.auditLimit);
      if (search) url.searchParams.set('search', search);
      if (jenis && jenis !== 'semua') url.searchParams.set('jenis', jenis);
      if (startDate) url.searchParams.set('start_date', startDate);
      if (endDate) url.searchParams.set('end_date', endDate);

      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      renderAuditTable(data);
    } catch (e) {
      console.error(e);
    }
  }

  function renderAuditTable(data) {
    const tbody = document.getElementById('table-audit-body');
    const pageInfo = document.getElementById('audit-pagination-info');
    tbody.innerHTML = '';

    const logs = data.logs || [];
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 30px; color: var(--text-muted);">Tidak ada riwayat log yang ditemukan.</td></tr>';
      pageInfo.textContent = 'Menampilkan 0 dari 0 data';
      return;
    }

    const totalPages = Math.ceil(data.total / state.auditLimit) || 1;
    pageInfo.textContent = `Menampilkan halaman ${data.page} dari ${totalPages} (${data.total} total aktivitas)`;

    logs.forEach(log => {
      const tr = document.createElement('tr');
      let badgeClass = 'badge-info';
      if (log.jenis_aktivitas === 'peminjaman') badgeClass = 'badge-warning';
      else if (log.jenis_aktivitas === 'pengembalian') badgeClass = 'badge-success';
      else if (log.jenis_aktivitas === 'tambah_barang') badgeClass = 'badge-primary';
      else if (log.jenis_aktivitas === 'hapus_barang') badgeClass = 'badge-danger';

      tr.innerHTML = `
        <td><code>#${log.id}</code></td>
        <td style="white-space: nowrap; color: var(--text-muted); font-size: 0.8rem;">${escapeHtml(log.waktu)}</td>
        <td><span class="badge ${badgeClass}">${escapeHtml(log.jenis_aktivitas)}</span></td>
        <td>${escapeHtml(log.deskripsi)}</td>
        <td><strong>${escapeHtml(log.admin_name || 'Admin')}</strong></td>
      `;
      tbody.appendChild(tr);
    });
  }

  document.getElementById('audit-log-search').addEventListener('input', debounce(() => {
    state.auditPage = 1;
    loadAuditLogs();
  }, 300));
  document.getElementById('audit-log-jenis').addEventListener('change', () => {
    state.auditPage = 1;
    loadAuditLogs();
  });
  document.getElementById('audit-log-start').addEventListener('change', () => {
    state.auditPage = 1;
    loadAuditLogs();
  });
  document.getElementById('audit-log-end').addEventListener('change', () => {
    state.auditPage = 1;
    loadAuditLogs();
  });

  document.getElementById('btn-audit-prev').addEventListener('click', () => {
    if (state.auditPage > 1) {
      state.auditPage--;
      loadAuditLogs();
    }
  });

  document.getElementById('btn-audit-next').addEventListener('click', () => {
    state.auditPage++;
    loadAuditLogs();
  });

  // -------------------------------------------------------------
  // CHANGE PASSWORD MODAL
  // -------------------------------------------------------------
  const modalPassword = document.getElementById('modal-password');
  const formPassword = document.getElementById('form-change-password');

  document.getElementById('btn-open-password-modal').addEventListener('click', () => {
    formPassword.reset();
    openModal(modalPassword);
  });

  formPassword.addEventListener('submit', async (e) => {
    e.preventDefault();
    const current_password = document.getElementById('pwd-current').value;
    const new_password = document.getElementById('pwd-new').value;
    const confirm_password = document.getElementById('pwd-confirm').value;

    if (new_password !== confirm_password) {
      showToast('Konfirmasi password baru tidak cocok!', 'error');
      return;
    }

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password, new_password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(data.message, 'success');
        closeModal(modalPassword);
      } else {
        showToast(data.error || 'Gagal memperbarui password.', 'error');
      }
    } catch (err) {
      showToast('Terjadi kesalahan jaringan.', 'error');
    }
  });

  // -------------------------------------------------------------
  // MODAL UTILITIES
  // -------------------------------------------------------------
  function openModal(modal) {
    modal.classList.add('open');
  }

  function closeModal(modal) {
    modal.classList.remove('open');
  }

  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-backdrop');
      if (modal) closeModal(modal);
    });
  });

  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal(backdrop);
    });
  });

  // General Utilities
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  // Startup initialization
  initTheme();
  checkAuth();
});
