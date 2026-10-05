import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  asNumber,
  listedWidgetLabel,
  buttonFace,
  buttonIsOn,
  buttonValues,
  cellColor,
  contrastText,
  gridConfig,
  gridDisplayCells,
  isOn,
  gaugeArcPath,
  gaugeSweep,
  lineWidth,
  liveMeterOpts,
  liveStr,
  sliderBounds,
  sliderPercent,
  meterColor,
  pinLabel,
} from "@/lib/utils";
import { pinKey } from "@/lib/layout";
import type { BoardWidget, WidgetProps } from "@/lib/types";
import { DpadWidget } from "./DpadWidget";
import { GraphWidget } from "./GraphWidget";
import { webhookContentType } from "@/lib/webhook";

interface WidgetViewProps {
  widget: BoardWidget;
  value?: string;
  values?: Record<string, string>;
  properties?: Record<string, string>;
  editing?: boolean;
  snap?: number;
  projectId?: string;
  deviceKeyId?: number | null;
  deviceName?: string;
  onPatchProps?: (patch: WidgetProps) => void;
  onSend?: (value: string, pin?: number) => void;
}

export function WidgetView({
  widget,
  value,
  values = {},
  properties = {},
  editing,
  snap = 64,
  projectId,
  deviceKeyId = null,
  deviceName,
  onPatchProps,
  onSend,
}: WidgetViewProps) {
  const p = widget.props;
  const colorOn = liveStr(properties, "colorOn", liveStr(properties, "color", p.colorOn || "#2ee0c5")) || "#2ee0c5";
  const colorOff = liveStr(properties, "colorOff", p.colorOff || "#314057") || "#314057";
  const color = liveStr(properties, "color", p.color || (widget.type === "label" ? "#e8eef8" : "#2ee0c5")) || "#2ee0c5";
  const label = listedWidgetLabel(widget.type, p.label);
  const hideCaption = p.hideLabel ?? widget.type === "label";
  const fontSize = p.fontSize && p.fontSize > 0 ? p.fontSize : undefined;
  const pad = Math.max(4, Math.round(snap * 0.08));
  const n = asNumber(value, 0);
  const detached = widget.type === "label" && p.detached !== false;
  const meter = liveMeterOpts(p, properties);

  if (widget.type === "line_h" || widget.type === "line_v") {
    const vertical = widget.type === "line_v";
    const thickness = lineWidth(p.lineWidth);
    const stroke = p.color || "#e8eef8";
    return (
      <div className="relative h-full w-full" data-testid={widget.type}>
        <div
          style={
            vertical
              ? {
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: "50%",
                  width: thickness,
                  maxWidth: "100%",
                  transform: "translateX(-50%)",
                  background: stroke,
                  borderRadius: thickness,
                }
              : {
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: "50%",
                  height: thickness,
                  maxHeight: "100%",
                  transform: "translateY(-50%)",
                  background: stroke,
                  borderRadius: thickness,
                }
          }
        />
      </div>
    );
  }

  if (widget.type === "dpad") {
    return (
      <DpadWidget
        widget={widget}
        values={values}
        deviceKeyId={deviceKeyId ?? null}
        editing={editing}
        colorOn={colorOn}
        colorOff={colorOff}
        onSend={onSend}
      />
    );
  }

  if (widget.type === "led") {
    const on = isOn(value);
    const c = on ? colorOn : colorOff;
    return (
      <Shell label={label} pin={widget.pin} deviceName={deviceName} hideLabel={hideCaption} pad={pad}>
        <div className="widget-scale flex min-h-0 flex-1 items-center justify-center">
          <div
            className="aspect-square rounded-full border-4"
            style={{
              width: "78cqmin",
              height: "78cqmin",
              background: c,
              borderColor: c,
              boxShadow: on ? `0 0 24px ${c}` : "none",
              opacity: on ? 1 : 0.55,
            }}
          />
        </div>
      </Shell>
    );
  }

  if (widget.type === "circle_meter") {
    const { color: c, pct } = meterColor(n, meter);
    const r = 36;
    const start = meter.startDeg;
    const sweep = gaugeSweep(start, meter.endDeg);
    const fillSweep = sweep * (pct / 100);
    return (
      <Shell label={label} pin={widget.pin} deviceName={deviceName} hideLabel={hideCaption} pad={pad}>
        <div className="widget-scale flex min-h-0 flex-1 items-center justify-center">
          <div className="relative" style={{ width: "100cqmin", height: "100cqmin" }}>
            <svg viewBox="0 0 100 100" className="h-full w-full">
              <path d={gaugeArcPath(50, 50, r, start, sweep)} fill="none" stroke="#243044" strokeWidth="10" strokeLinecap="round" />
              {fillSweep > 0.2 ? (
                <path d={gaugeArcPath(50, 50, r, start, fillSweep)} fill="none" stroke={c} strokeWidth="10" strokeLinecap="round" />
              ) : null}
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={fontSize ? "font-mono font-semibold" : "widget-fit-text font-mono font-semibold"} style={{ color: c, ...textStyle(fontSize) }}>
                {formatValue(value)}
              </span>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  if (widget.type === "bar_meter") {
    const { color: c, pct } = meterColor(n, meter);
    return (
      <Shell label={label} pin={widget.pin} deviceName={deviceName} hideLabel={hideCaption} pad={pad}>
        <div className="widget-scale flex min-h-0 flex-1 items-stretch justify-center gap-[6%]">
          <div className="relative h-full overflow-hidden rounded-full border border-line bg-[#0b1220]" style={{ width: "22%" }}>
            <div
              className="absolute bottom-0 w-full rounded-full"
              style={{ height: `${pct}%`, background: c, boxShadow: `0 0 18px ${c}` }}
            />
          </div>
          <div className="flex items-end">
            <span className={fontSize ? "font-mono" : "widget-fit-text font-mono"} style={{ color: c, ...textStyle(fontSize) }}>
              {formatValue(value)}
            </span>
          </div>
        </div>
      </Shell>
    );
  }

  if (widget.type === "value") {
    return (
      <Shell label={label} pin={widget.pin} deviceName={deviceName} hideLabel={hideCaption} pad={pad}>
        <div
          className="widget-scale flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-line bg-bg px-2 font-mono"
          style={{ color }}
        >
          <span className={fontSize ? "" : "widget-fit-text"} style={textStyle(fontSize)}>
            {value === undefined || value === "" ? "—" : value}
          </span>
        </div>
      </Shell>
    );
  }

  if (widget.type === "label") {
    const live =
      !detached && value !== undefined && value !== ""
        ? value
        : liveStr(properties, "text", p.text || p.label) || "Label";
    return (
      <Shell label={label} pin={widget.pin} deviceName={detached ? undefined : deviceName} hideLabel={hideCaption} showPin={!detached} pad={pad}>
        <div className="widget-scale flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          <span
            className={`max-h-full w-full break-words text-center ${fontSize ? "" : "widget-fit-text"}`}
            style={{ color, ...textStyle(fontSize) }}
          >
            {live}
          </span>
        </div>
      </Shell>
    );
  }

  if (widget.type === "input") {
    return (
      <InputWidget
        label={label}
        pin={widget.pin}
        deviceName={deviceName}
        hideLabel={hideCaption}
        pad={pad}
        fontSize={fontSize}
        colorOn={colorOn}
        colorOff={colorOff}
        disabled={editing}
        onSend={(v) => onSend?.(v)}
      />
    );
  }

  if (widget.type === "button_round" || widget.type === "button_oval") {
    const { onValue, offValue } = buttonValues({
      onValue: liveStr(properties, "onValue", p.onValue),
      offValue: liveStr(properties, "offValue", p.offValue),
      sendValue: liveStr(properties, "sendValue", p.sendValue),
    });
    const on = buttonIsOn(value, onValue, offValue);
    const face = buttonFace(on, p, properties);
    const background = on ? colorOn : colorOff;
    const textColor = on
      ? liveStr(properties, "textColorOn", p.textColorOn || "#071018") || "#071018"
      : liveStr(properties, "textColorOff", p.textColorOff || "#e8eef8") || "#e8eef8";
    const round = widget.type === "button_round";
    return (
      <Shell label={label} pin={widget.pin} deviceName={deviceName} hideLabel={hideCaption} pad={pad}>
        <div className="widget-scale flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          <button
            type="button"
            disabled={editing}
            onClick={() => onSend?.(on ? offValue : onValue)}
            className="flex max-h-full max-w-full items-center justify-center overflow-hidden px-[8%] text-center font-semibold leading-tight"
            style={{
              width: round ? "min(100%, 100cqmin)" : "92%",
              height: round ? "min(100%, 100cqmin)" : "72%",
              aspectRatio: round ? "1" : undefined,
              borderRadius: "9999px",
              background,
              color: textColor,
              boxShadow: on ? `0 0 22px ${background}66` : "none",
              ...textStyle(fontSize, round ? "16cqmin" : "18cqmin"),
            }}
          >
            {face}
          </button>
        </div>
      </Shell>
    );
  }

  if (widget.type === "slider_h" || widget.type === "slider_v") {
    return (
      <Shell label={label} pin={widget.pin} deviceName={deviceName} hideLabel={hideCaption} pad={pad}>
        <FillSlider
          vertical={widget.type === "slider_v"}
          {...sliderBounds(p, properties)}
          value={value}
          color={color}
          fontSize={fontSize}
          disabled={editing}
          onCommit={(v) => onSend?.(v)}
        />
      </Shell>
    );
  }

  if (widget.type === "webhook") {
    const method = (p.method || "POST").toUpperCase();
    const contentType = webhookContentType(p.contentType, p.data);
    const status = liveStr(properties, "webhookStatus", "");
    const target = p.url || "No URL yet";
    const hidden = !!p.hideInLive;
    return (
      <Shell label={label} pin={widget.pin} deviceName={deviceName} hideLabel={hideCaption} pad={pad}>
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-1 overflow-hidden">
          <div className="flex items-center gap-2">
            <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] text-accent">{method}</span>
            <span className="truncate font-mono text-[10px] text-muted">{contentType}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink" style={textStyle(fontSize, "0.8rem")}>
              {target}
            </span>
            <button
              type="button"
              className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] text-muted hover:text-ink"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onPatchProps?.({ hideInLive: !hidden })}
            >
              {hidden ? "Show in live" : "Hide"}
            </button>
          </div>
          <div className="truncate font-mono text-sm text-accent" style={textStyle(fontSize, "0.95rem")}>
            {value || "Waiting for virtualWrite"}
          </div>
          {status ? <div className="truncate text-xs text-muted">{status}</div> : null}
          {hidden ? <div className="truncate text-xs text-muted">Hidden while Live is on. Save the layout to keep that.</div> : null}
        </div>
      </Shell>
    );
  }

  if (widget.type === "watchdog") {
    const target = p.target || "No site or IP yet";
    const every = p.intervalSec ?? 30;
    const misses = p.misses ?? 3;
    const transition = p.transitionSec ?? 5;
    const direction = p.direction === "low-to-high" ? "low to high" : "high to low";
    const status = liveStr(properties, "watchdogStatus", "Waiting for the board");
    return (
      <Shell label={label} pin={widget.pin} deviceName={deviceName} hideLabel={hideCaption} pad={pad} pinText={`GPIO ${widget.pin}`}>
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-1 overflow-hidden">
          <div className="truncate font-mono text-sm text-ink" style={textStyle(fontSize, "0.95rem")}>
            {target}
          </div>
          <div className="truncate text-xs text-muted">
            every {every}s · fail after {misses} misses · {direction} over {transition}s
          </div>
          <div className="truncate font-mono text-sm text-accent" style={textStyle(fontSize, "0.9rem")}>
            {status}
          </div>
        </div>
      </Shell>
    );
  }

  if (widget.type === "graph") {
    return (
      <Shell label={label} pin={widget.pin} deviceName={deviceName} hideLabel={hideCaption} pad={pad} pinText={graphPins(widget)}>
        <GraphWidget
          projectId={projectId}
          widget={widget}
          deviceKeyId={deviceKeyId}
          values={values}
          editing={editing}
          onPatchProps={onPatchProps}
        />
      </Shell>
    );
  }

  if (widget.type === "grid") {
    return (
      <GridWidget
        widget={widget}
        value={value}
        values={values}
        deviceKeyId={deviceKeyId}
        properties={properties}
        editing={editing}
        hideLabel={hideCaption}
        pad={pad}
        fontSize={fontSize}
        deviceName={deviceName}
        onSend={onSend}
      />
    );
  }

  return (
    <Shell label={label} pin={widget.pin} deviceName={deviceName} hideLabel={hideCaption} pad={pad}>
      <div className="flex flex-1 items-center justify-center text-sm text-muted">Unsupported widget</div>
    </Shell>
  );
}

