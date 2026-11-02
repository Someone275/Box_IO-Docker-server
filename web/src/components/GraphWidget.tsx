import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { api } from "@/lib/api";
import {
  dateInputValue,
  formatGraphTime,
  formatGraphValue,
  graphWindow,
  LIVE_SPANS,
  niceValueTicks,
  normalizeGraphSeries,
  normalizeLiveSpan,
  normalizeSampleEvery,
  paddedValueRange,
  plotGraphSeries,
  retentionText,
  shiftGraphAnchor,
  timeTicks,
  zoomGraphView,
  type GraphMode,
  type GraphPoint,
  type GraphZoom,
  type LiveSpan,
} from "@/lib/graph";
import type { BoardWidget, WidgetProps } from "@/lib/types";
import { pinKey } from "@/lib/layout";

function readingFor(values: Record<string, string>, deviceKeyId: number | null, pin: number): string | undefined {
  const key = pinKey(deviceKeyId, pin);
  if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
  const suffix = `:${pin}`;
  const matches = Object.entries(values).filter(([name, value]) => name.endsWith(suffix) && value !== "");
  return matches.length === 1 ? matches[0][1] : undefined;
}

interface GraphResponse {
  from: number;
  to: number;
  series: { pin: number; label: string; color: string; points: GraphPoint[] }[];
}

