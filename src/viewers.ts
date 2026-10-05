import { randomBytes } from "node:crypto";
import { db, getSettings } from "./db.js";
import { referencedDeviceKeyIds } from "./layout.js";
import { createUser } from "./auth.js";

export interface ShareProject {
  id: number;
  name: string;
}

export interface ViewerRow {
  id: number;
  username: string;
  email: string;
  role: string;
  created_at: string;
  projectIds: number[];
}

export interface InviteRow {
  id: number;
  email: string;
  projectIds: number[];
  accountRole: "user" | "viewer";
  expires_at: string;
  created_at: string;
}

export function smtpIsConfigured(): boolean {
  return Boolean(getSettings().smtp_host?.trim());
}

export function shareableProjects(userId: number, role: string): ShareProject[] {
  if (role === "admin") {
    return db
      .prepare("SELECT id, name FROM projects ORDER BY name COLLATE NOCASE, id")
      .all() as unknown as ShareProject[];
  }
  return db
    .prepare("SELECT id, name FROM projects WHERE user_id = ? ORDER BY name COLLATE NOCASE, id")
    .all(userId) as unknown as ShareProject[];
}

function projectIdList(rows: { project_id: number }[], allowed: Set<number> | null): number[] {
  const ids = rows.map((row) => row.project_id);
  if (!allowed) return ids;
  return ids.filter((id) => allowed.has(id));
}

export function listViewerDesk(actorId: number, role: string) {
  const projects = shareableProjects(actorId, role);
  const allowed = role === "admin" ? null : new Set(projects.map((project) => project.id));
  const users =
    role === "admin"
      ? (db
          .prepare(
            "SELECT id, username, email, role, created_at FROM users WHERE id != ? ORDER BY id",
          )
          .all(actorId) as Omit<ViewerRow, "projectIds">[])
      : (db
          .prepare(
            `SELECT DISTINCT u.id, u.username, u.email, u.role, u.created_at
             FROM users u
             LEFT JOIN project_members m ON m.user_id = u.id
             LEFT JOIN projects p ON p.id = m.project_id AND p.user_id = ?
             WHERE u.id != ? AND u.role = 'viewer' AND (u.created_by = ? OR p.id IS NOT NULL)
             ORDER BY u.id`,
          )
          .all(actorId, actorId, actorId) as Omit<ViewerRow, "projectIds">[]);
  const withProjects: ViewerRow[] = users.map((user) => ({
    ...user,
    email: user.email || "",
    projectIds: projectIdList(
      db.prepare("SELECT project_id FROM project_members WHERE user_id = ? ORDER BY project_id").all(user.id) as {
        project_id: number;
      }[],
      allowed,
    ),
  }));
  const invites = (
    db
      .prepare(
        `SELECT id, email, project_ids, account_role, expires_at, created_at
         FROM account_invites
         WHERE invited_by = ? AND accepted_at IS NULL AND expires_at > datetime('now')
         ORDER BY id DESC`,
      )
      .all(actorId) as {
      id: number;
      email: string;
      project_ids: string;
      account_role: string;
      expires_at: string;
      created_at: string;
    }[]
  ).map((invite) => ({
    id: invite.id,
    email: invite.email,
    projectIds: parseProjectIds(invite.project_ids).filter((id) => !allowed || allowed.has(id)),
    accountRole: invite.account_role === "user" ? ("user" as const) : ("viewer" as const),
    expires_at: invite.expires_at,
    created_at: invite.created_at,
  }));
  return { smtp: smtpIsConfigured(), canCreateBuilders: role === "admin", projects, users: withProjects, invites };
}

export function assertShareable(actorId: number, role: string, projectIds: number[]): number[] {
  const allowed = new Set(shareableProjects(actorId, role).map((project) => project.id));
  const unique = [...new Set(projectIds.map((id) => Math.round(Number(id))).filter((id) => Number.isInteger(id)))];
  if (!unique.length) throw new Error("Select at least one project");
  if (unique.some((id) => !allowed.has(id))) throw new Error("Choose a project you can share");
  return unique;
}

export function replaceViewerProjects(viewerId: number, projectIds: number[], actorId: number, role: string): void {
  const unique = assertShareable(actorId, role, projectIds);
  const allowed = shareableProjects(actorId, role).map((project) => project.id);
  for (const projectId of allowed) {
    db.prepare("DELETE FROM project_members WHERE user_id = ? AND project_id = ?").run(viewerId, projectId);
  }
  const insert = db.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)");
  for (const projectId of unique) {
    const owner = db.prepare("SELECT user_id FROM projects WHERE id = ?").get(projectId) as { user_id: number } | undefined;
    if (!owner || owner.user_id === viewerId) continue;
    insert.run(projectId, viewerId);
  }
}

export function createViewerAccount(
  username: string,
  password: string,
  email: string,
  projectIds: number[],
  actorId: number,
  role: string,
): number {
  const id = createUser(username, password, email, "viewer");
  db.prepare("UPDATE users SET created_by = ? WHERE id = ?").run(actorId, id);
  replaceViewerProjects(id, projectIds, actorId, role);
  return id;
}

export function createBuilderAccount(username: string, password: string, email: string, actorId: number): number {
  const id = createUser(username, password, email, "user");
  db.prepare("UPDATE users SET created_by = ? WHERE id = ?").run(actorId, id);
  return id;
}

