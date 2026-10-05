import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

delete process.env.BOXIO_LICENSE_DEV;
const dataDir = mkdtempSync(join(tmpdir(), "boxio-return-"));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = "boxio-return-test-secret";

const license = await import("../src/license.ts");
const { db } = await import("../src/db.ts");
const { signToken } = await import("../src/auth.ts");
const { mountLicenseRoutes } = await import("../src/license-api.ts");

let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  PASS  ${name}`);
    return;
  }
  failed += 1;
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

const bindKey = "ab".repeat(32);
const document = {
  v: 1,
  id: 7,
  kind: "year",
  holder: "ada",
  expiresAt: "2099-01-01T00:00:00Z",
  instanceId: "",
  bindKey,
  autoRenew: false,
  signature: "not-checked-here",
};

function storePending() {
  const local = license.instanceId();
  writeFileSync(
    join(dataDir, "license.json"),
    JSON.stringify({
      mode: "pending",
      document,
      checkoutCode: license.checkoutCode(bindKey, local),
    }),
  );
}

let mode = "released";
let seen: { licenseId?: number; instanceId?: string; proof?: string } = {};
const remote = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    if (req.url === "/api/license/return.php") {
      seen = JSON.parse(raw || "{}") as typeof seen;
      if (mode === "released") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, released: true }));
        return;
      }
      if (mode === "already") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, alreadyReleased: true }));
        return;
      }
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "This license is checked out to a different Docker server." }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
});
await new Promise<void>((resolve) => remote.listen(0, "127.0.0.1", () => resolve()));
const address = remote.address();
const port = typeof address === "object" && address ? address.port : 0;
process.env.BOXIO_LICENSE_URL = `http://127.0.0.1:${port}`;

storePending();
const local = license.instanceId();
await license.returnInstalledLicense();
check("a successful return removes the local license", license.licenseSummary().hasLicenseFile === false);
check("return sends this server and the license proof", seen.licenseId === 7 && seen.instanceId === local && seen.proof === license.returnProof(bindKey, local));

storePending();
mode = "conflict";
let kept = false;
try {
  await license.returnInstalledLicense();
} catch (err) {
  kept = err instanceof Error && err.message.includes("different Docker server");
}
check("a checkout on another server stays on this server", kept && license.licenseSummary().hasLicenseFile === true);

storePending();
mode = "already";
await license.returnInstalledLicense();
check("an already-clear checkout still removes the local file", license.licenseSummary().hasLicenseFile === false);

storePending();
process.env.BOXIO_LICENSE_URL = "http://127.0.0.1:9";
let offline = false;
try {
  await license.returnInstalledLicense();
} catch (err) {
  offline = err instanceof Error && err.message.includes("still locked");
}
check("an unreachable license site keeps the checkout", offline && license.licenseSummary().hasLicenseFile === true);
process.env.BOXIO_LICENSE_URL = `http://127.0.0.1:${port}`;

db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run("owner", "x", "admin");
db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run("builder", "x", "user");
const ownerId = Number((db.prepare("SELECT id FROM users WHERE username = ?").get("owner") as { id: number }).id);
const builderId = Number((db.prepare("SELECT id FROM users WHERE username = ?").get("builder") as { id: number }).id);

const app = express();
app.use(express.json());
const router = express.Router();
mountLicenseRoutes(router);
app.use("/api", router);
const api: Server = createServer(app);
await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", () => resolve()));
const apiAddress = api.address();
const apiPort = typeof apiAddress === "object" && apiAddress ? apiAddress.port : 0;

async function post(roleId: number, role: "admin" | "user") {
  const res = await fetch(`http://127.0.0.1:${apiPort}/api/license/return`, {
    method: "POST",
    headers: { authorization: `Bearer ${signToken({ id: roleId, username: role, role })}` },
  });
  const body = (await res.json()) as { error?: string; hasLicenseFile?: boolean };
  return { status: res.status, body };
}

mode = "released";
const builder = await post(builderId, "user");
check("a builder cannot return the license", builder.status === 403 && license.licenseSummary().hasLicenseFile === true, String(builder.status));

const admin = await post(ownerId, "admin");
check(
  "an admin return clears the local license",
  admin.status === 200 && admin.body.hasLicenseFile === false && license.licenseSummary().hasLicenseFile === false,
  JSON.stringify(admin.body),
);

remote.close();
api.close();
if (readFileSync(join(dataDir, "license.json"), "utf8") !== "") {
  check("returned license file is empty", false);
}

if (failed) process.exit(1);
console.log("license return tests passed");
