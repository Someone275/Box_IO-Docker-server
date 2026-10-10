import express from "express";
import cors from "cors";
import { createServer, type Server } from "node:http";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { createDeviceRouter } from "./device.js";
import { createWebRouter } from "./webapi.js";
import { dataDir, sweepOfflineDevices } from "./db.js";
import { addClient } from "./broadcast.js";
import { readToken } from "./auth.js";
import { mountPublicPins } from "./public-pin.js";
import { refreshLicenseFromServer } from "./license.js";

const WEB_PORT = Number(process.env.WEB_PORT || 3847);
const DEVICE_PORT = Number(process.env.DEVICE_PORT || 5923);
const webDir = join(process.cwd(), "web", "dist");

const deviceApp = express();
deviceApp.disable("x-powered-by");
deviceApp.use(express.json({ limit: "32kb" }));
deviceApp.use(express.urlencoded({ extended: true, limit: "32kb" }));
deviceApp.get("/", (_req, res) => {
  res.json({
    service: "Box IO device hub",
    port: DEVICE_PORT,
    protocol: "http",
    paths: ["/hw/ping", "/hw/vw", "/hw/vr", "/hw/pull", "/hw/watchdog", "/hw/property", "/hw/email", "/hw/sms"],
  });
});
deviceApp.get("/health", (_req, res) => res.json({ ok: true, role: "device" }));
deviceApp.use("/hw", createDeviceRouter());

const webApp = express();
webApp.disable("x-powered-by");
webApp.use(cors({ origin: true, credentials: true }));
webApp.use(express.json({ limit: "1mb" }));
webApp.use("/api", createWebRouter());
webApp.use("/hw", createDeviceRouter());
mountPublicPins(webApp);

webApp.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.path.startsWith("/api") && !req.path.includes("/api/")) {
    next(error);
    return;
  }
  const message = error instanceof Error && error.message ? error.message : "Request failed";
  if (!res.headersSent) res.status(500).json({ error: message });
});

if (existsSync(webDir)) {
  webApp.use(express.static(webDir));
  webApp.use((req, res) => {
    if (
      req.path.startsWith("/api") ||
      req.path.includes("/api/") ||
      req.path.startsWith("/hw") ||
      req.path.startsWith("/ws")
    ) {
      res.status(404).json({ error: "That address was not found on this Box IO server" });
      return;
    }
    res.sendFile(join(webDir, "index.html"));
  });
} else {
  webApp.get("/", (_req, res) => {
    res.json({
      service: "Box IO",
      hint: "Web UI not built yet. Run npm run build:web from server/",
    });
  });
}

function tune(server: Server): void {
  // Node's default headers timeout is 60 seconds. A proxy that keeps the
  // socket open hits that limit and then waits out its own gateway timeout.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  server.requestTimeout = 120_000;
}

const webServer = createServer(webApp);
tune(webServer);
const wss = new WebSocketServer({ server: webServer, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "", "http://localhost");
  const token = url.searchParams.get("token") || "";
  const user = readToken(token);
  if (!user) {
    ws.close(4401, "Unauthorized");
    return;
  }
  addClient({ ws, user });
  ws.send(JSON.stringify({ type: "hello", user: user.username }));
});

const deviceServer = deviceApp.listen(DEVICE_PORT, "0.0.0.0", () => {
  console.log(`Box IO device HTTP  http://0.0.0.0:${DEVICE_PORT}`);
});
tune(deviceServer);

webServer.listen(WEB_PORT, "0.0.0.0", () => {
  console.log(`Box IO web + API    http://0.0.0.0:${WEB_PORT}`);
});

setInterval(sweepOfflineDevices, 10_000);
// Touched every second. keep-up.sh restarts this process when the file goes stale
// so a stuck program comes back without recreating the proxy.
setInterval(() => {
  try {
    writeFileSync(join(dataDir, "alive"), String(Date.now()));
  } catch {
    /* a full disk should not take the server down */
  }
}, 1000).unref();
setInterval(() => {
  void refreshLicenseFromServer();
}, 60 * 60 * 1000);
void refreshLicenseFromServer();
