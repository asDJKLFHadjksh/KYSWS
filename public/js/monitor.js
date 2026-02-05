(() => {
  const createChart = (id, color, label, max = 100) =>
    new Chart(document.getElementById(id), {
      type: 'line',
      data: { labels: [], datasets: [{ label, data: [], borderColor: color, tension: 0.25, fill: true, backgroundColor: `${color}33` }] },
      options: { scales: { y: { min: 0, max } } },
    });

  const charts = {
    cpu: createChart('cpuChart', '#a78bfa', 'CPU %'),
    ram: createChart('ramChart', '#60a5fa', 'RAM %'),
    disk: createChart('diskChart', '#f59e0b', 'Disk %'),
    uptime: createChart('uptimeChart', '#22c55e', 'Uptime (min)', 120),
  };

  function push(chart, label, value, maxLen = 120) {
    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(value);
    if (chart.data.labels.length > maxLen) {
      chart.data.labels.shift();
      chart.data.datasets[0].data.shift();
    }
    chart.update();
  }

  async function refresh() {
    try {
      window.AdminUI.showLoading(true);
      const [metrics, logs] = await Promise.all([window.AdminUI.api('/api/metrics'), window.AdminUI.api('/api/logs')]);
      const time = new Date(metrics.timestamp).toLocaleTimeString();
      push(charts.cpu, time, metrics.cpu.percent);
      push(charts.ram, time, metrics.mem.percent);
      push(charts.disk, time, metrics.disk.percent);
      push(charts.uptime, time, Number((metrics.uptime / 60).toFixed(2)));

      document.getElementById('monitor-logs').innerHTML = logs.logs
        .map((log) => `<tr><td>${new Date(log.ts).toLocaleString()}</td><td>${log.actor}</td><td>${log.action}</td><td>${log.detail}</td></tr>`)
        .join('');
    } catch (err) {
      window.AdminUI.toast(err.message, 'error');
    } finally {
      window.AdminUI.showLoading(false);
    }
  }

  refresh();
  setInterval(refresh, 2000);
})();