export function GraphWidget({
  projectId,
  widget,
  deviceKeyId,
  values,
  editing,
  fontSize,
  onPatchProps,
}: {
  projectId?: string;
  widget: BoardWidget;
  deviceKeyId: number | null;
  values: Record<string, string>;
  editing?: boolean;
  fontSize?: number;
  onPatchProps?: (patch: WidgetProps) => void;
}) {
  const series = useMemo(
    () => normalizeGraphSeries(widget.props.graphSeries, widget.pin),
    [widget.props.graphSeries, widget.pin],
  );
  const sampleEvery = normalizeSampleEvery(widget.props.sampleEvery);
  const liveSpan = normalizeLiveSpan(widget.props.liveSpan);
  const [mode, setMode] = useState<GraphMode>("live");
  const [date, setDate] = useState(() => dateInputValue(new Date()));
  const [time, setTime] = useState("00:00");
  const [zoom, setZoom] = useState<GraphZoom | null>(null);
  const [data, setData] = useState<GraphResponse | null>(null);
  const [error, setError] = useState("");
  const seriesKey = series.map((item) => `${item.pin}:${item.color}:${item.label}`).join("|");
  const windowKey = `${mode}|${liveSpan}|${date}|${time}`;
  const [zoomKey, setZoomKey] = useState(windowKey);
  if (zoomKey !== windowKey) {
    setZoomKey(windowKey);
    setZoom(null);
  }
  const textPx = fontSize && fontSize > 0 ? fontSize : undefined;
  const controlHeight = textPx ? Math.max(28, Math.round(textPx + 12)) : undefined;

  useEffect(() => {
    if (!projectId) return;
    let stop = false;
    const load = () => {
      const span = graphWindow({ mode, liveSpan, date, time });
      const query = new URLSearchParams({
        widget: widget.id,
        from: String(zoom ? zoom.from / 1000 : span.from),
        to: String(zoom ? zoom.to / 1000 : span.to),
      });
      api
        .get<GraphResponse>(`/api/projects/${projectId}/history?${query}`)
        .then((next) => {
          if (stop) return;
          setData(next);
          setError("");
        })
        .catch((err: unknown) => {
          if (stop) return;
          setError(err instanceof Error ? err.message : "Could not load the graph");
        });
    };
    load();
    if (mode !== "live") return () => {
      stop = true;
    };
    const timer = window.setInterval(load, 5000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [projectId, widget.id, mode, liveSpan, date, time, sampleEvery, seriesKey, zoom]);

  const span = graphWindow({ mode, liveSpan, date, time });
  const from = zoom ? zoom.from : (data?.from ?? span.from) * 1000;
  const to = zoom ? zoom.to : mode === "live" ? Math.max((data?.to ?? span.to) * 1000, Date.now()) : (data?.to ?? span.to) * 1000;
  const liveFollow = mode === "live" && (!zoom || zoom.to >= Date.now() - 2000);
  const plotted = plotGraphSeries(
    data?.series,
    series,
    liveFollow,
    (pin) => readingFor(values, deviceKeyId, pin),
    Date.now(),
    from,
    to,
  );
  const fullDomain = useMemo(() => valueDomain(plotted.flatMap((item) => item.points)), [plotted]);
  const domain = zoom ? { min: zoom.min, max: zoom.max } : fullDomain;

  function zoomAt(xFraction: number, yFraction: number) {
    if (editing || !domain) return;
    const next = zoomGraphView(zoom ?? { from, to, min: domain.min, max: domain.max }, xFraction, yFraction);
    if (next) setZoom(next);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div
        className="flex flex-wrap items-center gap-1"
        style={{ fontSize: textPx ?? 11, lineHeight: 1.2 }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {(["live", "day", "week", "month"] as GraphMode[]).map((item) => (
          <button
            key={item}
            type="button"
            className={`rounded-md px-2 py-0.5 ${mode === item ? "bg-accent text-bg" : "bg-panel-2 text-muted"}`}
            onClick={() => setMode(item)}
          >
            {item === "live" ? "Live" : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={widget.props.showTimeScale === true}
          className={`rounded-md px-2 py-0.5 ${widget.props.showTimeScale ? "bg-accent text-bg" : "bg-panel-2 text-muted"}`}
          onClick={() => onPatchProps?.({ showTimeScale: widget.props.showTimeScale !== true })}
        >
          Time scale
        </button>
        <button
          type="button"
          aria-pressed={widget.props.showDataScale === true}
          className={`rounded-md px-2 py-0.5 ${widget.props.showDataScale ? "bg-accent text-bg" : "bg-panel-2 text-muted"}`}
          onClick={() => onPatchProps?.({ showDataScale: widget.props.showDataScale !== true })}
        >
          Data scale
        </button>
        {zoom ? (
          <button type="button" className="rounded-md bg-panel-2 px-2 py-0.5 text-ink" onClick={() => setZoom(null)}>
            Reset zoom
          </button>
        ) : null}
        {mode === "live" ? (
          <select
            aria-label="Live view"
            className="rounded-md border border-line bg-bg px-1"
            style={{ height: controlHeight ?? 28 }}
            value={liveSpan}
            onChange={(event) => onPatchProps?.({ liveSpan: event.target.value as LiveSpan })}
          >
            {LIVE_SPANS.map((span) => (
              <option key={span.id} value={span.id}>
                {span.label}
              </option>
            ))}
          </select>
        ) : (
          <>
            <button type="button" className="rounded-md bg-panel-2 px-2 py-0.5 text-ink" onClick={() => {
              const next = shiftGraphAnchor(date, time, mode, -1);
              setDate(next.date);
              setTime(next.time);
            }}>
              Prev
            </button>
            <input aria-label="Graph date" type="date" className="rounded-md border border-line bg-bg px-1" style={{ height: controlHeight ?? 28 }} value={date} onChange={(event) => setDate(event.target.value)} />
            {mode === "day" ? (
              <input aria-label="Graph time" type="time" className="rounded-md border border-line bg-bg px-1" style={{ height: controlHeight ?? 28 }} value={time} onChange={(event) => setTime(event.target.value)} />
            ) : null}
            <button type="button" className="rounded-md bg-panel-2 px-2 py-0.5 text-ink" onClick={() => {
              const next = shiftGraphAnchor(date, time, mode, 1);
              setDate(next.date);
              setTime(next.time);
            }}>
              Next
            </button>
          </>
        )}
      </div>
      <GraphPlot
        series={plotted}
        from={from}
        to={to}
        domain={domain}
        fontSize={textPx ?? 10}
        showTimeScale={widget.props.showTimeScale === true}
        showDataScale={widget.props.showDataScale === true}
        onZoom={editing ? undefined : zoomAt}
      />
      <div
        className="flex flex-wrap gap-x-2 text-muted"
        style={{ fontSize: textPx ?? 10, lineHeight: 1.2 }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {plotted.map((item) => {
          const latest = item.points[item.points.length - 1];
          return (
            <span key={item.pin} className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: item.color }} />
              {item.label}
              {latest ? ` ${formatGraphValue(latest.v)}` : ""}
            </span>
          );
        })}
        {editing ? <span>{retentionText(sampleEvery)}</span> : null}
      </div>
      {error ? <p className="text-danger" style={{ fontSize: textPx ?? 11, lineHeight: 1.2 }}>{error}</p> : null}
    </div>
  );
}

function GraphPlot({
  series,
  from,
  to,
  domain,
  fontSize,
  showTimeScale,
  showDataScale,
  onZoom,
}: {
  series: { color: string; points: GraphPoint[] }[];
  from: number;
  to: number;
  domain: { min: number; max: number } | null;
  fontSize: number;
  showTimeScale: boolean;
  showDataScale: boolean;
  onZoom?: (xFraction: number, yFraction: number) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const clipId = useId().replace(/:/g, "");
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(0, Math.round(rect.width));
      const h = Math.max(0, Math.round(rect.height));
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const points = series.flatMap((item) => item.points);
  const empty = !points.length || to <= from;
  return (
    <div ref={boxRef} className="relative min-h-0 w-full flex-1">
      {empty || !domain ? (
        <div className="absolute inset-0 flex items-center justify-center text-muted" style={{ fontSize, lineHeight: 1.2 }}>No stored readings in this window.</div>
      ) : size.w > 8 && size.h > 8 ? (
        <GraphSvg
          series={series}
          from={from}
          to={to}
          domain={domain}
          fontSize={fontSize}
          width={size.w}
          height={size.h}
          showTimeScale={showTimeScale}
          showDataScale={showDataScale}
          clipId={clipId}
          onZoom={onZoom}
        />
      ) : null}
    </div>
  );
}

function GraphSvg({
  series,
  from,
  to,
  domain,
  fontSize,
  width,
  height,
  showTimeScale,
  showDataScale,
  clipId,
  onZoom,
}: {
  series: { color: string; points: GraphPoint[] }[];
  from: number;
  to: number;
  domain: { min: number; max: number };
  fontSize: number;
  width: number;
  height: number;
  showTimeScale: boolean;
  showDataScale: boolean;
  clipId: string;
  onZoom?: (xFraction: number, yFraction: number) => void;
}) {
  const span = Math.max(1, to - from);
  const custom = fontSize !== 10;
  const left = showDataScale
    ? Math.min(width * 0.4, Math.max(custom ? fontSize * 4.6 : 32, Math.round(width * 0.18)))
    : 8;
  const right = 8;
  const top = 8;
  const bottom = showTimeScale ? (custom ? fontSize + 10 : 20) : 8;
  const plotW = Math.max(1, width - left - right);
  const plotH = Math.max(1, height - top - bottom);
  const xOf = (t: number) => left + ((t - from) / span) * plotW;
  const yOf = (v: number) => top + (1 - (v - domain.min) / (domain.max - domain.min)) * plotH;
  const valueTicks = showDataScale ? niceValueTicks(domain.min, domain.max, Math.max(2, Math.min(5, Math.floor(plotH / Math.max(28, fontSize * 2.4))))) : [];
  const stamps = showTimeScale ? timeTicks(from, to, Math.max(2, Math.min(6, Math.floor(plotW / Math.max(72, fontSize * 6))))) : [];

  function zoomFromEvent(event: ReactMouseEvent<SVGSVGElement>) {
    if (!onZoom) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const y = ((event.clientY - rect.top) / rect.height) * height;
    if (x < left || x > left + plotW || y < top || y > top + plotH) return;
    onZoom((x - left) / plotW, (y - top) / plotH);
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`absolute inset-0 h-full w-full ${onZoom ? "cursor-zoom-in" : ""}`}
      role="img"
      aria-label={onZoom ? "Graph. Click to zoom in." : "Graph"}
      onPointerDown={onZoom ? (event) => event.stopPropagation() : undefined}
      onClick={onZoom ? zoomFromEvent : undefined}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={left} y={top} width={plotW} height={plotH} />
        </clipPath>
      </defs>
      <line x1={left} y1={top + plotH} x2={left + plotW} y2={top + plotH} stroke="#243044" strokeWidth="1" />
      {valueTicks.map((tick) => {
        const y = yOf(tick);
        if (y < top - 1 || y > top + plotH + 1) return null;
        return (
          <g key={`v${tick}`}>
            <line x1={left} y1={y} x2={left + plotW} y2={y} stroke="#243044" strokeWidth="1" />
            <text x={4} y={y + fontSize * 0.35} fill="#8b9bb4" fontSize={fontSize} fontFamily="ui-monospace, monospace">
              {formatGraphValue(tick)}
            </text>
          </g>
        );
      })}
      <g clipPath={`url(#${clipId})`}>
        {series.map((item, index) => {
          if (!item.points.length) return null;
          const d = item.points
            .map((point, i) => `${i === 0 ? "M" : "L"} ${xOf(point.t).toFixed(2)} ${yOf(point.v).toFixed(2)}`)
            .join(" ");
          return (
            <g key={index}>
              <path d={d} fill="none" stroke={item.color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
              {item.points.length === 1 ? (
                <circle cx={xOf(item.points[0].t)} cy={yOf(item.points[0].v)} r="3" fill={item.color} />
              ) : null}
            </g>
          );
        })}
      </g>
      {stamps.map((stamp) => {
        const x = xOf(stamp);
        const anchor = x < left + 28 ? "start" : x > width - 28 ? "end" : "middle";
        return (
          <text key={stamp} x={x} y={height - 4} textAnchor={anchor} fill="#8b9bb4" fontSize={fontSize} fontFamily="ui-monospace, monospace">
            {formatGraphTime(stamp, span)}
          </text>
        );
      })}
    </svg>
  );
}

function valueDomain(points: GraphPoint[]): { min: number; max: number } | null {
  if (!points.length) return null;
  let low = points[0].v;
  let high = points[0].v;
  for (const point of points) {
    if (point.v < low) low = point.v;
    if (point.v > high) high = point.v;
  }
  return paddedValueRange(low, high);
}
