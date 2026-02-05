(async () => {
  const stats = [
    { key: "cpu", label: "CPU" },
    { key: "mem", label: "RAM" },
    { key: "disk", label: "Disk" },
    { key: "uptime", label: "Uptime" },
  ];
  const cardsEl = document.getElementById("summary-cards");
  cardsEl.innerHTML = stats
    .map(
      (item) => `<article class="panel stat-card"><div class="muted">${item.label}</div><div class="value" id="${item.key}-val">-</div><div class="progress"><span id="${item.key}-bar" style="width:0%"></span></div></article>`
    )
    .join("");

  const chart = new Chart(document.getElementById("overviewChart"), {
    type: "line",
    data: { labels: [], datasets: [
      { label: "CPU", data: [], borderColor: "#a78bfa", tension: 0.28, fill: true, backgroundColor: "rgba(167,139,250,.14)" },
      { label: "RAM", data: [], borderColor: "#60a5fa", tension: 0.28, fill: true, backgroundColor: "rgba(96,165,250,.12)" },
    ] },
    options: { responsive: true, scales: { y: { min: 0, max: 100 } } },
  });

  function setCard(id, value, percent = 0) {
    document.getElementById(`${id}-val`).textContent = value;
    document.getElementById(`${id}-bar`).style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }

  async function tick() {
    try {
      window.AdminUI.showLoading(true);
      const [metrics, logs] = await Promise.all([window.AdminUI.api('/api/metrics'), window.AdminUI.api('/api/logs')]);
      setCard('cpu', `${metrics.cpu.percent.toFixed(2)}%`, metrics.cpu.percent);
      setCard('mem', `${metrics.mem.percent.toFixed(2)}%`, metrics.mem.percent);
      setCard('disk', `${metrics.disk.percent.toFixed(2)}%`, metrics.disk.percent);
      const uptimeMin = (metrics.uptime / 60).toFixed(1);
      setCard('uptime', `${uptimeMin}m`, Math.min(100, uptimeMin % 100));

      const label = new Date(metrics.timestamp).toLocaleTimeString();
      chart.data.labels.push(label);
      chart.data.datasets[0].data.push(metrics.cpu.percent);
      chart.data.datasets[1].data.push(metrics.mem.percent);
      if (chart.data.labels.length > 150) {
        chart.data.labels.shift();
        chart.data.datasets.forEach((d) => d.data.shift());
      }
      chart.update();

      document.getElementById('recent-logs').innerHTML = logs.logs
        .slice(0, 12)
        .map((log) => `<tr><td>${new Date(log.ts).toLocaleString()}</td><td>${log.actor}</td><td>${log.action}</td><td>${log.detail}</td></tr>`)
        .join('');
    } catch (err) {
      window.AdminUI.toast(err.message, 'error');
    } finally {
      window.AdminUI.showLoading(false);
    }
  }

  await tick();
  setInterval(tick, 2000);
})();
