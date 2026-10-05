import { useState, type FormEvent, type ReactNode } from "react";
import { Cpu } from "lucide-react";
import { api, setToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { User } from "@/lib/types";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api.post<{ token: string; user: User }>("/api/auth/login", {
        username,
        password,
      });
      setToken(data.token);
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <p className="text-sm text-muted">Open your dashboards, keys, and devices.</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <Field label="Username">
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button className="w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthFrame>
  );
}

const useRestrictions = [
  "Decompile, reverse engineer, disassemble, or otherwise attempt to derive the source code of the Software.",
  "Modify, adapt, alter, translate, or create derivative works based upon the Software.",
  "Bypass, modify, defeat, or circumvent any security measures, digital rights management (DRM), or license key verification systems used to protect the Software.",
  "Rent, lease, sublicense, resell, redistribute, or otherwise transfer the Software or your subscription license to any third party.",
  "Use the Software beyond the paid 365-day subscription term without a valid, active renewal.",
];

const warrantyLimits = [
  '"As-Is" Provision: The Software is provided to you "AS IS" and "AS AVAILABLE", with all faults and defects, and without warranty of any kind. To the maximum extent permitted by law, the Licensor expressly disclaims all warranties, whether express, implied, or statutory.',
  "Exclusion of Damages: In no event shall the Licensor be liable for any special, incidental, indirect, or consequential damages whatsoever (including, but not limited to, damages for loss of profits, loss of data, business interruption, or personal injury) arising out of or in any way related to the use of or inability to use the Software.",
  "Cap on Liability: Notwithstanding any damages you might incur, the entire liability of the Licensor under any provision of this Agreement, and your exclusive remedy for all of the foregoing, shall be limited strictly to the actual amount paid by you for the current yearly subscription term of the Software.",
];

export function SetupPage() {
  const [agreed, setAgreed] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!agreed) return;
    setBusy(true);
    setError("");
    try {
      const data = await api.post<{ token: string }>("/api/auth/setup", {
        username,
        password,
        email,
        agreed: true,
      });
      setToken(data.token);
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  if (!agreed) {
    return (
      <AuthFrame>
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle>Terms of use</CardTitle>
            <p className="text-sm text-muted">
              Read this agreement and click I agree before the first sign-in on this server.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-2 text-sm">
              <section className="space-y-2">
                <h2 className="font-semibold">1. RESTRICTIONS ON USE</h2>
                <p>You agree that you will not, and will not permit any third party to:</p>
                <ul className="list-disc space-y-2 pl-5">
                  {useRestrictions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
              <section className="space-y-2">
                <h2 className="font-semibold">2. LIMITATION OF LIABILITY & DISCLAIMER OF WARRANTIES</h2>
                <ul className="list-disc space-y-2 pl-5">
                  {warrantyLimits.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            </div>
            <Button className="w-full" onClick={() => setAgreed(true)}>
              I agree
            </Button>
          </CardContent>
        </Card>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Create the admin account</CardTitle>
          <p className="text-sm text-muted">
            You agreed to the terms. This account becomes the administrator and can create logins for everyone else.
          </p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <Field label="Admin username">
              <Input value={username} onChange={(e) => setUsername(e.target.value)} />
            </Field>
            <Field label="Email (optional)">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button className="w-full" disabled={busy}>
              {busy ? "Creating…" : "Create admin"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthFrame>
  );
}

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 text-accent">
          <Cpu />
        </div>
        <div>
          <div className="text-2xl font-semibold tracking-wide">BOX IO</div>
          <div className="text-sm text-muted">Self-hosted virtual pins for Arduino, ESP32, and SAM</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
