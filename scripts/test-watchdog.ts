import assert from "node:assert/strict";
import {
  clampIntervalSec,
  clampMisses,
  clampTransitionSec,
  targetAllowed,
  watchdogLevels,
} from "../src/watchdog-plan.ts";

assert.deepEqual(watchdogLevels("high-to-low"), ["1", "0"]);
assert.deepEqual(watchdogLevels("low-to-high"), ["0", "1"]);

assert.equal(clampIntervalSec(1), 5);
assert.equal(clampIntervalSec(30), 30);
assert.equal(clampMisses(0), 1);
assert.equal(clampTransitionSec("9"), 9);

assert.equal(targetAllowed("192.168.1.1"), true);
assert.equal(targetAllowed("localhost"), true);
assert.equal(targetAllowed("https://example.com/health"), true);
assert.equal(targetAllowed("ftp://example.com"), false);
assert.equal(targetAllowed("bad host"), false);
assert.equal(targetAllowed(""), false);

console.log("watchdog plan ok");

const { mkdtempSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "boxio-wd-"));
const { db } = await import("../src/db.ts");
const { watchdogConfig } = await import("../src/watchdog.ts");

const user = db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('wd', 'x', 'admin')").run();
const userId = Number(user.lastInsertRowid);
const device = db
  .prepare("INSERT INTO device_keys (user_id, name, key) VALUES (?, 'bench', 'bx_wd')")
  .run(userId);
const deviceId = Number(device.lastInsertRowid);
const other = db
  .prepare("INSERT INTO device_keys (user_id, name, key) VALUES (?, 'other', 'bx_other')")
  .run(userId);
const otherId = Number(other.lastInsertRowid);

assert.equal(watchdogConfig(deviceId).active, 0);

const layout = {
  pages: [
    {
      id: "p1",
      name: "Main",
      widgets: [
        {
          id: "wd1",
          type: "watchdog",
          pin: 4,
          props: {
            target: "https://example.com/health",
            intervalSec: 1,
            misses: 0,
            direction: "low-to-high",
            transitionSec: 9,
          },
        },
      ],
    },
  ],
};
db.prepare("INSERT INTO projects (user_id, name, device_key_id, layout_json) VALUES (?, 'WD', ?, ?)").run(
  userId,
  deviceId,
  JSON.stringify(layout),
);

const cfg = watchdogConfig(deviceId);
assert.equal(cfg.active, 1);
assert.equal(cfg.target, "https://example.com/health");
assert.equal(cfg.interval, 5);
assert.equal(cfg.misses, 1);
assert.equal(cfg.pin, 4);
assert.equal(cfg.dir, 1);
assert.equal(cfg.transition, 9);
assert.equal(watchdogConfig(otherId).active, 0);

const commands = db.prepare("SELECT COUNT(*) AS c FROM pin_commands").get() as { c: number };
assert.equal(commands.c, 0);
console.log("watchdog config ok");
