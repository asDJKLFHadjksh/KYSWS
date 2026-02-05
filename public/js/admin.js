window.AdminUI = (() => {
  const navItems = [
    ["/dashboard", "Dashboard"],
    ["/monitor", "Monitor"],
    ["/files", "File Manager"],
    ["/settings", "Settings"],
  ];

  const loadingEl = () => document.getElementById("loading");

  function showLoading(show) {
    const overlay = loadingEl();
    if (!overlay) return;
    overlay.classList.toggle("show", show);
  }

  function toast(message, type = "success") {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.className = `toast show ${type}`;
    setTimeout(() => {
      el.classList.remove("show");
    }, 2600);
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request gagal");
    return data;
  }

  async function loadMe() {
    try {
      const me = await api("/me");
      const chip = document.getElementById("user-chip");
      if (chip) chip.textContent = `@${me.username}`;
    } catch {
      location.href = "/login";
    }
  }

  function buildSidebar() {
    const sidebar = document.querySelector("[data-sidebar]");
    if (!sidebar) return;
    const page = document.body.dataset.page || "";
    sidebar.innerHTML = `
      <div class="brand-wrap">
        <div class="brand">KuhyaKuya Admin</div>
        <p class="brand-sub">Dark glass dashboard</p>
      </div>
      <nav>
        ${navItems
          .map(([href, label]) => `<a class="nav-link ${page === href.slice(1) ? "active" : ""}" href="${href}">${label}</a>`)
          .join("")}
      </nav>
    `;
  }

  function initLoadingAnimation() {
    if (typeof lottie === "undefined") return;
    const holder = document.getElementById("loading-lottie");
    if (!holder) return;
    lottie.loadAnimation({
      container: holder,
      renderer: "svg",
      loop: true,
      autoplay: true,
      path: "/assets/loading.json",
    });
  }

  buildSidebar();
  loadMe();
  initLoadingAnimation();

  return { showLoading, toast, api };
})();
