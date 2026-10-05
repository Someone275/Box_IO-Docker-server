export type WatchdogDirection = "high-to-low" | "low-to-high";

const HOST_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,251}[A-Za-z0-9])?$|^[A-Za-z0-9]$/;

export function clampIntervalSec(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 30;
  return Math.max(5, Math.min(86400, n));
}

export function clampMisses(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(50, n));
}

export function clampTransitionSec(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(3600, n));
}

export function watchdogDirection(value: unknown): WatchdogDirection {
  return value === "low-to-high" ? "low-to-high" : "high-to-low";
}

/** First level, then the level after the transition time. */
export function watchdogLevels(direction: WatchdogDirection): [string, string] {
  return direction === "low-to-high" ? ["0", "1"] : ["1", "0"];
}

export function normalizeTarget(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, 2000);
}

export function targetAllowed(target: string): boolean {
  if (!target) return false;
  if (/^https?:\/\//i.test(target)) {
    try {
      const url = new URL(target);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }
  return HOST_RE.test(target);
}

