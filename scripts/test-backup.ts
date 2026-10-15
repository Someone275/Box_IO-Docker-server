import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "boxio-backup-"));

const { db, getSetting, setSetting } = await import("../src/db.ts");
const { buildBackup, remapLayoutDeviceKeys, restoreBackup } = await import("../src/backup.ts");

const admin = Number(
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')").run()
    .lastInsertRowid,
);
const other = Number(
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('other', 'x', 'admin')").run()
    .lastInsertRowid,
);
setSetting("smtp_host", "mail.example.com");
setSetting("smtp_pass", "secret-pass");
setSetting("jwt_secret", "do-not-export");

const keyId = Number(
  db.prepare("INSERT INTO device_keys (user_id, name, key) VALUES (?, 'Bench', 'bx_abcdef0123456789')").run(admin)
    .lastInsertRowid,
);
db.prepare("INSERT INTO pin_values (device_key_id, pin, value) VALUES (?, 3, '9')").run(keyId);
db.prepare("INSERT INTO pin_values (device_key_id, pin, value) VALUES (?, 100, '1')").run(keyId);
db.prepare("INSERT INTO pin_properties (device_key_id, pin, prop, value) VALUES (?, 3, 'label', 'Pump')").run(keyId);
const layout = {
  pages: [{ id: "page-1", name: "Page 1", widgets: [{ id: "w1", type: "led", pin: 100, deviceKeyId: keyId }] }],
};
db.prepare("INSERT INTO projects (user_id, name, device_key_id, layout_json) VALUES (?, 'Pump room', ?, ?)").run(
  admin,
  keyId,
  JSON.stringify(layout),
);
db.prepare("INSERT INTO projects (user_id, name, device_key_id, layout_json) VALUES (?, 'Old', NULL, '{}')").run(admin);

const backup = buildBackup(admin);
db.prepare("DELETE FROM projects WHERE user_id = ?").run(admin);
db.prepare("DELETE FROM pin_values WHERE device_key_id = ?").run(keyId);
db.prepare("DELETE FROM pin_properties WHERE device_key_id = ?").run(keyId);
db.prepare("DELETE FROM device_keys WHERE id = ?").run(keyId);
assert.equal(backup.format, "boxio-backup");
assert.equal(backup.settings.smtp_host, "mail.example.com");
assert.equal(backup.settings.smtp_pass, "secret-pass");
assert.equal("jwt_secret" in backup.settings, false);
assert.equal(backup.deviceKeys.length, 1);
assert.equal(backup.deviceKeys[0].key, "bx_abcdef0123456789");
assert.deepEqual(backup.deviceKeys[0].pins, [{ pin: 3, value: "9" }]);
assert.equal(backup.projects.length, 2);

const fresh = Number(
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('fresh', 'x', 'admin')").run()
    .lastInsertRowid,
);
const restored = restoreBackup(fresh, backup);
assert.deepEqual(restored, { keys: 1, projects: 2 });
const moved = db.prepare("SELECT id, name, key FROM device_keys WHERE user_id = ?").get(fresh) as {
  id: number;
  name: string;
  key: string;
};
assert.notEqual(moved.id, keyId);
assert.equal(moved.key, "bx_abcdef0123456789");
assert.equal(moved.name, "Bench");
const pin = db.prepare("SELECT value FROM pin_values WHERE device_key_id = ? AND pin = 3").get(moved.id) as {
  value: string;
};
assert.equal(pin.value, "9");
const status = db.prepare("SELECT value FROM pin_values WHERE device_key_id = ? AND pin = 100").get(moved.id) as {
  value: string;
};
assert.equal(status.value, "0");
const label = db.prepare("SELECT value FROM pin_properties WHERE device_key_id = ? AND prop = 'label'").get(moved.id) as {
  value: string;
};
assert.equal(label.value, "Pump");
const project = db.prepare("SELECT device_key_id, layout_json FROM projects WHERE user_id = ? AND name = 'Pump room'").get(
  fresh,
) as { device_key_id: number; layout_json: string };
assert.equal(project.device_key_id, moved.id);
const savedLayout = JSON.parse(project.layout_json) as { pages: { widgets: { deviceKeyId: number }[] }[] };
assert.equal(savedLayout.pages[0].widgets[0].deviceKeyId, moved.id);
assert.equal(getSetting("smtp_host"), "mail.example.com");

db.prepare("UPDATE pin_values SET value = '1' WHERE device_key_id = ? AND pin = 3").run(moved.id);
db.prepare("INSERT INTO projects (user_id, name, layout_json) VALUES (?, 'Extra', '{}')").run(fresh);
restoreBackup(fresh, backup);
const again = db.prepare("SELECT id FROM device_keys WHERE user_id = ?").all(fresh) as { id: number }[];
assert.equal(again.length, 1);
assert.equal(again[0].id, moved.id);
const names = db.prepare("SELECT name FROM projects WHERE user_id = ? ORDER BY name").all(fresh) as { name: string }[];
assert.deepEqual(
  names.map((row) => row.name),
  ["Old", "Pump room"],
);
const rewritten = db.prepare("SELECT value FROM pin_values WHERE device_key_id = ? AND pin = 3").get(moved.id) as {
  value: string;
};
assert.equal(rewritten.value, "9");

assert.throws(() => restoreBackup(other, { format: "nope" }), /not a Box IO backup/);
const stolen = buildBackup(fresh);
assert.throws(() => restoreBackup(other, stolen), /another account/);
assert.equal(
  (db.prepare("SELECT COUNT(*) AS c FROM device_keys WHERE user_id = ?").get(other) as { c: number }).c,
  0,
);

const mapped = remapLayoutDeviceKeys({ widgets: [{ deviceKeyId: 4 }, { deviceKeyId: 9 }] }, new Map([[4, 8]]));
assert.deepEqual(mapped, { widgets: [{ deviceKeyId: 8 }, {}] });

console.log("backup restore ok");
