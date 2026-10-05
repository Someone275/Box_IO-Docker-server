import { Router } from "express";
import { db, markDeviceSeen } from "./db.js";
import { emitPinUpdate, emitDeviceStatus } from "./broadcast.js";
import { sendEmail, sendSms } from "./notify.js";
import { watchdogConfig } from "./watchdog.js";
import { recordPinHistory } from "./history.js";
import { licenseAllowsData } from "./license.js";

interface DeviceRow {
  id: number;
  user_id: number;
  name: string;
  key: string;
}

function deviceFromReq(req: {
  header: (n: string) => string | undefined;
  query: Record<string, unknown>;
  body?: Record<string, unknown>;
}): DeviceRow | null {
  const key =
    req.header("x-boxio-key") ||
    req.header("authorization")?.replace(/^Bearer\s+/i, "") ||
    String(req.query.key || req.body?.key || "");
  if (!key) return null;
  return (
    (db
      .prepare("SELECT id, user_id, name, key FROM device_keys WHERE key = ?")
      .get(key) as DeviceRow | undefined) ?? null
  );
}

function pinNum(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 127) return -1;
  return n;
}

function asString(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v);
}

function pinProperties(deviceKeyId: number, pin: number): Record<string, string> {
  const rows = db
    .prepare(
      "SELECT prop, value FROM pin_properties WHERE device_key_id = ? AND pin = ?",
    )
    .all(deviceKeyId, pin) as { prop: string; value: string }[];
  const out: Record<string, string> = {};
  for (const row of rows) out[row.prop] = row.value;
  return out;
}

function deviceById(deviceKeyId: number): DeviceRow | null {
  return (
    (db
      .prepare("SELECT id, user_id, name, key FROM device_keys WHERE id = ?")
      .get(deviceKeyId) as DeviceRow | undefined) ?? null
  );
}

export function commandDevicePin(deviceKeyId: number, pin: number, value: string): boolean {
  const device = deviceById(deviceKeyId);
  if (!device || pin < 0 || pin > 127) return false;
  writePin(device, pin, value, false);
  return true;
}

export function noteDevicePin(deviceKeyId: number, pin: number, prop: string, value: string): boolean {
  const device = deviceById(deviceKeyId);
  if (!device || pin < 0 || pin > 127 || !prop) return false;
  writePinProperty(device, pin, prop, value.slice(0, 240));
  return true;
}

function writePinProperty(device: DeviceRow, pin: number, prop: string, value: string): Record<string, string> {
  db.prepare(
    `INSERT INTO pin_properties (device_key_id, pin, prop, value)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(device_key_id, pin, prop) DO UPDATE SET value = excluded.value`,
  ).run(device.id, pin, prop, value);
  const row = db
    .prepare("SELECT value FROM pin_values WHERE device_key_id = ? AND pin = ?")
    .get(device.id, pin) as { value: string } | undefined;
  const properties = pinProperties(device.id, pin);
  emitPinUpdate(device.user_id, device.id, pin, row?.value ?? "", properties);
  return properties;
}

