require("dotenv").config();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcrypt");
const multer = require("multer");

const { db, slugify, GUEST_USER_ID } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const UPLOAD_DIR = path.join(
  DATA_DIR === __dirname ? path.join(__dirname, "public") : DATA_DIR,
  "uploads",
  "mp3"
);
const PHOTO_DIR = path.join(
  DATA_DIR === __dirname ? path.join(__dirname, "public") : DATA_DIR,
  "uploads",
  "photos"
);
const FILM_DIR = path.join(
  DATA_DIR === __dirname ? path.join(__dirname, "public") : DATA_DIR,
  "uploads",
  "films"
);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(PHOTO_DIR, { recursive: true });
fs.mkdirSync(FILM_DIR, { recursive: true });

const MUSIC_EXTS = new Set([".mp3", ".m4a", ".aac", ".mpeg"]);
const MUSIC_MAX_BYTES = 80 * 1024 * 1024;
const WAV_EXTS = new Set([".wav", ".wave", ".aiff", ".aif"]);
const WAV_TYPES = new Set([
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/x-pn-wav",
  "audio/vnd.wave",
  "audio/aiff",
  "audio/x-aiff",
  "audio/aif",
]);
const SECRET_MAX_BYTES = 600 * 1024 * 1024;

function audioType(file) {
  return (file.mimetype || "").toLowerCase().split(";")[0].trim();
}

function audioExt(file) {
  return path.extname(file.originalname || "").toLowerCase();
}

function isMusicFile(file) {
  const ext = audioExt(file);
  const type = audioType(file);
  return MUSIC_EXTS.has(ext) || type === "audio/mpeg" || type === "audio/mp3" || type === "audio/mp4" || type === "audio/aac";
}

function isSecretAudioFile(file) {
  const ext = audioExt(file);
  const type = audioType(file);
  return WAV_EXTS.has(ext) || WAV_TYPES.has(type) || isMusicFile(file);
}

function uploadErrorMessage(err, fallback, maxLabel) {
  if (!err) return fallback;
  if (err.code === "LIMIT_FILE_SIZE") {
    return `That file is too large (max ${maxLabel || "80MB"}).`;
  }
  return err.message || fallback;
}

function diskAudioStorage(defaultExt) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = audioExt(file) || defaultExt;
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
    },
  });
}

const upload = multer({
  storage: diskAudioStorage(".mp3"),
  limits: { fileSize: MUSIC_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok = isMusicFile(file);
    cb(ok ? null : new Error("Please upload an MP3 file."), ok);
  },
});

const uploadSecret = multer({
  storage: diskAudioStorage(".wav"),
  limits: { fileSize: SECRET_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok = isSecretAudioFile(file);
    cb(ok ? null : new Error("Please upload a high-res WAV file."), ok);
  },
});

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const uploadPhoto = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PHOTO_DIR),
    filename: (_req, file, cb) => {
      const ext = IMAGE_EXTS.has(path.extname(file.originalname).toLowerCase())
        ? path.extname(file.originalname).toLowerCase()
        : ".jpg";
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const type = (file.mimetype || "").toLowerCase().split(";")[0].trim();
    const ok =
      IMAGE_TYPES.has(type) ||
      IMAGE_EXTS.has(ext) ||
      type.startsWith("image/");
    cb(ok ? null : new Error("Please upload a JPG, PNG, GIF, or WEBP image."), ok);
  },
});

const FILM_EXTS = new Set([".mp4", ".m4v", ".webm", ".mov"]);
const FILM_MAX_BYTES = 2 * 1024 * 1024 * 1024;

function isFilmFile(file) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const type = (file.mimetype || "").toLowerCase().split(";")[0].trim();
  return (
    FILM_EXTS.has(ext) ||
    type === "video/mp4" ||
    type === "video/quicktime" ||
    type === "video/webm" ||
    type === "video/x-m4v" ||
    type.startsWith("video/")
  );
}

const uploadFilm = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILM_DIR),
    filename: (_req, file, cb) => {
      const ext = FILM_EXTS.has(path.extname(file.originalname).toLowerCase())
        ? path.extname(file.originalname).toLowerCase()
        : ".mp4";
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: FILM_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok = isFilmFile(file);
    cb(ok ? null : new Error("Please upload a film (mp4, m4v, webm, or mov)."), ok);
  },
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "1mb" }));

const CINEMA_TZ = "Europe/London";

function londonClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CINEMA_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type) => Number(parts.find((part) => part.type === type).value);
  return { hour: read("hour"), minute: read("minute"), second: read("second") };
}

