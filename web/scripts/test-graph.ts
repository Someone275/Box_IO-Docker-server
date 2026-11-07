import { addGraphSeries, appendLiveReading, coverGraphWindow, filledLiveWindow, formatGraphTime, formatGraphValue, graphWindow, holdLiveReading, liveSeriesReadings, niceValueTicks, normalizeGraphSeries, plotGraphSeries, shiftGraphAnchor, timeTicks, zoomGraphView } from "../src/lib/graph.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const series = normalizeGraphSeries(
  [
    { pin: 4, color: "#ff5d73", label: "Temp" },
    { pin: 4, color: "#000000", label: "dup" },
    { pin: 5, color: "blue", label: "" },
  ],
  1,
);
assert(series.length === 2 && series[0].label === "Temp" && series[1].label === "V5", "series keep unique pins and a fallback label");
let many = series;
for (let i = 0; i < 20; i++) many = addGraphSeries(many);
assert(many.length === 16, "a graph holds 16 pins");

const now = new Date(2026, 8, 27, 18, 0, 0);
const live = graphWindow({ mode: "live", liveSpan: "hour", date: "2026-09-27", time: "00:00", now });
assert(live.to - live.from === 3600, "live hour is 3600 seconds");
const day = graphWindow({ mode: "day", liveSpan: "hour", date: "2026-09-27", time: "14:30", now });
assert(day.to - day.from === 86400, "a day is 24 hours from the selected time");
assert(new Date(day.from * 1000).getHours() === 14 && new Date(day.from * 1000).getMinutes() === 30, "day view starts at the selected time");
const week = graphWindow({ mode: "week", liveSpan: "hour", date: "2026-09-27", time: "14:30", now });
assert(week.to - week.from === 7 * 86400, "a week is seven days");
assert(new Date(week.from * 1000).getDay() === 1, "the week starts on Monday");
const month = graphWindow({ mode: "month", liveSpan: "hour", date: "2026-09-27", time: "14:30", now });
assert(new Date(month.from * 1000).getDate() === 1, "the month starts on the first");
assert(new Date(month.to * 1000).getMonth() === 9, "the month ends at the next month");
const shifted = shiftGraphAnchor("2026-09-27", "14:30", "day", -1);
assert(shifted.date === "2026-09-26" && shifted.time === "14:30", "previous day keeps the time");
const nextMonth = shiftGraphAnchor("2026-09-27", "14:30", "month", 1);
assert(nextMonth.date === "2026-10-27", "next month moves the date");

const values = niceValueTicks(10, 90, 4);
assert(values.length >= 2 && values[0] >= 10 && values[values.length - 1] <= 90, `value ticks stay inside the data, got ${values.join(",")}`);
const hourTicks = timeTicks(0, 3_600_000, 4);
assert(hourTicks.length >= 2 && hourTicks.every((tick) => tick >= 0 && tick <= 3_600_000), "time ticks sit inside the hour");
assert(formatGraphValue(72) === "72", "whole values stay whole");
assert(formatGraphTime(Date.UTC(2026, 0, 1, 15, 30, 0), 3_600_000).includes(":"), "an hour window labels the clock");

const fromMs = 1_700_000_000_000;
const nowMs = fromMs + 3_600_000;
const livePoint = appendLiveReading([], "72", nowMs, fromMs, nowMs);
assert(livePoint.length === 1 && livePoint[0].v === 72 && livePoint[0].t === nowMs, "live mode draws the current reading when no bucket is stored yet");
const extended = appendLiveReading([{ t: fromMs + 60_000, v: 10 }], "72", nowMs, fromMs, nowMs);
assert(extended.length === 2 && extended[1].t === nowMs && extended[1].v === 72, "live mode keeps stored points and ends at the current reading");
assert(appendLiveReading([{ t: nowMs, v: 72 }], "72", nowMs, fromMs, nowMs).length === 1, "the same current reading is not drawn twice");
assert(appendLiveReading([], "hot", nowMs, fromMs, nowMs).length === 0, "text is not a graph point");

const plotted = plotGraphSeries(
  [{ pin: 4, label: "Temp", color: "#ff5d73", points: [{ t: fromMs + 60_000, v: 10 }] }],
  [
    { pin: 4, label: "Temp", color: "#ff5d73" },
    { pin: 5, label: "Hum", color: "#7aa2ff" },
  ],
  true,
  (pin) => (pin === 4 ? "11" : pin === 5 ? "40" : ""),
  nowMs,
  fromMs,
  nowMs,
);
assert(plotted.length === 2 && plotted[0].points.length === 2 && plotted[0].points[1].v === 11, "a stored series is extended to now");
assert(plotted[1].points.length === 1 && plotted[1].points[0].v === 40, "a pin with only a current value is still drawn");
const past = plotGraphSeries(
  [{ pin: 4, label: "Temp", color: "#ff5d73", points: [{ t: fromMs, v: 10 }] }],
  [{ pin: 4, label: "Temp", color: "#ff5d73" }],
  false,
  () => "99",
  nowMs,
  fromMs,
  fromMs + 1000,
);
assert(past[0].points.length === 1 && past[0].points[0].v === 10, "day view stays on the stored points");