function writePin(device: DeviceRow, pin: number, value: string, fromHw: boolean): void {
  db.prepare(
    `INSERT INTO pin_values (device_key_id, pin, value, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(device_key_id, pin) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(device.id, pin, value);
  if (!fromHw) {
    db.prepare(
      "INSERT INTO pin_commands (device_key_id, pin, value) VALUES (?, ?, ?)",
    ).run(device.id, pin, value);
  }
  emitPinUpdate(device.user_id, device.id, pin, value, pinProperties(device.id, pin));
  recordPinHistory(device.user_id, device.id, pin, value);
  if (fromHw) {
    void import("./webhook.js").then((mod) => mod.fireWebhooksForPin(device, pin, value));
  }
}

export function createDeviceRouter(): Router {
  const router = Router();

  router.use((req, res, next) => {
    const device = deviceFromReq(req);
    if (!device) {
      res.status(401).json({ error: "Missing or invalid device key" });
      return;
    }
    (req as typeof req & { device: DeviceRow }).device = device;
    markDeviceSeen(device.id);
    emitDeviceStatus(device.user_id, device.id, true);
    next();
  });

  router.get("/ping", (req, res) => {
    const device = (req as unknown as { device: DeviceRow }).device;
    res.json({ ok: true, device: device.name, time: Date.now() });
  });

  router.all("/vw", (req, res) => {
    const device = (req as unknown as { device: DeviceRow }).device;
    const pin = pinNum(req.query.pin ?? req.body?.pin);
    const value = asString(req.query.value ?? req.body?.value);
    if (pin < 0) {
      res.status(400).json({ error: "pin required (0-127)" });
      return;
    }
    writePin(device, pin, value, true);
    res.json({ ok: true, pin, value });
  });

  router.all("/vr", (req, res) => {
    const device = (req as unknown as { device: DeviceRow }).device;
    const pin = pinNum(req.query.pin ?? req.body?.pin);
    if (pin < 0) {
      res.status(400).json({ error: "pin required" });
      return;
    }
    const row = db
      .prepare("SELECT value FROM pin_values WHERE device_key_id = ? AND pin = ?")
      .get(device.id, pin) as { value: string } | undefined;
    res.json({ ok: true, pin, value: licenseAllowsData() ? (row?.value ?? "") : "" });
  });

  router.get("/watchdog", (req, res) => {
    const device = (req as unknown as { device: DeviceRow }).device;
    res.json({ ok: true, ...watchdogConfig(device.id) });
  });

  router.all("/pull", (req, res) => {
    const device = (req as unknown as { device: DeviceRow }).device;
    const rows = db
      .prepare(
        "SELECT id, pin, value FROM pin_commands WHERE device_key_id = ? ORDER BY id ASC LIMIT 32",
      )
      .all(device.id) as { id: number; pin: number; value: string }[];
    if (rows.length) {
      const ids = rows.map((r) => r.id);
      db.prepare(
        `DELETE FROM pin_commands WHERE id IN (${ids.map(() => "?").join(",")})`,
      ).run(...ids);
    }
    res.json({
      ok: true,
      commands: rows.map((r) => ({ pin: r.pin, value: r.value })),
    });
  });

  router.all("/sync", (req, res) => {
    const device = (req as unknown as { device: DeviceRow }).device;
    const values = db
      .prepare("SELECT pin, value FROM pin_values WHERE device_key_id = ?")
      .all(device.id) as { pin: number; value: string }[];
    const props = db
      .prepare("SELECT pin, prop, value FROM pin_properties WHERE device_key_id = ?")
      .all(device.id) as { pin: number; prop: string; value: string }[];
    const visible = licenseAllowsData();
    res.json({
      ok: true,
      values: visible ? values : values.map((row) => ({ ...row, value: "" })),
      properties: visible ? props : props.map((row) => ({ ...row, value: "" })),
    });
  });

  router.all("/property", (req, res) => {
    const device = (req as unknown as { device: DeviceRow }).device;
    const pin = pinNum(req.query.pin ?? req.body?.pin);
    const prop = asString(req.query.prop ?? req.body?.prop);
    const value = asString(req.query.value ?? req.body?.value);
    if (pin < 0 || !prop) {
      res.status(400).json({ error: "pin and prop required" });
      return;
    }
    writePinProperty(device, pin, prop, value);
    res.json({ ok: true, pin, prop, value });
  });

  router.all("/email", async (req, res) => {
    const to = asString(req.query.to ?? req.body?.to);
    const subject = asString(req.query.subject ?? req.body?.subject);
    const body = asString(req.query.body ?? req.body?.body);
    if (!to || !subject) {
      res.status(400).json({ error: "to and subject required" });
      return;
    }
    try {
      await sendEmail(to, subject, body);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Email failed" });
    }
  });

  router.all("/sms", async (req, res) => {
    const to = asString(req.query.to ?? req.body?.to);
    const body = asString(req.query.body ?? req.body?.body);
    if (!to || !body) {
      res.status(400).json({ error: "to and body required" });
      return;
    }
    try {
      await sendSms(to, body);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "SMS failed" });
    }
  });

  return router;
}

export { writePin, writePinProperty, pinProperties, type DeviceRow };
