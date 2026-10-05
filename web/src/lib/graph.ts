export const MAX_GRAPH_SERIES = 16;

export const GRAPH_COLORS = [
  "#2ee0c5",
  "#f5b942",
  "#ff5d73",
  "#7aa2ff",
  "#c084fc",
  "#34d399",
  "#fb923c",
  "#f472b6",
  "#a3e635",
  "#38bdf8",
  "#facc15",
  "#f87171",
  "#818cf8",
  "#2dd4bf",
  "#e879f9",
  "#94a3b8",
];

export type SampleEvery = "second" | "minute" | "hour";
export type LiveSpan = "minute" | "15m" | "hour" | "6h" | "day" | "week" | "month";
export type GraphMode = "live" | "day" | "week" | "month";

export interface GraphSeries {
  pin: number;
  color: string;
  label: string;
}

export const LIVE_SPANS: { id: LiveSpan; label: string; seconds: number }[] = [
  { id: "minute", label: "1 minute", seconds: 60 },
  { id: "15m", label: "15 minutes", seconds: 15 * 60 },
  { id: "hour", label: "1 hour", seconds: 3600 },
  { id: "6h", label: "6 hours", seconds: 6 * 3600 },
  { id: "day", label: "1 day", seconds: 86400 },
  { id: "week", label: "1 week", seconds: 7 * 86400 },
  { id: "month", label: "1 month", seconds: 31 * 86400 },
];

export function normalizeSampleEvery(value: unknown): SampleEvery {
  if (value === "second" || value === "hour") return value;
  return "minute";
}

export function normalizeLiveSpan(value: unknown): LiveSpan {
  return LIVE_SPANS.some((span) => span.id === value) ? (value as LiveSpan) : "hour";
}

export function retentionText(every: SampleEvery): string {
  if (every === "second") return "One reading per second, kept for 31 days.";
  if (every === "hour") return "One reading per hour, kept for 5 years.";
  return "One reading per minute, kept for 400 days.";
}

export function normalizeGraphSeries(raw: unknown, fallbackPin = 0): GraphSeries[] {
  const series: GraphSeries[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const pin = Number((item as { pin?: unknown }).pin);
      if (!Number.isInteger(pin) || pin < 0 || pin > 127) continue;
      if (series.some((entry) => entry.pin === pin)) continue;
      const colorRaw = String((item as { color?: unknown }).color || "");
      const color = /^#[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : GRAPH_COLORS[series.length % GRAPH_COLORS.length];
      const labelRaw = String((item as { label?: unknown }).label || "").trim();
      series.push({ pin, color, label: labelRaw.slice(0, 40) || `V${pin}` });
      if (series.length >= MAX_GRAPH_SERIES) break;
    }
  }
  if (!series.length) {
    const pin = Number.isInteger(fallbackPin) && fallbackPin >= 0 && fallbackPin <= 127 ? fallbackPin : 0;
    series.push({ pin, color: GRAPH_COLORS[0], label: `V${pin}` });
  }
  return series;
}

export function addGraphSeries(series: GraphSeries[]): GraphSeries[] {
  if (series.length >= MAX_GRAPH_SERIES) return series;
  const used = new Set(series.map((item) => item.pin));
  let pin = 0;
  while (used.has(pin) && pin < 128) pin += 1;
  if (pin > 127) return series;
  const color = GRAPH_COLORS.find((entry) => !series.some((item) => item.color.toLowerCase() === entry)) || GRAPH_COLORS[series.length % GRAPH_COLORS.length];
  return [...series, { pin, color, label: `V${pin}` }];
}

function parseLocal(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map((part) => Number(part));
  const [hour, minute] = time.split(":").map((part) => Number(part));
  return new Date(
    Number.isFinite(year) ? year : 2026,
    Number.isFinite(month) ? month - 1 : 0,
    Number.isFinite(day) ? day : 1,
    Number.isFinite(hour) ? hour : 0,
    Number.isFinite(minute) ? minute : 0,
    0,
    0,
  );
}

export function dateInputValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function timeInputValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function startOfWeekMonday(date: Date): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = copy.getDay();
  copy.setDate(copy.getDate() - (day === 0 ? 6 : day - 1));
  return copy;
}

export function graphWindow(opts: {
  mode: GraphMode;
  liveSpan: LiveSpan;
  date: string;
  time: string;
  now?: Date;
}): { from: number; to: number } {
  const now = opts.now || new Date();
  if (opts.mode === "live") {
    const span = LIVE_SPANS.find((item) => item.id === opts.liveSpan) || LIVE_SPANS[2];
    const to = Math.floor(now.getTime() / 1000);
    return { from: to - span.seconds, to };
  }
  if (opts.mode === "week") {
    const start = startOfWeekMonday(parseLocal(opts.date, "00:00"));
    const from = Math.floor(start.getTime() / 1000);
    return { from, to: from + 7 * 86400 };
  }
  if (opts.mode === "month") {
    const anchor = parseLocal(opts.date, "00:00");
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    return { from: Math.floor(start.getTime() / 1000), to: Math.floor(end.getTime() / 1000) };
  }
  const start = parseLocal(opts.date, opts.time || "00:00");
  const from = Math.floor(start.getTime() / 1000);
  return { from, to: from + 86400 };
}

const TIME_STEPS_MS = [
  1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000,
  3_600_000, 7_200_000, 10_800_000, 21_600_000, 43_200_000, 86_400_000, 172_800_000, 604_800_000,
];

export function paddedValueRange(min: number, max: number): { min: number; max: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) return { min: min - 1, max: max + 1 };
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

export function niceValueTicks(min: number, max: number, target = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return [min];
  const rough = (max - min) / Math.max(1, target);
  const pow = 10 ** Math.floor(Math.log10(rough));
  const err = rough / pow;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * pow;
  if (!(step > 0)) return [min, max];
  const start = Math.ceil((min - step * 1e-8) / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= max + step * 1e-6 && ticks.length < 8; value += step) {
    ticks.push(Number(value.toPrecision(12)));
  }
  return ticks.length ? ticks : [min, max];
}

export function timeTicks(fromMs: number, toMs: number, target = 4): number[] {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || !(toMs > fromMs)) return [];
  const rough = (toMs - fromMs) / Math.max(1, target);
  let step = TIME_STEPS_MS[TIME_STEPS_MS.length - 1];
  for (const candidate of TIME_STEPS_MS) {
    if (candidate >= rough) {
      step = candidate;
      break;
    }
  }
  const start = Math.ceil(fromMs / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= toMs && ticks.length < 8; t += step) ticks.push(t);
  return ticks;
}

export function formatGraphValue(value: number): string {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 10000 || abs < 0.01)) return value.toExponential(1);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toFixed(digits).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export function formatGraphTime(ms: number, spanMs: number): string {
  const date = new Date(ms);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  if (spanMs <= 2 * 60 * 1000) return `${hh}:${mm}:${String(date.getSeconds()).padStart(2, "0")}`;
  if (spanMs <= 36 * 60 * 60 * 1000) return `${hh}:${mm}`;
  const day = `${date.getMonth() + 1}/${date.getDate()}`;
  if (spanMs <= 14 * 24 * 60 * 60 * 1000) return `${day} ${hh}:${mm}`;
  return day;
}

export function shiftGraphAnchor(date: string, time: string, mode: GraphMode, direction: -1 | 1): { date: string; time: string } {
  const current = parseLocal(date, time || "00:00");
  if (mode === "month") current.setMonth(current.getMonth() + direction);
  else current.setDate(current.getDate() + direction * (mode === "week" ? 7 : 1));
  return { date: dateInputValue(current), time: timeInputValue(current) };
}
