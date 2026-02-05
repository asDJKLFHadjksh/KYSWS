const os = require("os");
const fs = require("fs");
const fsp = require("fs/promises");
const { execSync } = require("child_process");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const db = new Database("data.db");
const ROOT_DIR = path.resolve(__dirname);
const ACTIVITY_LOG_LIMIT = 200;
const activityLogs = [];

function pushLog(level, action, detail) {
  activityLogs.unshift({
    ts: Date.now(),
    level,
    action,
    detail,
  });
  if (activityLogs.length > ACTIVITY_LOG_LIMIT) activityLogs.length = ACTIVITY_LOG_LIMIT;
}

function resolveSafePath(relPath = "") {
  const target = path.resolve(ROOT_DIR, relPath);
  if (target !== ROOT_DIR && !target.startsWith(ROOT_DIR + path.sep)) {
    throw new Error("Path tidak diizinkan");
  }
  return target;
}

function relFromRoot(absPath) {
  const rel = path.relative(ROOT_DIR, absPath);
  return rel === "" ? "." : rel;
}

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
app.use(express.json({ limit: "30mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "kuhyakuya-secret-key-ganti-nanti",
    resave: false,
    saveUninitialized: false,
  })
);

app.use((req, _res, next) => {
  const username = req.session?.user || "guest";
  if (!req.path.startsWith("/api/logs")) {
    pushLog("info", `${req.method} ${req.path}`, `user=${username}`);
  }
  next();
});

function requireAuth(req, res, next) {
  if (req.session.user) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Unauthorized" });
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
  if (!user) {
    pushLog("warn", "login_failed", `username=${username || "-"}`);
    return res.redirect("/login");
  }

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    pushLog("warn", "login_failed", `username=${username || "-"}`);
    return res.redirect("/login");
  }

  req.session.user = user.username;
  pushLog("info", "login_success", `username=${user.username}`);
  return res.redirect("/dashboard");
});

app.get("/me", requireAuth, (req, res) => {
  res.json({ username: req.session.user });
});

app.get("/dashboard", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/dashboard.html"));
});

app.get("/files", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/files.html"));
});

app.get("/logout", (req, res) => {
  pushLog("info", "logout", `username=${req.session?.user || "unknown"}`);
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/api/metrics", requireAuth, (req, res) => {
  const uptimeSec = os.uptime();
  const uptime = `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`;

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const [l1, l5, l15] = os.loadavg();

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

  let cpu = { percent: "?" };
  try {
    const mp = execSync("mpstat 1 1 | awk '/Average/ && $2 ~ /all/ {print 100-$NF}'")
      .toString()
      .trim();
    const v = Number(mp);
    cpu = { percent: Number.isNaN(v) ? "?" : `${v.toFixed(1)}%` };
  } catch {
    cpu = { percent: "?" };
  }

  res.json({
    uptime,
    cpu,
    mem: {
      used: usedMem,
      total: totalMem,
      percent: `${((usedMem / totalMem) * 100).toFixed(1)}%`,
    },
    disk,
    load: { "1m": l1.toFixed(2), "5m": l5.toFixed(2), "15m": l15.toFixed(2) },
    ts: Date.now(),
  });
});

app.get("/api/logs", requireAuth, (_req, res) => {
  res.json({ logs: activityLogs.slice(0, 120) });
});

app.get("/api/admin/users", requireAuth, (_req, res) => {
  const users = db.prepare("SELECT id, username FROM users ORDER BY id ASC").all();
  res.json({ users });
});

