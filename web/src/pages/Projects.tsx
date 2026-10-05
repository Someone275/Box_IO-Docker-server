import { useEffect, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { Plus, Radio } from "lucide-react";
import { api } from "@/lib/api";
import type { DeviceKey, Project, User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

export function ProjectsPage() {
  const user = useOutletContext<User>();
  const viewer = user.role === "viewer";
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [keys, setKeys] = useState<DeviceKey[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("New dashboard");
  const [deviceKeyId, setDeviceKeyId] = useState<number | "">("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const p = await api.get<{ projects: Project[] }>("/api/projects");
      setProjects(p.projects);
      if (!viewer) {
        const k = await api.get<{ keys: DeviceKey[] }>("/api/keys");
        setKeys(k.keys);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load projects");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    try {
      const data = await api.post<{ project: Project }>("/api/projects", {
        name,
        deviceKeyId: deviceKeyId === "" ? null : deviceKeyId,
      });
      setOpen(false);
      navigate(`/projects/${data.project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project");
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-muted">
            {viewer
              ? "These are the dashboards shared with you."
              : "Each project is a widget layout bound to a device key. Open one to live-view pins or edit the board."}
          </p>
        </div>
        {!viewer && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} />
            New project
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {loading ? (
        <p className="text-muted">Loading projects…</p>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-ink">{viewer ? "No dashboards yet" : "No projects yet"}</p>
            <p className="mt-1 text-sm text-muted">
              {viewer
                ? "When someone shares a dashboard with you, it shows up here."
                : "Create a project, drop widgets on the board, and bind them to virtual pins."}
            </p>
            {!viewer && (
              <Button className="mt-5" onClick={() => setOpen(true)}>
                Create the first project
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((project) => (
            <Link key={project.id} to={`/projects/${project.id}`}>
              <Card className="h-full transition hover:border-accent/40">
                <CardContent className="space-y-3 pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-lg font-medium">{project.name}</div>
                    <Badge tone={project.access === "view" ? "muted" : project.online ? "ok" : "muted"}>
                      {project.access === "view" ? "Shared" : project.online ? "Device online" : "Device idle"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <Radio size={14} />
                    {project.device_name || "No device key assigned"}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Give the dashboard a name and optionally bind a device key.</DialogDescription>
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Device key</Label>
              <select
                className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm"
                value={deviceKeyId}
                onChange={(e) => setDeviceKeyId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">None yet</option>
                {keys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </div>
            <Button className="w-full" onClick={() => void create()}>
              Create project
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
