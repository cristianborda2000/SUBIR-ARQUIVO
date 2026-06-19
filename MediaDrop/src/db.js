const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const initSqlJs = require("sql.js");
const config = require("./config");
const { ensureDirectories } = require("./storage");

ensureDirectories();

let db;

function persist() {
  const data = db.export();
  fs.writeFileSync(config.dbPath, Buffer.from(data));
}

function normalizeParams(params = []) {
  return Array.isArray(params) ? params : [params];
}

function all(sql, params = []) {
  const statement = db.prepare(sql);
  const rows = [];
  try {
    statement.bind(normalizeParams(params));
    while (statement.step()) {
      rows.push(statement.getAsObject());
    }
    return rows;
  } finally {
    statement.free();
  }
}

function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

function run(sql, params = []) {
  const statement = db.prepare(sql);
  try {
    statement.run(normalizeParams(params));
  } finally {
    statement.free();
  }
  const row = get("SELECT last_insert_rowid() AS id");
  persist();
  return { lastInsertRowid: row ? row.id : null };
}

function exec(sql) {
  db.exec(sql);
  persist();
}

function ensureAdmin() {
  const existing = get("SELECT id FROM admins WHERE username = ?", [config.adminUser]);
  if (existing) return;

  const hash = bcrypt.hashSync(config.adminPassword, 12);
  run(`
    INSERT INTO admins (username, password_hash, created_at)
    VALUES (?, ?, ?)
  `, [config.adminUser, hash, new Date().toISOString()]);
}

async function initDb() {
  const wasmPath = path.dirname(require.resolve("sql.js/dist/sql-wasm.wasm"));
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(wasmPath, file)
  });
  const fileBuffer = fs.existsSync(config.dbPath) ? fs.readFileSync(config.dbPath) : null;
  db = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();

  exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      category TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      note TEXT,
      relative_path TEXT NOT NULL,
      uploaded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  ensureAdmin();

  return { all, get, run, exec };
}

module.exports = { initDb };
