import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { WIDGET_META, type ColorMode, type ColorRule, type ColorStop, type GridMode, type WidgetProps, type WidgetType } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function pinLabel(pin: number) {
  return `V${pin}`;
}

export const DEFAULT_WIDGET_BACKGROUND = "#101827";
export const DEFAULT_PAGE_BACKGROUND = "#0a1220";

/** A stored fill. Empty uses the fallback. The word transparent is see-through. */
export function fillCss(value: unknown, fallback: string) {
  if (value === "transparent") return "transparent";
  if (typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value)) return value;
  return fallback;
}

export function normalizeBackground(value: unknown): string | undefined {
  if (value === "transparent") return "transparent";
  if (typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value)) return value.toLowerCase();
  return undefined;
}

/** Stroke thickness for a line widget, in pixels. */
export function lineWidth(value: unknown, fallback = 8) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(64, Math.round(n)));
}

export function clampPin(value: unknown, fallback: number) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 127) return Math.max(0, Math.min(127, fallback));
  return n;
}

/** Up, right, down, and left pins for a D-pad. Missing values step off the widget pin. */
export function dpadPins(
  props: { pinUp?: number; pinRight?: number; pinDown?: number; pinLeft?: number },
  fallback: number,
) {
  const base = clampPin(fallback, 0);
  const near = (offset: number) => Math.min(127, base + offset);
  return {
    up: clampPin(props.pinUp, base),
    right: clampPin(props.pinRight, near(1)),
    down: clampPin(props.pinDown, near(2)),
    left: clampPin(props.pinLeft, near(3)),
  };
}

export function buttonValues(props: { onValue?: string; offValue?: string; sendValue?: string }) {
  return {
    onValue: props.onValue || props.sendValue || "1",
    offValue: props.offValue ?? "0",
  };
}

export function buttonIsOn(value: string | undefined, onValue: string, offValue: string) {
  const current = value ?? "";
  if (current === onValue) return true;
  if (current === offValue) return false;
  return isOn(current);
}

/** Caption listed on a widget. The widget's own label is shown. A sketch setProperty("label") does not rename it. */
export function listedWidgetLabel(type: string, label?: string) {
  const text = (label ?? "").trim();
  if (text) return text;
  return WIDGET_META[type as WidgetType]?.name || type;
}

/** Caption above a round or oval button. The saved widget label is shown, not the pin property. */
export function buttonCaption(
  props: { label?: string },
  _properties: Record<string, string> = {},
) {
  return (props.label ?? "").trim();
}

/** Face text for a round or oval button. A sketch setProperty textOn/textOff wins until the dashboard saves a new one. */
export function buttonFace(
  on: boolean,
  props: { textOn?: string; textOff?: string },
  properties: Record<string, string> = {},
) {
  if (on) return liveStr(properties, "textOn", props.textOn) || "On";
  return liveStr(properties, "textOff", props.textOff) || "Off";
}

export function isOn(value: string | number | undefined) {
  if (value === undefined || value === "") return false;
  const s = String(value).trim().toLowerCase();
  if (s === "0" || s === "false" || s === "off" || s === "no") return false;
  return true;
}

