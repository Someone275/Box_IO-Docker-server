import { db } from "./db.js";

export const MAX_GRAPH_SERIES = 16;
export const MAX_GRAPH_POINTS = 720;

const SAMPLE_SECONDS: Record<string, number> = {
  second: 1,
  minute: 60,
  hour: 3600,
};

interface SavedGraph {
  id?: string;
  type?: string;
  pin?: number;
  deviceKeyId?: number;
  props?: {
    sampleEvery?: string;
    graphSeries?: { pin?: number; color?: string; label?: string }[];
  };
}

function widgetsFromLayout(layoutJson: string): SavedGraph[] {
  let data: { pages?: { widgets?: SavedGraph[] }[]; widgets?: SavedGraph[] } = {};
  try {
    const parsed = JSON.parse(layoutJson || "{}") as unknown;
    if (parsed && typeof parsed === "object") data = parsed as typeof data;
  } catch {
    return [];
  }
  const pages = Array.isArray(data.pages) && data.pages.length ? data.pages : [{ widgets: data.widgets }];
  const widgets: SavedGraph[] = [];
  for (const page of pages) {
    for (const widget of page?.widgets || []) widgets.push(widget);
  }
  return widgets;
}

export function sampleIntervalSeconds(sampleEvery: unknown): number {
  return SAMPLE_SECONDS[String(sampleEvery || "")] || 60;
}

export function retentionSeconds(intervalSec: number): number {
  if (intervalSec <= 1) return 31 * 86400;
  if (intervalSec <= 60) return 400 * 86400;
  return 5 * 365 * 86400;
}

export function alignBucket(unixSec: number, intervalSec: number): number {
  const interval = Math.max(1, Math.floor(intervalSec));
  const sec = Math.floor(unixSec);
  return sec - (sec % interval);
}

export function clampHistoryRange(fromSec: number, toSec: number, nowSec = Math.floor(Date.now() / 1000)): { from: number; to: number } {
  let from = Math.floor(fromSec);
  let to = Math.floor(toSec);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    to = nowSec;
    from = nowSec - 3600;
  }
  if (to <= from) to = from + 60;
  if (to - from > 40 * 86400) from = to - 40 * 86400;
  if (to > nowSec + 86400) to = nowSec + 60;
  return { from, to };
}

function seriesPins(widget: SavedGraph): number[] {
  const pins: number[] = [];
  const raw = widget.props?.graphSeries;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const pin = Number(item?.pin);
      if (Number.isInteger(pin) && pin >= 0 && pin <= 127) pins.push(pin);
    }
  }
  if (!pins.length) {
    const pin = Number(widget.pin);
    if (Number.isInteger(pin) && pin >= 0 && pin <= 127) pins.push(pin);
  }
  return [...new Set(pins)].slice(0, MAX_GRAPH_SERIES);
}

export function graphSeriesOf(widget: SavedGraph): { pin: number; color: string; label: string }[] {
  const pins = seriesPins(widget);
  const raw = Array.isArray(widget.props?.graphSeries) ? widget.props.graphSeries : [];
  return pins.map((pin, index) => {
    const item = raw.find((entry) => Number(entry?.pin) === pin) || raw[index];
    const color = typeof item?.color === "string" && /^#[0-9A-Fa-f]{6}$/.test(item.color) ? item.color : "#2ee0c5";
    const label = typeof item?.label === "string" && item.label.trim() ? item.label.trim().slice(0, 40) : `V${pin}`;
    return { pin, color, label };
  });
}

function intervalsForPin(userId: number, deviceKeyId: number, pin: number): number[] {
  const projects = db
    .prepare("SELECT device_key_id, layout_json FROM projects WHERE user_id = ?")
    .all(userId) as { device_key_id: number | null; layout_json: string }[];
  const intervals = new Set<number>();
  for (const project of projects) {
    for (const widget of widgetsFromLayout(project.layout_json)) {
      if (widget.type !== "graph") continue;
      const bound = Number(widget.deviceKeyId) || project.device_key_id;
      if (bound !== deviceKeyId) continue;
      if (!seriesPins(widget).includes(pin)) continue;
      intervals.add(sampleIntervalSeconds(widget.props?.sampleEvery));
    }
  }
  return [...intervals];
}

export function recordPinHistory(userId: number, deviceKeyId: number, pin: number, value: string, nowMs = Date.now()): void {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || pin < 0 || pin > 127) return;
  const intervals = intervalsForPin(userId, deviceKeyId, pin);
  if (!intervals.length) return;
  const nowSec = Math.floor(nowMs / 1000);
  const insert = db.prepare(
    `INSERT INTO pin_history (device_key_id, pin, interval_sec, bucket, value)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(device_key_id, pin, interval_sec, bucket) DO UPDATE SET value = excluded.value`,
  );
  const prune = db.prepare(
    `DELETE FROM pin_history WHERE rowid IN (
       SELECT rowid FROM pin_history
       WHERE device_key_id = ? AND pin = ? AND interval_sec = ? AND bucket < ?
       LIMIT 400
     )`,
  );
  for (const interval of intervals) {
    insert.run(deviceKeyId, pin, interval, alignBucket(nowSec, interval), numeric);
    prune.run(deviceKeyId, pin, interval, nowSec - retentionSeconds(interval));
  }
}

export function readPinHistory(
  deviceKeyId: number,
  pin: number,
  intervalSec: number,
  fromSec: number,
  toSec: number,
  maxPoints = MAX_GRAPH_POINTS,
): { t: number; v: number }[] {
  const from = Math.floor(fromSec);
  const to = Math.floor(toSec);
  if (to <= from) return [];
  const group = Math.max(1, intervalSec, Math.ceil((to - from) / Math.max(1, maxPoints)));
  // One small index lookup per point. Grouping the whole retention window
  // in a single query holds the process until it finishes, and the dashboard
  // then waits out the gateway timeout.
  const latest = db.prepare(
    `SELECT bucket, value FROM pin_history
     WHERE device_key_id = ? AND pin = ? AND interval_sec = ? AND bucket >= ? AND bucket < ?
     ORDER BY bucket DESC LIMIT 1`,
  );
  const points: { t: number; v: number }[] = [];
  for (let slot = from; slot < to; slot += group) {
    const row = latest.get(deviceKeyId, pin, intervalSec, slot, Math.min(to, slot + group)) as
      | { bucket: number; value: number }
      | undefined;
    if (row) points.push({ t: row.bucket * 1000, v: row.value });
  }
  return points;
}

export function findGraphWidget(layoutJson: string, widgetId: string): SavedGraph | null {
  return widgetsFromLayout(layoutJson).find((widget) => widget?.id === widgetId && widget.type === "graph") || null;
}
