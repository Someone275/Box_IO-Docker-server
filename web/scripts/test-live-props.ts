import { addColorDivision, buttonCaption, buttonFace, gaugeArcPath, gaugePoint, gaugeSweep, liveMeterOpts, liveNum, liveStr, MAX_COLOR_DIVISIONS, meterColor, parseColorStopsCompact, removeColorDivision, sliderBounds, sliderPercent } from "../src/lib/utils.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

assert(liveStr({ color: "#ff5d73" }, "color", "#000000") === "#ff5d73", "liveStr uses device value");
assert(liveStr({}, "color", "#000000") === "#000000", "liveStr falls back");
assert(liveStr({ color: "" }, "color", "#000000") === "#000000", "empty liveStr is ignored");
assert(buttonFace(true, { textOn: "Start" }, { label: "Pump" }) === "Start", "on text stays off the caption");
assert(buttonFace(false, { textOff: "Stop" }, { label: "Pump" }) === "Stop", "off text stays off the caption");
assert(buttonFace(true, {}, { label: "Go" }) === "On", "caption label is not the on face");
assert(buttonFace(false, {}, { label: "Stop" }) === "Off", "caption label is not the off face");
assert(buttonFace(true, { textOn: "Start" }, { textOn: "Go" }) === "Go", "sketch on text wins");
assert(buttonFace(false, { textOff: "Halt" }, { textOff: "Stop" }) === "Stop", "sketch off text wins");
assert(buttonFace(true, { textOn: "Start" }, {}) === "Start", "saved on text used when the sketch has not set one");
assert(buttonCaption({ label: "Pump" }, { label: "Go" }) === "Pump", "widget label stays when the pin has another name");
assert(buttonCaption({ label: "Gate" }, { label: "Stop" }) === "Gate", "oval caption stays the widget label");
assert(buttonCaption({ label: "Pump" }, {}) === "Pump", "saved label used when the sketch has not set one");
assert(buttonCaption({ label: "  Round button  " }, { label: "Round" }) === "Round button", "caption trims the widget label");

const h = sliderBounds({ min: 0, max: 100 }, { min: "5", max: "50" });
assert(h.min === 5 && h.max === 50, "slider uses device min and max");
const edited = sliderBounds({ min: 5, max: 80 }, { min: "5", max: "80" });
assert(edited.min === 5 && edited.max === 80, "edited slider range replaces the old one");
const v = sliderBounds({ min: 0, max: 100 }, { min: "-10", max: "10" });
assert(v.min === -10 && v.max === 10, "vertical slider keeps a negative min");
const swapped = sliderBounds({ min: 40, max: 10 }, {});
assert(swapped.min === 10 && swapped.max === 40, "inverted slider limits are ordered");
assert(sliderPercent(5, 5, 50) === 0, "slider start is the min");
assert(sliderPercent(50, 5, 50) === 100, "slider end is the max");
assert(sliderPercent(0, -10, 10) === 50, "zero sits halfway from -10 to 10");
assert(sliderPercent(100, 5, 50) === 100, "values above max stay at the end");
assert(sliderPercent(-40, -10, 10) === 0, "values below min stay at the start");
assert(liveNum({ min: "5" }, "min", 0) === 5, "liveNum parses");
assert(liveNum({ min: "nope" }, "min", 7) === 7, "liveNum invalid keeps fallback");

const stops = parseColorStopsCompact("0:#2ee0c5;60:#f5b942;85:#ff5d73");
assert(stops.length === 3, `expected 3 stops, got ${stops.length}`);
assert(stops[1].at === 60 && stops[1].color === "#f5b942", "middle stop");

const meter = liveMeterOpts(
  { min: 0, max: 100, color: "#111111", colorMode: "percentage", colorStops: [{ at: 0, color: "#111111" }] },
  { min: "10", max: "90", color: "#7aa2ff", colorMode: "values", colorStops: "0:#2ee0c5;100:#ff5d73" },
);
assert(meter.min === 10 && meter.max === 90, "live meter range");
assert(meter.color === "#7aa2ff", "live meter color");
assert(meter.colorMode === "values", "live colorMode");
assert(meter.colorStops?.length === 2 && meter.colorStops[1].color === "#ff5d73", "device colorStops win");
assert(liveMeterOpts({}, {}).startDeg === 225 && liveMeterOpts({}, {}).endDeg === 135, "default gauge is lower left to lower right");
const angles = liveMeterOpts({ startDeg: 10, endDeg: 20 }, { startDeg: "200", endDeg: "40" });
assert(angles.startDeg === 200 && angles.endDeg === 40, "sketch start and end win");
assert(gaugeSweep(225, 135) === 270, "default sweep is the long way around");
assert(gaugeSweep(0, 360) === 360, "0 to 360 is a full circle");
assert(gaugeSweep(90, 90) === 360, "equal angles are a full circle");
const top = gaugePoint(50, 50, 36, 0);
assert(Math.abs(top.x - 50) < 0.01 && Math.abs(top.y - 14) < 0.01, "0 degrees is the top");
const right = gaugePoint(50, 50, 36, 90);
assert(Math.abs(right.x - 86) < 0.01 && Math.abs(right.y - 50) < 0.01, "90 degrees is the right");
const left = gaugePoint(50, 50, 36, 225);
assert(left.x < 50 && left.y > 50, "225 degrees is the lower left");
const lowRight = gaugePoint(50, 50, 36, 135);
assert(lowRight.x > 50 && lowRight.y > 50, "135 degrees is the lower right");
assert(gaugeArcPath(50, 50, 36, 225, 270).includes("A 36 36 0 1 1"), "gauge arc sweeps clockwise the long way");

const { color, pct } = meterColor(72, {
  min: 0,
  max: 200,
  colorMode: "values",
  colorStops: [
    { at: 0, color: "#2ee0c5" },
    { at: 50, color: "#f5b942" },
    { at: 100, color: "#ff5d73" },
  ],
});
assert(color === "#f5b942", `value 72 should hit mid stop, got ${color}`);
assert(pct === 36, `72/200 should be 36%, got ${pct}`);

const oneColor = meterColor(10, { min: 0, max: 100, color: "#111111", colorStops: [{ at: 80, color: "#ff5d73" }] });
assert(oneColor.color === "#ff5d73", "one division fills the gauge");
let divisions = [{ at: 0, color: "#2ee0c5" }];
assert(removeColorDivision(divisions, 0).length === 1, "the last division stays");
divisions = addColorDivision(divisions);
assert(divisions.length === 2 && divisions[1].at === 10, "a new division starts 10 past the highest");
assert(divisions[1].color !== divisions[0].color, "a new division uses another color");
for (let i = divisions.length; i < MAX_COLOR_DIVISIONS + 3; i++) divisions = addColorDivision(divisions);
assert(divisions.length === MAX_COLOR_DIVISIONS, "fifteen divisions is the most");
const trimmed = removeColorDivision(divisions, 4);
assert(
  trimmed.length === 14 && trimmed.every((stop, i) => stop.color === divisions[i < 4 ? i : i + 1].color),
  "remove drops one division",
);

console.log("live property helpers ok");
