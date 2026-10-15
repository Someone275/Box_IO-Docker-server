import { db, getSettings, setSetting } from "./db.js";
import { publishDeviceStatusPin, type DeviceRow } from "./device.js";

/** Settings a backup may carry. Server secrets such as the JWT stay put. */
export const BACKUP_SETTING_KEYS = [
  "smtp_host",
  "smtp_port",
  "smtp_user",
  "smtp_pass",
  "smtp_from",
  "smtp_secure",
  "twilio_sid",
  "twilio_token",
  "twilio_from",
  "domain",
  "letsencrypt_email",
] as const;

const KEY_RE = /^bx_[A-Za-z0-9]{16,128}$/;

export interface BackupPin {
  pin: number;
  value: string;
}

export interface BackupProperty {
  pin: number;
  prop: string;
  value: string;
}

export interface BackupDeviceKey {
  id: number;
  name: string;
  key: string;
  pins: BackupPin[];
  properties: BackupProperty[];
}

export interface BackupProject {
  name: string;
  deviceKeyId: number | null;
  layout: unknown;
}

export interface BackupFile {
  format: "boxio-backup";
  version: 1;
  exportedAt: string;
  settings: Record<string, string>;
  deviceKeys: BackupDeviceKey[];
  projects: BackupProject[];
}

interface KeyRow {
  id: number;
  name: string;
  key: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > max) return null;
  return text;
}

function readPin(value: unknown): number | null {
  const pin = Number(value);
  if (!Number.isInteger(pin) || pin < 0 || pin > 127) return null;
  return pin;
}

/** Point saved widgets at the device-key ids this server assigned. */
export function remapLayoutDeviceKeys(layout: unknown, ids: Map<number, number>): unknown {
  const copy = JSON.parse(JSON.stringify(layout ?? {})) as unknown;
  const visit = (widgets: unknown) => {
    if (!Array.isArray(widgets)) return;
    for (const widget of widgets) {
      const row = asRecord(widget);
      if (!row || !("deviceKeyId" in row)) continue;
      const current = Number(row.deviceKeyId);
      if (!Number.isInteger(current) || current <= 0) continue;
      const next = ids.get(current);
      if (next) row.deviceKeyId = next;
      else delete row.deviceKeyId;
    }
  };
  const root = asRecord(copy);
  if (!root) return {};
  visit(root.widgets);
  if (Array.isArray(root.pages)) {
    for (const page of root.pages) visit(asRecord(page)?.widgets);
  }
  return root;
}

export function buildBackup(userId: number): BackupFile {
  const stored = getSettings();
  const settings: Record<string, string> = {};
  for (const key of BACKUP_SETTING_KEYS) settings[key] = stored[key] ?? "";
  const keys = db
    .prepare("SELECT id, name, key FROM device_keys WHERE user_id = ? ORDER BY id")
    .all(userId) as unknown as KeyRow[];
  const deviceKeys: BackupDeviceKey[] = keys.map((key) => ({
    id: key.id,
    name: key.name,
    key: key.key,
    pins: (
      db
        .prepare("SELECT pin, value FROM pin_values WHERE device_key_id = ? AND pin != 100 ORDER BY pin")
        .all(key.id) as unknown as BackupPin[]
    ).map((row) => ({ pin: Number(row.pin), value: String(row.value) })),
    properties: (
      db
        .prepare(
          "SELECT pin, prop, value FROM pin_properties WHERE device_key_id = ? ORDER BY pin, prop",
        )
        .all(key.id) as unknown as BackupProperty[]
    ).map((row) => ({ pin: Number(row.pin), prop: String(row.prop), value: String(row.value) })),
  }));
  const projects = (
    db
      .prepare("SELECT name, device_key_id, layout_json FROM projects WHERE user_id = ? ORDER BY id")
      .all(userId) as unknown as { name: string; device_key_id: number | null; layout_json: string }[]
  ).map((row) => {
    let layout: unknown = {};
    try {
      layout = JSON.parse(row.layout_json || "{}");
    } catch {
      layout = {};
    }
    return { name: row.name, deviceKeyId: row.device_key_id, layout };
  });
  return {
    format: "boxio-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    deviceKeys,
    projects,
  };
}