function getCinemaStatus(date = new Date()) {
  const { hour, minute, second } = londonClock(date);
  const nowSec = hour * 3600 + minute * 60 + second;
  const openStart = 20 * 3600;
  const openEnd = 24 * 3600;
  const open = nowSec >= openStart && nowSec < openEnd;

  let slot = null;
  let slotKey = null;
  let slotEnd = openEnd;
  if (nowSec >= 20 * 3600 && nowSec < 22 * 3600) {
    slot = "20:00 – 22:00";
    slotKey = "20-22";
    slotEnd = 22 * 3600;
  } else if (nowSec >= 22 * 3600 && nowSec < 24 * 3600) {
    slot = "22:00 – 00:00";
    slotKey = "22-00";
    slotEnd = 24 * 3600;
  }

  const targetSec = open ? slotEnd : openStart;
  let waitSec = targetSec - nowSec;
  if (waitSec <= 0) waitSec += 24 * 3600;

  return {
    open,
    slot,
    slotKey,
    liveOffset: open ? nowSec - (slotKey === "20-22" ? 20 * 3600 : 22 * 3600) : 0,
    nextLabel: open ? null : "20:00",
    reloadAfterMs: Math.min(waitSec * 1000, 24 * 60 * 60 * 1000),
  };
}

app.use("/uploads/films", (req, res, next) => {
  if (!getCinemaStatus().open) return res.status(404).end();
  next();
});
app.use(express.static(path.join(__dirname, "public")));
if (DATA_DIR !== __dirname) {
  app.use("/uploads/mp3", express.static(UPLOAD_DIR));
  app.use("/uploads/photos", express.static(PHOTO_DIR));
  app.use("/uploads/films", express.static(FILM_DIR));
}

app.use(
  session({
    store: new SQLiteStore({ db: "sessions.sqlite", dir: DATA_DIR }),
    secret: process.env.SESSION_SECRET || "change-me-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    },
  })
);

// Make the logged-in user (if any) available in every template.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

// ---------- Public site ----------

const POST_SELECT = `SELECT posts.*,
  COALESCE(NULLIF(posts.handle, ''), users.display_name) AS author_name
  FROM posts JOIN users ON users.id = posts.author_id`;

app.get("/", (req, res) => {
  res.render("index");
});

app.get("/secretgiftforyou", (req, res) => {
  const tracks = db
    .prepare("SELECT * FROM secret_tracks ORDER BY datetime(created_at) ASC, id ASC")
    .all();
  res.render("secret", { tracks });
});

app.get("/diary", (req, res) => {
  const posts = db
    .prepare(`${POST_SELECT} ORDER BY datetime(posts.created_at) DESC`)
    .all();
  res.render("diary", {
    posts,
    error: null,
    form: { handle: "", title: "", body: "" },
  });
});

app.post("/diary", (req, res) => {
  const handle = normalizeHandle(req.body.handle, "anonymous");
  const body = (req.body.body || "").trim();
  let title = (req.body.title || "").trim();

  if (!body) {
    const posts = db
      .prepare(`${POST_SELECT} ORDER BY datetime(posts.created_at) DESC`)
      .all();
    return res.status(400).render("diary", {
      posts,
      error: "write something before posting.",
      form: {
        handle: req.body.handle || "",
        title: req.body.title || "",
        body: "",
      },
    });
  }

  if (!title) {
    title = body.length > 48 ? body.slice(0, 48).trim() + "…" : body;
  }

  const slug = slugify(title);
  db.prepare(
    `INSERT INTO posts (slug, title, body, author_id, handle) VALUES (?, ?, ?, ?, ?)`
  ).run(slug, title, body, GUEST_USER_ID, handle);

  res.redirect("/diary");
});

app.get("/music", (req, res) => {
  const tracks = db
    .prepare("SELECT * FROM tracks ORDER BY datetime(created_at) ASC, id ASC")
    .all();
  res.render("music", { tracks });
});

app.get("/photos", (req, res) => {
  const photos = db
    .prepare("SELECT * FROM photos ORDER BY datetime(created_at) DESC, id DESC")
    .all();
  res.render("photos", { photos });
});

app.get("/cinema", (req, res) => {
  const cinema = getCinemaStatus();
  let film = null;
  if (cinema.open && cinema.slotKey) {
    film = db
      .prepare(
        `SELECT films.* FROM cinema_slots
         JOIN films ON films.id = cinema_slots.film_id
         WHERE cinema_slots.slot = ?`
      )
      .get(cinema.slotKey);
  }
  res.render("cinema", { film, cinema });
});

