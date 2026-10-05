import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

delete process.env.BOXIO_LICENSE_DEV;
const dataDir = mkdtempSync(join(tmpdir(), "boxio-lic-"));
process.env.DATA_DIR = dataDir;

const here = dirname(fileURLToPath(import.meta.url));
const license = await import("../src/license.ts");
const { db } = await import("../src/db.ts");
const { mountPublicPins } = await import("../src/public-pin.ts");

let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  PASS  ${name}`);
    return;
  }
  failed += 1;
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

const instance = license.instanceId();
const raw = execFileSync("php", [join(here, "../../php-guide/scripts/test-license.php"), instance], {
  encoding: "utf8",
});
const sample = JSON.parse(raw) as {
  unbound: license.LicenseDocument;
  bound: license.LicenseDocument;
  expired: license.LicenseDocument;
  checkout: string;
  confirmation: string;
  returnProof?: string;
};

check("checkout code matches PHP", license.checkoutCode(sample.unbound.bindKey, instance) === sample.checkout);
check(
  "return proof matches PHP",
  sample.returnProof !== undefined && license.returnProof(sample.unbound.bindKey, instance) === sample.returnProof,
);
check("unbound signature verifies", license.documentIsCurrent(sample.unbound));
check("bound signature verifies", license.documentIsCurrent(sample.bound));
check("expired file is rejected", !license.documentIsCurrent(sample.expired));
check("no license hides data", license.licenseAllowsData() === false);

const pending = license.uploadLicenseFile(sample.unbound);
check("upload returns the checkout code", "checkoutCode" in pending && pending.checkoutCode === sample.checkout);
check("pending file still hides data", license.licenseAllowsData() === false);

let badConfirm = false;
try {
  license.confirmInstalledLicense("BXIN.not-a-real-code");
} catch {
  badConfirm = true;
}
check("wrong confirmation is refused", badConfirm && license.licenseAllowsData() === false);
check("edited license fails", !license.documentIsCurrent({ ...sample.unbound, holder: "someone-else" }));

db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run("lic", "x", "admin");
const userId = Number(
  (db.prepare("SELECT id FROM users WHERE username = ?").get("lic") as { id: number }).id,
);
db.prepare("INSERT INTO device_keys (user_id, name, key) VALUES (?, ?, ?)").run(
  userId,
  "board",
  "bx_0123456789abcdef0123456789abcdef",
);
const keyId = Number(
  (db.prepare("SELECT id FROM device_keys WHERE key = ?").get("bx_0123456789abcdef0123456789abcdef") as { id: number })
    .id,
);
db.prepare("INSERT INTO pin_values (device_key_id, pin, value) VALUES (?, ?, ?)").run(keyId, 0, "42");

const app = express();
mountPublicPins(app);
const server = createServer(app);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;

async function get(path: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const text = await res.text();
  return { status: res.status, text };
}

const blocked = await get("/public/bx_0123456789abcdef0123456789abcdef/V0");
check("unlicensed public pin hides the value", blocked.status === 403 && !blocked.text.includes("42"), blocked.text);

license.confirmInstalledLicense(sample.confirmation);
check("confirmation shows data", license.licenseAllowsData() === true);

const live = await get("/public/bx_0123456789abcdef0123456789abcdef/V0");
check("licensed public pin returns the value", live.status === 200 && live.text.includes('"value":"42"'), live.text);
const plain = await get("/public/bx_0123456789abcdef0123456789abcdef/V0.txt");
check("plain pin is the raw value", plain.status === 200 && plain.text === "42", plain.text);

license.uploadLicenseFile(sample.unbound);
const hiddenAgain = await get("/public/bx_0123456789abcdef0123456789abcdef/V0");
check("a new upload hides data until it is confirmed", hiddenAgain.status === 403 && !hiddenAgain.text.includes("42"), hiddenAgain.text);

writeFileSync(join(dataDir, "license-token"), "test-token");
let refreshMode = "unbound";
const refreshServer = createServer((req, res) => {
  if (refreshMode === "revoked") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, revoked: true }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, unbound: true }));
});
await new Promise<void>((resolve) => refreshServer.listen(0, "127.0.0.1", () => resolve()));
const refreshAddress = refreshServer.address();
const refreshPort = typeof refreshAddress === "object" && refreshAddress ? refreshAddress.port : 0;
process.env.BOXIO_LICENSE_URL = `http://127.0.0.1:${refreshPort}`;
await license.refreshLicenseFromServer();
check(
  "a check-in with no assignment keeps the uploaded license",
  license.licenseSummary().pendingCheckout.length > 0,
);
refreshMode = "revoked";
await license.refreshLicenseFromServer();
check(
  "a released server drops the local license",
  license.licenseSummary().pendingCheckout === "" && license.licenseAllowsData() === false,
);
refreshServer.close();

let expiredRejected = false;
try {
  license.uploadLicenseFile(sample.expired);
} catch {
  expiredRejected = true;
}
check("expired file is refused", expiredRejected);

server.close();

const { parsePublicPin } = await import("../src/public-pin.ts");
check("V12 parses", parsePublicPin("V12")?.pin === 12);
check("txt flag parses", parsePublicPin("v3.txt")?.plain === true);
check("pin 200 is rejected", parsePublicPin("V200") === null);

if (failed) {
  process.exit(1);
}
console.log("license tests passed");
