import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, setToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { User } from "@/lib/types";

interface InviteInfo {
  email: string;
  accountRole?: "user" | "viewer";
  projects: { id: number; name: string }[];
}

export function InvitePage() {
  const { token = "" } = useParams();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [existing, setExisting] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<InviteInfo>(`/api/auth/invite/${encodeURIComponent(token)}`);
        if (!cancelled) setInfo(data);
      } catch {
        if (!cancelled) setMissing(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api.post<{ token?: string; user?: User; existing?: boolean; username?: string }>(
        `/api/auth/invite/${encodeURIComponent(token)}`,
        { username, password },
      );
      if (data.existing) {
        setExisting(data.username || "your account");
        return;
      }
      if (data.token) {
        setToken(data.token);
        window.location.href = "/";
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <p className="text-sm text-muted">
            {info?.accountRole === "user"
              ? "Choose a username and password. You can create projects and add view-only users."
              : "Choose a username and password to view the dashboards shared with you."}
          </p>
        </CardHeader>
        <CardContent>
          {missing ? (
            <p className="text-sm text-danger">This invite link is no longer valid.</p>
          ) : !info ? (
            <p className="text-sm text-muted">Loading invite…</p>
          ) : existing ? (
            <p className="text-sm text-muted">
              These dashboards were added to <span className="text-ink">{existing}</span>.{" "}
              <Link to="/login" className="text-accent">Sign in</Link> to view them.
            </p>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={info.email} readOnly />
              </div>
              {info.accountRole !== "user" && (
                <div className="space-y-1.5">
                  <Label>Projects</Label>
                  <p className="text-sm text-muted">{info.projects.map((project) => project.name).join(", ") || "None"}</p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Username</Label>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button className="w-full" disabled={busy}>
                {busy ? "Creating…" : "Create account"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
