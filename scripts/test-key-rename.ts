import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import type { Server } from "node:http";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "boxio-keys-"));

const { createWebRouter } = await import("../src/webapi.ts");
const { createUser, signToken } = await import("../src/auth.ts");

function assert(ok: unknown, message: string) {
  if (!ok) throw new Error(message);
  console.log("ok ", message);
}

const app = express();
app.use(express.json());
app.use("/api", createWebRouter());
const server: Server = await new Promise((resolve) => {
  const started = app.listen(0, "127.0.0.1", () => resolve(started));
});
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const base = `http://127.0.0.1:${port}`;

const ownerId = createUser("owner", "secret1", "", "admin");
const otherId = createUser("other", "secret1", "", "user");
const owner = signToken({ id: ownerId, username: "owner", role: "admin" });
const other = signToken({ id: otherId, username: "other", role: "user" });

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json()) as { key?: { id: number; name: string; key: string }; error?: string };
  return { status: res.status, data };
}

const created = await call("POST", "/api/keys", owner, { name: "Bench" });
assert(created.status === 200 && created.data.key?.name === "Bench", "create keeps the name");
const id = created.data.key!.id;
const secret = created.data.key!.key;
assert(secret.startsWith("bx_"), "create returns a device key");

const renamed = await call("PUT", `/api/keys/${id}`, owner, { name: "  Rose  " });
assert(renamed.status === 200 && renamed.data.key?.name === "Rose", "rename saves the trimmed name");
assert(renamed.data.key?.key === secret, "rename keeps the same key");

const listed = await call("GET", "/api/keys", owner);
assert(
  listed.status === 200 && (listed.data as { keys?: { name: string; key: string }[] }).keys?.[0]?.name === "Rose",
  "the key list shows the new name",
);
assert((listed.data as { keys?: { key: string }[] }).keys?.[0]?.key === secret, "the key list keeps the same key");

const blank = await call("PUT", `/api/keys/${id}`, owner, { name: "   " });
assert(blank.status === 400, "a blank name is rejected");

const stolen = await call("PUT", `/api/keys/${id}`, other, { name: "Stolen" });
assert(stolen.status === 404, "another account cannot rename the key");

const removed = await call("DELETE", `/api/keys/${id}`, owner);
assert(removed.status === 200, "the owner can delete the key");
const after = await call("GET", "/api/keys", owner);
assert((after.data as { keys?: unknown[] }).keys?.length === 0, "the deleted key is gone");

server.close();
console.log("key rename ok");
