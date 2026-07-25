const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'users.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Error opening database', err.message);
    else console.log('Connected to the SQLite database.');
});

// Create the schema synchronously at require time (queued in order before any
// query issued by callers), so later statements never race ahead of table
// creation. db.serialize guarantees these run sequentially.
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        password TEXT,
        credits INTEGER DEFAULT 100,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TEXT DEFAULT (datetime('now'))
    )`);

    // Lightweight migrations for databases created before role/created_at
    // existed. ALTER ... ADD COLUMN with a constant default is allowed; the
    // error when the column already exists is ignored.
    db.run(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`, () => {});
    db.run(`ALTER TABLE users ADD COLUMN created_at TEXT`, () => {});

    // Optional profile fields (Reoon-style Profile Settings).
    for (const col of ['first_name', 'last_name', 'phone', 'address', 'city', 'zip', 'country', 'state']) {
        db.run(`ALTER TABLE users ADD COLUMN ${col} TEXT`, () => {});
    }

    // Per-execution verification history (retained for ~1 month). Each row is a
    // "batch": one execution, tagged with a per-user sequential batch_number and
    // an optional task name (Reoon-style Tasks & Results).
    db.run(`CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        batch_number INTEGER,               -- per-user sequential number
        name TEXT,                          -- optional task name
        type TEXT NOT NULL,                 -- 'single' | 'bulk' | 'csv'
        total INTEGER NOT NULL DEFAULT 0,
        valid_count INTEGER NOT NULL DEFAULT 0,
        invalid_count INTEGER NOT NULL DEFAULT 0,
        catch_all_count INTEGER NOT NULL DEFAULT 0,
        unknown_count INTEGER NOT NULL DEFAULT 0,
        disposable_count INTEGER NOT NULL DEFAULT 0,
        results TEXT,                       -- JSON array of result objects
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_history_user_created
            ON history (user_id, created_at)`);

    // Lightweight migrations for history tables created before these columns
    // existed. The error when a column already exists is ignored.
    db.run(`ALTER TABLE history ADD COLUMN batch_number INTEGER`, () => {});
    db.run(`ALTER TABLE history ADD COLUMN name TEXT`, () => {});
    db.run(`ALTER TABLE history ADD COLUMN disposable_count INTEGER NOT NULL DEFAULT 0`, () => {});

    // Password-reset tokens. We store only the SHA-256 hash of the token, never
    // the token itself, and each row expires and can be used once.
    db.run(`CREATE TABLE IF NOT EXISTS password_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,       -- unix ms
        used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_reset_token ON password_resets (token_hash)`);
});

module.exports = db;
