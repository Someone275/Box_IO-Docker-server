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
    rows?: number;
    cols?: number;
    pinPerCell?: boolean;
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

const STATUS_PIN = 100;

/** A comma-separated list of numbers, such as a grid virtualWrite. */
export function numericList(value: string | undefined | null): string[] | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed.includes(",")) return null;
  const parts = trimmed.split(",").map((part) => part.trim()).filter((part) => part !== "");
  if (parts.length < 2 || parts.some((part) => !Number.isFinite(Number(part)))) return null;
  return parts;
}

/** The number a graph can plot. A list uses its first value. */
export function graphableNumber(value: string | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const direct = Number(trimmed);
  if (Number.isFinite(direct)) return direct;
  const list = numericList(trimmed);
  if (!list) return null;
  const first = Number(list[0]);
  return Number.isFinite(first) ? first : null;
}

function gridSpan(widget: SavedGraph): number {
  const rows = Math.min(16, Math.max(1, Math.round(Number(widget.props?.rows)) || 4));
  const cols = Math.min(16, Math.max(1, Math.round(Number(widget.props?.cols)) || 4));
  return rows * cols;
}

/**
 * Offsets after the written pin that should receive the rest of a numeric list.
 * A pin-per-cell grid on this pin, and a graph whose series continues from this pin.
 */
export function fanoutOffsets(userId: number, deviceKeyId: number, pin: number, count: number): number[] {
  if (count < 2 || pin < 0) return [];
  const projects = db
    .prepare("SELECT device_key_id, layout_json FROM projects WHERE user_id = ?")
    .all(userId) as { device_key_id: number | null; layout_json: string }[];
  const offsets = new Set<number>();
  for (const project of projects) {
    for (const widget of widgetsFromLayout(project.layout_json)) {
      const bound = Number(widget.deviceKeyId) || project.device_key_id;
      if (bound !== deviceKeyId) continue;
      if (widget.type === "grid" && widget.props?.pinPerCell === true && Number(widget.pin) === pin) {
        const span = Math.min(count, gridSpan(widget));
        for (let offset = 1; offset < span; offset++) offsets.add(offset);
      }
      if (widget.type === "graph" && seriesPins(widget).includes(pin)) {
        for (const seriesPin of seriesPins(widget)) {
          const offset = seriesPin - pin;
          if (offset > 0 && offset < count) offsets.add(offset);
        }
      }
    }
  }
  return [...offsets].filter((offset) => {
    const next = pin + offset;
    return next >= 0 && next <= 127 && next !== STATUS_PIN;
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
  const numeric = graphableNumber(value);
  if (numeric === null || pin < 0 || pin > 127) return;
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

function readInterval(
  deviceKeyId: number,
  pin: number,
  intervalSec: number,
  from: number,
  to: number,
  maxPoints: number,
): { t: number; v: number }[] {
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
  const primary = readInterval(deviceKeyId, pin, intervalSec, from, to, maxPoints);
  if (primary.length) return primary;
  const others = db
    .prepare(
      `SELECT DISTINCT interval_sec AS interval_sec FROM pin_history
       WHERE device_key_id = ? AND pin = ? AND bucket >= ? AND bucket < ?
       ORDER BY interval_sec ASC`,
    )
    .all(deviceKeyId, pin, from, to) as { interval_sec: number }[];
  for (const row of others) {
    if (row.interval_sec === intervalSec) continue;
    const alt = readInterval(deviceKeyId, pin, row.interval_sec, from, to, maxPoints);
    if (alt.length) return alt;
  }
  return primary;
}

export function storedPinValue(deviceKeyId: number, pin: number): string | undefined {
  const row = db
    .prepare("SELECT value FROM pin_values WHERE device_key_id = ? AND pin = ?")
    .get(deviceKeyId, pin) as { value: string } | undefined;
  return row?.value;
}

/** The value the pin holds now, when the requested window reaches the present. */
export function currentReadingPoint(
  value: string | undefined,
  fromSec: number,
  toSec: number,
  nowSec: number,
): { t: number; v: number } | null {
  if (toSec < nowSec - 2) return null;
  const v = graphableNumber(value);
  if (v === null) return null;
  const stamp = Math.min(toSec, nowSec);
  if (stamp < fromSec) return null;
  return { t: stamp * 1000, v };
}

export function withCurrentReading(
  points: { t: number; v: number }[],
  point: { t: number; v: number } | null,
): { t: number; v: number }[] {
  if (!point) return points;
  const kept = points.filter((item) => item.t < point.t);
  const last = kept[kept.length - 1];
  if (last && Math.abs(last.t - point.t) < 1000 && last.v === point.v) return kept;
  return [...kept, point];
}

/**
 * Points the graph should draw. A live window whose first pin holds a numeric
 * list draws each following pin at that field, so V1..V4 follow 236,264,265,263
 * even when older samples are still stored.
 */
export function liveGraphSeries(
  series: { pin: number; points: { t: number; v: number }[] }[],
  valueForPin: (pin: number) => string | undefined,
  fromSec: number,
  toSec: number,
  nowSec: number,
): { t: number; v: number }[][] {
  const live = toSec >= nowSec - 2;
  const pins = series.map((item) => item.pin);
  if (live && pins.length) {
    const ordered = [...pins].sort((a, b) => a - b);
    const base = ordered[0];
    const consecutive = ordered.every((pin, index) => pin === base + index);
    const list = numericList(valueForPin(base));
    const end = Math.min(Math.floor(toSec), Math.floor(nowSec));
    const start = Math.floor(fromSec);
    if (consecutive && list && list.length >= ordered.length && end > start) {
      return series.map((item) => {
        const value = Number(list[item.pin - base]);
        if (!Number.isFinite(value)) return [];
        return [
          { t: start * 1000, v: value },
          { t: end * 1000, v: value },
        ];
      });
    }
  }
  return series.map((item) =>
    withCurrentReading(item.points, currentReadingPoint(valueForPin(item.pin), fromSec, toSec, nowSec)),
  );
}

export function findGraphWidget(layoutJson: string, widgetId: string): SavedGraph | null {
  return widgetsFromLayout(layoutJson).find((widget) => widget?.id === widgetId && widget.type === "graph") || null;
}
