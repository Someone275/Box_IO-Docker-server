import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "boxio-status-"));

const { db } = await import("../src/db.ts");
const {
  DEVICE_STATUS_PIN,
  deviceStatusValue,
  ensureDeviceStatusPins,
  publishDeviceStatusPin,
  sweepDevicePresence,
  writePin,
} = await import("../src/device.ts");

assert.equal(DEVICE_STATUS_PIN, 100);

const user = db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('status', 'x', 'admin')").run();
const userId = Number(user.lastInsertRowid);
const inserted = db
  .prepare("INSERT INTO device_keys (user_id, name, key) VALUES (?, 'bench', 'bx_status')")
  .run(userId);
const device = {
  id: Number(inserted.lastInsertRowid),
  user_id: userId,
  name: "bench",
  key: "bx_status",
};
const otherInsert = db
  .prepare("INSERT INTO device_keys (user_id, name, key, online) VALUES (?, 'other', 'bx_other', 1)")
  .run(userId);
const other = {
  id: Number(otherInsert.lastInsertRowid),
  user_id: userId,
  name: "other",
  key: "bx_other",
};
db.prepare("UPDATE device_keys SET last_seen = datetime('now') WHERE id = ?").run(other.id);

ensureDeviceStatusPins();
assert.equal(deviceStatusValue(device.id), "0");
assert.equal(deviceStatusValue(other.id), "1");

publishDeviceStatusPin(device, true);
assert.equal(deviceStatusValue(device.id), "1");
const onlineFlag = db.prepare("SELECT online FROM device_keys WHERE id = ?").get(device.id) as { online: number };
assert.equal(onlineFlag.online, 0, "the status pin does not itself mark the key online");

writePin(device, DEVICE_STATUS_PIN, "9", true);
assert.equal(deviceStatusValue(device.id), "1", "a device write cannot replace the status pin");
writePin(device, DEVICE_STATUS_PIN, "9", false);
assert.equal(deviceStatusValue(device.id), "1", "a dashboard write cannot replace the status pin");

db.prepare("UPDATE device_keys SET online = 1, last_seen = datetime('now', '-1 minute') WHERE id = ?").run(device.id);
publishDeviceStatusPin(device, true);
sweepDevicePresence();
assert.equal(deviceStatusValue(device.id), "0");
const after = db.prepare("SELECT online FROM device_keys WHERE id = ?").get(device.id) as { online: number };
assert.equal(after.online, 0);
assert.equal(deviceStatusValue(other.id), "1", "a key that checked in stays online");

console.log("device status pin ok");
