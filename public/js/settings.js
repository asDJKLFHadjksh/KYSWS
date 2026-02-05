(() => {
  const tabs = [...document.querySelectorAll('.tab-btn')];
  const panels = [...document.querySelectorAll('.tab-content')];

  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach((b) => b.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.querySelector(`[data-panel="${btn.dataset.tab}"]`).classList.add('active');
    });
  });

  async function submitForm(formId, endpoint) {
    const form = document.getElementById(formId);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(form).entries());
      window.AdminUI.showLoading(true);
      try {
        const data = await window.AdminUI.api(endpoint, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        window.AdminUI.toast(data.message || 'Berhasil.', 'success');
        form.reset();
      } catch (err) {
        window.AdminUI.toast(err.message, 'error');
      } finally {
        window.AdminUI.showLoading(false);
      }
    });
  }

  submitForm('form-password', '/api/admin/change-password');
  submitForm('form-username', '/api/admin/change-username');
  submitForm('form-admin', '/api/admin/add-admin');
})();
