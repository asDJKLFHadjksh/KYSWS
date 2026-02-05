(() => {
  const rowsEl = document.getElementById('file-rows');
  const pathEl = document.getElementById('current-path');
  const editor = document.getElementById('editor');
  const editorTitle = document.getElementById('editor-title');
  const uploadInput = document.getElementById('upload-input');

  let currentPath = '/';
  let selected = null;

  const fmt = (s) => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let v = s; let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    return `${v.toFixed(1)} ${units[i]}`;
  };

  async function list(path = currentPath) {
    window.AdminUI.showLoading(true);
    try {
      const data = await window.AdminUI.api(`/api/files/list?path=${encodeURIComponent(path)}`);
      currentPath = data.current;
      selected = null;
      pathEl.textContent = `Current: ${currentPath}`;

      const rows = [];
      if (currentPath !== '/') {
        const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
        rows.push(`<div class="file-row" data-path="${parent}" data-type="dir"><strong>..</strong><span></span><span>dir</span></div>`);
      }

      rows.push(
        ...data.entries.map((entry) =>
          `<div class="file-row" data-path="${entry.path}" data-type="${entry.type}"><strong>${entry.type === 'dir' ? '📁' : '📄'} ${entry.name}</strong><span class="muted">${entry.type === 'file' ? fmt(entry.size) : '-'}</span><span class="muted">${entry.type}</span></div>`
        )
      );

      rowsEl.innerHTML = rows.join('');
      [...rowsEl.querySelectorAll('.file-row')].forEach((row) => {
        row.addEventListener('click', () => onSelect(row));
      });
    } catch (err) {
      window.AdminUI.toast(err.message, 'error');
    } finally {
      window.AdminUI.showLoading(false);
    }
  }

  async function onSelect(row) {
    [...rowsEl.children].forEach((r) => r.classList.remove('active'));
    row.classList.add('active');

    selected = { path: row.dataset.path, type: row.dataset.type };
    if (selected.type === 'dir') {
      await list(selected.path);
      return;
    }

    window.AdminUI.showLoading(true);
    try {
      const file = await window.AdminUI.api(`/api/files/read?path=${encodeURIComponent(selected.path)}`);
      editor.value = file.content;
      editorTitle.textContent = `Editor — ${selected.path}`;
    } catch (err) {
      window.AdminUI.toast(err.message, 'error');
    } finally {
      window.AdminUI.showLoading(false);
    }
  }

  async function post(url, body) {
    return window.AdminUI.api(url, { method: 'POST', body: JSON.stringify(body) });
  }

  document.getElementById('btn-refresh').onclick = () => list(currentPath);
  document.getElementById('btn-mkdir').onclick = async () => {
    const name = prompt('Nama folder baru:');
    if (!name) return;
    window.AdminUI.showLoading(true);
    try { await post('/api/files/mkdir', { path: currentPath, name }); window.AdminUI.toast('Folder dibuat.'); await list(currentPath); } catch (e) { window.AdminUI.toast(e.message, 'error'); }
    finally { window.AdminUI.showLoading(false); }
  };

  document.getElementById('btn-new-file').onclick = async () => {
    const name = prompt('Nama file baru:');
    if (!name) return;
    window.AdminUI.showLoading(true);
    try { await post('/api/files/new', { path: currentPath, name }); window.AdminUI.toast('File dibuat.'); await list(currentPath); } catch (e) { window.AdminUI.toast(e.message, 'error'); }
    finally { window.AdminUI.showLoading(false); }
  };

  document.getElementById('btn-rename').onclick = async () => {
    if (!selected) return window.AdminUI.toast('Pilih file/folder dulu.', 'error');
    const target = prompt('Path baru (contoh /lab/newname.txt):', selected.path);
    if (!target) return;
    window.AdminUI.showLoading(true);
    try { await post('/api/files/rename', { from: selected.path, to: target }); window.AdminUI.toast('Berhasil rename.'); await list(currentPath); } catch (e) { window.AdminUI.toast(e.message, 'error'); }
    finally { window.AdminUI.showLoading(false); }
  };

  document.getElementById('btn-delete').onclick = async () => {
    if (!selected) return window.AdminUI.toast('Pilih file/folder dulu.', 'error');
    if (!confirm(`Yakin hapus ${selected.path}?`)) return;
    window.AdminUI.showLoading(true);
    try { await post('/api/files/delete', { path: selected.path }); window.AdminUI.toast('Berhasil delete.'); await list(currentPath); } catch (e) { window.AdminUI.toast(e.message, 'error'); }
    finally { window.AdminUI.showLoading(false); }
  };

  document.getElementById('btn-download').onclick = () => {
    if (!selected || selected.type !== 'file') return window.AdminUI.toast('Pilih file dulu.', 'error');
    window.location.href = `/api/files/download?path=${encodeURIComponent(selected.path)}`;
  };

  document.getElementById('btn-save').onclick = async () => {
    if (!selected || selected.type !== 'file') return window.AdminUI.toast('Pilih file teks untuk disimpan.', 'error');
    window.AdminUI.showLoading(true);
    try { await post('/api/files/write', { path: selected.path, content: editor.value }); window.AdminUI.toast('File disimpan.'); } catch (e) { window.AdminUI.toast(e.message, 'error'); }
    finally { window.AdminUI.showLoading(false); }
  };

  document.getElementById('btn-upload').onclick = () => uploadInput.click();
  uploadInput.onchange = async () => {
    if (!uploadInput.files.length) return;
    window.AdminUI.showLoading(true);
    try {
      const form = new FormData();
      [...uploadInput.files].forEach((f) => form.append('files', f));
      const res = await fetch(`/api/files/upload?path=${encodeURIComponent(currentPath)}`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload gagal');
      window.AdminUI.toast('Upload berhasil.');
      await list(currentPath);
    } catch (e) {
      window.AdminUI.toast(e.message, 'error');
    } finally {
      uploadInput.value = '';
      window.AdminUI.showLoading(false);
    }
  };

  list('/');
})();
