import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type RemoteLicense = {
  id: number;
  kind: string;
  status: string;
  expiresAt: string;
  instanceId?: string;
  expired?: boolean;
};

type Status = {
  licensed: boolean;
  kind: string;
  holder: string;
  expiresAt: string;
  pendingCheckout: string;
  instanceId: string;
  hasLicenseFile?: boolean;
  reachable: boolean;
  signedIn: boolean;
  server: string;
  canInstall: boolean;
  licenses: RemoteLicense[];
};

export function LicensePage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await api.get<Status>("/api/license/status");
    setStatus(data);
    window.dispatchEvent(new CustomEvent("boxio-license", { detail: data }));
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Could not load the license"));
  }, []);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  const kindLabel =
    status?.kind === "year" ? "1 year" : status?.kind === "trial" ? "30-day trial" : status?.kind === "test" ? "test" : status?.kind;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">License</h1>
        <p className="text-sm text-muted">
          Pin values stay hidden until this Docker server has a valid license. A checkout works on this server only. A year is $30 on {status?.server || "the Box IO site"}. A trial lasts 30 days.
        </p>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {message && <p className="text-sm text-accent">{message}</p>}

      <Card>
        <CardHeader>
          <CardTitle>{status?.licensed ? "License installed" : "No valid license"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {status?.licensed ? (
            <p>
              {kindLabel} license{status.holder ? ` for ${status.holder}` : ""}
              {status.expiresAt ? `, through ${status.expiresAt}` : ""}.
            </p>
          ) : (
            <p>Dashboard widgets, graphs, and the public pin address return no values.</p>
          )}
          {status?.instanceId ? <p className="break-all text-xs text-muted">This server: {status.instanceId}</p> : null}
          {status?.canInstall && status.hasLicenseFile ? (
            <div className="space-y-2 pt-2">
              <p className="text-muted">
                Return this license to free the checkout. Pin data on this server stops, and the license can be installed on one other Docker server.
              </p>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm("Return this license? Pin data on this server stops, and it can be installed on one other Docker server.")) return;
                  void run(async () => {
                    await api.post("/api/license/return");
                    setMessage("License returned. It can be installed on one other Docker server.");
                  });
                }}
              >
                Return license
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {status?.canInstall === false ? (
        <p className="text-sm text-muted">An admin on this Docker server has to install the license.</p>
      ) : null}

      {status?.canInstall && status.reachable ? (
        <Card>
          <CardHeader>
            <CardTitle>Sign in to box-io.com</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted">
              This machine can reach the license server. Sign in with the account you use on that site. The token stays on this server for later checks.
            </p>
            {status.signedIn ? (
              <p className="text-sm">Signed in. Pick a license to install.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="lic-user">Username</Label>
                  <Input id="lic-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lic-pass">Password</Label>
                  <Input id="lic-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
                </div>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.post("/api/license/login", { username, password });
                      setPassword("");
                      setMessage("Signed in. The token is stored on this server.");
                    })
                  }
                >
                  Sign in
                </Button>
              </div>
            )}
            {status.signedIn ? (
              <div className="space-y-2">
                {(status.licenses || []).filter((row) => !row.expired).map((row) => {
                  const taken =
                    Boolean(row.instanceId) && row.instanceId?.toLowerCase() !== status.instanceId.toLowerCase();
                  return (
                    <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                      <div className="text-sm">
                        #{row.id} {row.kind} · {row.status} · {row.expiresAt}
                      </div>
                      {taken ? (
                        <span className="text-xs text-muted">Checked out to another server</span>
                      ) : (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await api.post("/api/license/pull", { licenseId: row.id });
                              setMessage("License installed.");
                            })
                          }
                        >
                          Install
                        </Button>
                      )}
                    </div>
                  );
                })}
                {(status.licenses || []).filter((row) => !row.expired).length === 0 ? (
                  <p className="text-sm text-muted">No license is waiting on that account. Start a trial or buy a year on the website.</p>
                ) : null}
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.post("/api/license/disconnect");
                      setMessage("Removed the saved sign-in token.");
                    })
                  }
                >
                  Forget the saved sign-in
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {status?.pendingCheckout ? (
        <Card>
          <CardHeader>
            <CardTitle>Finish this install</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">Checkout code. Paste it on your account page next to this license, then put the confirmation code here.</p>
            <pre className="overflow-auto rounded-lg border border-line bg-bg p-3 text-xs">{status.pendingCheckout}</pre>
            <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(status.pendingCheckout)}>
              Copy checkout code
            </Button>
            <div className="space-y-2">
              <Label htmlFor="confirm-code-online">Confirmation code from the website</Label>
              <Input id="confirm-code-online" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
              <Button
                disabled={busy || !confirm.trim()}
                onClick={() =>
                  void run(async () => {
                    await api.post("/api/license/confirm", { code: confirm.trim() });
                    setConfirm("");
                    setMessage("License installed.");
                  })
                }
              >
                Finish install
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {status?.canInstall && status.reachable === false ? (
        <Card>
          <CardHeader>
            <CardTitle>Offline install</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted">
              This server cannot reach {status.server}. Download the license file from your account on that site, then upload it here.
            </p>
            <Input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  void run(async () => {
                    const parsed = JSON.parse(String(reader.result || ""));
                    const result = await api.post<{ checkoutCode?: string; installed?: boolean }>("/api/license/upload", {
                      document: parsed,
                    });
                    setMessage(result.installed ? "License installed." : "File accepted. Copy the checkout code to your account on the website.");
                  });
                };
                reader.readAsText(file);
              }}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
