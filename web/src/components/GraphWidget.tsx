import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  retentionText,
  shiftGraphAnchor,
  timeTicks,
  type GraphMode,
  type LiveSpan,
} from "@/lib/graph";
import type { BoardWidget, WidgetProps } from "@/lib/types";
import { pinKey } from "@/lib/layout";

interface GraphPoint {
  t: number;
  v: number;
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
  onPatchProps,
}: {
  projectId?: string;
  widget: BoardWidget;
  deviceKeyId: number | null;
  values: Record<string, string>;
  editing?: boolean;
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
  const [data, setData] = useState<GraphResponse | null>(null);
  const [error, setError] = useState("");
  const latest = series.map((item) => values[pinKey(deviceKeyId, item.pin)] ?? "").join("|");

  useEffect(() => {
    if (!projectId) return;
    let stop = false;
    const load = () => {
      const window = graphWindow({ mode, liveSpan, date, time });
      const query = new URLSearchParams({
        widget: widget.id,
        from: String(window.from),
        to: String(window.to),
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
  }, [projectId, widget.id, mode, liveSpan, date, time, latest, sampleEvery, series.length]);

  const plotted = data?.series?.length ? data.series : series.map((item) => ({ ...item, points: [] as GraphPoint[] }));
  const from = (data?.from ?? graphWindow({ mode, liveSpan, date, time }).from) * 1000;
  const to = (data?.to ?? graphWindow({ mode, liveSpan, date, time }).to) * 1000;

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1" onPointerDown={(event) => event.stopPropagation()}>
        {(["live", "day", "week", "month"] as GraphMode[]).map((item) => (
          <button
            key={item}
            type="button"
            className={`rounded-md px-2 py-0.5 text-[11px] ${mode === item ? "bg-accent text-bg" : "bg-panel-2 text-muted"}`}
            onClick={() => setMode(item)}
          >
            {item === "live" ? "Live" : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={widget.props.showTimeScale === true}
          className={`rounded-md px-2 py-0.5 text-[11px] ${widget.props.showTimeScale ? "bg-accent text-bg" : "bg-panel-2 text-muted"}`}
          onClick={() => onPatchProps?.({ showTimeScale: widget.props.showTimeScale !== true })}
        >
          Time scale
        </button>
        <button
          type="button"
          aria-pressed={widget.props.showDataScale === true}
          className={`rounded-md px-2 py-0.5 text-[11px] ${widget.props.showDataScale ? "bg-accent text-bg" : "bg-panel-2 text-muted"}`}
          onClick={() => onPatchProps?.({ showDataScale: widget.props.showDataScale !== true })}
        >
          Data scale
        </button>
        {mode === "live" ? (
          <select
            aria-label="Live view"
            className="h-7 rounded-md border border-line bg-bg px-1 text-[11px]"
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
            <button type="button" className="rounded-md bg-panel-2 px-2 py-0.5 text-[11px] text-ink" onClick={() => {
              const next = shiftGraphAnchor(date, time, mode, -1);
              setDate(next.date);
              setTime(next.time);
            }}>
              Prev
            </button>
            <input aria-label="Graph date" type="date" className="h-7 rounded-md border border-line bg-bg px-1 text-[11px]" value={date} onChange={(event) => setDate(event.target.value)} />
            {mode === "day" ? (
              <input aria-label="Graph time" type="time" className="h-7 rounded-md border border-line bg-bg px-1 text-[11px]" value={time} onChange={(event) => setTime(event.target.value)} />
            ) : null}
            <button type="button" className="rounded-md bg-panel-2 px-2 py-0.5 text-[11px] text-ink" onClick={() => {
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
        showTimeScale={widget.props.showTimeScale === true}
        showDataScale={widget.props.showDataScale === true}
      />
      <div className="flex flex-wrap gap-x-2 text-[10px] text-muted" onPointerDown={(event) => event.stopPropagation()}>
        {series.map((item) => (
          <span key={item.pin} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
        {editing ? <span>{retentionText(sampleEvery)}</span> : null}
      </div>
      {error ? <p className="text-[11px] text-danger">{error}</p> : null}
    </div>
  );
}

function GraphPlot({
  series,
  from,
  to,
  showTimeScale,
  showDataScale,
}: {
  series: { color: string; points: GraphPoint[] }[];
  from: number;
  to: number;
  showTimeScale: boolean;
  showDataScale: boolean;
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
      {empty ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">No stored readings in this window.</div>
      ) : size.w > 8 && size.h > 8 ? (
        <GraphSvg
          series={series}
          from={from}
          to={to}
          width={size.w}
          height={size.h}
          showTimeScale={showTimeScale}
          showDataScale={showDataScale}
          clipId={clipId}
        />
      ) : null}
    </div>
  );
}

function GraphSvg({
  series,
  from,
  to,
  width,
  height,
  showTimeScale,
  showDataScale,
  clipId,
}: {
  series: { color: string; points: GraphPoint[] }[];
  from: number;
  to: number;
  width: number;
  height: number;
  showTimeScale: boolean;
  showDataScale: boolean;
  clipId: string;
}) {
  const points = series.flatMap((item) => item.points);
  let low = points[0].v;
  let high = points[0].v;
  for (const point of points) {
    if (point.v < low) low = point.v;
    if (point.v > high) high = point.v;
  }
  const domain = paddedValueRange(low, high);
  const span = Math.max(1, to - from);
  const left = showDataScale ? Math.min(52, Math.max(32, Math.round(width * 0.18))) : 8;
  const right = 8;
  const top = 8;
  const bottom = showTimeScale ? 20 : 8;
  const plotW = Math.max(1, width - left - right);
  const plotH = Math.max(1, height - top - bottom);
  const xOf = (t: number) => left + ((t - from) / span) * plotW;
  const yOf = (v: number) => top + (1 - (v - domain.min) / (domain.max - domain.min)) * plotH;
  const valueTicks = showDataScale ? niceValueTicks(domain.min, domain.max, Math.max(2, Math.min(5, Math.floor(plotH / 28)))) : [];
  const stamps = showTimeScale ? timeTicks(from, to, Math.max(2, Math.min(6, Math.floor(plotW / 72)))) : [];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" role="img" aria-label="Graph">
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
            <text x={4} y={y + 3} fill="#8b9bb4" fontSize="10" fontFamily="ui-monospace, monospace">
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
          <text key={stamp} x={x} y={height - 4} textAnchor={anchor} fill="#8b9bb4" fontSize="10" fontFamily="ui-monospace, monospace">
            {formatGraphTime(stamp, span)}
          </text>
        );
      })}
    </svg>
  );
}
