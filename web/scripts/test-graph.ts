import { addGraphSeries, formatGraphTime, formatGraphValue, graphWindow, niceValueTicks, normalizeGraphSeries, shiftGraphAnchor, timeTicks } from "../src/lib/graph.ts";

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

console.log("graph window ok");
