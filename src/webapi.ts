import { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db, getSettings, setSetting, userCount } from "./db.js";
import {
  adminMiddleware,
  authMiddleware,
  checkPassword,
  createUser,
  findUserById,
  findUserByUsername,
  needsSetup,
  signToken,
  type AuthedRequest,
} from "./auth.js";
import { pinProperties, writePin, writePinProperty, type DeviceRow } from "./device.js";
import { sendEmail, sendSms, verifySmtp } from "./notify.js";
import {
  acceptInvite,
  canManageViewer,
  createBuilderAccount,
  createInvite,
  createViewerAccount,
  deleteInvite,
  dropInvite,
  listViewerDesk,
  openInvite,
  replaceViewerProjects,
  smtpIsConfigured,
} from "./viewers.js";
import type { ProjectLayout } from "./types.js";
import { referencedDeviceKeyIds } from "./layout.js";
import { clampHistoryRange, findGraphWidget, graphSeriesOf, readPinHistory, sampleIntervalSeconds } from "./history.js";
import { licenseAllowsData } from "./license.js";
import { mountLicenseRoutes } from "./license-api.js";
import { emitToUser } from "./broadcast.js";

const usernameSchema = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[a-zA-Z0-9._-]+$/);
const passwordSchema = z.string().min(6).max(128);

function deviceForUser(userId: number, keyId: number): DeviceRow | null {
  return (
    (db
      .prepare(
        "SELECT id, user_id, name, key FROM device_keys WHERE id = ? AND user_id = ?",
      )
      .get(keyId, userId) as DeviceRow | undefined) ?? null
  );
}

interface OpenProject {
  id: number;
  user_id: number;
  name: string;
  device_key_id: number | null;
  layout_json: string;
  created_at?: string;
  updated_at?: string;
}

function loadProject(userId: number, projectId: number): { project: OpenProject; access: "owner" | "view" } | null {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as OpenProject | undefined;
  if (!project) return null;
  if (project.user_id === userId) return { project, access: "owner" };
  const member = db
    .prepare("SELECT 1 AS ok FROM project_members WHERE project_id = ? AND user_id = ?")
    .get(projectId, userId);
  if (!member) return null;
  return { project, access: "view" };
}

function deviceForAccess(
  opened: { project: OpenProject; access: "owner" | "view" },
  actorId: number,
  keyId: number,
): DeviceRow | null {
  if (opened.access === "owner") return deviceForUser(actorId, keyId);
  const allowed = referencedDeviceKeyIds(opened.project.layout_json, opened.project.device_key_id);
  if (!allowed.includes(keyId)) return null;
  return (
    (db
      .prepare("SELECT id, user_id, name, key FROM device_keys WHERE id = ? AND user_id = ?")
      .get(keyId, opened.project.user_id) as DeviceRow | undefined) ?? null
  );
}

function dashboardOrigin(req: { protocol?: string; get(name: string): string | undefined }, bodyOrigin?: string): string {
  if (typeof bodyOrigin === "string" && /^https?:\/\/[A-Za-z0-9._:-]+$/.test(bodyOrigin)) {
    return bodyOrigin.replace(/\/$/, "");
  }
  const proto = (req.get("x-forwarded-proto") || req.protocol || "http").split(",")[0].trim();
  const host = (req.get("x-forwarded-host") || req.get("host") || "localhost").split(",")[0].trim();
  return `${proto}://${host}`;
}

function hideRows<T extends { value: string }>(rows: T[]): T[] {
  if (licenseAllowsData()) return rows;
  return rows.map((row) => ({ ...row, value: "" }));
}

