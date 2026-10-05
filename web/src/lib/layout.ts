import type { BoardWidget, WidgetProps, WidgetType } from "./types";
import { normalizeBackground } from "./utils";

export const DEFAULT_SNAP = 64;
export const DEFAULT_COLUMNS = 12;
export const DEFAULT_ROWS = 10;

export interface BoardPage {
  id: string;
  name: string;
  widgets: BoardWidget[];
  snap: number;
  columns: number;
  rows: number;
  background?: string;
}

export interface BoardLayout {
  snap: number;
  columns: number;
  rows: number;
  activePageId: string;
  pages: BoardPage[];
}

const WIDGET_TYPES = new Set<WidgetType>([
  "led",
  "circle_meter",
  "bar_meter",
  "input",
  "value",
  "button_round",
  "button_oval",
  "slider_h",
  "slider_v",
  "grid",
  "label",
  "webhook",
  "watchdog",
  "graph",
  "dpad",
  "line_h",
  "line_v",
]);

export function clampSnap(value: unknown, fallback = DEFAULT_SNAP) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(16, Math.min(160, Math.round(n)));
}

export function clampColumns(value: unknown, fallback = DEFAULT_COLUMNS) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(4, Math.min(48, Math.round(n)));
}

export function clampRows(value: unknown, fallback = DEFAULT_ROWS) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(4, Math.min(80, Math.round(n)));
}

export function pinKey(deviceKeyId: number | null | undefined, pin: number) {
  return `${deviceKeyId ?? 0}:${pin}`;
}

export function emptyLayout(): BoardLayout {
  return {
    snap: DEFAULT_SNAP,
    columns: DEFAULT_COLUMNS,
    rows: DEFAULT_ROWS,
    activePageId: "page-1",
    pages: [
      {
        id: "page-1",
        name: "Page 1",
        widgets: [],
        snap: DEFAULT_SNAP,
        columns: DEFAULT_COLUMNS,
        rows: DEFAULT_ROWS,
      },
    ],
  };
}

export function activePage(layout: BoardLayout) {
  return layout.pages.find((p) => p.id === layout.activePageId) ?? layout.pages[0];
}

/** Top-level snap, columns, and rows follow the page that is open. */
export function syncLayoutScreen(layout: BoardLayout): BoardLayout {
  const page = activePage(layout);
  if (!page) return layout;
  return { ...layout, snap: page.snap, columns: page.columns, rows: page.rows };
}

export function activatePage(layout: BoardLayout, id: string): BoardLayout {
  return syncLayoutScreen({ ...layout, activePageId: id });
}

export function updateActivePage(
  layout: BoardLayout,
  patch: Partial<Pick<BoardPage, "snap" | "columns" | "rows" | "name" | "background">>,
): BoardLayout {
  const pages = layout.pages.map((page) => {
    if (page.id !== layout.activePageId) return page;
    const next = { ...page, ...patch };
    if (patch.columns !== undefined && patch.columns !== page.columns) {
      next.widgets = fitWidgetsToColumns(page.widgets, next.columns);
    }
    return next;
  });
  return syncLayoutScreen({ ...layout, pages });
}

function normalizeWidget(raw: unknown): BoardWidget | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Partial<BoardWidget> & { props?: WidgetProps };
  if (typeof w.id !== "string" || !w.id) return null;
  if (typeof w.type !== "string" || !WIDGET_TYPES.has(w.type as WidgetType)) return null;
  const deviceKeyId = Number(w.deviceKeyId);
  return {
    id: w.id,
    type: w.type as WidgetType,
    pin: Number.isFinite(Number(w.pin)) ? Math.max(0, Math.round(Number(w.pin))) : 0,
    x: Number.isFinite(Number(w.x)) ? Math.max(0, Math.round(Number(w.x))) : 0,
    y: Number.isFinite(Number(w.y)) ? Math.max(0, Math.round(Number(w.y))) : 0,
    w: Math.max(1, Math.round(Number(w.w)) || 2),
    h: Math.max(1, Math.round(Number(w.h)) || 2),
    ...(Number.isInteger(deviceKeyId) && deviceKeyId > 0 ? { deviceKeyId } : {}),
    props: w.props && typeof w.props === "object" ? w.props : {},
  };
}

function hasOwn(raw: object, key: string) {
  return Object.prototype.hasOwnProperty.call(raw, key);
}

function normalizePage(
  raw: unknown,
  index: number,
  fallback: { snap: number; columns: number; rows: number },
): BoardPage {
  const page = raw && typeof raw === "object" ? (raw as Partial<BoardPage>) : {};
  const source = raw && typeof raw === "object" ? raw : {};
  const widgets = Array.isArray(page.widgets)
    ? page.widgets.map(normalizeWidget).filter((w): w is BoardWidget => w !== null)
    : [];
  return {
    id: typeof page.id === "string" && page.id ? page.id : `page-${index + 1}`,
    name: typeof page.name === "string" && page.name.trim() ? page.name : `Page ${index + 1}`,
    snap: hasOwn(source, "snap") ? clampSnap(page.snap, fallback.snap) : fallback.snap,
    columns: hasOwn(source, "columns") ? clampColumns(page.columns, fallback.columns) : fallback.columns,
    rows: hasOwn(source, "rows") ? clampRows(page.rows, fallback.rows) : fallback.rows,
    background: normalizeBackground((page as { background?: unknown }).background),
    widgets,
  };
}

export function parseLayout(raw: string | null | undefined): BoardLayout {
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    data = {};
  }
  const snap = clampSnap(data.snap);
  const columns = clampColumns(data.columns);
  const rows = clampRows(data.rows);
  const fallback = { snap, columns, rows };
  const pages = Array.isArray(data.pages) && data.pages.length
    ? data.pages.map((page, index) => normalizePage(page, index, fallback))
    : [normalizePage({ id: "page-1", name: "Page 1", widgets: data.widgets }, 0, fallback)];
  const active = typeof data.activePageId === "string" ? data.activePageId : pages[0].id;
  return syncLayoutScreen({
    snap,
    columns,
    rows,
    activePageId: pages.some((p) => p.id === active) ? active : pages[0].id,
    pages,
  });
}

export function serializeLayout(layout: BoardLayout) {
  const pages = layout.pages.length ? layout.pages : emptyLayout().pages;
  const activePageId = pages.some((p) => p.id === layout.activePageId) ? layout.activePageId : pages[0].id;
  const active = pages.find((p) => p.id === activePageId) ?? pages[0];
  return {
    snap: clampSnap(active.snap),
    columns: clampColumns(active.columns),
    rows: clampRows(active.rows),
    activePageId,
    pages: pages.map((page) => ({
      ...page,
      snap: clampSnap(page.snap),
      columns: clampColumns(page.columns),
      rows: clampRows(page.rows),
    })),
    widgets: pages[0]?.widgets ?? [],
  };
}

export function fitWidgetsToColumns(widgets: BoardWidget[], columns: number): BoardWidget[] {
  return widgets.map((w) => {
    const width = Math.max(1, Math.min(w.w, columns));
    return { ...w, w: width, x: Math.max(0, Math.min(w.x, columns - width)) };
  });
}
