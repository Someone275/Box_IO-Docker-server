import { useEffect, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { DeviceKey } from "@/lib/types";
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

export function KeysPage() {
  const [keys, setKeys] = useState<DeviceKey[]>([]);
  const [name, setName] = useState("ESP32 living room");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<number | null>(null);

  async function load() {
    try {
      const data = await api.get<{ keys: DeviceKey[] }>("/api/keys");
      setKeys(data.keys);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load keys");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    try {
      await api.post("/api/keys", { name });
      setOpen(false);
      setName("ESP32 living room");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create key");
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this device key? Hardware using it will disconnect.")) return;
    await api.del(`/api/keys/${id}`);
    await load();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Device keys</h1>
          <p className="text-sm text-muted">
            Arduino firmware identifies itself with a key. Generate one per board and paste it
            into <span className="font-mono text-ink">BoxIO.begin(...)</span>.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} />
          Generate key
        </Button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {keys.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted">
            No keys yet. Generate one, then put it in your sketch along with this server’s
            address and port 5923.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {keys.map((key) => (
            <Card key={key.id}>
              <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="font-medium">{key.name}</div>
                    <Badge tone={key.online ? "ok" : "muted"}>{key.online ? "Online" : "Offline"}</Badge>
                  </div>
                  <div className="mt-1 break-all font-mono text-xs text-muted">{key.key}</div>
                  <div className="mt-1 text-xs text-muted">
                    Last seen: {key.last_seen || "never"}
                  </div>
                  <div className="mt-1 break-all font-mono text-xs text-muted">
                    {window.location.origin}/public/{key.key}/V0
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      await navigator.clipboard.writeText(key.key);
                      setCopied(key.id);
                      setTimeout(() => setCopied(null), 1500);
                    }}
                  >
                    <Copy size={14} />
                    {copied === key.id ? "Copied" : "Copy"}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => void remove(key.id)}>
                    <Trash2 size={14} />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Generate device key</DialogTitle>
          <DialogDescription>Name the hardware so you can tell keys apart later.</DialogDescription>
          <div className="mt-4 space-y-3">
            <Label>Device name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
            <Button className="w-full" onClick={() => void create()}>
              Generate
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
