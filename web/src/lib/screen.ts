import {
  fitWidgetsToColumns,
  syncLayoutScreen,
  updateActivePage,
  type BoardLayout,
  type BoardPage,
} from "./layout";

export interface ScreenTemplate {
  name: string;
  snap: number;
  columns: number;
  rows: number;
  width: number;
  height: number;
}

function template(name: string, snap: number, columns: number, rows: number): ScreenTemplate {
  return { name, snap, columns, rows, width: columns * snap, height: rows * snap };
}

export const screenTemplates: ScreenTemplate[] = [
  template("Phone", 32, 12, 26),
  template("Phone wide", 32, 26, 12),
  template("Small phone", 40, 9, 20),
  template("Tablet", 64, 12, 16),
  template("Tablet wide", 64, 16, 12),
  template("Desktop", 32, 40, 25),
];

export function sameScreen(
  page: { snap: number; columns: number; rows: number },
  screen: { snap: number; columns: number; rows: number },
) {
  return page.snap === screen.snap && page.columns === screen.columns && page.rows === screen.rows;
}

export function matchingScreenTemplate(layout: { snap: number; columns: number; rows: number }) {
  return screenTemplates.find((screen) => sameScreen(layout, screen)) ?? null;
}

export function screenLabel(layout: { snap: number; columns: number; rows: number }) {
  const match = matchingScreenTemplate(layout);
  const width = layout.columns * layout.snap;
  const height = layout.rows * layout.snap;
  return match ? `${match.name}  ${width}×${height}` : `Custom ${width}×${height}`;
}

/** First device size no existing page uses. When every preset is taken, rotate past the last page. */
export function screenForNewPage(pages: Pick<BoardPage, "snap" | "columns" | "rows">[]) {
  for (const screen of screenTemplates) {
    if (!pages.some((page) => sameScreen(page, screen))) return screen;
  }
  if (!pages.length) return screenTemplates[0];
  const last = pages[pages.length - 1];
  const lastIndex = screenTemplates.findIndex((screen) => sameScreen(last, screen));
  return screenTemplates[(lastIndex + 1) % screenTemplates.length];
}

export interface FittedScreen {
  snap: number;
  columns: number;
  rows: number;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** Turn a pixel width and height into a grid. Prefer an exact snap near 32. */
export function fitCustomScreen(width: number, height: number): FittedScreen {
  let bestSnap: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let snap = 16; snap <= 160; snap++) {
    if (width % snap !== 0 || height % snap !== 0) continue;
    const columns = width / snap;
    const rows = height / snap;
    if (columns < 4 || columns > 48 || rows < 4 || rows > 80) continue;
    const score = Math.abs(snap - 32);
    if (bestSnap === null || score < bestScore || (score === bestScore && snap > bestSnap)) {
      bestScore = score;
      bestSnap = snap;
    }
  }
  if (bestSnap !== null) {
    return { snap: bestSnap, columns: width / bestSnap, rows: height / bestSnap };
  }
  return {
    snap: 32,
    columns: clamp(Math.round(width / 32), 4, 48),
    rows: clamp(Math.round(height / 32), 4, 80),
  };
}

export function applyScreenTemplate(layout: BoardLayout, screen: ScreenTemplate) {
  const next = updateActivePage(layout, {
    snap: screen.snap,
    columns: screen.columns,
    rows: screen.rows,
  });
  return next;
}

export function applyCustomScreen(layout: BoardLayout, width: number, height: number) {
  const fitted = fitCustomScreen(width, height);
  const pages = layout.pages.map((page) => {
    if (page.id !== layout.activePageId) return page;
    return {
      ...page,
      snap: fitted.snap,
      columns: fitted.columns,
      rows: fitted.rows,
      widgets: fitWidgetsToColumns(page.widgets, fitted.columns),
    };
  });
  return syncLayoutScreen({ ...layout, pages });
}
