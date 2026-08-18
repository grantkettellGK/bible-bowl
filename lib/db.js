'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'biblebowl.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name       TEXT NOT NULL,
  pass_hash  TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  translation TEXT NOT NULL DEFAULT '',
  verse_count INTEGER NOT NULL DEFAULT 0,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (name, translation)
);

CREATE TABLE IF NOT EXISTS verses (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter INTEGER NOT NULL,
  verse   INTEGER NOT NULL,
  text    TEXT NOT NULL,
  UNIQUE (book_id, chapter, verse)
);
CREATE INDEX IF NOT EXISTS idx_verses_book ON verses(book_id);

CREATE TABLE IF NOT EXISTS assignments (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, book_id)
);

-- The daily quiz is generated once per (user, date) and stored, so grading
-- always matches exactly what the student saw even if assignments change.
CREATE TABLE IF NOT EXISTS daily_quizzes (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiz_date  TEXT NOT NULL,
  quiz_json  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, quiz_date)
);

CREATE TABLE IF NOT EXISTS attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiz_date    TEXT NOT NULL,
  mode         TEXT NOT NULL DEFAULT 'daily' CHECK (mode IN ('daily','practice')),
  score        INTEGER NOT NULL,
  total        INTEGER NOT NULL,
  details_json TEXT NOT NULL DEFAULT '[]',
  finished_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_once
  ON attempts(user_id, quiz_date) WHERE mode = 'daily';
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, quiz_date);
`);

// App secret (used to seed per-user daily quizzes unpredictably).
function getSecret() {
  const row = db.prepare(`SELECT value FROM meta WHERE key='secret'`).get();
  if (row) return row.value;
  const secret = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO meta (key, value) VALUES ('secret', ?)`).run(secret);
  return secret;
}

module.exports = { db, getSecret, DATA_DIR };
