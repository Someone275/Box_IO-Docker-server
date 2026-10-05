import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

interface ShareProject {
  id: number;
  name: string;
}

interface Viewer {
  id: number;
  username: string;
  email: string;
  role: string;
  projectIds: number[];
}

interface Invite {
  id: number;
  email: string;
  projectIds: number[];
  accountRole: "user" | "viewer";
  expires_at: string;
}

interface Desk {
  smtp: boolean;
  canCreateBuilders: boolean;
  projects: ShareProject[];
  users: Viewer[];
  invites: Invite[];
}

export function AdminPage() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [projectIds, setProjectIds] = useState<number[]>([]);
  const [kind, setKind] = useState<"user" | "viewer">("viewer");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      const data = await api.get<Desk>("/api/users");
      setDesk(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load users");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function resetForm() {
    setUsername("");
    setPassword("");
    setEmail("");
    setProjectIds([]);
    setKind("viewer");
  }

  async function create() {
    if (!desk) return;
    setError("");
    setNotice("");
    try {
      const accountKind = desk.canCreateBuilders && kind === "user" ? "user" : "viewer";
      if (desk.smtp) {
        await api.post("/api/users", { email, projectIds, kind: accountKind, origin: window.location.origin });
        setNotice(`Invite sent to ${email}`);
      } else {
        await api.post("/api/users", { username, password, email, projectIds, kind: accountKind });
        setNotice(`${username} can sign in`);
      }
      setOpen(false);
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create user");
    }
  }

  async function saveProjects(user: Viewer, next: number[]) {
    setError("");
    try {
      await api.put(`/api/users/${user.id}/projects`, { projectIds: next });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update projects");
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this user?")) return;
    await api.del(`/api/users/${id}`);
    await load();
  }

  async function cancelInvite(id: number) {
    await api.del(`/api/users/invites/${id}`);
    await load();
  }

  const smtp = desk?.smtp === true;
  const projects = desk?.projects ?? [];
  const makingViewer = !desk?.canCreateBuilders || kind === "viewer";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="text-sm text-muted">
            {desk?.canCreateBuilders
              ? "Add someone who can build dashboards, or a view-only account for the projects you select."
              : smtp
                ? "Email a link so someone can create an account and view the projects you select."
                : "Email is not set up. Enter a username, password, and email, and choose the projects they can see."}
          </p>
        </div>
        <Button
          onClick={() => {
            resetForm();
            setOpen(true);
          }}
        >
          <Plus size={16} />
          New user
        </Button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {notice && <p className="text-sm text-accent">{notice}</p>}
      <div className="space-y-3">
        {(desk?.users ?? []).map((user) => (
          <Card key={user.id}>
            <CardContent className="space-y-3 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{user.username}</span>
                    <Badge tone={user.role === "admin" ? "ok" : "muted"}>{roleLabel(user.role)}</Badge>
                  </div>
                  <div className="text-xs text-muted">{user.email || "No email"}</div>
                </div>
                {user.role !== "admin" && (
                  <Button variant="danger" size="sm" onClick={() => void remove(user.id)}>
                    <Trash2 size={14} />
                    Delete
                  </Button>
                )}
              </div>
              {user.role === "viewer" && projects.length > 0 && (
                <ProjectChecks
                  projects={projects}
                  selected={user.projectIds}
                  onChange={(next) => void saveProjects(user, next)}
                />
              )}
            </CardContent>
          </Card>
        ))}
        {(desk?.invites ?? []).map((invite) => (
          <Card key={`invite-${invite.id}`}>
            <CardContent className="flex items-center justify-between gap-3 py-4">
              <div>
                <div className="font-medium">{invite.email}</div>
                <div className="text-xs text-muted">
                  Invite waiting. {invite.accountRole === "user" ? "Can create projects." : `Projects: ${namesFor(projects, invite.projectIds)}`}
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => void cancelInvite(invite.id)}>
                Cancel invite
              </Button>
            </CardContent>
          </Card>
        ))}
        {desk && desk.users.length === 0 && desk.invites.length === 0 && (
          <p className="text-sm text-muted">No viewers yet.</p>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{smtp ? "Send an invite" : "Create user"}</DialogTitle>
          <DialogDescription>
            {makingViewer
              ? smtp
                ? "They get a link to choose a username and password. They can only open the projects you select. The link expires in 7 days."
                : "They can sign in with this username and password and open the projects you select."
              : smtp
                ? "They get a link to choose a username and password. They can create projects and add view-only users. The link expires in 7 days."
                : "They can sign in, create projects and device keys, and add view-only users for those projects."}
          </DialogDescription>
          <div className="mt-4 space-y-3">
            {error && <p className="text-sm text-danger">{error}</p>}
            {!smtp && (
              <>
                <div className="space-y-1.5">
                  <Label>Username</Label>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <Label>Password</Label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {desk?.canCreateBuilders && (
              <div className="space-y-1.5">
                <Label>Account type</Label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="account-kind" checked={kind === "user"} onChange={() => setKind("user")} />
                  Can create projects
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="account-kind" checked={kind === "viewer"} onChange={() => setKind("viewer")} />
                  View only
                </label>
              </div>
            )}
            {makingViewer && (
              <div className="space-y-1.5">
                <Label>Projects they can see</Label>
                {projects.length === 0 ? (
                  <p className="text-xs text-muted">Create a project first, then come back to share it.</p>
                ) : (
                  <ProjectChecks projects={projects} selected={projectIds} onChange={setProjectIds} />
                )}
              </div>
            )}
            <Button className="w-full" onClick={() => void create()} disabled={makingViewer && projects.length === 0}>
              {smtp ? "Send invite link" : "Create user"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function roleLabel(role: string) {
  if (role === "admin") return "Admin";
  if (role === "viewer") return "View only";
  return "Projects";
}

function namesFor(projects: ShareProject[], ids: number[]) {
  const names = projects.filter((project) => ids.includes(project.id)).map((project) => project.name);
  return names.length ? names.join(", ") : "None";
}

function ProjectChecks({
  projects,
  selected,
  onChange,
}: {
  projects: ShareProject[];
  selected: number[];
  onChange: (next: number[]) => void;
}) {
  return (
    <div className="space-y-1">
      {projects.map((project) => (
        <label key={project.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={selected.includes(project.id)}
            onChange={() =>
              onChange(selected.includes(project.id) ? selected.filter((id) => id !== project.id) : [...selected, project.id])
            }
          />
          {project.name}
        </label>
      ))}
    </div>
  );
}
