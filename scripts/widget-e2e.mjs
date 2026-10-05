#!/usr/bin/env node
/**
 * Widget lab e2e: every dashboard widget type, firmware setProperty, and
 * dashboard → device writes.
 *
 * Local (default):
 *   npm --prefix server run test:widgets
 *
 * Against a live server (do not put the password in git or chat):
 *   BOXIO_URL=http://localhost \
 *   BOXIO_DEVICE_URL=http://localhost:5923 \
 *   BOXIO_USER=... BOXIO_PASSWORD=... \
 *   npm --prefix server run test:widgets
 *
 * Optional:
 *   BOXIO_KEEP=1          leave the lab project/key for dashboard inspection
 *   BOXIO_WAIT_DEVICE=1   after creating a key, wait for a real ESP32 ping
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(here, "..");
const fixture = JSON.parse(await readFile(join(here, "widget-lab-layout.json"), "utf8"));

const failures = [];
let passed = 0;

function check(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
    return;
  }
  failures.push({ name, detail });
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

function equal(a, b) {
  return String(a ?? "") === String(b ?? "");
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

async function waitFor(fn, timeoutMs = 15000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw last instanceof Error ? last : new Error("timed out");
}

async function jsonFetch(url, { method = "GET", headers = {}, body, timeoutMs = 12000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `${res.status} ${res.statusText} ${url}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

function labLayout() {
  const widgets = [
    { id: "lab-led", type: "led", pin: 0, x: 0, y: 0, w: 2, h: 2, props: { label: "Layout LED", colorOn: "#000000", colorOff: "#111111" } },
    { id: "lab-value", type: "value", pin: 1, x: 2, y: 0, w: 3, h: 2, props: { label: "Layout Value", color: "#111111" } },
    {
      id: "lab-circle",
      type: "circle_meter",
      pin: 2,
      x: 5,
      y: 0,
      w: 3,
      h: 3,
      props: {
        label: "Layout Circle",
        min: 0,
        max: 100,
        color: "#111111",
        colorMode: "percentage",
        colorStops: [{ at: 0, color: "#111111" }],
      },
    },
    {
      id: "lab-bar",
      type: "bar_meter",
      pin: 3,
      x: 8,
      y: 0,
      w: 2,
      h: 3,
      props: { label: "Layout Bar", min: 0, max: 100, color: "#111111", colorMode: "percentage" },
    },
    { id: "lab-input", type: "input", pin: 4, x: 0, y: 3, w: 4, h: 2, props: { label: "Layout Input", colorOn: "#111111", colorOff: "#000000" } },
    {
      id: "lab-grid",
      type: "grid",
      pin: 5,
      x: 4,
      y: 3,
      w: 4,
      h: 4,
      props: {
        label: "Layout Grid",
        rows: 4,
        cols: 4,
        mode: "readwrite",
        colorOff: "#000000",
        colorRules: [{ low: 0, high: 1, color: "#111111", cells: "all" }],
      },
    },
    { id: "lab-round", type: "button_round", pin: 6, x: 8, y: 3, w: 2, h: 2, props: { label: "Layout Go", sendValue: "layout-go", colorOn: "#111111" } },
    { id: "lab-oval", type: "button_oval", pin: 7, x: 0, y: 7, w: 3, h: 2, props: { label: "Layout Stop", sendValue: "layout-stop", colorOn: "#111111" } },
    { id: "lab-sh", type: "slider_h", pin: 8, x: 3, y: 7, w: 4, h: 2, props: { label: "Layout H", min: 0, max: 100, color: "#111111" } },
    { id: "lab-sv", type: "slider_v", pin: 9, x: 7, y: 7, w: 2, h: 4, props: { label: "Layout V", min: 0, max: 100, color: "#111111" } },
  ];
  return { widgets };
}

function tsxBin() {
  const local = join(serverRoot, "node_modules", ".bin", "tsx");
  if (!existsSync(local)) throw new Error("tsx is not installed (npm install in server/)");
  return local;
}

function stopChild(child) {
  if (!child?.pid || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
      setTimeout(finish, 250);
    }, 1500);
    child.once("exit", finish);
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        finish();
      }
    }
  });
}

async function startLocalServer() {
  const dataDir = await mkdtemp(join(tmpdir(), "boxio-widget-e2e-"));
  const webPort = await freePort();
  const devicePort = await freePort();
  const child = spawn(tsxBin(), ["src/index.ts"], {
    cwd: serverRoot,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      WEB_PORT: String(webPort),
      DEVICE_PORT: String(devicePort),
      JWT_SECRET: "widget-e2e-secret",
      BOXIO_LICENSE_DEV: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let log = "";
  child.stdout.on("data", (c) => {
    log += c.toString();
  });
  child.stderr.on("data", (c) => {
    log += c.toString();
  });
  const apiUrl = `http://127.0.0.1:${webPort}`;
  const deviceUrl = `http://127.0.0.1:${devicePort}`;
  try {
    await waitFor(async () => {
      const h = await jsonFetch(`${apiUrl}/api/health`);
      return h.ok ? h : null;
    }, 20000);
  } catch (err) {
    await stopChild(child);
    throw new Error(`local server failed to start: ${err.message}\n${log}`);
  }
  return { child, dataDir, apiUrl, deviceUrl, local: true };
}

async function runSuite({ apiUrl, deviceUrl, token, key, projectId, keep }) {
  const auth = { Authorization: `Bearer ${token}` };
  const hw = { "X-BoxIO-Key": key };

  console.log("\n[device hub]");
  const ping = await jsonFetch(`${deviceUrl}/hw/ping`, { headers: hw });
  check("device ping", ping.ok === true, JSON.stringify(ping));

  console.log("\n[firmware virtualWrite + setProperty]");
  for (const [pin, spec] of Object.entries(fixture.firmware)) {
    if (spec.value !== undefined) {
      const vw = await jsonFetch(
        `${deviceUrl}/hw/vw?pin=${pin}&value=${encodeURIComponent(spec.value)}`,
        { headers: hw },
      );
      check(`V${pin} virtualWrite ${spec.value}`, vw.ok && equal(vw.value, spec.value), JSON.stringify(vw));
    }
    for (const [prop, value] of Object.entries(spec.properties || {})) {
      const pr = await jsonFetch(
        `${deviceUrl}/hw/property?pin=${pin}&prop=${encodeURIComponent(prop)}&value=${encodeURIComponent(value)}`,
        { headers: hw },
      );
      check(`V${pin} setProperty ${prop}=${value}`, pr.ok && equal(pr.value, value), JSON.stringify(pr));
    }
  }

  console.log("\n[dashboard pin snapshot]");
  const snap = await jsonFetch(`${apiUrl}/api/projects/${projectId}/pins`, { headers: auth });
  const values = Object.fromEntries((snap.pins || []).map((r) => [String(r.pin), String(r.value)]));
  const props = {};
  for (const row of snap.properties || []) {
    props[row.pin] ??= {};
    props[row.pin][row.prop] = String(row.value);
  }

  for (const [pin, spec] of Object.entries(fixture.firmware)) {
    if (spec.value !== undefined) {
      check(`V${pin} stored value`, equal(values[pin], spec.value), `got ${values[pin]}`);
    }
    for (const [prop, value] of Object.entries(spec.properties || {})) {
      check(`V${pin} stored ${prop}`, equal(props[pin]?.[prop], value), `got ${props[pin]?.[prop]}`);
    }
  }

  const sync = await jsonFetch(`${deviceUrl}/hw/sync`, { headers: hw });
  check("device sync includes firmware pins", Array.isArray(sync.values) && sync.values.length >= 4);

  console.log("\n[dashboard writes → device pull]");
  for (const write of fixture.dashboardWrites) {
    const res = await jsonFetch(`${apiUrl}/api/projects/${projectId}/pins/${write.pin}`, {
      method: "PUT",
      headers: auth,
      body: { value: write.value },
    });
    check(`dashboard write V${write.pin}=${write.value}`, res.ok === true, JSON.stringify(res));
  }

  const after = await jsonFetch(`${apiUrl}/api/projects/${projectId}/pins`, { headers: auth });
  const afterValues = Object.fromEntries((after.pins || []).map((r) => [String(r.pin), String(r.value)]));
  for (const write of fixture.dashboardWrites) {
    check(`stored dashboard V${write.pin}`, equal(afterValues[String(write.pin)], write.value), `got ${afterValues[String(write.pin)]}`);
  }

  const pulled = await jsonFetch(`${deviceUrl}/hw/pull`, { headers: hw });
  const commands = pulled.commands || [];
  const byPin = Object.fromEntries(commands.map((c) => [String(c.pin), String(c.value)]));
  check(`device received ${fixture.dashboardWrites.length} commands`, commands.length >= fixture.dashboardWrites.length, `got ${commands.length}: ${JSON.stringify(commands)}`);
  for (const write of fixture.dashboardWrites) {
    check(`pull V${write.pin}`, equal(byPin[String(write.pin)], write.value), `got ${byPin[String(write.pin)]}`);
  }

  const empty = await jsonFetch(`${deviceUrl}/hw/pull`, { headers: hw });
  check("second pull is empty", Array.isArray(empty.commands) && empty.commands.length === 0, JSON.stringify(empty.commands));

  if (process.env.BOXIO_WAIT_DEVICE === "1") {
    console.log("\n[waiting for a real ESP32 to ping this key]");
    console.log(`  BOXIO_AUTH=${key}`);
    console.log("  Flash samples/widget-lab/widget-lab.ino then wait…");
    const deadline = Date.now() + Number(process.env.BOXIO_WAIT_MS || 120000);
    let online = false;
    while (Date.now() < deadline) {
      const keys = await jsonFetch(`${apiUrl}/api/keys`, { headers: auth });
      const row = (keys.keys || []).find((k) => k.key === key);
      if (row?.online) {
        online = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    check("ESP32 came online", online);
  }

  return keep;
}

async function main() {
  const remoteUrl = process.env.BOXIO_URL;
  const remoteUser = process.env.BOXIO_USER;
  const remotePass = process.env.BOXIO_PASSWORD;
  const keep = process.env.BOXIO_KEEP === "1";
  let ctx;
  let token;
  let created = { keyId: null, projectId: null };

  if (remoteUrl && remoteUser && remotePass) {
    const apiUrl = remoteUrl.replace(/\/$/, "");
    const deviceUrl = (process.env.BOXIO_DEVICE_URL || `${apiUrl.replace(/^https:/, "http:")}:5923`).replace(/\/$/, "");
    console.log(`Remote API     ${apiUrl}`);
    console.log(`Remote device  ${deviceUrl}`);
    const login = await jsonFetch(`${apiUrl}/api/auth/login`, {
      method: "POST",
      body: { username: remoteUser, password: remotePass },
    });
    token = login.token;
    ctx = { apiUrl, deviceUrl, local: false };
  } else {
    if (remoteUrl && !remotePass) {
      console.log("BOXIO_URL is set but BOXIO_USER/BOXIO_PASSWORD are not; running against a local server instead.");
      console.log("Set those env vars (not chat) when you want the production account tested.");
    }
    ctx = await startLocalServer();
    console.log(`Local API      ${ctx.apiUrl}`);
    console.log(`Local device   ${ctx.deviceUrl}`);
    const setup = await jsonFetch(`${ctx.apiUrl}/api/auth/setup`, {
      method: "POST",
      body: { username: "labadmin", password: "labpass-e2e", agreed: true },
    });
    token = setup.token;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const keyName = `widget-lab ${stamp}`;
  const projectName = `Widget lab ${stamp}`;
  try {
    const createdKey = await jsonFetch(`${ctx.apiUrl}/api/keys`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: { name: keyName },
    });
    created.keyId = createdKey.key.id;
    const deviceKey = createdKey.key.key;
    check("created device key", typeof deviceKey === "string" && deviceKey.startsWith("bx_"));

    const createdProject = await jsonFetch(`${ctx.apiUrl}/api/projects`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: { name: projectName, deviceKeyId: created.keyId },
    });
    created.projectId = createdProject.project.id;
    check("created project", Number.isInteger(created.projectId));

    await jsonFetch(`${ctx.apiUrl}/api/projects/${created.projectId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: { layout: labLayout(), deviceKeyId: created.keyId },
    });
    check("saved lab layout (10 widgets)", true);

    await runSuite({
      apiUrl: ctx.apiUrl,
      deviceUrl: ctx.deviceUrl,
      token,
      key: deviceKey,
      projectId: created.projectId,
      keep,
    });

    if (keep) {
      console.log(`\nKept lab project "${projectName}" (id ${created.projectId}).`);
      console.log(`Flash samples/widget-lab/widget-lab.ino with BOXIO_AUTH=${deviceKey}`);
    }
  } finally {
    if (!keep && token) {
      if (created.projectId) {
        await jsonFetch(`${ctx.apiUrl}/api/projects/${created.projectId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
      if (created.keyId) {
        await jsonFetch(`${ctx.apiUrl}/api/keys/${created.keyId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    }
    if (ctx?.child) await stopChild(ctx.child);
    if (ctx?.dataDir) await rm(ctx.dataDir, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(` - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
  }
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
