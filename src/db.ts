import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";

export const dataDir = process.env.DATA_DIR || join(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });

export const dbPath = join(dataDir, "boxio.db");
export const db = new DatabaseSync(dbPath);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS device_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  key TEXT UNIQUE NOT NULL,
  last_seen TEXT,
  online INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  device_key_id INTEGER,
  layout_json TEXT NOT NULL DEFAULT '{"widgets":[]}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (device_key_id) REFERENCES device_keys(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pin_values (
  device_key_id INTEGER NOT NULL,
  pin INTEGER NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (device_key_id, pin)
);

CREATE TABLE IF NOT EXISTS pin_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_key_id INTEGER NOT NULL,
  pin INTEGER NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pin_properties (
  device_key_id INTEGER NOT NULL,
  pin INTEGER NOT NULL,
  prop TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (device_key_id, pin, prop)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pin_history (
  device_key_id INTEGER NOT NULL,
  pin INTEGER NOT NULL,
  interval_sec INTEGER NOT NULL,
  bucket INTEGER NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (device_key_id, pin, interval_sec, bucket)
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  invited_by INTEGER NOT NULL,
  project_ids TEXT NOT NULL,
  account_role TEXT NOT NULL DEFAULT 'viewer',
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE
);
`);

const userColumns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
if (!userColumns.some((column) => column.name === "created_by")) {
  db.exec("ALTER TABLE users ADD COLUMN created_by INTEGER");
}

const inviteColumns = db.prepare("PRAGMA table_info(account_invites)").all() as { name: string }[];
if (!inviteColumns.some((column) => column.name === "account_role")) {
  db.exec("ALTER TABLE account_invites ADD COLUMN account_role TEXT NOT NULL DEFAULT 'viewer'");
}

function getSettingRaw(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function getSetting(key: string, fallback = ""): string {
  return getSettingRaw(key) ?? fallback;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export function getSettings(): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

if (!getSettingRaw("jwt_secret")) {
  setSetting("jwt_secret", randomBytes(48).toString("hex"));
}

if (!getSettingRaw("roles_split_viewers")) {
  db.exec("UPDATE users SET role = 'viewer' WHERE role = 'user' AND created_by IS NOT NULL");
  setSetting("roles_split_viewers", "1");
}

export function jwtSecret(): string {
  return process.env.JWT_SECRET || getSetting("jwt_secret");
}

export function userCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  return row.c;
}

export function markDeviceSeen(keyId: number): void {
  db.prepare(
    "UPDATE device_keys SET last_seen = datetime('now'), online = 1 WHERE id = ?",
  ).run(keyId);
}

export function sweepOfflineDevices(): void {
  db.prepare(
    `UPDATE device_keys SET online = 0
     WHERE last_seen IS NULL OR last_seen < datetime('now', '-20 seconds')`,
  ).run();
}

export function getOrCreateSecretFile(): string {
  return join(dirname(dbPath), "boxio.db");
}