export function createWebRouter(): Router {
  const router = Router();
  mountLicenseRoutes(router);

  router.get("/health", (_req, res) => {
    res.json({ ok: true, service: "boxio", setupRequired: needsSetup() });
  });

  router.get("/setup-status", (_req, res) => {
    res.json({ setupRequired: needsSetup(), userCount: userCount() });
  });

  router.post("/auth/setup", (req, res) => {
    if (!needsSetup()) {
      res.status(400).json({ error: "Server already has an admin account" });
      return;
    }
    const parsed = z
      .object({
        username: usernameSchema,
        password: passwordSchema,
        email: z.string().email().optional().or(z.literal("")),
        agreed: z.literal(true),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      if (req.body?.agreed !== true) {
        res.status(400).json({ error: "Agree to the terms before creating the admin account" });
        return;
      }
      res.status(400).json({ error: "Username (3+ chars) and password (6+ chars) required" });
      return;
    }
    const id = createUser(
      parsed.data.username,
      parsed.data.password,
      parsed.data.email || "",
      "admin",
    );
    setSetting("terms_accepted_at", new Date().toISOString());
    const user = { id, username: parsed.data.username, role: "admin" as const };
    res.json({ token: signToken(user), user });
  });

  router.post("/auth/login", (req, res) => {
    const parsed = z
      .object({ username: z.string(), password: z.string() })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Username and password required" });
      return;
    }
    const row = findUserByUsername(parsed.data.username);
    if (!row || !checkPassword(parsed.data.password, row.password_hash)) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }
    const user = { id: row.id, username: row.username, role: row.role };
    res.json({
      token: signToken(user),
      user: { ...user, email: row.email },
    });
  });

  router.get("/auth/invite/:token", (req, res) => {
    const invite = openInvite(String(req.params.token || ""));
    if (!invite) {
      res.status(404).json({ error: "This invite link is no longer valid" });
      return;
    }
    res.json({ email: invite.email, projects: invite.projects, accountRole: invite.accountRole });
  });

  router.post("/auth/invite/:token", (req, res) => {
    const invite = openInvite(String(req.params.token || ""));
    if (!invite) {
      res.status(404).json({ error: "This invite link is no longer valid" });
      return;
    }
    const parsed = z
      .object({
        username: usernameSchema.optional(),
        password: passwordSchema.optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Username (3+ characters) and password (6+ characters) required" });
      return;
    }
    try {
      const accepted = acceptInvite(
        String(req.params.token || ""),
        parsed.data.username || "",
        parsed.data.password || "",
      );
      const row = findUserById(accepted.userId);
      if (!row) {
        res.status(500).json({ error: "Account was not created" });
        return;
      }
      if (accepted.existing) {
        res.json({ existing: true, username: row.username });
        return;
      }
      const user = { id: row.id, username: row.username, role: row.role };
      res.json({ token: signToken(user), user: { ...user, email: row.email } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create the account";
      res.status(message.includes("taken") || message.includes("UNIQUE") ? 409 : 400).json({
        error: message.includes("UNIQUE") ? "That username is already taken" : message,
      });
    }
  });

  router.get("/auth/me", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const row = findUserById(user.id);
    if (!row) {
      res.status(401).json({ error: "Account not found" });
      return;
    }
    res.json({ user: row });
  });

  router.get("/admin/users", authMiddleware, adminMiddleware, (_req, res) => {
    const users = db
      .prepare(
        "SELECT id, username, email, role, created_at FROM users ORDER BY id ASC",
      )
      .all();
    res.json({ users });
  });

  router.post("/admin/users", authMiddleware, adminMiddleware, (req, res) => {
    const parsed = z
      .object({
        username: usernameSchema,
        password: passwordSchema,
        email: z.string().optional().default(""),
        role: z.enum(["admin", "user"]).optional().default("user"),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Valid username and password required" });
      return;
    }
    try {
      const id = createUser(
        parsed.data.username,
        parsed.data.password,
        parsed.data.email || "",
        parsed.data.role,
      );
      res.json({ user: findUserById(id) });
    } catch {
      res.status(409).json({ error: "That username is already taken" });
    }
  });

  router.delete("/admin/users/:id", authMiddleware, adminMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const id = Number(req.params.id);
    if (id === user.id) {
      res.status(400).json({ error: "You cannot delete your own account" });
      return;
    }
    const result = db.prepare("DELETE FROM users WHERE id = ?").run(id);
    if (!result.changes) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ ok: true });
  });

  router.get("/users", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    if (user.role === "viewer") {
      res.status(403).json({ error: "This account can only view dashboards" });
      return;
    }
    res.json(listViewerDesk(user.id, user.role));
  });

  router.post("/users", authMiddleware, async (req, res) => {
    const { user } = req as AuthedRequest;
    if (user.role === "viewer") {
      res.status(403).json({ error: "This account can only view dashboards" });
      return;
    }
    const kind = req.body?.kind === "user" ? "user" : "viewer";
    if (kind === "user" && user.role !== "admin") {
      res.status(403).json({ error: "Only the server owner can create accounts that build dashboards" });
      return;
    }
    const smtp = smtpIsConfigured();
    const projectIds = Array.isArray(req.body?.projectIds) ? (req.body.projectIds as unknown[]) : [];
    try {
      if (smtp) {
        const parsed = z.object({ email: z.string().email().max(200) }).safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: "A valid email address is required" });
          return;
        }
        const invite = createInvite(parsed.data.email, projectIds.map(Number), user.id, user.role, kind);
        const origin = dashboardOrigin(req, typeof req.body?.origin === "string" ? req.body.origin : undefined);
        const link = `${origin}/invite/${invite.token}`;
        const intro =
          kind === "user"
            ? "Create your account to build dashboards on this server."
            : "Create your account to view the dashboard.";
        try {
          await sendEmail(
            parsed.data.email,
            "Create your Box IO account",
            `${intro}\n\n${link}\n\nThis link expires in 7 days.`,
          );
        } catch (err) {
          dropInvite(invite.id);
          res.status(400).json({ error: err instanceof Error ? err.message : "Could not send the invite" });
          return;
        }
        res.json({ invited: true, email: parsed.data.email });
        return;
      }
      const parsed = z
        .object({
          username: usernameSchema,
          password: passwordSchema,
          email: z.string().email().max(200),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Username, password, and email are required when email is not set up" });
        return;
      }
      const id =
        kind === "user"
          ? createBuilderAccount(parsed.data.username, parsed.data.password, parsed.data.email, user.id)
          : createViewerAccount(
              parsed.data.username,
              parsed.data.password,
              parsed.data.email,
              projectIds.map(Number),
              user.id,
              user.role,
            );
      res.json({ user: findUserById(id) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create the user";
      const taken = message.includes("UNIQUE") || message.includes("taken");
      res.status(taken ? 409 : 400).json({ error: taken ? "That username is already taken" : message });
    }
  });

  router.put("/users/:id/projects", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const viewerId = Number(req.params.id);
    if (!canManageViewer(user.id, user.role, viewerId)) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const target = findUserById(viewerId);
    if (!target || target.role !== "viewer") {
      res.status(400).json({ error: "Project access is only for view-only accounts" });
      return;
    }
    const projectIds = Array.isArray(req.body?.projectIds) ? (req.body.projectIds as unknown[]).map(Number) : [];
    try {
      replaceViewerProjects(viewerId, projectIds, user.id, user.role);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Could not update projects" });
    }
  });

  router.delete("/users/invites/:id", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    if (!deleteInvite(Number(req.params.id), user.id)) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    res.json({ ok: true });
  });

  router.delete("/users/:id", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const id = Number(req.params.id);
    if (!canManageViewer(user.id, user.role, id)) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const result = db.prepare("DELETE FROM users WHERE id = ?").run(id);
    if (!result.changes) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ ok: true });
  });

  router.get("/keys", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    if (user.role === "viewer") {
      res.json({ keys: [] });
      return;
    }
    const keys = db
      .prepare(
        `SELECT id, name, key, last_seen, online, created_at
         FROM device_keys WHERE user_id = ? ORDER BY id DESC`,
      )
      .all(user.id);
    res.json({ keys });
  });

  router.post("/keys", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    if (user.role === "viewer") {
      res.status(403).json({ error: "This account can only view dashboards" });
      return;
    }
    const parsed = z
      .object({ name: z.string().min(1).max(80) })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Key name required" });
      return;
    }
    const key = "bx_" + randomBytes(24).toString("hex");
    const result = db
      .prepare("INSERT INTO device_keys (user_id, name, key) VALUES (?, ?, ?)")
      .run(user.id, parsed.data.name.trim(), key);
    res.json({
      key: {
        id: Number(result.lastInsertRowid),
        name: parsed.data.name.trim(),
        key,
        last_seen: null,
        online: 0,
      },
    });
  });

  router.delete("/keys/:id", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    if (user.role === "viewer") {
      res.status(403).json({ error: "This account can only view dashboards" });
      return;
    }
    const result = db
      .prepare("DELETE FROM device_keys WHERE id = ? AND user_id = ?")
      .run(Number(req.params.id), user.id);
    if (!result.changes) {
      res.status(404).json({ error: "Key not found" });
      return;
    }
    res.json({ ok: true });
  });

  router.get("/pins", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const keys = db
      .prepare("SELECT id FROM device_keys WHERE user_id = ? ORDER BY id ASC")
      .all(user.id) as { id: number }[];
    const devices = keys.map((key) => ({
      deviceKeyId: key.id,
      pins: hideRows(
        db
          .prepare("SELECT pin, value, updated_at FROM pin_values WHERE device_key_id = ?")
          .all(key.id) as { pin: number; value: string; updated_at: string }[],
      ),
      properties: hideRows(
        db
          .prepare("SELECT pin, prop, value FROM pin_properties WHERE device_key_id = ?")
          .all(key.id) as { pin: number; prop: string; value: string }[],
      ),
    }));
    res.json({ devices });
  });

  router.get("/projects", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const projects = db
      .prepare(
        `SELECT p.id, p.name, p.device_key_id, p.layout_json, p.created_at, p.updated_at,
                d.name AS device_name, d.online,
                CASE WHEN p.user_id = ? THEN 'owner' ELSE 'view' END AS access
         FROM projects p
         LEFT JOIN device_keys d ON d.id = p.device_key_id
         WHERE p.user_id = ?
            OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)
         ORDER BY p.updated_at DESC`,
      )
      .all(user.id, user.id, user.id);
    res.json({ projects });
  });

  router.post("/projects", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    if (user.role === "viewer") {
      res.status(403).json({ error: "This account can only view dashboards" });
      return;
    }
    const parsed = z
      .object({
        name: z.string().min(1).max(80),
        deviceKeyId: z.number().int().optional().nullable(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Project name required" });
      return;
    }
    const layout: ProjectLayout = { widgets: [] };
    const result = db
      .prepare(
        "INSERT INTO projects (user_id, name, device_key_id, layout_json) VALUES (?, ?, ?, ?)",
      )
      .run(
        user.id,
        parsed.data.name.trim(),
        parsed.data.deviceKeyId ?? null,
        JSON.stringify(layout),
      );
    res.json({
      project: {
        id: Number(result.lastInsertRowid),
        name: parsed.data.name.trim(),
        device_key_id: parsed.data.deviceKeyId ?? null,
        layout_json: JSON.stringify(layout),
      },
    });
  });

  router.get("/projects/:id", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const opened = loadProject(user.id, Number(req.params.id));
    if (!opened) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const device = opened.project.device_key_id
      ? (db
          .prepare("SELECT name, online FROM device_keys WHERE id = ?")
          .get(opened.project.device_key_id) as { name: string; online: number } | undefined)
      : undefined;
    res.json({
      project: {
        ...opened.project,
        device_name: device?.name ?? null,
        online: device?.online ?? 0,
        access: opened.access,
      },
    });
  });

  router.put("/projects/:id", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const parsed = z
      .object({
        name: z.string().min(1).max(80).optional(),
        deviceKeyId: z.number().int().nullable().optional(),
        layout: z
          .object({
            widgets: z.array(z.unknown()).optional(),
            pages: z
              .array(
                z
                  .object({
                    id: z.string(),
                    name: z.string(),
                    widgets: z.array(z.unknown()),
                  })
                  .loose(),
              )
              .optional(),
            snap: z.number().optional(),
            columns: z.number().optional(),
            rows: z.number().optional(),
            activePageId: z.string().optional(),
          })
          .loose()
          .optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid project update" });
      return;
    }
    const existing = loadProject(user.id, Number(req.params.id));
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (existing.access !== "owner") {
      res.status(403).json({ error: "You can view this dashboard" });
      return;
    }
    if (parsed.data.name) {
      db.prepare(
        "UPDATE projects SET name = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(parsed.data.name.trim(), Number(req.params.id));
    }
    if (parsed.data.deviceKeyId !== undefined) {
      db.prepare(
        "UPDATE projects SET device_key_id = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(parsed.data.deviceKeyId, Number(req.params.id));
    }
    if (parsed.data.layout) {
      db.prepare(
        "UPDATE projects SET layout_json = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(JSON.stringify(parsed.data.layout), Number(req.params.id));
    }
    const project = db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(Number(req.params.id));
    emitToUser(user.id, {
      type: "project",
      projectId: Number(req.params.id),
      project,
    });
    res.json({ project });
  });

  router.delete("/projects/:id", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const result = db
      .prepare("DELETE FROM projects WHERE id = ? AND user_id = ?")
      .run(Number(req.params.id), user.id);
    if (!result.changes) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json({ ok: true });
  });

  router.get("/projects/:id/pins", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const opened = loadProject(user.id, Number(req.params.id));
    if (!opened) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const project = opened.project;
    const projectRow = project as { device_key_id: number | null; layout_json?: string };
    const keyIds = referencedDeviceKeyIds(projectRow.layout_json || "{}", projectRow.device_key_id).filter(
      (keyId) => deviceForAccess(opened, user.id, keyId),
    );
    const devices = keyIds.map((keyId) => ({
      deviceKeyId: keyId,
      pins: hideRows(
        db.prepare("SELECT pin, value, updated_at FROM pin_values WHERE device_key_id = ?").all(keyId) as {
          pin: number;
          value: string;
          updated_at: string;
        }[],
      ),
      properties: hideRows(
        db.prepare("SELECT pin, prop, value FROM pin_properties WHERE device_key_id = ?").all(keyId) as {
          pin: number;
          prop: string;
          value: string;
        }[],
      ),
    }));
    const primary = project.device_key_id
      ? devices.find((d) => d.deviceKeyId === project.device_key_id)
      : undefined;
    res.json({
      pins: primary?.pins ?? [],
      properties: primary?.properties ?? [],
      deviceKeyId: project.device_key_id,
      devices,
    });
  });

  router.get("/projects/:id/history", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const opened = loadProject(user.id, Number(req.params.id));
    if (!opened) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const project = opened.project;
    const widget = findGraphWidget(project.layout_json, String(req.query.widget || ""));
    if (!widget) {
      res.status(404).json({ error: "Save the graph on this project first" });
      return;
    }
    const keyId = Number(widget.deviceKeyId) || project.device_key_id;
    if (!keyId || !deviceForAccess(opened, user.id, keyId)) {
      res.status(400).json({ error: "Assign a device key to this graph or project first" });
      return;
    }
    const range = clampHistoryRange(Number(req.query.from), Number(req.query.to));
    const interval = sampleIntervalSeconds(widget.props?.sampleEvery);
    const showData = licenseAllowsData();
    const series = graphSeriesOf(widget).map((item) => ({
      pin: item.pin,
      label: item.label,
      color: item.color,
      points: showData ? readPinHistory(keyId, item.pin, interval, range.from, range.to) : [],
    }));
    res.json({ from: range.from, to: range.to, sampleEvery: widget.props?.sampleEvery || "minute", series });
  });

  router.put("/projects/:id/pins/:pin", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const opened = loadProject(user.id, Number(req.params.id));
    if (!opened) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const project = opened.project;
    const requested = (req.body as { deviceKeyId?: unknown } | undefined)?.deviceKeyId;
    const keyId =
      requested !== undefined && requested !== null && requested !== ""
        ? Number(requested)
        : project?.device_key_id;
    if (!keyId || !Number.isInteger(keyId)) {
      res.status(400).json({ error: "Assign a device key to this widget or project first" });
      return;
    }
    const device = deviceForAccess(opened, user.id, keyId);
    if (!device) {
      res.status(400).json({ error: "Device key not found" });
      return;
    }
    const pin = Number(req.params.pin);
    const value = String(req.body?.value ?? "");
    writePin(device, pin, value, false);
    res.json({
      ok: true,
      pin,
      value,
      properties: pinProperties(device.id, pin),
    });
  });

  router.put("/projects/:id/pins/:pin/properties", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const opened = loadProject(user.id, Number(req.params.id));
    if (!opened) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const project = opened.project;
    const parsed = z
      .object({
        prop: z.string().min(1).max(40).regex(/^[A-Za-z][A-Za-z0-9_]*$/),
        value: z.string().max(500),
        deviceKeyId: z.number().int().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid property" });
      return;
    }
    const keyId = parsed.data.deviceKeyId ?? project.device_key_id;
    if (!keyId || !Number.isInteger(keyId)) {
      res.status(400).json({ error: "Assign a device key to this widget or project first" });
      return;
    }
    const device = deviceForAccess(opened, user.id, keyId);
    if (!device) {
      res.status(400).json({ error: "Device key not found" });
      return;
    }
    const pin = Number(req.params.pin);
    if (!Number.isInteger(pin) || pin < 0 || pin > 127) {
      res.status(400).json({ error: "pin required" });
      return;
    }
    const properties = writePinProperty(device, pin, parsed.data.prop, parsed.data.value);
    res.json({ ok: true, pin, prop: parsed.data.prop, value: parsed.data.value, properties });
  });

  router.get("/settings", authMiddleware, adminMiddleware, (_req, res) => {
    const s = getSettings();
    res.json({
      settings: {
        smtp_host: s.smtp_host || "",
        smtp_port: s.smtp_port || "587",
        smtp_user: s.smtp_user || "",
        smtp_pass: s.smtp_pass ? "••••••••" : "",
        smtp_from: s.smtp_from || "",
        smtp_secure: s.smtp_secure || "0",
        twilio_sid: s.twilio_sid || "",
        twilio_token: s.twilio_token ? "••••••••" : "",
        twilio_from: s.twilio_from || "",
        domain: s.domain || "",
        letsencrypt_email: s.letsencrypt_email || "",
      },
    });
  });

  router.put("/settings", authMiddleware, adminMiddleware, (req, res) => {
    const body = (req.body || {}) as Record<string, string>;
    const keys = [
      "smtp_host",
      "smtp_port",
      "smtp_user",
      "smtp_pass",
      "smtp_from",
      "smtp_secure",
      "twilio_sid",
      "twilio_token",
      "twilio_from",
      "domain",
      "letsencrypt_email",
    ];
    for (const key of keys) {
      if (body[key] === undefined) continue;
      if ((key === "smtp_pass" || key === "twilio_token") && body[key].includes("•")) {
        continue;
      }
      setSetting(key, String(body[key]));
    }
    res.json({ ok: true });
  });

  router.post("/settings/test-email", authMiddleware, adminMiddleware, async (req, res) => {
    try {
      const to = String(req.body?.to || "");
      if (!to) {
        res.status(400).json({ error: "Destination email required" });
        return;
      }
      await sendEmail(to, "Box IO test", "SMTP is working. This message was sent from your Box IO server.");
      res.json({ ok: true, message: "Test email sent" });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Send failed" });
    }
  });

  router.post("/settings/test-smtp", authMiddleware, adminMiddleware, async (_req, res) => {
    try {
      const message = await verifySmtp();
      res.json({ ok: true, message });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "SMTP failed" });
    }
  });

  router.post("/settings/test-sms", authMiddleware, adminMiddleware, async (req, res) => {
    try {
      const to = String(req.body?.to || "");
      if (!to) {
        res.status(400).json({ error: "Destination number required" });
        return;
      }
      await sendSms(to, "Box IO test: Twilio SMS is configured.");
      res.json({ ok: true, message: "Test SMS sent" });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "SMS failed" });
    }
  });

  return router;
}
