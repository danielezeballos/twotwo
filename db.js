const path = require("path");
const fs = require("fs");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");

const DB_PATH =
  process.env.DB_PATH ||
  path.join(process.env.DATA_DIR || __dirname, "data.sqlite");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    author_id INTEGER NOT NULL,
    handle TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (author_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS graffiti_strokes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    points TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Older databases created before the handle column still need it.
const postColumns = db.prepare("PRAGMA table_info(posts)").all().map((c) => c.name);
if (!postColumns.includes("handle")) {
  db.exec("ALTER TABLE posts ADD COLUMN handle TEXT");
  db.exec(`
    UPDATE posts
    SET handle = (
      SELECT display_name FROM users WHERE users.id = posts.author_id
    )
    WHERE handle IS NULL OR handle = ''
  `);
}

// Seed the two admin accounts from environment variables, if they don't
// already exist. This keeps credentials out of source control — set
// ADMIN1_USERNAME / ADMIN1_PASSWORD / ADMIN1_NAME (and ADMIN2_*) wherever
// you deploy (e.g. Railway's Variables tab).
function seedAdmins() {
  const admins = [
    {
      username: process.env.ADMIN1_USERNAME,
      password: process.env.ADMIN1_PASSWORD,
      name: process.env.ADMIN1_NAME || process.env.ADMIN1_USERNAME,
    },
    {
      username: process.env.ADMIN2_USERNAME,
      password: process.env.ADMIN2_PASSWORD,
      name: process.env.ADMIN2_NAME || process.env.ADMIN2_USERNAME,
    },
  ];

  const insert = db.prepare(
    "INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)"
  );
  const exists = db.prepare("SELECT id FROM users WHERE username = ?");

  for (const admin of admins) {
    if (!admin.username || !admin.password) continue;
    if (exists.get(admin.username)) continue;
    const hash = bcrypt.hashSync(admin.password, 12);
    insert.run(admin.username, hash, admin.name);
    console.log(`Seeded admin user: ${admin.username}`);
  }
}

seedAdmins();

// Shared author account for open diary posts (not a login).
function ensureGuestUser() {
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get("guest");
  if (existing) return existing.id;
  const hash = bcrypt.hashSync(cryptoRandom(), 12);
  const info = db
    .prepare(
      "INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)"
    )
    .run("guest", hash, "anonymous");
  return info.lastInsertRowid;
}

function cryptoRandom() {
  return require("crypto").randomBytes(24).toString("hex");
}

const GUEST_USER_ID = ensureGuestUser();

function slugify(title) {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
  let slug = base || "entry";
  let n = 1;
  const taken = db.prepare("SELECT id FROM posts WHERE slug = ?");
  while (taken.get(slug)) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

module.exports = { db, slugify, GUEST_USER_ID };
