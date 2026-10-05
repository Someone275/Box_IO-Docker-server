import { activatePage, parseLayout, serializeLayout, updateActivePage } from "../src/lib/layout.ts";
import {
  applyCustomScreen,
  fitCustomScreen,
  matchingScreenTemplate,
  screenForNewPage,
  screenTemplates,
} from "../src/lib/screen.ts";
import { fillCss, lineWidth, listedWidgetLabel, normalizeBackground } from "../src/lib/utils.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const small = fitCustomScreen(360, 800);
assert(small.snap === 40 && small.columns === 9 && small.rows === 20, "360×800 is the small phone grid");
const mid = fitCustomScreen(500, 900);
assert(mid.snap === 25 && mid.columns === 20 && mid.rows === 36, "500×900 uses snap 25");
const phone = fitCustomScreen(390, 844);
assert(phone.snap === 32 && phone.columns === 12 && phone.rows === 26, "390×844 falls back to the phone grid");

const layout = parseLayout(JSON.stringify({
  snap: 64,
  columns: 12,
  rows: 10,
  activePageId: "page-1",
  pages: [
    {
      id: "page-1",
      name: "Page 1",
      widgets: [{ id: "a", type: "led", pin: 0, x: 10, y: 0, w: 4, h: 2, props: { label: "LED" } }],
    },
    {
      id: "page-2",
      name: "Page 2",
      snap: 32,
      columns: 26,
      rows: 12,
      widgets: [{ id: "b", type: "circle_meter", pin: 1, x: 10, y: 0, w: 4, h: 2, props: { label: "Circle meter" } }],
    },
  ],
}));
assert(layout.pages[0].snap === 64 && layout.pages[0].rows === 10, "a page without its own size inherits the layout");
assert(layout.snap === 64 && layout.columns === 12, "the open page supplies the layout size");
const next = screenForNewPage(layout.pages);
assert(next.name === "Phone", "a new page takes the first unused device size");
const narrowed = updateActivePage(layout, { columns: 8 });
assert(narrowed.columns === 8 && narrowed.pages[0].widgets[0].x === 4, "columns pull widgets on the open page");
assert(narrowed.pages[1].columns === 26 && narrowed.pages[1].widgets[0].x === 10, "another page keeps its columns");
const wide = activatePage(narrowed, "page-2");
assert(wide.snap === 32 && wide.columns === 26 && wide.rows === 12, "opening a page loads its screen");
assert(matchingScreenTemplate(wide)?.name === "Phone wide", "phone wide matches that page");
const custom = applyCustomScreen(wide, 500, 900);
assert(custom.snap === 25 && custom.pages[1].rows === 36, "custom size applies to the open page");
assert(custom.pages[0].snap === 64, "custom size leaves the other page");
const saved = serializeLayout(custom);
assert(saved.snap === 25 && saved.pages[1].snap === 25 && saved.pages[0].snap === 64, "saved json keeps each page size");
assert(screenTemplates.length === 6, "the device list matches the Flutter templates");
assert(listedWidgetLabel("circle_meter", "Circle meter") === "Circle meter", "caption uses the widget label");
assert(listedWidgetLabel("value", "  ") === "Value box", "blank label falls back to the widget name");
assert(listedWidgetLabel("led", undefined) === "LED", "missing label falls back to the widget name");

assert(fillCss(undefined, "#101827") === "#101827", "empty widget background stays the panel");
assert(fillCss("transparent", "#101827") === "transparent", "transparent is a fill");
assert(fillCss("#FF5D73", "#101827") === "#FF5D73", "hex background is kept");
assert(normalizeBackground("nope") === undefined, "unknown background is dropped");
const colored = parseLayout(JSON.stringify({
  pages: [{ id: "page-1", name: "Page 1", background: "transparent", widgets: [] }],
}));
assert(colored.pages[0].background === "transparent", "a page keeps a transparent background");
const savedColor = serializeLayout(colored);
assert(savedColor.pages[0].background === "transparent", "saved page keeps its background");

assert(lineWidth(undefined) === 8, "a line starts at 8 pixels");
assert(lineWidth(2.4) === 2, "line width rounds");
assert(lineWidth(0) === 1 && lineWidth(200) === 64, "line width stays between 1 and 64");
const withLine = parseLayout(JSON.stringify({
  pages: [{
    id: "page-1",
    name: "Page 1",
    widgets: [
      { id: "h", type: "line_h", pin: 0, x: 0, y: 0, w: 6, h: 1, props: { color: "#ff5d73", lineWidth: 12, background: "transparent" } },
      { id: "v", type: "line_v", pin: 0, x: 0, y: 1, w: 1, h: 6, props: { color: "#e8eef8", lineWidth: 4 } },
    ],
  }],
}));
assert(withLine.pages[0].widgets.length === 2, "horizontal and vertical lines stay on the page");
assert(withLine.pages[0].widgets[0].props.lineWidth === 12, "a line keeps its width");
assert(withLine.pages[0].widgets[0].props.color === "#ff5d73", "a line keeps its color");

console.log("screen helpers ok");
