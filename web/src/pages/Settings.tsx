import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Settings = Record<string, string>;

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [testTo, setTestTo] = useState("");
  const [smsTo, setSmsTo] = useState("");

  useEffect(() => {
    api
      .get<{ settings: Settings }>("/api/settings")
      .then((d) => setSettings(d.settings))
      .catch((err) => setError(err.message));
  }, []);

  function set(key: string, value: string) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  async function save() {
    try {
      await api.put("/api/settings", settings);
      setMessage("Settings saved");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Server settings</h1>
        <p className="text-sm text-muted">
          SMTP for email alerts, Twilio for SMS, and the public domain used with Let’s Encrypt.
        </p>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {message && <p className="text-sm text-accent">{message}</p>}

      <Card>
        <CardHeader>
          <CardTitle>SMTP email</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Host">
            <Input value={settings.smtp_host || ""} onChange={(e) => set("smtp_host", e.target.value)} />
          </Field>
          <Field label="Port">
            <Input value={settings.smtp_port || ""} onChange={(e) => set("smtp_port", e.target.value)} />
          </Field>
          <Field label="Username">
            <Input value={settings.smtp_user || ""} onChange={(e) => set("smtp_user", e.target.value)} />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={settings.smtp_pass || ""}
              onChange={(e) => set("smtp_pass", e.target.value)}
            />
          </Field>
          <Field label="From address">
            <Input value={settings.smtp_from || ""} onChange={(e) => set("smtp_from", e.target.value)} />
          </Field>
          <Field label="Use TLS/SSL">
            <select
              className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm"
              value={settings.smtp_secure || "0"}
              onChange={(e) => set("smtp_secure", e.target.value)}
            >
              <option value="0">STARTTLS (port 587)</option>
              <option value="1">Implicit TLS (port 465)</option>
            </select>
          </Field>
          <div className="sm:col-span-2 flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Send test to this address"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
            />
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  const r = await api.post<{ message: string }>("/api/settings/test-email", { to: testTo });
                  setMessage(r.message);
                  setError("");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Email failed");
                }
              }}
            >
              Send test email
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Twilio SMS</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Account SID">
            <Input value={settings.twilio_sid || ""} onChange={(e) => set("twilio_sid", e.target.value)} />
          </Field>
          <Field label="Auth token">
            <Input
              type="password"
              value={settings.twilio_token || ""}
              onChange={(e) => set("twilio_token", e.target.value)}
            />
          </Field>
          <Field label="From number">
            <Input
              value={settings.twilio_from || ""}
              onChange={(e) => set("twilio_from", e.target.value)}
              placeholder="+15551234567"
            />
          </Field>
          <div className="sm:col-span-2 flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Send test SMS to this number"
              value={smsTo}
              onChange={(e) => setSmsTo(e.target.value)}
            />
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  const r = await api.post<{ message: string }>("/api/settings/test-sms", { to: smsTo });
                  setMessage(r.message);
                  setError("");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "SMS failed");
                }
              }}
            >
              Send test SMS
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Let’s Encrypt / HTTPS</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Public domain">
            <Input
              value={settings.domain || ""}
              onChange={(e) => set("domain", e.target.value)}
              placeholder="boxio.example.com"
            />
          </Field>
          <Field label="Admin email for certificates">
            <Input
              value={settings.letsencrypt_email || ""}
              onChange={(e) => set("letsencrypt_email", e.target.value)}
            />
          </Field>
          <p className="sm:col-span-2 text-sm text-muted">
            In Docker, HTTP port 80 is redirected to HTTPS 443. Device traffic stays on HTTP
            port 5923. Run <span className="font-mono text-ink">./nginx/init-letsencrypt.sh</span> after
            DNS points at this host.
          </p>
        </CardContent>
      </Card>

      <Button onClick={() => void save()}>Save settings</Button>
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
