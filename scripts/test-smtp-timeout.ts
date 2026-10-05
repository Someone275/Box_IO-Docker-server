import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "boxio-smtp-"));
process.env.DATA_DIR = dataDir;

const { setSetting } = await import("../src/db.ts");
const { sendEmail } = await import("../src/notify.ts");

const hang = createServer(() => {
  /* accept and never send an SMTP greeting */
});
await new Promise<void>((resolve) => hang.listen(0, "127.0.0.1", resolve));
const address = hang.address();
if (!address || typeof address === "string") throw new Error("no port");

setSetting("smtp_host", "127.0.0.1");
setSetting("smtp_port", String(address.port));
setSetting("smtp_from", "boxio@localhost");

const started = Date.now();
let message = "";
try {
  await sendEmail("person@example.com", "Invite", "hello");
} catch (err) {
  message = err instanceof Error ? err.message : "";
}
const elapsed = Date.now() - started;
hang.close();

if (!message.includes("Could not reach the email server")) {
  throw new Error(`expected a mail-server error, got: ${message || "success"}`);
}
if (elapsed > 12000) {
  throw new Error(`email send waited ${elapsed}ms`);
}
console.log(`smtp timeout ok ${elapsed}ms`);