export function asNumber(value: string | number | undefined, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function liveStr(
  properties: Record<string, string>,
  key: string,
  fallback?: string,
) {
  const v = properties[key];
  if (v !== undefined && v !== "") return v;
  return fallback;
}

export function liveNum(properties: Record<string, string>, key: string, fallback: number) {
  const v = properties[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Slider track limits. A device setProperty wins until the dashboard writes a new one. */
export function sliderBounds(
  props: { min?: number; max?: number },
  properties: Record<string, string> = {},
) {
  let min = liveNum(properties, "min", props.min ?? 0);
  let max = liveNum(properties, "max", props.max ?? 100);
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = min + 1;
  if (max < min) [min, max] = [max, min];
  if (min === max) max = min + 1;
  return { min, max };
}

export function sliderPercent(value: number, min: number, max: number) {
  const span = max - min;
  if (span === 0) return 0;
  return Math.min(100, Math.max(0, ((value - min) / span) * 100));
}

export function parseColorStopsCompact(raw?: string): ColorStop[] {
  if (!raw?.trim()) return [];
  const stops: ColorStop[] = [];
  for (const part of raw.split(";")) {
    const token = part.trim();
    if (!token) continue;
    const match = token.match(/^(-?\d+(?:\.\d+)?)\s*:\s*(#[0-9A-Fa-f]{3,8}|[^;]+)$/i);
    if (!match) continue;
    stops.push({ at: Number(match[1]), color: match[2].trim() });
  }
  return stops;
}

/** 0° is straight up. Degrees increase clockwise. */
export const GAUGE_START_DEG = 225;
export const GAUGE_END_DEG = 135;

export function clampDegree(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 360) return 360;
  return value;
}

/** Clockwise sweep from start to end. Equal angles, or 0 to 360, are a full circle. */
export function gaugeSweep(start: number, end: number): number {
  const sweep = clampDegree(end, GAUGE_END_DEG) - clampDegree(start, GAUGE_START_DEG);
  if (sweep > 0) return sweep;
  return sweep + 360;
}

export function gaugePoint(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return {
    x: cx + r * Math.sin(rad),
    y: cy - r * Math.cos(rad),
  };
}

function gaugeNum(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/** SVG arc. 0° is up and the sweep travels clockwise. */
export function gaugeArcPath(cx: number, cy: number, r: number, start: number, sweep: number): string {
  const a = gaugePoint(cx, cy, r, start);
  if (sweep >= 359.99) {
    const mid = gaugePoint(cx, cy, r, start + 180);
    return `M ${gaugeNum(a.x)} ${gaugeNum(a.y)} A ${r} ${r} 0 1 1 ${gaugeNum(mid.x)} ${gaugeNum(mid.y)} A ${r} ${r} 0 1 1 ${gaugeNum(a.x)} ${gaugeNum(a.y)}`;
  }
  const b = gaugePoint(cx, cy, r, start + sweep);
  const large = sweep > 180 ? 1 : 0;
  return `M ${gaugeNum(a.x)} ${gaugeNum(a.y)} A ${r} ${r} 0 ${large} 1 ${gaugeNum(b.x)} ${gaugeNum(b.y)}`;
}

export function liveMeterOpts(props: WidgetProps, properties: Record<string, string> = {}) {
  const fromDevice = parseColorStopsCompact(properties.colorStops);
  const rawMode = (properties.colorMode || props.colorMode || "percentage").toLowerCase();
  const colorMode: ColorMode = rawMode === "values" ? "values" : "percentage";
  return {
    min: liveNum(properties, "min", props.min ?? 0),
    max: liveNum(properties, "max", props.max ?? 100),
    startDeg: clampDegree(liveNum(properties, "startDeg", props.startDeg ?? GAUGE_START_DEG), GAUGE_START_DEG),
    endDeg: clampDegree(liveNum(properties, "endDeg", props.endDeg ?? GAUGE_END_DEG), GAUGE_END_DEG),
    color: liveStr(properties, "color", props.color),
    colorMode,
    colorStops: fromDevice.length ? fromDevice : props.colorStops,
  };
}

export const MAX_COLOR_DIVISIONS = 15;

const COLOR_DIVISION_PALETTE = [
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
];

export function addColorDivision(stops: ColorStop[]): ColorStop[] {
  if (stops.length >= MAX_COLOR_DIVISIONS) return stops;
  const used = new Set(stops.map((stop) => stop.color.toLowerCase()));
  const color =
    COLOR_DIVISION_PALETTE.find((entry) => !used.has(entry)) ||
    COLOR_DIVISION_PALETTE[stops.length % COLOR_DIVISION_PALETTE.length];
  const highest = stops.reduce((max, stop) => (Number.isFinite(stop.at) ? Math.max(max, stop.at) : max), 0);
  return [...stops, { at: stops.length === 0 ? 0 : highest + 10, color }];
}

export function removeColorDivision(stops: ColorStop[], index: number): ColorStop[] {
  if (stops.length <= 1) return stops;
  if (index < 0 || index >= stops.length) return stops;
  return stops.filter((_, i) => i !== index);
}

export function meterColor(
  value: number,
  opts: {
    min?: number;
    max?: number;
    color?: string;
    colorMode?: "percentage" | "values";
    colorStops?: { at: number; color: string }[];
  },
) {
  const min = opts.min ?? 0;
  const max = opts.max ?? 100;
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  const stops = opts.colorStops?.length
    ? [...opts.colorStops].sort((a, b) => a.at - b.at)
    : [
        { at: 0, color: "#2ee0c5" },
        { at: 60, color: "#f5b942" },
        { at: 85, color: "#ff5d73" },
      ];
  const point = opts.colorMode === "values" ? value : pct;
  let color = opts.color || stops[0].color;
  if (stops.length === 1) {
    color = stops[0].color;
  } else {
    for (const stop of stops) {
      if (point >= stop.at) color = stop.color;
    }
  }
  return { color, pct: Math.max(0, Math.min(100, pct)) };
}

export function clampGridSize(n: number, fallback = 4) {
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(16, Math.round(n));
}

export function parseGridValues(value?: unknown): string[] {
  if (value === undefined || value === null || value === "") return [];
  const trimmed = String(value).trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return parsed.map((v) => String(v));
    } catch {
      /* fall through to CSV */
    }
  }
  return trimmed.split(",").map((part) => part.trim());
}

/** Cell text for a grid. Pin-per-cell reads live values; otherwise one pin's list fills the cells. */
export function gridDisplayCells(
  count: number,
  value: unknown,
  pinPerCell: boolean,
  readPin?: (index: number) => string | undefined,
): string[] {
  const total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (pinPerCell && readPin) {
    return Array.from({ length: total }, (_, index) => readPin(index) ?? "");
  }
  const incoming = parseGridValues(value);
  return Array.from({ length: total }, (_, index) => incoming[index] ?? "");
}

export function parseColorRulesCompact(raw?: string): ColorRule[] {
  if (!raw?.trim()) return [];
  const rules: ColorRule[] = [];
  for (const part of raw.split(";")) {
    const token = part.trim();
    if (!token) continue;
    const match = token.match(
      /^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*:\s*(#[0-9A-Fa-f]{3,8}|[^:]+)\s*:\s*(all|[\d,\s]+)$/i,
    );
    if (!match) continue;
    const cellsRaw = match[4].trim().toLowerCase();
    rules.push({
      low: Number(match[1]),
      high: Number(match[2]),
      color: match[3].trim(),
      cells:
        cellsRaw === "all"
          ? "all"
          : cellsRaw
              .split(",")
              .map((s) => Number(s.trim()))
              .filter((n) => Number.isInteger(n) && n >= 0),
    });
  }
  return rules;
}

export function parseColorRules(layoutRules?: ColorRule[], compact?: string): ColorRule[] {
  const fromDevice = parseColorRulesCompact(compact);
  if (fromDevice.length) return fromDevice;
  return layoutRules?.length ? layoutRules : [];
}

export function cellColor(
  value: string | undefined,
  index: number,
  rules: ColorRule[],
  colorOff = "#314057",
) {
  const n = Number(value);
  if (!Number.isFinite(n)) return colorOff;
  for (const rule of rules) {
    const applies =
      rule.cells === "all" || (Array.isArray(rule.cells) && rule.cells.includes(index));
    if (applies && n >= rule.low && n <= rule.high) return rule.color;
  }
  return colorOff;
}

export function contrastText(hex: string) {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (full.length < 6) return "#e8eef8";
  const r = Number.parseInt(full.slice(0, 2), 16) / 255;
  const g = Number.parseInt(full.slice(2, 4), 16) / 255;
  const b = Number.parseInt(full.slice(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? "#071018" : "#e8eef8";
}

export function gridConfig(
  props: {
    rows?: number;
    cols?: number;
    mode?: GridMode;
    colorOff?: string;
    colorRules?: ColorRule[];
  },
  properties: Record<string, string> = {},
) {
  const rows = clampGridSize(Number(properties.rows ?? props.rows ?? 4));
  const cols = clampGridSize(Number(properties.cols ?? props.cols ?? 4));
  const rawMode = (props.mode || properties.mode || "readonly").toLowerCase();
  const mode: GridMode = rawMode === "readwrite" || rawMode === "rw" ? "readwrite" : "readonly";
  const colorOff = properties.colorOff || props.colorOff || "#314057";
  const rules = parseColorRules(props.colorRules, properties.colorRules);
  return { rows, cols, mode, colorOff, rules };
}
