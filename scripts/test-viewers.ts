import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

const dataDir = mkdtempSync(join(tmpdir(), "boxio-viewers-"));
process.env.DATA_DIR = dataDir;

const { createWebRouter } = await import("../src/webapi.ts");
const { db, setSetting } = await import("../src/db.ts");

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const app = express();
app.use(express.json());
app.use("/api", createWebRouter());
const server = createServer(app);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("no port");
const base = `http://127.0.0.1:${address.port}`;

async function call(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const response = await fetch(base + path, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  return { status: response.status, data };
}

const refused = await call("/api/auth/setup", {
  method: "POST",
  body: { username: "owner", password: "owner-pass", email: "owner@example.com" },
});
assert(refused.status === 400, "setup without agreement is refused");

const setup = await call("/api/auth/setup", {
  method: "POST",
  body: { username: "owner", password: "owner-pass", email: "owner@example.com", agreed: true },
});
assert(setup.status === 200, "owner account is created");
const ownerToken = String(setup.data.token);

const project = await call("/api/projects", {
  method: "POST",
  token: ownerToken,
  body: { name: "Pump room" },
});
assert(project.status === 200, "owner creates a project");
const projectId = Number((project.data.project as { id: number }).id);

const desk = await call("/api/users", { token: ownerToken });
assert(desk.status === 200 && desk.data.smtp === false, "without SMTP the form asks for a password");
const projects = desk.data.projects as { id: number; name: string }[];
assert(projects.some((item) => item.id === projectId && item.name === "Pump room"), "the owner can share their project");

const missing = await call("/api/users", {
  method: "POST",
  token: ownerToken,
  body: { email: "view@example.com", projectIds: [projectId] },
});
assert(missing.status === 400, "a password account needs a username and password");

const created = await call("/api/users", {
  method: "POST",
  token: ownerToken,
  body: {
    username: "viewer",
    password: "viewer-pass",
    email: "view@example.com",
    projectIds: [projectId],
  },
});
assert(created.status === 200, `viewer account is created (${created.status})`);

const login = await call("/api/auth/login", {
  method: "POST",
  body: { username: "viewer", password: "viewer-pass" },
});
assert(login.status === 200, "viewer can sign in");
const viewerToken = String(login.data.token);

const list = await call("/api/projects", { token: viewerToken });
const rows = list.data.projects as { id: number; access: string; name: string }[];
assert(rows.length === 1 && rows[0].access === "view" && rows[0].name === "Pump room", "viewer sees only the shared project");

const opened = await call(`/api/projects/${projectId}`, { token: viewerToken });
assert(opened.status === 200 && (opened.data.project as { access: string }).access === "view", "viewer can open the dashboard");

const blocked = await call(`/api/projects/${projectId}`, {
  method: "PUT",
  token: viewerToken,
  body: { name: "Changed" },
});
assert(blocked.status === 403, "viewer cannot change the layout");

const other = await call("/api/projects", {
  method: "POST",
  token: ownerToken,
  body: { name: "Private" },
});
const otherId = Number((other.data.project as { id: number }).id);
const hidden = await call(`/api/projects/${otherId}`, { token: viewerToken });
assert(hidden.status === 404, "viewer cannot open a project that was not shared");

const viewerKeys = await call("/api/keys", { token: viewerToken });
assert(viewerKeys.status === 200 && Array.isArray(viewerKeys.data.keys) && viewerKeys.data.keys.length === 0, "viewer has no device keys");
const viewerProject = await call("/api/projects", { method: "POST", token: viewerToken, body: { name: "Nope" } });
assert(viewerProject.status === 403, "viewer cannot create a project");
const viewerUsers = await call("/api/users", { token: viewerToken });
assert(viewerUsers.status === 403, "viewer cannot open the user list");

const builder = await call("/api/users", {
  method: "POST",
  token: ownerToken,
  body: { username: "builder", password: "builder-pass", email: "builder@example.com", kind: "user" },
});
assert(builder.status === 200 && (builder.data.user as { role: string }).role === "user", "owner can create a project user");
const builderLogin = await call("/api/auth/login", {
  method: "POST",
  body: { username: "builder", password: "builder-pass" },
});
assert(builderLogin.status === 200, "project user can sign in");
const builderToken = String(builderLogin.data.token);
const builderProject = await call("/api/projects", {
  method: "POST",
  token: builderToken,
  body: { name: "Builder room" },
});
assert(builderProject.status === 200, "project user can create a dashboard");
const builderProjectId = Number((builderProject.data.project as { id: number }).id);
const nested = await call("/api/users", {
  method: "POST",
  token: builderToken,
  body: {
    username: "guestview",
    password: "guestview-pass",
    email: "guestview@example.com",
    projectIds: [builderProjectId],
  },
});
assert(nested.status === 200 && (nested.data.user as { role: string }).role === "viewer", "project user can create a view-only account");
const promoted = await call("/api/users", {
  method: "POST",
  token: builderToken,
  body: { username: "nope", password: "nope-pass", email: "nope@example.com", kind: "user" },
});
assert(promoted.status === 403, "a project user cannot create another project user");
const guestLogin = await call("/api/auth/login", {
  method: "POST",
  body: { username: "guestview", password: "guestview-pass" },
});
const shared = await call("/api/projects", { token: String(guestLogin.data.token) });
const guestRows = shared.data.projects as { name: string; access: string }[];
assert(guestRows.length === 1 && guestRows[0].name === "Builder room" && guestRows[0].access === "view", "view-only user sees only the shared dashboard");

setSetting("smtp_host", "127.0.0.1");
const mailed = await call("/api/users", { token: ownerToken });
assert(mailed.data.smtp === true, "SMTP switches the form to an invite link");

const { createInvite, openInvite } = await import("../src/viewers.ts");
const owner = db.prepare("SELECT id FROM users WHERE username = ?").get("owner") as { id: number };
const made = createInvite("guest@example.com", [projectId], owner.id, "admin");
const link = openInvite(made.token);
assert(link?.email === "guest@example.com" && link.projects[0]?.name === "Pump room", "the invite names the shared project");
const joined = await call(`/api/auth/invite/${made.token}`, {
  method: "POST",
  body: { username: "guest", password: "guest-pass" },
});
assert(joined.status === 200 && typeof joined.data.token === "string", "the invite link creates the account");
const guestList = await call("/api/projects", { token: String(joined.data.token) });
const guestProjects = guestList.data.projects as { access: string }[];
assert(guestProjects.length === 1 && guestProjects[0].access === "view", "the invited account sees the selected project");

server.close();
console.log("viewer access ok");
