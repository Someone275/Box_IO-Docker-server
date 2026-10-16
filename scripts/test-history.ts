import { rmSync } from "node:fs";
import { db } from "../src/db.js";
import { commandDevicePin } from "../src/device.js";

db.exec("DELETE FROM pin_history; DELETE FROM projects; DELETE FROM device_keys; DELETE FROM users;");
import {
  alignBucket,
  clampHistoryRange,
  currentReadingPoint,
  readPinHistory,
  fanoutOffsets,
  graphableNumber,
  recordPinHistory,
  retentionSeconds,
  sampleIntervalSeconds,
  withCurrentReading,
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

db.prepare(
  "INSERT INTO pin_history (device_key_id, pin, interval_sec, bucket, value) VALUES (?, ?, ?, ?, ?)",
).run(deviceId, 7, 60, start, 42);
const fallback = readPinHistory(deviceId, 7, 3600, start, start + 120);
assert(fallback.length === 1 && fallback[0].v === 42, `stored readings are loaded when they were kept at another rate, got ${fallback.length}`);

const nowSec = 1_800_000_000;
const point = currentReadingPoint("18", nowSec - 3600, nowSec, nowSec);
assert(point !== null && point.v === 18 && point.t === nowSec * 1000, "a live window includes the value the pin holds now");
assert(currentReadingPoint("18", nowSec - 86400, nowSec - 3600, nowSec) === null, "a past window does not add the current value");
assert(currentReadingPoint("hot", nowSec - 60, nowSec, nowSec) === null, "text is not a graph point");
assert(graphableNumber("236,264,265,263") === 236, "a list plots its first number");
const future = withCurrentReading([{ t: (nowSec + 30) * 1000, v: 0 }], point);
assert(future.length === 1 && future[0].v === 18, "a sample stamped after now does not hide the current value");
assert(fanoutOffsets(userId, deviceId, 1, 4).join(",") === "1", "a list on V1 also updates the next graphed pin");
recordPinHistory(userId, deviceId, 1, "236,264,265,263", (start + 500) * 1000);
const listed = db.prepare("SELECT value FROM pin_history WHERE pin = 1 AND bucket = ?").get(alignBucket(start + 500, 60)) as {
  value: number;
};
assert(listed.value === 236, "a list is stored as its first number");
db.prepare("INSERT INTO projects (user_id, name, device_key_id, layout_json) VALUES (?, 'Grid', ?, ?)").run(
  userId,
  deviceId,
  JSON.stringify({
    widgets: [{ id: "grid1", type: "grid", pin: 10, props: { rows: 2, cols: 2, pinPerCell: true } }],
  }),
);
assert(commandDevicePin(deviceId, 10, "236,264,265,263"), "a list write is accepted");
const cells = db
  .prepare("SELECT pin, value FROM pin_values WHERE device_key_id = ? AND pin BETWEEN 10 AND 13 ORDER BY pin")
  .all(deviceId) as { pin: number; value: string }[];
assert(
  cells.map((cell) => `${cell.pin}=${cell.value}`).join("|") === "10=236,264,265,263|11=264|12=265|13=263",
  `a pin-per-cell grid follows the list, got ${cells.map((cell) => `${cell.pin}=${cell.value}`).join("|")}`,
);
assert(commandDevicePin(deviceId, 1, "236,264,265,263"), "a graph list write is accepted");
const followed = db
  .prepare("SELECT pin, value FROM pin_values WHERE device_key_id = ? AND pin IN (1, 2, 3) ORDER BY pin")
  .all(deviceId) as { pin: number; value: string }[];
assert(
  followed.map((cell) => `${cell.pin}=${cell.value}`).join("|") === "1=236,264,265,263|2=264",
  `a graph series follows the list on its first pin, got ${followed.map((cell) => `${cell.pin}=${cell.value}`).join("|")}`,
);
const line = withCurrentReading([{ t: (nowSec - 30) * 1000, v: 10 }], point);
assert(line.length === 2 && line[1].v === 18, "the current value is the last point");
assert(withCurrentReading([{ t: nowSec * 1000, v: 18 }], point).length === 1, "the same current reading is not duplicated");

console.log("pin history ok");
const dir = process.env.DATA_DIR || "";
if (dir.includes("boxio-history-test")) rmSync(dir, { recursive: true, force: true });