const listed = liveSeriesReadings([1, 2, 3, 4], (pin) => (pin === 1 ? "236,264,265,263" : pin === 2 ? "-0.5" : "0"));
assert(listed.fromList && listed.readings.join(",") === "236,264,265,263", "a list on V1 is the value of V1 through V4");
const listedPlot = plotGraphSeries(
  [
    { pin: 1, label: "V1", color: "#2ee0c5", points: [{ t: fromMs, v: 0 }] },
    { pin: 2, label: "V2", color: "#f5b942", points: [{ t: fromMs, v: -0.5 }] },
    { pin: 3, label: "V3", color: "#ff5d73", points: [{ t: fromMs, v: 3 }] },
    { pin: 4, label: "V4", color: "#7aa2ff", points: [{ t: fromMs, v: 0 }] },
  ],
  [
    { pin: 1, label: "V1", color: "#2ee0c5" },
    { pin: 2, label: "V2", color: "#f5b942" },
    { pin: 3, label: "V3", color: "#ff5d73" },
    { pin: 4, label: "V4", color: "#7aa2ff" },
  ],
  true,
  (pin) => (pin === 1 ? "236,264,265,263" : "0"),
  nowMs,
  fromMs,
  nowMs,
);
assert(
  listedPlot.every((item) => item.points.length === 2 && item.points[0].v === item.points[1].v),
  "a list draws a line at the current number",
);
assert(
  listedPlot.map((item) => item.points[0].v).join(",") === "236,264,265,263",
  "the live graph follows the list instead of the old samples",
);
const held = holdLiveReading("264", nowMs, fromMs, nowMs);
assert(held.length === 2 && held[0].v === 264 && held[1].t === nowMs, "the held line spans the live window");

const zoomed = zoomGraphView({ from: 0, to: 3_600_000, min: 0, max: 100 }, 0.5, 0.5);
assert(zoomed && zoomed.to - zoomed.from === 1_800_000 && zoomed.min === 25 && zoomed.max === 75, "a click in the middle zooms to half the window");
const edge = zoomGraphView({ from: 0, to: 10_000, min: 0, max: 10 }, 0, 0);
assert(edge && edge.from === 0 && edge.to === 5_000 && edge.max === 10 && edge.min === 5, "a click in the corner stays inside the window");
assert(zoomGraphView({ from: 0, to: 3_000, min: 0, max: 1 }, 0.5, 0.5) === null, "a two-second window does not zoom further");
const again = zoomed && zoomGraphView(zoomed, 0.25, 0.75);
assert(again && again.to - again.from === 900_000, "another click zooms the current window");

const minutePoints = [
  { t: 0, v: 10 },
  { t: 50_000, v: 12 },
];
const openMinute = filledLiveWindow(0, 60_000, minutePoints);
assert(openMinute.from === 0 && openMinute.to === 60_000, "a minute that already has readings keeps the full minute");
const drawnMinute = coverGraphWindow(minutePoints, openMinute.from, openMinute.to, 60_000);
assert(drawnMinute[0].t === 0 && drawnMinute[drawnMinute.length - 1].t === 60_000, "the minute line touches both edges");
const slid = filledLiveWindow(61_000, 121_000, minutePoints);
assert(slid.from === 61_000 && slid.to === 121_000, "when the minute line reaches the left the window slides");
const slidLine = coverGraphWindow(minutePoints, slid.from, slid.to, 121_000);
assert(slidLine[0].t === 61_000 && slidLine[0].v === 12, "the value still in effect stays on the left edge");
assert(slidLine[slidLine.length - 1].t === 121_000 && slidLine[slidLine.length - 1].v === 12, "the minute line does not jump back to the right");
const stepped = coverGraphWindow(
  [
    { t: 0, v: 10 },
    { t: 90_000, v: 14 },
  ],
  61_000,
  121_000,
  121_000,
);
assert(stepped[0].t === 61_000 && stepped[0].v === 10, "the older minute reading is held at the left");
assert(stepped.some((point) => point.t === 90_000 && point.v === 14), "the new minute reading stays where it happened");
assert(stepped[stepped.length - 1].t === 121_000, "the new reading is held to the right edge");

const weekTo = 7 * 86400 * 1000;
const partialWeek = filledLiveWindow(0, weekTo, [
  { t: 5 * 86400 * 1000, v: 237 },
  { t: weekTo, v: 238 },
]);
assert(partialWeek.from === 5 * 86400 * 1000, "a week with a later first reading starts at that reading");
const partialLine = coverGraphWindow(
  [
    { t: 5 * 86400 * 1000, v: 237 },
    { t: weekTo, v: 238 },
  ],
  partialWeek.from,
  partialWeek.to,
  weekTo,
);
assert(partialLine[0].t === partialWeek.from && partialLine[partialLine.length - 1].t === partialWeek.to, "the shorter week history fills the chart");
const monthTo = 31 * 86400 * 1000;
const partialMonth = filledLiveWindow(0, monthTo, [{ t: 20 * 86400 * 1000, v: 68 }]);
assert(partialMonth.from === 20 * 86400 * 1000, "a month starts at the first stored reading");
const heldWeek = filledLiveWindow(0, weekTo, [
  { t: 0, v: 200 },
  { t: 5 * 86400 * 1000, v: 237 },
]);
assert(heldWeek.from === 0, "a reading already in effect keeps the full week");
const heldLine = coverGraphWindow(
  [
    { t: 0, v: 200 },
    { t: 5 * 86400 * 1000, v: 237 },
  ],
  heldWeek.from,
  heldWeek.to,
  weekTo,
);
assert(heldLine[0].t === 0 && heldLine[0].v === 200 && heldLine[heldLine.length - 1].t === weekTo, "the week line runs from the left edge to now");
const fresh = filledLiveWindow(0, 60_000, [{ t: 60_000, v: 5 }]);
assert(fresh.to - fresh.from === 1000, "a single new reading still has a visible span");

console.log("graph window ok");