app.post("/api/admin/users", requireAuth, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || password.length < 8) {
    return res.status(400).json({ error: "Username/password tidak valid (min 8 karakter)." });
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hash);
    pushLog("info", "admin_add_user", `by=${req.session.user}, user=${username}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: `Gagal tambah user: ${err.message}` });
  }
});

app.post("/api/admin/change-password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: "Password baru minimal 8 karakter." });
  }

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(req.session.user);
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: "Password lama salah." });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, user.id);
  pushLog("info", "admin_change_password", `username=${req.session.user}`);
  res.json({ ok: true });
});

app.post("/api/admin/change-username", requireAuth, (req, res) => {
  const { newUsername, password } = req.body;
  if (!newUsername || !password) {
    return res.status(400).json({ error: "Field wajib diisi." });
  }

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(req.session.user);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(400).json({ error: "Password salah." });
  }

  try {
    db.prepare("UPDATE users SET username = ? WHERE id = ?").run(newUsername, user.id);
    req.session.user = newUsername;
    pushLog("info", "admin_change_username", `old=${user.username}, new=${newUsername}`);
    res.json({ ok: true, username: newUsername });
  } catch (err) {
    res.status(400).json({ error: `Gagal ganti username: ${err.message}` });
  }
});

app.get("/api/files/list", requireAuth, async (req, res) => {
  try {
    const rel = req.query.dir || ".";
    const abs = resolveSafePath(rel);
    const stat = await fsp.stat(abs);
    if (!stat.isDirectory()) return res.status(400).json({ error: "Bukan direktori." });

    const entries = await fsp.readdir(abs, { withFileTypes: true });
    const items = await Promise.all(
      entries
        .filter((d) => !d.name.startsWith("."))
        .map(async (d) => {
          const p = path.join(abs, d.name);
          const st = await fsp.stat(p);
          return {
            name: d.name,
            type: d.isDirectory() ? "dir" : "file",
            size: d.isDirectory() ? null : st.size,
            mtime: st.mtimeMs,
            path: relFromRoot(p),
          };
        })
    );

    items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    res.json({ cwd: relFromRoot(abs), parent: relFromRoot(path.dirname(abs)), items });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/files/read", requireAuth, async (req, res) => {
  try {
    const abs = resolveSafePath(req.query.path || "");
    const content = await fsp.readFile(abs, "utf-8");
    res.json({ path: relFromRoot(abs), content });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/files/write", requireAuth, async (req, res) => {
  try {
    const abs = resolveSafePath(req.body.path || "");
    await fsp.writeFile(abs, String(req.body.content ?? ""), "utf-8");
    pushLog("info", "file_write", `${req.session.user} -> ${relFromRoot(abs)}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/files/upload", requireAuth, async (req, res) => {
  try {
    const dirAbs = resolveSafePath(req.body.dir || ".");
    const fileName = path.basename(req.body.name || "");
    if (!fileName) return res.status(400).json({ error: "Nama file kosong." });

    const data = req.body.contentBase64 || "";
    const output = path.join(dirAbs, fileName);
    const buffer = Buffer.from(data, "base64");
    await fsp.writeFile(output, buffer);
    pushLog("info", "file_upload", `${req.session.user} -> ${relFromRoot(output)}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/files/download", requireAuth, (req, res) => {
  try {
    const abs = resolveSafePath(req.query.path || "");
    pushLog("info", "file_download", `${req.session.user} -> ${relFromRoot(abs)}`);
    res.download(abs);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/files/mkdir", requireAuth, async (req, res) => {
  try {
    const target = resolveSafePath(path.join(req.body.dir || ".", req.body.name || ""));
    await fsp.mkdir(target, { recursive: false });
    pushLog("info", "file_mkdir", `${req.session.user} -> ${relFromRoot(target)}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/files/create", requireAuth, async (req, res) => {
  try {
    const target = resolveSafePath(path.join(req.body.dir || ".", req.body.name || ""));
    await fsp.writeFile(target, "", { flag: "wx" });
    pushLog("info", "file_create", `${req.session.user} -> ${relFromRoot(target)}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/files/rename", requireAuth, async (req, res) => {
  try {
    const from = resolveSafePath(req.body.from || "");
    const to = resolveSafePath(path.join(path.dirname(req.body.from || ""), req.body.name || ""));
    await fsp.rename(from, to);
    pushLog("info", "file_rename", `${req.session.user} -> ${relFromRoot(from)} to ${relFromRoot(to)}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/files/delete", requireAuth, async (req, res) => {
  try {
    const target = resolveSafePath(req.body.path || "");
    await fsp.rm(target, { recursive: true, force: true });
    pushLog("info", "file_delete", `${req.session.user} -> ${relFromRoot(target)}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/monitor", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/monitor.html"));
});

app.listen(3000, "0.0.0.0", () => {
  console.log("App running on http://0.0.0.0:3000");
});
