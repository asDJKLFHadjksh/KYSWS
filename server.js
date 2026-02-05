const os = require("os");
const { execSync } = require("child_process");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const db = new Database("data.db");

// ===== Init DB =====
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);
`);

const userCount = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
if (userCount === 0) {
  const hash = bcrypt.hashSync("BangALserver123", 10);
  db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run("admin", hash);
  console.log("Default login: admin / BangALserver123");
}

// ===== Middlewares =====
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "kuhyakuya-secret-key-ganti-nanti",
    resave: false,
    saveUninitialized: false,
  })
);

function requireAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect("/login");
}

// ===== Routes =====
app.get("/", (req, res) => res.redirect("/login"));

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user) return res.redirect("/login");

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.redirect("/login");

  req.session.user = user.username;
  return res.redirect("/dashboard");
});

app.get("/me", requireAuth, (req, res) => {
  res.json({ username: req.session.user });
});

app.get("/dashboard", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/dashboard.html"));
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/api/metrics", requireAuth, (req, res) => {
  // Uptime
  const uptimeSec = os.uptime();
  const uptime = `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`;

  // RAM
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // Load average
  const [l1, l5, l15] = os.loadavg();

  // Disk usage (root /)
  let disk = {};
  try {
    const out = execSync("df -k / | tail -1").toString().trim().split(/\s+/);
    disk = {
      used: Number(out[2]) * 1024,
      avail: Number(out[3]) * 1024,
      percent: out[4],
    };
  } catch {
    disk = { used: 0, avail: 0, percent: "?" };
  }

  // CPU usage (mpstat 1 1)
  let cpu = { percent: "?" };
  try {
    const mp = execSync("mpstat 1 1 | awk '/Average/ && $2 ~ /all/ {print 100-$NF}'")
      .toString()
      .trim();
    const v = Number(mp);
    cpu = { percent: isNaN(v) ? "?" : v.toFixed(1) + "%" };
  } catch {
    cpu = { percent: "?" };
  }

  res.json({
    uptime,
    cpu,
    mem: {
      used: usedMem,
      total: totalMem,
      percent: ((usedMem / totalMem) * 100).toFixed(1) + "%",
    },
    disk,
    load: { "1m": l1.toFixed(2), "5m": l5.toFixed(2), "15m": l15.toFixed(2) },
    ts: Date.now(),
  });
});

app.get("/monitor", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/monitor.html"));
});

app.listen(3000, "0.0.0.0", () => {
  console.log("App running on http://0.0.0.0:3000");
});
