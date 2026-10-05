import {
  cellColor,
  gridConfig,
  gridDisplayCells,
  parseColorRules,
  parseColorRulesCompact,
  parseGridValues,
} from "../src/lib/utils.ts";
import type { ColorRule } from "../src/lib/types.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const csv = parseGridValues("21,22, 25,30");
assert(csv.join("|") === "21|22|25|30", `CSV parse failed: ${csv.join("|")}`);

const json = parseGridValues("[1, 2, 3]");
assert(json.join("|") === "1|2|3", `JSON parse failed: ${json.join("|")}`);

const scalar = gridDisplayCells(4, 72, false);
assert(scalar.join("|") === "72|||", `scalar should fill the first cell, got ${scalar.join("|")}`);
const pins = gridDisplayCells(2, "ignored", true, (index) => (index === 0 ? "72" : "40"));
assert(pins.join("|") === "72|40", `pin per cell should read V2 and V3, got ${pins.join("|")}`);
const csvCells = gridDisplayCells(4, "21,22,40,18", false);
assert(csvCells.join("|") === "21|22|40|18", "csv still fills every cell");

const rules = parseColorRulesCompact("0-25:#2ee0c5:all;35-100:#ff5d73:0,1");
assert(rules.length === 2, `expected 2 rules, got ${rules.length}`);
assert(rules[0].cells === "all", "first rule should be all cells");
assert(Array.isArray(rules[1].cells) && rules[1].cells.join(",") === "0,1", "second rule cells");

const layout: ColorRule[] = [{ low: 0, high: 10, color: "#111111", cells: "all" }];
const merged = parseColorRules(layout, "0-5:#abcdef:all");
assert(merged[0].color === "#abcdef", "device colorRules should override layout");
assert(parseColorRules(layout, "")[0].color === "#111111", "empty compact should keep layout");

assert(cellColor("20", 0, rules, "#314057") === "#2ee0c5", "all-cells low range");
assert(cellColor("40", 0, rules, "#314057") === "#ff5d73", "specific cell 0 high range");
assert(cellColor("40", 2, rules, "#314057") === "#314057", "unmatched specific cell uses colorOff");

const cfg = gridConfig({ rows: 2, cols: 3, mode: "readonly" }, { rows: "4", mode: "readwrite" });
assert(cfg.rows === 4 && cfg.cols === 3 && cfg.mode === "readonly", "live size overrides; layout mode wins");

console.log("grid helpers ok");
