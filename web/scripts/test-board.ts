import { buttonIsOn, buttonValues } from "../src/lib/utils.ts";
import { grabOffsetCells, snapEdge } from "../src/lib/gridSnap.ts";
import { parseLayout, serializeLayout } from "../src/lib/layout.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const values = buttonValues({ sendValue: "1" });
assert(values.onValue === "1" && values.offValue === "0", "legacy sendValue is the on value");
assert(buttonIsOn("1", "1", "0") === true, "matching on value");
assert(buttonIsOn("0", "1", "0") === false, "matching off value");
assert(buttonIsOn("START", "START", "STOP") === true, "custom on text");
assert(buttonIsOn("", "1", "0") === false, "empty pin is off");
assert(buttonValues({ onValue: "RUN", offValue: "HALT" }).onValue === "RUN", "explicit on value");

const cell = 40;
const edge = 3;
const down = 130;
const grab = grabOffsetCells(down, 0, cell, edge);
assert(Math.abs(grab - 0.25) < 1e-9, `grab offset ${grab}`);
let prev = snapEdge(down, 0, cell, grab);
assert(prev === edge, `pointer down should stay on ${edge}, got ${prev}`);
for (let px = down; px <= down + cell * 8; px++) {
  const next = snapEdge(px, 0, cell, grab);
  assert(Math.abs(next - prev) <= 1, `snap skipped from ${prev} to ${next} at ${px}px`);
  prev = next;
}
assert(snapEdge(down + cell, 0, cell, grab) === edge + 1, "one cell of movement moves one cell");
assert(snapEdge(down + cell * 4, 0, cell, grab) === edge + 4, "four cells of movement move four cells");

const legacy = parseLayout(JSON.stringify({ widgets: [{ id: "a", type: "led", pin: 1, x: 0, y: 0, w: 2, h: 2, props: { label: "LED" } }] }));
assert(legacy.pages.length === 1 && legacy.pages[0].widgets.length === 1, "legacy widgets become one page");
assert(legacy.snap === 64 && legacy.columns === 12, "default snap and columns");

const multi = parseLayout(
  JSON.stringify({
    snap: 32,
    columns: 8,
    rows: 6,
    activePageId: "p2",
    pages: [
      { id: "p1", name: "One", widgets: [] },
      {
        id: "p2",
        name: "Two",
        widgets: [{ id: "b", type: "label", pin: 0, x: 1, y: 1, w: 3, h: 1, deviceKeyId: 9, props: { text: "Hi", detached: false } }],
      },
    ],
  }),
);
assert(multi.activePageId === "p2", "active page kept");
assert(multi.pages[1].widgets[0].deviceKeyId === 9, "device key kept");
assert(multi.pages[1].widgets[0].type === "label", "label widget kept");
const saved = serializeLayout(multi);
assert(Array.isArray(saved.pages) && saved.pages.length === 2, "serialize keeps pages");
assert(Array.isArray(saved.widgets), "serialize keeps a widgets mirror");

const bad = parseLayout("{");
assert(bad.pages.length === 1 && bad.pages[0].widgets.length === 0, "invalid json falls back");

console.log("board helpers ok");