function parseProjectIds(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => Number(id)).filter((id) => Number.isInteger(id));
  } catch {
    return [];
  }
}

export function createInvite(
  email: string,
  projectIds: number[],
  actorId: number,
  role: string,
  accountRole: "user" | "viewer" = "viewer",
) {
  const unique = accountRole === "viewer" ? assertShareable(actorId, role, projectIds) : [];
  const token = randomBytes(24).toString("hex");
  db.prepare("DELETE FROM account_invites WHERE lower(email) = lower(?) AND invited_by = ? AND accepted_at IS NULL").run(
    email,
    actorId,
  );
  const result = db
    .prepare(
      `INSERT INTO account_invites (token, email, invited_by, project_ids, account_role, expires_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', '+7 days'))`,
    )
    .run(token, email.trim(), actorId, JSON.stringify(unique), accountRole);
  const row = db.prepare("SELECT expires_at FROM account_invites WHERE id = ?").get(Number(result.lastInsertRowid)) as {
    expires_at: string;
  };
  return { id: Number(result.lastInsertRowid), token, expires_at: row.expires_at, projectIds: unique };
}

export function deleteInvite(id: number, actorId: number): boolean {
  const result = db
    .prepare("DELETE FROM account_invites WHERE id = ? AND invited_by = ? AND accepted_at IS NULL")
    .run(id, actorId);
  return result.changes > 0;
}

export function dropInvite(id: number): void {
  db.prepare("DELETE FROM account_invites WHERE id = ? AND accepted_at IS NULL").run(id);
}

export interface OpenInvite {
  id: number;
  email: string;
  projectIds: number[];
  projects: ShareProject[];
  invited_by: number;
  accountRole: "user" | "viewer";
}

export function openInvite(token: string): OpenInvite | null {
  const row = db
    .prepare(
      `SELECT id, email, invited_by, project_ids, account_role
       FROM account_invites
       WHERE token = ? AND accepted_at IS NULL AND expires_at > datetime('now')`,
    )
    .get(token) as
    | { id: number; email: string; invited_by: number; project_ids: string; account_role: string }
    | undefined;
  if (!row) return null;
  const projectIds = parseProjectIds(row.project_ids);
  const projects = projectIds.flatMap((id) => {
    const project = db.prepare("SELECT id, name FROM projects WHERE id = ?").get(id) as ShareProject | undefined;
    return project ? [project] : [];
  });
  return {
    id: row.id,
    email: row.email,
    projectIds,
    projects,
    invited_by: row.invited_by,
    accountRole: row.account_role === "user" ? "user" : "viewer",
  };
}

export function acceptInvite(token: string, username: string, password: string): { userId: number; existing: boolean } {
  const invite = openInvite(token);
  if (!invite) throw new Error("This invite link is no longer valid");
  const existing = db
    .prepare("SELECT id FROM users WHERE email != '' AND lower(email) = lower(?) ORDER BY id LIMIT 1")
    .get(invite.email) as { id: number } | undefined;
  let userId: number;
  let already = false;
  if (existing) {
    userId = existing.id;
    already = true;
  } else {
    if (username.trim().length < 3 || password.length < 6) {
      throw new Error("Username (3+ characters) and password (6+ characters) required");
    }
    userId = createUser(username, password, invite.email, invite.accountRole);
    db.prepare("UPDATE users SET created_by = ? WHERE id = ?").run(invite.invited_by, userId);
  }
  if (invite.accountRole === "viewer") {
    const insert = db.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)");
    for (const projectId of invite.projectIds) {
      const owner = db.prepare("SELECT user_id FROM projects WHERE id = ?").get(projectId) as { user_id: number } | undefined;
      if (!owner || owner.user_id === userId) continue;
      insert.run(projectId, userId);
    }
  }
  db.prepare("UPDATE account_invites SET accepted_at = datetime('now') WHERE id = ?").run(invite.id);
  return { userId, existing: already };
}

export function memberIdsForDevice(ownerId: number, deviceKeyId: number): number[] {
  const projects = db
    .prepare("SELECT id, device_key_id, layout_json FROM projects WHERE user_id = ?")
    .all(ownerId) as { id: number; device_key_id: number | null; layout_json: string }[];
  const ids = new Set<number>();
  for (const project of projects) {
    const keys = referencedDeviceKeyIds(project.layout_json, project.device_key_id);
    if (!keys.includes(deviceKeyId)) continue;
    const members = db.prepare("SELECT user_id FROM project_members WHERE project_id = ?").all(project.id) as {
      user_id: number;
    }[];
    for (const member of members) ids.add(member.user_id);
  }
  return [...ids];
}

export function canManageViewer(actorId: number, role: string, viewerId: number): boolean {
  if (viewerId === actorId) return false;
  if (role === "admin") return true;
  const row = db.prepare("SELECT created_by, role FROM users WHERE id = ?").get(viewerId) as
    | { created_by: number | null; role: string }
    | undefined;
  if (!row || row.role !== "viewer") return false;
  if (row.created_by === actorId) return true;
  const shared = db
    .prepare(
      `SELECT 1 FROM project_members m
       JOIN projects p ON p.id = m.project_id
       WHERE m.user_id = ? AND p.user_id = ?`,
    )
    .get(viewerId, actorId);
  return Boolean(shared);
}