function graphPins(widget: BoardWidget): string {
  const series = widget.props.graphSeries;
  if (!Array.isArray(series) || series.length === 0) return pinLabel(widget.pin);
  return series.map((item) => pinLabel(Number(item.pin))).join(" ");
}

function textStyle(fontSize?: number, fallback?: string): CSSProperties {
  if (fontSize) return { fontSize: `${fontSize}px`, lineHeight: 1.1 };
  if (fallback) return { fontSize: fallback, lineHeight: 1.1 };
  return { lineHeight: 1.1 };
}

function formatValue(value?: string) {
  if (value === undefined || value === "") return "0";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function Shell({
  label,
  pin,
  deviceName,
  hideLabel,
  showPin = true,
  pinText,
  pad,
  children,
}: {
  label: string;
  pin: number;
  deviceName?: string;
  hideLabel?: boolean;
  showPin?: boolean;
  pinText?: string;
  pad: number;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col" style={{ padding: pad, gap: Math.max(2, Math.round(pad / 2)) }}>
      {!hideLabel && (
        <div className="flex shrink-0 items-center justify-between gap-2 text-[11px] text-muted">
          <span className="truncate">{label}</span>
          {showPin && (
            <span className="shrink-0 font-mono text-accent/80">
              {pinText || pinLabel(pin)}
              {deviceName ? ` · ${deviceName}` : ""}
            </span>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

const SLIDER_THUMB = 0.62;
const SLIDER_GAP = "4px";

function quantize(raw: number, min: number, max: number) {
  const clamped = Math.min(max, Math.max(min, raw));
  const range = Math.abs(max - min);
  if (range <= 10) return Math.round(clamped * 10) / 10;
  return Math.round(clamped);
}

function FillSlider({
  vertical,
  min,
  max,
  value,
  color,
  fontSize,
  disabled,
  onCommit,
}: {
  vertical: boolean;
  min: number;
  max: number;
  value?: string;
  color: string;
  fontSize?: number;
  disabled?: boolean;
  onCommit: (value: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pending = useRef<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const external = quantize(asNumber(value, min), min, max);
  const shown = drag ?? (pending.current !== null ? quantize(Number(pending.current), min, max) : external);
  const pct = sliderPercent(shown, min, max);

  useEffect(() => {
    if (pending.current !== null && value === pending.current) pending.current = null;
  }, [value]);

  useEffect(() => {
    pending.current = null;
    setDrag(null);
  }, [min, max]);

  function read(clientX: number, clientY: number) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return external;
    const thumbPx = (vertical ? rect.width : rect.height) * SLIDER_THUMB;
    const gap = 4;
    const span = (vertical ? rect.height : rect.width) - thumbPx - gap * 2;
    if (span <= 0) return external;
    const pos = vertical ? rect.bottom - thumbPx / 2 - gap - clientY : clientX - rect.left - thumbPx / 2 - gap;
    const ratio = Math.min(1, Math.max(0, pos / span));
    return quantize(min + ratio * (max - min), min, max);
  }

  function commit(next: number) {
    const text = String(next);
    pending.current = text;
    setDrag(null);
    onCommit(text);
    window.setTimeout(() => {
      if (pending.current === text) pending.current = null;
    }, 800);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (disabled) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    setDrag(read(e.clientX, e.clientY));
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    setDrag(read(e.clientX, e.clientY));
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    dragging.current = false;
    commit(read(e.clientX, e.clientY));
  }

  const thumb = vertical
    ? {
        left: "50%",
        width: `${SLIDER_THUMB * 100}%`,
        aspectRatio: "1",
        boxSizing: "border-box" as const,
        transform: "translate(-50%, 50%)",
        bottom: `calc(${SLIDER_THUMB * 50}cqw + ${SLIDER_GAP} + (100% - ${SLIDER_THUMB * 100}cqw - ${SLIDER_GAP} - ${SLIDER_GAP}) * ${pct} / 100)`,
        background: color,
      }
    : {
        top: "50%",
        height: `${SLIDER_THUMB * 100}%`,
        aspectRatio: "1",
        boxSizing: "border-box" as const,
        transform: "translate(-50%, -50%)",
        left: `calc(${SLIDER_THUMB * 50}cqh + ${SLIDER_GAP} + (100% - ${SLIDER_THUMB * 100}cqh - ${SLIDER_GAP} - ${SLIDER_GAP}) * ${pct} / 100)`,
        background: color,
      };

  const readout = (
    <div className={`shrink-0 font-mono text-accent ${vertical ? "flex items-center" : "text-right"}`} style={textStyle(fontSize, "1.05rem")}>
      {formatValue(String(shown))}
    </div>
  );

  return (
    <div className={`widget-scale flex min-h-0 flex-1 ${vertical ? "flex-row items-stretch gap-[8%]" : "flex-col justify-center gap-1"}`}>
      {vertical ? null : readout}
      <div
        ref={trackRef}
        role="slider"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={shown}
        aria-disabled={disabled || undefined}
        className="relative touch-none"
        style={vertical ? { width: "28%", minWidth: 18, containerType: "size" } : { height: "42%", minHeight: 22, width: "100%", containerType: "size" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="absolute inset-0 overflow-hidden rounded-full border border-line bg-[#0b1220]">
          <div
            className="absolute"
            style={
              vertical
                ? { left: 0, right: 0, bottom: 0, height: `${pct}%`, background: color }
                : { top: 0, bottom: 0, left: 0, width: `${pct}%`, background: color }
            }
          />
        </div>
        <div className="pointer-events-none absolute z-10 rounded-full border-2 border-white/80 shadow" style={thumb} />
      </div>
      {vertical ? readout : null}
    </div>
  );
}

function InputWidget({
  label,
  pin,
  deviceName,
  hideLabel,
  pad,
  fontSize,
  colorOn,
  colorOff,
  disabled,
  onSend,
}: {
  label: string;
  pin: number;
  deviceName?: string;
  hideLabel?: boolean;
  pad: number;
  fontSize?: number;
  colorOn: string;
  colorOff: string;
  disabled?: boolean;
  onSend: (v: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <Shell label={label} pin={pin} deviceName={deviceName} hideLabel={hideLabel} pad={pad}>
      <div className="flex min-h-0 flex-1 items-center gap-2">
        <input
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onPointerDown={(e) => {
            if (!disabled) e.stopPropagation();
          }}
          className="h-full min-h-8 max-h-14 flex-1 rounded-lg border px-2 outline-none"
          style={{ borderColor: colorOff, background: "#070b14", color: colorOn, ...textStyle(fontSize, "0.95rem") }}
          placeholder="Send to device"
        />
        <button
          type="button"
          disabled={disabled}
          onPointerDown={(e) => {
            if (!disabled) e.stopPropagation();
          }}
          onClick={() => {
            onSend(text);
            setText("");
          }}
          className="h-full min-h-8 max-h-14 rounded-lg px-3 font-medium"
          style={{ background: colorOn, color: "#071018", ...textStyle(fontSize, "0.9rem") }}
        >
          Send
        </button>
      </div>
    </Shell>
  );
}

function GridWidget({
  widget,
  value,
  values,
  deviceKeyId,
  properties,
  editing,
  hideLabel,
  pad,
  fontSize,
  deviceName,
  onSend,
}: {
  widget: BoardWidget;
  value?: string;
  values: Record<string, string>;
  deviceKeyId: number | null;
  properties: Record<string, string>;
  editing?: boolean;
  hideLabel?: boolean;
  pad: number;
  fontSize?: number;
  deviceName?: string;
  onSend?: (value: string, pin?: number) => void;
}) {
  const { rows, cols, mode, colorOff, rules } = gridConfig(widget.props, properties);
  const count = rows * cols;
  const pinPerCell = widget.props.pinPerCell === true;
  const cells = gridDisplayCells(count, value, pinPerCell, (index) => {
    const pin = widget.pin + index;
    return values[pinKey(deviceKeyId, pin)] ?? (index === 0 ? value : "");
  });
  const signature = `${pinPerCell ? "pins" : "csv"}|${rows}|${cols}|${cells.join("\u0001")}`;
  const [draft, setDraft] = useState<string[] | null>(null);
  const shown = draft ?? cells;
  const writable = mode === "readwrite" && !editing;
  const label = listedWidgetLabel(widget.type, widget.props.label);
  const cellFont = textStyle(fontSize, "clamp(8px, 46cqmin, 28px)");

  useEffect(() => {
    setDraft(null);
  }, [signature]);

  function commit(next: string[], index?: number) {
    const padded = Array.from({ length: count }, (_, i) => next[i] ?? "");
    setDraft(padded);
    if (pinPerCell && index !== undefined) {
      onSend?.(padded[index] ?? "", widget.pin + index);
      return;
    }
    onSend?.(padded.join(","));
  }

  const rowsOf = Array.from({ length: rows }, (_, row) => shown.slice(row * cols, row * cols + cols));

  return (
    <Shell label={label} pin={widget.pin} deviceName={deviceName} hideLabel={hideLabel} pad={pad}>
      <div className="flex h-full min-h-0 w-full flex-1 flex-col gap-1">
        {rowsOf.map((rowCells, row) => (
          <div key={row} className="flex min-h-0 flex-1 gap-1">
            {rowCells.map((cell, col) => {
              const i = row * cols + col;
              const bg = cellColor(cell, i, rules, colorOff);
              const fg = contrastText(bg);
              const display = cell === "" ? "—" : cell;
              if (writable) {
                return (
                  <input
                    key={i}
                    value={cell}
                    aria-label={`Cell ${i}`}
                    className="h-full min-h-0 min-w-0 flex-1 rounded-md border border-black/20 px-0.5 text-center font-mono outline-none"
                    style={{ background: bg, color: fg, containerType: "size", ...cellFont }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => {
                      const next = [...shown];
                      next[i] = e.target.value;
                      setDraft(next);
                    }}
                    onBlur={(e) => {
                      const next = [...shown];
                      next[i] = e.target.value;
                      commit(next, i);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                );
              }
              return (
                <div
                  key={i}
                  className="flex h-full min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-md px-0.5 text-center font-mono"
                  style={{ background: bg, color: fg, containerType: "size", ...cellFont }}
                >
                  {display}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Shell>
  );
}