function parseGraffitiPoints(raw) {
  try {
    const points = JSON.parse(raw);
    return Array.isArray(points) ? points : [];
  } catch (_err) {
    return [];
  }
}

const GRAFFITI_BRUSHES = new Set([
  "pencil",
  "ink",
  "marker",
  "nib",
  "chalk",
  "spray",
  "dots",
  "stars",
  "splat",
  "bloom",
  "two",
]);

function sanitizePoints(rawPoints) {
  if (!Array.isArray(rawPoints) || rawPoints.length === 0 || rawPoints.length > 800) {
    return null;
  }
  const points = [];
  for (const point of rawPoints) {
    if (!point || typeof point !== "object") continue;
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push({
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    });
    if (points.length > 800) break;
  }
  return points.length ? points : null;
}

function sanitizeStroke(stroke) {
  if (Array.isArray(stroke)) {
    const points = sanitizePoints(stroke);
    return points ? { brush: "pencil", points } : null;
  }
  if (!stroke || typeof stroke !== "object") return null;
  const brush = GRAFFITI_BRUSHES.has(stroke.brush) ? stroke.brush : "pencil";
  const points = sanitizePoints(stroke.points);
  return points ? { brush, points } : null;
}

app.get("/graffiti", (req, res) => {
  const rows = db
    .prepare("SELECT points FROM graffiti_strokes ORDER BY id ASC")
    .all();
  res.json({
    strokes: rows
      .map((row) => {
        const parsed = (() => {
          try {
            return JSON.parse(row.points);
          } catch (_err) {
            return null;
          }
        })();
        return sanitizeStroke(parsed);
      })
      .filter(Boolean),
  });
});

app.post("/graffiti", (req, res) => {
  const incoming = Array.isArray(req.body && req.body.strokes) ? req.body.strokes : [];
  if (!incoming.length) {
    return res.status(400).json({ error: "nothing to save." });
  }
  if (incoming.length > 80) {
    return res.status(400).json({ error: "too many strokes at once." });
  }

  const insert = db.prepare("INSERT INTO graffiti_strokes (points) VALUES (?)");
  const saveMany = db.transaction((strokes) => {
    let count = 0;
    for (const stroke of strokes) {
      const points = sanitizeStroke(stroke);
      if (!points) continue;
      insert.run(JSON.stringify(points));
      count += 1;
    }
    return count;
  });

  const saved = saveMany(incoming);
  if (!saved) return res.status(400).json({ error: "nothing to save." });
  res.json({ ok: true, saved });
});

app.get("/post/:slug", (req, res) => {
  const post = db
    .prepare(`${POST_SELECT} WHERE slug = ?`)
    .get(req.params.slug);
  if (!post) return res.status(404).render("404");
  res.render("post", { post });
});

// ---------- Auth ----------

app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/admin");
  res.render("login", { error: null });
});

app.post("/login", (req, res) => {
  const username = (req.body.username || "").trim();
  const password = req.body.password || "";
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).render("login", { error: "Wrong username or password." });
  }

  req.session.user = { id: user.id, username: user.username, name: user.display_name };
  res.redirect("/admin");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// ---------- Admin portal ----------

function normalizeHandle(raw, fallback) {
  const handle = (raw || "").trim();
  return handle || fallback || "anonymous";
}

function renderAdmin(res, extras = {}) {
  const posts = db
    .prepare(`${POST_SELECT} ORDER BY datetime(posts.created_at) DESC`)
    .all();
  const tracks = db
    .prepare("SELECT * FROM tracks ORDER BY datetime(created_at) DESC, id DESC")
    .all();
  const photos = db
    .prepare("SELECT * FROM photos ORDER BY datetime(created_at) DESC, id DESC")
    .all();
  const secretTracks = db
    .prepare("SELECT * FROM secret_tracks ORDER BY datetime(created_at) DESC, id DESC")
    .all();
  const films = db
    .prepare("SELECT * FROM films ORDER BY datetime(created_at) DESC, id DESC")
    .all();
  const cinemaSlots = db
    .prepare(
      `SELECT cinema_slots.slot, cinema_slots.film_id, films.title AS film_title
       FROM cinema_slots
       LEFT JOIN films ON films.id = cinema_slots.film_id`
    )
    .all();
  const graffitiCount = db
    .prepare("SELECT COUNT(*) AS count FROM graffiti_strokes")
    .get().count;
  res.render("admin", {
    posts,
    tracks,
    photos,
    secretTracks,
    films,
    cinemaSlots,
    graffitiCount,
    handleSaved: false,
    trackSaved: false,
    trackError: null,
    secretTrackSaved: false,
    secretTrackError: null,
    photoSaved: false,
    photoError: null,
    filmSaved: false,
    filmError: null,
    slotsSaved: false,
    graffitiCleared: false,
    ...extras,
  });
}

