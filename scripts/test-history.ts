import { rmSync } from "node:fs";
import { db } from "../src/db.js";

db.exec("DELETE FROM pin_history; DELETE FROM projects; DELETE FROM device_keys; DELETE FROM users;");
import {
  alignBucket,
  clampHistoryRange,
  readPinHistory,
  recordPinHistory,
  retentionSeconds,
  sampleIntervalSeconds,
} from "../src/history.js";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

assert(sampleIntervalSeconds("second") === 1, "second interval");
assert(sampleIntervalSeconds("hour") === 3600, "hour interval");
assert(sampleIntervalSeconds("nope") === 60, "minute is the default interval");
assert(alignBucket(1_700_000_100, 60) === 1_700_000_100 - (1_700_000_100 % 60), "minute bucket");
assert(retentionSeconds(1) === 31 * 86400, "second readings stay 31 days");
assert(retentionSeconds(60) === 400 * 86400, "minute readings stay 400 days");
const clamped = clampHistoryRange(0, 100 * 86400, 200 * 86400);
assert(clamped.to - clamped.from === 40 * 86400, "a request cannot span more than 40 days");

const user = db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('hist', 'x', 'admin')").run();
const userId = Number(user.lastInsertRowid);
const device = db
  .prepare("INSERT INTO device_keys (user_id, name, key) VALUES (?, 'dev', 'bx_hist')")
  .run(userId);
const deviceId = Number(device.lastInsertRowid);
const layout = {
  widgets: [
    {
      id: "g1",
      type: "graph",
      pin: 1,
      props: {
        sampleEvery: "minute",
        graphSeries: [
          { pin: 1, color: "#2ee0c5", label: "Temp" },
          { pin: 2, color: "#ff5d73", label: "Hum" },
        ],
      },
    },
  ],
};
db.prepare("INSERT INTO projects (user_id, name, device_key_id, layout_json) VALUES (?, 'Hist', ?, ?)").run(
  userId,
  deviceId,
  JSON.stringify(layout),
);

const start = 1_700_000_000 - (1_700_000_000 % 600);
recordPinHistory(userId, deviceId, 1, "10", start * 1000);
recordPinHistory(userId, deviceId, 1, "12", (start + 20) * 1000);
recordPinHistory(userId, deviceId, 1, "15", (start + 70) * 1000);
recordPinHistory(userId, deviceId, 3, "99", start * 1000);
recordPinHistory(userId, deviceId, 2, "nope", start * 1000);

const stored = db.prepare("SELECT pin, bucket, value FROM pin_history ORDER BY pin, bucket").all() as {
  pin: number;
  bucket: number;
  value: number;
}[];
assert(stored.length === 2, `expected two minute buckets, got ${stored.length}`);
assert(stored[0].value === 12, "the later reading replaces the earlier one in the same minute");
assert(stored[1].bucket === start + 60 && stored[1].value === 15, "the next minute is its own reading");
assert(stored.every((row) => row.pin === 1), "pins that are not on the graph are not stored");

for (let i = 0; i < 100; i++) {
  recordPinHistory(userId, deviceId, 2, String(i), (start + i * 60) * 1000);
}
const down = readPinHistory(deviceId, 2, 60, start, start + 100 * 60, 10);
assert(down.length === 10, `downsample keeps 10 points, got ${down.length}`);
assert(down[down.length - 1].v === 99, `last downsampled reading should be 99, got ${down[down.length - 1].v}`);
assert(down[0].v < down[down.length - 1].v, "downsampled readings move forward in time");

const old = start - retentionSeconds(60) - 120;
recordPinHistory(userId, deviceId, 1, "1", old * 1000);
recordPinHistory(userId, deviceId, 1, "2", start * 1000);
const left = db
  .prepare("SELECT bucket FROM pin_history WHERE pin = 1 AND bucket < ?")
  .all(start - retentionSeconds(60)) as { bucket: number }[];
assert(left.length === 0, "readings older than the retention window are removed");

console.log("pin history ok");
const dir = process.env.DATA_DIR || "";
if (dir.includes("boxio-history-test")) rmSync(dir, { recursive: true, force: true });
