import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { WIDGET_META, type BoardWidget, type WidgetType } from "@/lib/types";
import { pinKey } from "@/lib/layout";
import { clamp, grabOffsetCells, snapEdge } from "@/lib/gridSnap";
import { WidgetView } from "./WidgetView";
import { cn, DEFAULT_PAGE_BACKGROUND, DEFAULT_WIDGET_BACKGROUND, fillCss } from "@/lib/utils";

interface CanvasProps {
  widgets: BoardWidget[];
  values: Record<string, string>;
  properties: Record<string, Record<string, string>>;
  projectDeviceKeyId: number | null;
  deviceNames: Record<number, string>;
  snap: number;
  columns: number;
  rows: number;
  editing: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onChange?: (widgets: BoardWidget[]) => void;
  onSend?: (widget: BoardWidget, value: string) => void;
  projectId?: string;
  showFrameLabel?: boolean;
  frameLabel?: string;
  pageBackground?: string;
}

export function Canvas({
  widgets,
  values,
  properties,
  projectDeviceKeyId,
  deviceNames,
  snap,
  columns,
  rows,
  editing,
  selectedId,
  onSelect,
  onChange,
  onSend,
  projectId,
  showFrameLabel = false,
  frameLabel = "",
  pageBackground,
}: CanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState<{ w: number; h: number } | null>(null);
  const contentRows = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
  const gridRows = Math.max(rows, contentRows + (editing ? 1 : 0));
  const boardW = columns * snap;
  const boardH = gridRows * snap;
  const labelBlock = showFrameLabel ? 28 : 0;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setSpace({ w: el.clientWidth, h: el.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);

  const availW = space?.w ?? boardW;
  const availH = Math.max(1, (space?.h ?? boardH + labelBlock) - labelBlock);
  const scale =
    boardW > 0 && boardH > 0 ? Math.min(availW / boardW, availH / boardH) : 1;
  const fittedW = boardW * (Number.isFinite(scale) && scale > 0 ? scale : 1);
  const fittedH = boardH * (Number.isFinite(scale) && scale > 0 ? scale : 1);
  const cell = columns > 0 ? fittedW / columns : snap;

  function startDrag(e: ReactPointerEvent, id: string, mode: "move" | "resize") {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.(id);
    const canvas = ref.current;
    const start = widgets.find((w) => w.id === id);
    if (!canvas || !start) return;
    const origin = () => canvas.getBoundingClientRect();
    const down = origin();
    const grabCol = grabOffsetCells(
      e.clientX,
      down.left,
      cell,
      mode === "move" ? start.x : start.x + start.w,
    );
    const grabRow = grabOffsetCells(
      e.clientY,
      down.top,
      cell,
      mode === "move" ? start.y : start.y + start.h,
    );
    let lastX = start.x;
    let lastY = start.y;
    let lastW = start.w;
    let lastH = start.h;

    const move = (ev: PointerEvent) => {
      const rect = origin();
      let x = lastX;
      let y = lastY;
      let w = lastW;
      let h = lastH;
      if (mode === "move") {
        x = clamp(snapEdge(ev.clientX, rect.left, cell, grabCol), 0, Math.max(0, columns - start.w));
        y = Math.max(0, snapEdge(ev.clientY, rect.top, cell, grabRow));
      } else {
        const right = snapEdge(ev.clientX, rect.left, cell, grabCol);
        const bottom = snapEdge(ev.clientY, rect.top, cell, grabRow);
        w = clamp(right - start.x, 1, Math.max(1, columns - start.x));
        h = Math.max(1, bottom - start.y);
      }
      if (x === lastX && y === lastY && w === lastW && h === lastH) return;
      lastX = x;
      lastY = y;
      lastW = w;
      lastH = h;
      onChange?.(
        widgets.map((widget) => (widget.id === id ? { ...widget, x, y, w, h } : widget)),
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div ref={hostRef} className="flex h-[min(70vh,900px)] w-full flex-col items-center justify-center overflow-hidden">
      {showFrameLabel && (
        <div data-testid="screen-frame-label" className="mb-1 h-7 text-center text-xs text-muted">
          {frameLabel}
        </div>
      )}
    <div
      ref={ref}
      className="relative shrink-0 overflow-hidden rounded-2xl border border-line bg-[#0a1220]"
      style={{
        width: fittedW,
        height: fittedH,
        backgroundColor: fillCss(pageBackground, DEFAULT_PAGE_BACKGROUND),
        backgroundImage: editing
          ? "linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)"
          : "none",
        backgroundSize: `${cell}px ${cell}px`,
      }}
      onPointerDown={() => editing && onSelect?.(null)}
    >
      {widgets.map((widget, index) => {
        if (!editing && widget.type === "webhook" && widget.props.hideInLive) return null;
        const deviceId = widget.deviceKeyId ?? projectDeviceKeyId;
        const key = pinKey(deviceId, widget.pin);
        const opacity = clampOpacity(widget.props.opacity);
        const fill = widget.props.background;
        const transparent = fill === "transparent";
        return (
          <div
            key={widget.id}
            className={cn(
              "absolute rounded-2xl",
              selectedId === widget.id && editing && "z-30 ring-2 ring-accent",
              editing && "cursor-grab touch-none",
            )}
            style={{
              left: widget.x * cell,
              top: widget.y * cell,
              width: widget.w * cell,
              height: widget.h * cell,
              zIndex: selectedId === widget.id && editing ? 30 : index + 1,
            }}
            onPointerDown={(e) => startDrag(e, widget.id, "move")}
          >
            <div
              className={cn(
                "h-full overflow-hidden rounded-2xl border",
                transparent ? (editing ? "border-line/50" : "border-transparent") : "border-line",
                !fill && "bg-panel",
              )}
              style={{
                opacity,
                background: fill ? fillCss(fill, DEFAULT_WIDGET_BACKGROUND) : undefined,
              }}
            >
              <WidgetView
                widget={widget}
                value={values[key]}
                values={values}
                properties={properties[key]}
                editing={editing}
                snap={cell}
                projectId={projectId}
                deviceKeyId={deviceId}
                deviceName={widget.deviceKeyId ? deviceNames[widget.deviceKeyId] : undefined}
                onPatchProps={(patch) =>
                  onChange?.(
                    widgets.map((item) =>
                      item.id === widget.id ? { ...item, props: { ...item.props, ...patch } } : item,
                    ),
                  )
                }
                onSend={(value, pin) => onSend?.(pin === undefined ? widget : { ...widget, pin }, value)}
              />
            </div>
            {editing && (
              <div
                className="absolute bottom-1 right-1 z-10 h-4 w-4 cursor-nwse-resize rounded-sm bg-accent/80"
                onPointerDown={(e) => startDrag(e, widget.id, "resize")}
              />
            )}
          </div>
        );
      })}
    </div>
    </div>
  );
}

function clampOpacity(value: number | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.05, Math.min(1, n));
}

export function WidgetPalette({ onAdd }: { onAdd: (type: WidgetType) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(Object.keys(WIDGET_META) as WidgetType[]).map((type) => {
        const meta = WIDGET_META[type];
        return (
          <button
            key={type}
            type="button"
            onClick={() => onAdd(type)}
            className="rounded-xl border border-line bg-panel-2 p-3 text-left hover:border-accent/50"
          >
            <div className="text-sm font-medium text-ink">{meta.name}</div>
            <div className="text-xs text-muted">{meta.hint}</div>
          </button>
        );
      })}
    </div>
  );
}