function parseBackup(raw: unknown): BackupFile {
  const body = asRecord(raw);
  if (!body || body.format !== "boxio-backup" || body.version !== 1) {
    throw new Error("That file is not a Box IO backup");
  }
  const settingsIn = asRecord(body.settings) ?? {};
  const settings: Record<string, string> = {};
  for (const key of BACKUP_SETTING_KEYS) {
    if (settingsIn[key] === undefined) continue;
    if (typeof settingsIn[key] !== "string" || settingsIn[key].length > 2000) {
      throw new Error("Backup settings are not valid");
    }
    settings[key] = settingsIn[key];
  }
  if (!Array.isArray(body.deviceKeys) || body.deviceKeys.length > 500) {
    throw new Error("Backup device keys are not valid");
  }
  if (!Array.isArray(body.projects) || body.projects.length > 500) {
    throw new Error("Backup projects are not valid");
  }
  const seen = new Set<string>();
  const deviceKeys: BackupDeviceKey[] = body.deviceKeys.map((item) => {
    const row = asRecord(item);
    const id = Number(row?.id);
    const name = readString(row?.name, 80);
    const key = typeof row?.key === "string" ? row.key.trim() : "";
    if (!Number.isInteger(id) || id <= 0 || !name || !KEY_RE.test(key)) {
      throw new Error("A device key in the backup is not valid");
    }
    if (seen.has(key)) throw new Error("The backup lists the same device key twice");
    seen.add(key);
    const pins = Array.isArray(row?.pins) ? row.pins : [];
    const properties = Array.isArray(row?.properties) ? row.properties : [];
    if (pins.length > 128 || properties.length > 2000) throw new Error("A device key in the backup is too large");
    return {
      id,
      name,
      key,
      pins: pins.map((pin) => {
        const entry = asRecord(pin);
        const number = readPin(entry?.pin);
        if (number == null || number === 100 || typeof entry?.value !== "string" || entry.value.length > 8000) {
          throw new Error("A pin value in the backup is not valid");
        }
        return { pin: number, value: entry.value };
      }),
      properties: properties.map((prop) => {
        const entry = asRecord(prop);
        const number = readPin(entry?.pin);
        const name = readString(entry?.prop, 80);
        if (number == null || !name || typeof entry?.value !== "string" || entry.value.length > 8000) {
          throw new Error("A pin property in the backup is not valid");
        }
        return { pin: number, prop: name, value: entry.value };
      }),
    };
  });
  const projects: BackupProject[] = body.projects.map((item) => {
    const row = asRecord(item);
    const name = readString(row?.name, 80);
    if (!name || !asRecord(row?.layout)) throw new Error("A project in the backup is not valid");
    const deviceKeyId = row?.deviceKeyId == null || row.deviceKeyId === "" ? null : Number(row.deviceKeyId);
    if (deviceKeyId != null && (!Number.isInteger(deviceKeyId) || deviceKeyId <= 0)) {
      throw new Error("A project in the backup points at a missing device key");
    }
    return { name, deviceKeyId, layout: row?.layout };
  });
  return { format: "boxio-backup", version: 1, exportedAt: "", settings, deviceKeys, projects };
}

export function restoreBackup(userId: number, raw: unknown): { keys: number; projects: number } {
  const backup = parseBackup(raw);
  const owned = db
    .prepare("SELECT id, key FROM device_keys WHERE user_id = ?")
    .all(userId) as unknown as { id: number; key: string }[];
  const ownedByToken = new Map(owned.map((row) => [row.key, row.id]));
  for (const item of backup.deviceKeys) {
    const holder = db.prepare("SELECT user_id FROM device_keys WHERE key = ?").get(item.key) as
      | { user_id: number }
      | undefined;
    if (holder && holder.user_id !== userId) {
      throw new Error(`Device key ${item.name} already belongs to another account on this server`);
    }
  }

  db.exec("BEGIN");
  try {
    for (const [key, value] of Object.entries(backup.settings)) setSetting(key, value);
    const ids = new Map<number, number>();
    const kept = new Set<number>();
    for (const item of backup.deviceKeys) {
      let id = ownedByToken.get(item.key);
      if (id) {
        db.prepare("UPDATE device_keys SET name = ? WHERE id = ? AND user_id = ?").run(item.name, id, userId);
      } else {
        const inserted = db
          .prepare("INSERT INTO device_keys (user_id, name, key) VALUES (?, ?, ?)")
          .run(userId, item.name, item.key);
        id = Number(inserted.lastInsertRowid);
        const device: DeviceRow = { id, user_id: userId, name: item.name, key: item.key };
        publishDeviceStatusPin(device, false);
      }
      ids.set(item.id, id);
      kept.add(id);
      db.prepare("DELETE FROM pin_values WHERE device_key_id = ? AND pin != 100").run(id);
      db.prepare("DELETE FROM pin_properties WHERE device_key_id = ?").run(id);
      db.prepare("DELETE FROM pin_commands WHERE device_key_id = ?").run(id);
      const putPin = db.prepare(
        `INSERT INTO pin_values (device_key_id, pin, value, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(device_key_id, pin) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      );
      for (const pin of item.pins) putPin.run(id, pin.pin, pin.value);
      const putProp = db.prepare(
        `INSERT INTO pin_properties (device_key_id, pin, prop, value)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(device_key_id, pin, prop) DO UPDATE SET value = excluded.value`,
      );
      for (const prop of item.properties) putProp.run(id, prop.pin, prop.prop, prop.value);
    }

    db.prepare("DELETE FROM projects WHERE user_id = ?").run(userId);
    const insertProject = db.prepare(
      "INSERT INTO projects (user_id, name, device_key_id, layout_json) VALUES (?, ?, ?, ?)",
    );
    for (const project of backup.projects) {
      const deviceKeyId = project.deviceKeyId == null ? null : (ids.get(project.deviceKeyId) ?? null);
      insertProject.run(
        userId,
        project.name,
        deviceKeyId,
        JSON.stringify(remapLayoutDeviceKeys(project.layout, ids)),
      );
    }

    for (const row of owned) {
      if (kept.has(row.id)) continue;
      db.prepare("DELETE FROM pin_values WHERE device_key_id = ?").run(row.id);
      db.prepare("DELETE FROM pin_properties WHERE device_key_id = ?").run(row.id);
      db.prepare("DELETE FROM pin_commands WHERE device_key_id = ?").run(row.id);
      db.prepare("DELETE FROM pin_history WHERE device_key_id = ?").run(row.id);
      db.prepare("DELETE FROM device_keys WHERE id = ? AND user_id = ?").run(row.id, userId);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { keys: backup.deviceKeys.length, projects: backup.projects.length };
}
