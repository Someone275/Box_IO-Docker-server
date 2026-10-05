export type UserRole = "admin" | "user" | "viewer";

export type WidgetType =
  | "led"
  | "circle_meter"
  | "bar_meter"
  | "input"
  | "value"
  | "button_round"
  | "button_oval"
  | "slider_h"
  | "slider_v"
  | "grid"
  | "label"
  | "webhook"
  | "watchdog"
  | "graph"
  | "dpad"
  | "line_h"
  | "line_v";

export type ColorMode = "percentage" | "values";
export type SampleEvery = "second" | "minute" | "hour";
export type LiveSpan = "minute" | "15m" | "hour" | "6h" | "day" | "week" | "month";
export type GridMode = "readonly" | "readwrite";

export interface ColorStop {
  at: number;
  color: string;
}

export interface GraphSeries {
  pin: number;
  color: string;
  label?: string;
}

export interface ColorRule {
  low: number;
  high: number;
  color: string;
  cells: "all" | number[];
}

export interface WidgetProps {
  label?: string;
  colorOn?: string;
  colorOff?: string;
  color?: string;
  min?: number;
  max?: number;
  startDeg?: number;
  endDeg?: number;
  colorMode?: ColorMode;
  colorStops?: ColorStop[];
  sendValue?: string;
  onValue?: string;
  offValue?: string;
  textOn?: string;
  textOff?: string;
  textColorOn?: string;
  textColorOff?: string;
  text?: string;
  detached?: boolean;
  hideLabel?: boolean;
  hideInLive?: boolean;
  opacity?: number;
  background?: string;
  fontSize?: number;
  rows?: number;
  cols?: number;
  mode?: GridMode;
  colorRules?: ColorRule[];
  url?: string;
  method?: "GET" | "POST" | "PUT";
  contentType?: "application/json" | "text/plain" | "application/x-www-form-urlencoded";
  data?: string;
  target?: string;
  intervalSec?: number;
  misses?: number;
  direction?: "high-to-low" | "low-to-high";
  transitionSec?: number;
  sampleEvery?: SampleEvery;
  liveSpan?: LiveSpan;
  graphSeries?: GraphSeries[];
  pinUp?: number;
  pinRight?: number;
  pinDown?: number;
  pinLeft?: number;
  lineWidth?: number;
}

export interface Widget {
  id: string;
  type: WidgetType;
  pin: number;
  x: number;
  y: number;
  w: number;
  h: number;
  deviceKeyId?: number;
  props: WidgetProps;
}

export interface ProjectLayout {
  widgets: Widget[];
  pages?: { id: string; name: string; widgets: Widget[] }[];
  snap?: number;
  columns?: number;
  rows?: number;
  activePageId?: string;
}

export interface JwtUser {
  id: number;
  username: string;
  role: UserRole;
}