app.get("/admin", requireAuth, (req, res) => {
  renderAdmin(res, {
    handleSaved: req.query.handle === "saved",
    trackSaved: req.query.track === "saved",
    secretTrackSaved: req.query.secret === "saved",
    photoSaved: req.query.photo === "saved",
    filmSaved: req.query.film === "saved",
    slotsSaved: req.query.slots === "saved",
    graffitiCleared: req.query.graffiti === "cleared",
  });
});

app.post("/admin/handle", requireAuth, (req, res) => {
  const handle = normalizeHandle(req.body.handle, req.session.user.name);
  db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(
    handle,
    req.session.user.id
  );
  req.session.user.name = handle;
  res.redirect("/admin?handle=saved");
});

app.get("/admin/new", requireAuth, (req, res) => {
  res.render("edit-post", { post: null });
});

app.post("/admin/posts", requireAuth, (req, res) => {
  const { title, body, handle } = req.body;
  if (!title || !title.trim() || !body || !body.trim()) {
    return res.redirect("/admin/new");
  }
  const slug = slugify(title);
  const authorHandle = normalizeHandle(handle, req.session.user.name);
  db.prepare(
    `INSERT INTO posts (slug, title, body, author_id, handle) VALUES (?, ?, ?, ?, ?)`
  ).run(slug, title.trim(), body.trim(), req.session.user.id, authorHandle);
  res.redirect("/admin");
});

app.get("/admin/posts/:id/edit", requireAuth, (req, res) => {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id);
  if (!post) return res.status(404).render("404");
  res.render("edit-post", { post });
});

