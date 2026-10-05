import { db } from "./db.js";
import {
  clampIntervalSec,
  clampMisses,
  clampTransitionSec,
  normalizeTarget,
  targetAllowed,
  watchdogDirection,
} from "./watchdog-plan.js";

interface SavedWidget {
  id?: string;
  type?: string;
  pin?: number;
  deviceKeyId?: number;
  props?: {
    target?: string;
    intervalSec?: number;
    misses?: number;
    direction?: string;
    transitionSec?: number;
  };
}

export interface WatchdogConfig {
  active: 0 | 1;
  target: string;
  interval: number;
  misses: number;
  pin: number;
  dir: 0 | 1;
  transition: number;
}

const idle: WatchdogConfig = { active: 0, target: "", interval: 30, misses: 3, pin: 0, dir: 0, transition: 5 };

function widgetsFromLayout(layoutJson: string): SavedWidget[] {
  let data: { pages?: { widgets?: SavedWidget[] }[]; widgets?: SavedWidget[] } = {};
  try {
    data = JSON.parse(layoutJson || "{}");
  } catch {
    return [];
  }
  const pages = Array.isArray(data.pages) && data.pages.length ? data.pages : [{ widgets: data.widgets }];
  const widgets: SavedWidget[] = [];
  for (const page of pages) {
    for (const widget of page?.widgets || []) widgets.push(widget);
  }
  return widgets;
}

/** Settings the Arduino reads from /hw/watchdog. The board does the check and toggles its own GPIO. */
export function watchdogConfig(deviceKeyId: number): WatchdogConfig {
  if (!deviceKeyId) return idle;
  const projects = db
    .prepare("SELECT device_key_id, layout_json FROM projects")
    .all() as { device_key_id: number | null; layout_json: string }[];
  for (const project of projects) {
    for (const widget of widgetsFromLayout(project.layout_json)) {
      if (widget?.type !== "watchdog") continue;
      const owner = Number(widget.deviceKeyId) || Number(project.device_key_id) || 0;
      if (owner !== deviceKeyId) continue;
      const pin = Number(widget.pin);
      const target = normalizeTarget(widget.props?.target);
      const usable = Number.isInteger(pin) && pin >= 0 && pin <= 127 && targetAllowed(target);
      return {
        active: 1,
        target: usable ? target : "",
        interval: clampIntervalSec(widget.props?.intervalSec),
        misses: clampMisses(widget.props?.misses),
        pin: Number.isInteger(pin) && pin >= 0 && pin <= 127 ? pin : 0,
        dir: watchdogDirection(widget.props?.direction) === "low-to-high" ? 1 : 0,
        transition: clampTransitionSec(widget.props?.transitionSec),
      };
    }
  }
  return idle;
}
