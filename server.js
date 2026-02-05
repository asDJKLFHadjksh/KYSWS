const os = require("os");
const fs = require("fs/promises");
const path = require("path");
const { execSync } = require("child_process");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");

const PORT = 3000;
const FILE_ROOT = "/var/www";
const db = new Database("data.db");
const app = express();

let lastCpuSample = os.cpus();

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL
);
`);

const userCount = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
if (userCount === 0) {
  const hash = bcrypt.hashSync("BangALserver123", 10);
  db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run("admin", hash);
  console.log("Default login: admin / BangALserver123");
}

const insertLogStmt = db.prepare(
  "INSERT INTO activity_logs (ts, actor, action, detail) VALUES (?, ?, ?, ?)"
);

function logActivity(actor, action, detail) {
  const safeActor = actor || "system";
  insertLogStmt.run(Date.now(), safeActor, action, detail || "-");
}

function requireAuth(req, res, next) {
  if (req.session.user) {
    return next();
  }

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return res.redirect("/login");
}

function safeResolve(inputPath = "/") {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    throw new Error("Path is required.");
  }

  if (inputPath.includes("\0")) {
    throw new Error("Invalid path: null byte detected.");
  }

  const cleaned = inputPath.replace(/\\/g, "/");
  const target = path.resolve(FILE_ROOT, `.${cleaned.startsWith("/") ? cleaned : `/${cleaned}`}`);

  if (target !== FILE_ROOT && !target.startsWith(`${FILE_ROOT}${path.sep}`)) {
    throw new Error("Path traversal blocked.");
  }

  return target;
}

function toClientPath(absPath) {
  const rel = path.relative(FILE_ROOT, absPath).split(path.sep).join("/");
  return rel ? `/${rel}` : "/";
}

function sampleCpuPercent() {
  const current = os.cpus();
  let idle = 0;
  let total = 0;

  current.forEach((cpu, index) => {
    const prev = lastCpuSample[index];
    const prevTotal = Object.values(prev.times).reduce((sum, v) => sum + v, 0);
    const currTotal = Object.values(cpu.times).reduce((sum, v) => sum + v, 0);

    idle += cpu.times.idle - prev.times.idle;
    total += currTotal - prevTotal;
  });

  lastCpuSample = current;
  const usage = total === 0 ? 0 : (1 - idle / total) * 100;
  return Number(usage.toFixed(2));
}

function getDiskUsage() {
  try {
    const output = execSync(`df -k "${FILE_ROOT}" | tail -1`).toString().trim().split(/\s+/);
    const totalKb = Number(output[1]);
    const usedKb = Number(output[2]);
    const freeKb = Number(output[3]);
    return {
      percent: Number(String(output[4]).replace("%", "")),
      used: usedKb * 1024,
      free: freeKb * 1024,
      total: totalKb * 1024,
    };
  } catch {
    return { percent: 0, used: 0, free: 0, total: 0 };
  }
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: "kuhyakuya-secret-key-ganti-nanti",
    resave: false,
    saveUninitialized: false,
  })
);
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  if (req.session.user) {
    return res.redirect("/dashboard");
  }
  return res.redirect("/login");
});

app.get("/login", (req, res) => {
  if (req.session.user) {
    return res.redirect("/dashboard");
  }
  return res.sendFile(path.join(__dirname, "public/login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Username atau password salah." });
  }

  req.session.user = user.username;
  logActivity(user.username, "LOGIN", "Login success");
  return res.json({ ok: true, redirect: "/dashboard" });
});

app.get("/logout", requireAuth, (req, res) => {
  logActivity(req.session.user, "LOGOUT", "Logout");
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.get("/dashboard", requireAuth, (_, res) => res.sendFile(path.join(__dirname, "public/dashboard.html")));
app.get("/monitor", requireAuth, (_, res) => res.sendFile(path.join(__dirname, "public/monitor.html")));
app.get("/files", requireAuth, (_, res) => res.sendFile(path.join(__dirname, "public/files.html")));
app.get("/settings", requireAuth, (_, res) => res.sendFile(path.join(__dirname, "public/settings.html")));

app.get("/me", requireAuth, (req, res) => {
  res.json({ username: req.session.user });
});

app.get("/api/metrics", requireAuth, (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const disk = getDiskUsage();

  res.json({
    cpu: { percent: sampleCpuPercent() },
    mem: {
      percent: Number(((usedMem / totalMem) * 100).toFixed(2)),
      used: usedMem,
      total: totalMem,
    },
    disk,
    uptime: os.uptime(),
    loadavg: os.loadavg(),
    timestamp: Date.now(),
  });

  logActivity(req.session.user, "METRICS", "Fetched metrics");
});

app.get("/api/logs", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT id, ts, actor, action, detail FROM activity_logs ORDER BY id DESC LIMIT 50")
    .all();
  res.json({ logs: rows });
  logActivity(req.session.user, "LOG_LIST", "Fetched last 50 logs");
});

app.get("/api/files/list", requireAuth, async (req, res) => {
  try {
    const absPath = safeResolve(req.query.path || "/");
    const entries = await fs.readdir(absPath, { withFileTypes: true });
    const mapped = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(absPath, entry.name);
        const stat = await fs.stat(entryPath);
        return {
          name: entry.name,
          path: toClientPath(entryPath),
          type: entry.isDirectory() ? "dir" : "file",
          size: stat.size,
          mtime: stat.mtimeMs,
        };
      })
    );

    const sorted = mapped.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    logActivity(req.session.user, "FILE_LIST", `list:${toClientPath(absPath)}`);
    res.json({ current: toClientPath(absPath), entries: sorted });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/files/read", requireAuth, async (req, res) => {
  try {
    const absPath = safeResolve(req.query.path);
    const content = await fs.readFile(absPath, "utf8");
    logActivity(req.session.user, "FILE_READ", `read:${toClientPath(absPath)}`);
    res.json({ path: toClientPath(absPath), content });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/files/write", requireAuth, async (req, res) => {
  try {
    const absPath = safeResolve(req.body.path);
    await fs.writeFile(absPath, req.body.content ?? "", "utf8");
    logActivity(req.session.user, "FILE_WRITE", `write:${toClientPath(absPath)}`);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/files/upload", requireAuth, async (req, res) => {
  try {
    const absPath = safeResolve(req.query.path || "/");
    const contentType = req.headers["content-type"] || "";
    const match = contentType.match(/boundary=(.+)$/);
    if (!match) throw new Error("Invalid multipart form-data.");

    const boundary = `--${match[1]}`;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("binary");
    const parts = body.split(boundary).filter((part) => part.includes("filename="));

    const uploaded = [];
    for (const part of parts) {
      const [rawHeaders, rawContent] = part.split("\r\n\r\n");
      if (!rawHeaders || !rawContent) continue;
      const filenameMatch = rawHeaders.match(/filename="([^"]+)"/);
      if (!filenameMatch) continue;

      const filename = path.basename(filenameMatch[1]);
      const fileDataBinary = rawContent.replace(/\r\n--$/, "").replace(/\r\n$/, "");
      const fileBuffer = Buffer.from(fileDataBinary, "binary");
      const target = safeResolve(path.join(toClientPath(absPath), filename));
      await fs.writeFile(target, fileBuffer);
      uploaded.push(filename);
    }

    logActivity(req.session.user, "FILE_UPLOAD", `upload:${toClientPath(absPath)} (${uploaded.join(",")})`);
    res.json({ ok: true, uploaded });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/files/download", requireAuth, async (req, res) => {
  try {
    const absPath = safeResolve(req.query.path);
    await fs.access(absPath);
    logActivity(req.session.user, "FILE_DOWNLOAD", `download:${toClientPath(absPath)}`);
    res.download(absPath, path.basename(absPath));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/files/mkdir", requireAuth, async (req, res) => {
  try {
    const basePath = safeResolve(req.body.path || "/");
    const target = safeResolve(path.join(toClientPath(basePath), req.body.name));
    await fs.mkdir(target, { recursive: false });
    logActivity(req.session.user, "FILE_MKDIR", `mkdir:${toClientPath(target)}`);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/files/new", requireAuth, async (req, res) => {
  try {
    const basePath = safeResolve(req.body.path || "/");
    const target = safeResolve(path.join(toClientPath(basePath), req.body.name));
    await fs.writeFile(target, "", { flag: "wx" });
    logActivity(req.session.user, "FILE_NEW", `new:${toClientPath(target)}`);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/files/rename", requireAuth, async (req, res) => {
  try {
    const from = safeResolve(req.body.from);
    const to = safeResolve(req.body.to);
    await fs.rename(from, to);
    logActivity(req.session.user, "FILE_RENAME", `rename:${toClientPath(from)}=>${toClientPath(to)}`);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/files/delete", requireAuth, async (req, res) => {
  try {
    const target = safeResolve(req.body.path);
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      await fs.rm(target, { recursive: true, force: false });
    } else {
      await fs.unlink(target);
    }
    logActivity(req.session.user, "FILE_DELETE", `delete:${toClientPath(target)}`);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/admin/change-password", requireAuth, (req, res) => {
  const { oldPassword, newPassword, confirmPassword } = req.body;
  if (!newPassword || newPassword.length < 12) {
    return res.status(400).json({ error: "Password baru minimal 12 karakter." });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: "Konfirmasi password tidak sama." });
  }

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(req.session.user);
  if (!user || !bcrypt.compareSync(oldPassword || "", user.password_hash)) {
    return res.status(400).json({ error: "Password lama salah." });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, user.id);
  logActivity(req.session.user, "ADMIN_CHANGE_PASSWORD", "Changed own password");
  return res.json({ ok: true, message: "Password berhasil diperbarui." });
});

app.post("/api/admin/change-username", requireAuth, (req, res) => {
  const { newUsername, passwordConfirm } = req.body;
  if (!newUsername || newUsername.length < 3) {
    return res.status(400).json({ error: "Username minimal 3 karakter." });
  }

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(req.session.user);
  if (!user || !bcrypt.compareSync(passwordConfirm || "", user.password_hash)) {
    return res.status(400).json({ error: "Password konfirmasi salah." });
  }

  try {
    db.prepare("UPDATE users SET username = ? WHERE id = ?").run(newUsername, user.id);
    req.session.user = newUsername;
    logActivity(newUsername, "ADMIN_CHANGE_USERNAME", `Changed username from ${user.username}`);
    return res.json({ ok: true, message: "Username berhasil diperbarui." });
  } catch {
    return res.status(400).json({ error: "Username sudah dipakai." });
  }
});

app.post("/api/admin/add-admin", requireAuth, (req, res) => {
  const { username, password } = req.body;
  if (!username || username.length < 3) {
    return res.status(400).json({ error: "Username minimal 3 karakter." });
  }
  if (!password || password.length < 12) {
    return res.status(400).json({ error: "Password minimal 12 karakter." });
  }

  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hash);
    logActivity(req.session.user, "ADMIN_ADD_ADMIN", `Added admin ${username}`);
    return res.json({ ok: true, message: "Admin baru berhasil dibuat." });
  } catch {
    return res.status(400).json({ error: "Username sudah dipakai." });
  }
});

app.use((err, _req, res, _next) => {
  res.status(500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`App running on http://0.0.0.0:${PORT}`);
});
