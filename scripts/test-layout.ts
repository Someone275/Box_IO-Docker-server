import { referencedDeviceKeyIds } from "../src/layout.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const ids = referencedDeviceKeyIds(
  JSON.stringify({
    pages: [
      { widgets: [{ deviceKeyId: 2 }, { pin: 1 }] },
      { widgets: [{ deviceKeyId: 5 }, { deviceKeyId: 2 }] },
    ],
  }),
  4,
);
assert(ids.join(",") === "4,2,5", `device ids ${ids.join(",")}`);

const legacy = referencedDeviceKeyIds(JSON.stringify({ widgets: [{ deviceKeyId: 3 }] }), null);
assert(legacy.join(",") === "3", `legacy ids ${legacy.join(",")}`);

console.log("server layout ok");