app.post("/admin/posts/:id", requireAuth, (req, res) => {
  const { title, body, handle } = req.body;
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id);
  if (!post) return res.status(404).render("404");
  const authorHandle = normalizeHandle(handle, req.session.user.name);
  db.prepare(
    `UPDATE posts SET title = ?, body = ?, handle = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(title.trim(), body.trim(), authorHandle, req.params.id);
  res.redirect("/admin");
});

app.post("/admin/posts/:id/delete", requireAuth, (req, res) => {
  db.prepare("DELETE FROM posts WHERE id = ?").run(req.params.id);
  res.redirect("/admin");
});

app.post("/admin/tracks", requireAuth, (req, res) => {
  upload.single("track")(req, res, (err) => {
    if (err) {
      return renderAdmin(res, {
        trackError: uploadErrorMessage(err, "Upload failed.", "80MB"),
      });
    }
    if (!req.file) {
      return renderAdmin(res, { trackError: "Choose an MP3 file to upload." });
    }

    const fallback = path
      .basename(req.file.originalname, path.extname(req.file.originalname))
      .trim();
    const title = (req.body.title || "").trim() || fallback || "untitled";

    db.prepare(
      `INSERT INTO tracks (title, filename, original_name) VALUES (?, ?, ?)`
    ).run(title, req.file.filename, req.file.originalname);

    res.redirect("/admin?track=saved");
  });
});

app.post("/admin/tracks/:id/delete", requireAuth, (req, res) => {
  const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(req.params.id);
  if (track) {
    db.prepare("DELETE FROM tracks WHERE id = ?").run(track.id);
    const filePath = path.join(UPLOAD_DIR, track.filename);
    fs.unlink(filePath, () => {});
  }
  res.redirect("/admin");
});

app.post("/admin/secret-tracks", requireAuth, (req, res) => {
  uploadSecret.single("track")(req, res, (err) => {
    if (err) {
      return renderAdmin(res, {
        secretTrackError: uploadErrorMessage(err, "Upload failed.", "600MB"),
      });
    }
    if (!req.file) {
      return renderAdmin(res, { secretTrackError: "Choose a WAV file to upload." });
    }

    const fallback = path
      .basename(req.file.originalname, path.extname(req.file.originalname))
      .trim();
    const title = (req.body.title || "").trim() || fallback || "untitled";

    db.prepare(
      `INSERT INTO secret_tracks (title, filename, original_name) VALUES (?, ?, ?)`
    ).run(title, req.file.filename, req.file.originalname);

    res.redirect("/admin?secret=saved");
  });
});

app.post("/admin/secret-tracks/:id/delete", requireAuth, (req, res) => {
  const track = db.prepare("SELECT * FROM secret_tracks WHERE id = ?").get(req.params.id);
  if (track) {
    db.prepare("DELETE FROM secret_tracks WHERE id = ?").run(track.id);
    const filePath = path.join(UPLOAD_DIR, track.filename);
    fs.unlink(filePath, () => {});
  }
  res.redirect("/admin");
});

app.post("/admin/photos", requireAuth, (req, res) => {
  uploadPhoto.single("photo")(req, res, (err) => {
    if (err) {
      return renderAdmin(res, {
        photoError: uploadErrorMessage(err, "Upload failed."),
      });
    }
    if (!req.file) {
      return renderAdmin(res, { photoError: "Choose an image file to upload." });
    }

    const fallback = path
      .basename(req.file.originalname, path.extname(req.file.originalname))
      .trim();
    const title = (req.body.title || "").trim() || fallback || "untitled";

    db.prepare(
      `INSERT INTO photos (title, filename, original_name) VALUES (?, ?, ?)`
    ).run(title, req.file.filename, req.file.originalname);

    res.redirect("/admin?photo=saved");
  });
});

app.post("/admin/photos/:id/delete", requireAuth, (req, res) => {
  const photo = db.prepare("SELECT * FROM photos WHERE id = ?").get(req.params.id);
  if (photo) {
    db.prepare("DELETE FROM photos WHERE id = ?").run(photo.id);
    const filePath = path.join(PHOTO_DIR, photo.filename);
    fs.unlink(filePath, () => {});
  }
  res.redirect("/admin");
});

app.post("/admin/films", requireAuth, (req, res) => {
  uploadFilm.single("film")(req, res, (err) => {
    if (err) {
      return renderAdmin(res, {
        filmError: uploadErrorMessage(err, "Upload failed.", "2GB"),
      });
    }
    if (!req.file) {
      return renderAdmin(res, { filmError: "Choose a film file to upload." });
    }

    const fallback = path
      .basename(req.file.originalname, path.extname(req.file.originalname))
      .trim();
    const title = (req.body.title || "").trim() || fallback || "untitled";

    const info = db
      .prepare(
        `INSERT INTO films (title, filename, original_name) VALUES (?, ?, ?)`
      )
      .run(title, req.file.filename, req.file.originalname);

    const slot = req.body.slot === "20-22" || req.body.slot === "22-00" ? req.body.slot : "";
    if (slot) {
      db.prepare("UPDATE cinema_slots SET film_id = ? WHERE slot = ?").run(
        info.lastInsertRowid,
        slot
      );
    }

    res.redirect("/admin?film=saved");
  });
});

app.post("/admin/films/:id/delete", requireAuth, (req, res) => {
  const film = db.prepare("SELECT * FROM films WHERE id = ?").get(req.params.id);
  if (film) {
    db.prepare("UPDATE cinema_slots SET film_id = NULL WHERE film_id = ?").run(film.id);
    db.prepare("DELETE FROM films WHERE id = ?").run(film.id);
    const filePath = path.join(FILM_DIR, film.filename);
    fs.unlink(filePath, () => {});
  }
  res.redirect("/admin");
});

app.post("/admin/cinema-slots", requireAuth, (req, res) => {
  const upsert = db.prepare("UPDATE cinema_slots SET film_id = ? WHERE slot = ?");
  for (const slot of ["20-22", "22-00"]) {
    const raw = req.body[`film_${slot}`];
    const filmId = raw ? Number(raw) : null;
    const film = filmId ? db.prepare("SELECT id FROM films WHERE id = ?").get(filmId) : null;
    upsert.run(film ? film.id : null, slot);
  }
  res.redirect("/admin?slots=saved");
});

app.post("/admin/graffiti/clear", requireAuth, (req, res) => {
  db.prepare("DELETE FROM graffiti_strokes").run();
  res.redirect("/admin?graffiti=cleared");
});

app.use((err, req, res, next) => {
  console.error(err);
  if (req.path && req.path.startsWith("/admin")) {
    const secret = req.path.startsWith("/admin/secret-tracks");
    return renderAdmin(res, {
      trackError: secret ? null : uploadErrorMessage(err, "Upload failed.", "80MB"),
      secretTrackError: secret
        ? uploadErrorMessage(err, "Upload failed.", "600MB")
        : null,
      photoError: req.path.startsWith("/admin/photos")
        ? uploadErrorMessage(err, "Upload failed.", "25MB")
        : null,
      filmError: req.path.startsWith("/admin/films")
        ? uploadErrorMessage(err, "Upload failed.", "2GB")
        : null,
    });
  }
  next(err);
});

app.use((req, res) => res.status(404).render("404"));

app.listen(PORT, () => {
  console.log(`loverosiewebsite running on port ${PORT}`);
});
