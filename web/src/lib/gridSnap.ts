/** Cell index under the pointer, minus where on the widget the drag started. */
export function grabOffsetCells(pointerPx: number, canvasPx: number, cell: number, edgeCells: number) {
  if (!(cell > 0)) return 0;
  return (pointerPx - canvasPx) / cell - edgeCells;
}

/** Snap a widget edge to the nearest grid line without skipping cells. */
export function snapEdge(pointerPx: number, canvasPx: number, cell: number, grabCells: number) {
  if (!(cell > 0)) return 0;
  return Math.round((pointerPx - canvasPx) / cell - grabCells);
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
