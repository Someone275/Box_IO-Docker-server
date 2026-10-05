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

export type GridMode = "readonly" | "readwrite";
export type ColorMode = "percentage" | "values";
export type SampleEvery = "second" | "minute" | "hour";
export type LiveSpan = "minute" | "15m" | "hour" | "6h" | "day" | "week" | "month";

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
  /** Widget card fill. A #rrggbb color, or "transparent". Omitted uses the default panel. */
  background?: string;
  fontSize?: number;
  rows?: number;
  cols?: number;
  mode?: GridMode;
  /** When set, cell 0 is this widget's pin and each next cell is the next pin. */
  pinPerCell?: boolean;
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
  showTimeScale?: boolean;
  showDataScale?: boolean;
  graphSeries?: GraphSeries[];
  pinUp?: number;
  pinRight?: number;
  pinDown?: number;
  pinLeft?: number;
  /** Stroke thickness in pixels for a horizontal or vertical line. */
  lineWidth?: number;
}

export interface BoardWidget {
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

export interface Project {
  id: number;
  name: string;
  device_key_id: number | null;
  layout_json: string;
  created_at?: string;
  updated_at?: string;
  device_name?: string | null;
  online?: number;
  access?: "owner" | "view";
}

export interface DeviceKey {
  id: number;
  name: string;
  key: string;
  last_seen: string | null;
  online: number;
  created_at?: string;
}

export interface User {
  id: number;
  username: string;
  email?: string;
  role: "admin" | "user" | "viewer";
}

export const WIDGET_META: Record<
  WidgetType,
  { name: string; hint: string; w: number; h: number }
> = {
  led: { name: "LED", hint: "On / off indicator", w: 2, h: 2 },
  circle_meter: { name: "Circle meter", hint: "0 to max gauge", w: 3, h: 3 },
  bar_meter: { name: "Bar meter", hint: "0 to max bar", w: 2, h: 3 },
  input: { name: "Input box", hint: "Send text to a pin", w: 4, h: 2 },
  value: { name: "Value box", hint: "Display received data", w: 3, h: 2 },
  button_round: { name: "Round button", hint: "On / off with its own text and colors", w: 2, h: 2 },
  button_oval: { name: "Oval button", hint: "On / off with its own text and colors", w: 3, h: 2 },
  slider_h: { name: "Horizontal slider", hint: "Send a range value", w: 4, h: 2 },
  slider_v: { name: "Vertical slider", hint: "Send a range value", w: 2, h: 4 },
  grid: { name: "Grid", hint: "Array of colored cells", w: 4, h: 4 },
  label: { name: "Label", hint: "Text, optional pin from the device", w: 4, h: 2 },
  webhook: { name: "Webhook", hint: "Call a URL when virtualWrite hits the pin", w: 4, h: 3 },
  watchdog: { name: "Ping watchdog", hint: "On the Arduino, check the internet and toggle a GPIO if it drops", w: 4, h: 3 },
  graph: { name: "Graph", hint: "Stored readings from one or more pins", w: 8, h: 5 },
  dpad: { name: "D-pad", hint: "Four arrows, each on its own pin", w: 4, h: 4 },
  line_h: { name: "Horizontal line", hint: "A line across the page", w: 6, h: 1 },
  line_v: { name: "Vertical line", hint: "A line down the page", w: 1, h: 6 },
};
