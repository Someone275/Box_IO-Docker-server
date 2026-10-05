import type { Express, Request, Response } from "express";
import { db } from "./db.js";
import { licenseAllowsData } from "./license.js";

const hits = new Map<string, { n: number; reset: number }>();

export function parsePublicPin(spec: string): { pin: number; plain: boolean } | null {
  let plain = false;
  let text = spec.trim();
  if (text.toLowerCase().endsWith(".txt")) {
    plain = true;
    text = text.slice(0, -4);
  }
  const match = /^[Vv]?(\d+)$/.exec(text);
  if (!match) return null;
  const pin = Number(match[1]);
  if (!Number.isInteger(pin) || pin < 0 || pin > 127) return null;
  return { pin, plain };
}

function tooFast(ip: string): boolean {
  const now = Date.now();
  const row = hits.get(ip);
  if (!row || row.reset < now) {
    hits.set(ip, { n: 1, reset: now + 60_000 });
    return false;
  }
  row.n += 1;
  return row.n > 120;
}

function sendPin(res: Response, plain: boolean, status: number, value: string, extra: Record<string, unknown> = {}) {
  res.setHeader("Cache-Control", "no-store");
  if (plain) {
    res.status(status).type("text/plain").send(status === 200 ? value : "");
    return;
  }
  res.status(status).json({ ...extra, value: status === 200 ? value : "" });
}

export function mountPublicPins(app: Express): void {
  app.use((req: Request, res: Response, next) => {
    if (!req.path.startsWith("/public/")) {
      next();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Accept");
    res.removeHeader("Access-Control-Allow-Credentials");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ error: "Read only" });
      return;
    }
    const parts = req.path.split("/").filter(Boolean);
    const key = parts[1] || "";
    const spec = parts[2] || "";
    const parsed = parts.length === 3 ? parsePublicPin(spec) : null;
    const plain = Boolean(parsed?.plain) || String(req.query.format || "") === "text" || (req.get("accept") || "").includes("text/plain");
    if (!parsed || !/^bx_[a-f0-9]{16,80}$/i.test(key)) {
      sendPin(res, plain, 404, "", { error: "Pin address not found" });
      return;
    }
    if (tooFast(req.ip || "local")) {
      sendPin(res, plain, 429, "", { error: "Too many reads" });
      return;
    }
    if (!licenseAllowsData()) {
      sendPin(res, plain, 403, "", { error: "A valid license is required", pin: parsed.pin });
      return;
    }
    const device = db.prepare("SELECT id FROM device_keys WHERE key = ?").get(key) as { id: number } | undefined;
    if (!device) {
      sendPin(res, plain, 404, "", { error: "Unknown device key" });
      return;
    }
    const row = db
      .prepare("SELECT value FROM pin_values WHERE device_key_id = ? AND pin = ?")
      .get(device.id, parsed.pin) as { value: string } | undefined;
    sendPin(res, plain, 200, row?.value ?? "", { pin: parsed.pin });
  });
}
