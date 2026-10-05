import { createHmac, createPublicKey, randomUUID, verify } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir } from "./db.js";

const publicKeyB64 = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "license-public.b64"),
  "utf8",
).trim();
const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
const publicKey = createPublicKey({
  key: Buffer.concat([spkiPrefix, Buffer.from(publicKeyB64, "base64")]),
  format: "der",
  type: "spki",
});

export type LicenseDocument = {
  v: number;
  id: number;
  kind: string;
  holder: string;
  expiresAt: string;
  instanceId: string;
  bindKey: string;
  autoRenew: boolean;
  signature: string;
};

type StoredLicense =
  | { mode: "bound"; document: LicenseDocument }
  | { mode: "confirmed"; document: LicenseDocument; instanceId: string; confirmation: string }
  | { mode: "pending"; document: LicenseDocument; checkoutCode: string };

const licensePath = () => join(dataDir, "license.json");
const instancePath = () => join(dataDir, "instance-id");
const tokenPath = () => join(dataDir, "license-token");

export function licenseServerUrl(): string {
  return (process.env.BOXIO_LICENSE_URL || "https://box-io.com").replace(/\/$/, "");
}

export function b64urlDecode(text: string): Buffer {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

export function licenseSigningText(doc: {
  id: number;
  kind: string;
  holder: string;
  expiresAt: string;
  instanceId?: string;
  bindKey: string;
  autoRenew?: boolean;
}): string {
  return [
    "boxio-license-v1",
    String(doc.id),
    doc.kind,
    doc.holder,
    doc.expiresAt,
    doc.instanceId || "",
    doc.bindKey,
    doc.autoRenew ? "1" : "0",
  ].join("\n");
}

export function confirmSigningText(id: number, instanceId: string, expiresAt: string, kind: string): string {
  return ["boxio-confirm-v1", String(id), instanceId, expiresAt, kind].join("\n");
}

export function checkoutProof(bindKey: string, instanceId: string): string {
  return createHmac("sha256", bindKey).update(`boxio-checkout-v1\n${instanceId}`).digest("hex").slice(0, 12);
}

export function checkoutCode(bindKey: string, instanceId: string): string {
  const id = instanceId.toLowerCase();
  return `BXOUT-${id}-${checkoutProof(bindKey, id)}`;
}

export function returnProof(bindKey: string, instanceId: string): string {
  const id = instanceId.toLowerCase();
  return createHmac("sha256", bindKey).update(`boxio-return-v1\n${id}`).digest("hex").slice(0, 12);
}

function verifyText(text: string, signature: string): boolean {
  try {
    const sig = b64urlDecode(signature);
    if (sig.length !== 64) return false;
    return verify(null, Buffer.from(text, "utf8"), publicKey, sig);
  } catch {
    return false;
  }
}

function isDocument(value: unknown): value is LicenseDocument {
  if (!value || typeof value !== "object") return false;
  const doc = value as LicenseDocument;
  return (
    doc.v === 1 &&
    Number.isInteger(doc.id) &&
    doc.id > 0 &&
    (doc.kind === "year" || doc.kind === "trial" || doc.kind === "test") &&
    typeof doc.holder === "string" &&
    typeof doc.expiresAt === "string" &&
    typeof doc.instanceId === "string" &&
    typeof doc.bindKey === "string" &&
    /^[0-9a-f]{64}$/i.test(doc.bindKey) &&
    typeof doc.signature === "string" &&
    typeof doc.autoRenew === "boolean"
  );
}

export function documentIsCurrent(doc: LicenseDocument, now = Date.now()): boolean {
  const expires = Date.parse(doc.expiresAt);
  return Number.isFinite(expires) && expires > now && verifyText(licenseSigningText(doc), doc.signature);
}

export function confirmationMatches(doc: LicenseDocument, instanceId: string, confirmation: string): boolean {
  const code = confirmation.trim();
  if (!code.startsWith("BXIN.")) return false;
  return verifyText(confirmSigningText(doc.id, instanceId.toLowerCase(), doc.expiresAt, doc.kind), code.slice(5));
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  renameSync(tmp, path);
}

function clearStoredLicense(): void {
  if (existsSync(licensePath())) writeFileSync(licensePath(), "", { mode: 0o600 });
}

export function instanceId(): string {
  if (existsSync(instancePath())) {
    const id = readFileSync(instancePath(), "utf8").trim().toLowerCase();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return id;
  }
  const id = randomUUID();
  writeFileSync(instancePath(), id, { mode: 0o600 });
  return id;
}

export function readStoredLicense(): StoredLicense | null {
  const value = readJson(licensePath());
  if (!value || typeof value !== "object" || !("mode" in value)) return null;
  return value as StoredLicense;
}

export function licenseAllowsData(now = Date.now()): boolean {
  if (process.env.BOXIO_LICENSE_DEV === "1") return true;
  const stored = readStoredLicense();
  if (!stored || !isDocument(stored.document)) return false;
  if (!documentIsCurrent(stored.document, now)) return false;
  const local = existsSync(instancePath()) ? readFileSync(instancePath(), "utf8").trim().toLowerCase() : "";
  if (stored.mode === "bound") {
    return stored.document.instanceId.toLowerCase() === local && local !== "";
  }
  if (stored.mode === "confirmed") {
    return (
      stored.document.instanceId === "" &&
      stored.instanceId.toLowerCase() === local &&
      confirmationMatches(stored.document, local, stored.confirmation)
    );
  }
  return false;
}

export function blankValue(value: string): string {
  return licenseAllowsData() ? value : "";
}

export function licenseToken(): string {
  if (!existsSync(tokenPath())) return "";
  return readFileSync(tokenPath(), "utf8").trim();
}

function saveToken(token: string): void {
  writeFileSync(tokenPath(), token, { mode: 0o600 });
}

export function clearLicenseToken(): void {
  if (existsSync(tokenPath())) writeFileSync(tokenPath(), "", { mode: 0o600 });
}

export function saveBoundDocument(document: LicenseDocument): void {
  if (!documentIsCurrent(document) || document.instanceId.toLowerCase() !== instanceId()) {
    throw new Error("The license file does not match this server");
  }
  writeJson(licensePath(), { mode: "bound", document });
}

export function uploadLicenseFile(raw: unknown): { checkoutCode: string } | { installed: true } {
  const doc = raw && typeof raw === "object" && "document" in raw ? (raw as { document: unknown }).document : raw;
  if (!isDocument(doc) || !documentIsCurrent(doc)) {
    throw new Error("That file is not a current Box IO license");
  }
  const local = instanceId();
  if (doc.instanceId) {
    if (doc.instanceId.toLowerCase() !== local) {
      throw new Error("This license file is checked out to a different Docker server");
    }
    writeJson(licensePath(), { mode: "bound", document: doc });
    return { installed: true };
  }
  const code = checkoutCode(doc.bindKey, local);
  writeJson(licensePath(), { mode: "pending", document: doc, checkoutCode: code });
  return { checkoutCode: code };
}

export function confirmInstalledLicense(code: string): void {
  const stored = readStoredLicense();
  if (!stored || stored.mode === "bound") {
    throw new Error("Upload a license file before entering the confirmation code");
  }
  const pending = stored.mode === "pending" ? stored.document : stored.document;
  if (!isDocument(pending) || pending.instanceId !== "") {
    throw new Error("Upload the license file again");
  }
  const local = instanceId();
  if (!confirmationMatches(pending, local, code)) {
    throw new Error("That confirmation code does not match this server");
  }
  writeJson(licensePath(), { mode: "confirmed", document: pending, instanceId: local, confirmation: code.trim() });
}

async function licenseFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = licenseToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${licenseServerUrl()}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(8000),
  });
}

export async function licenseServerReachable(): Promise<boolean> {
  try {
    const res = await licenseFetch("/api/license/ping.php", { method: "GET" });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

export async function loginToLicenseServer(username: string, password: string): Promise<{ username: string; licenses: unknown[] }> {
  const res = await fetch(`${licenseServerUrl()}/api/license/login.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(8000),
  });
  const body = (await res.json().catch(() => ({}))) as { token?: string; user?: { username?: string }; licenses?: unknown[]; error?: string };
  if (!res.ok || !body.token) {
    throw new Error(body.error || "Sign-in failed");
  }
  saveToken(body.token);
  return { username: body.user?.username || username, licenses: body.licenses || [] };
}

export async function listRemoteLicenses(): Promise<unknown[]> {
  const res = await licenseFetch("/api/license/list.php");
  if (res.status === 401) {
    clearLicenseToken();
    throw new Error("Sign in to box-io.com again");
  }
  const body = (await res.json().catch(() => ({}))) as { licenses?: unknown[]; error?: string };
  if (!res.ok) throw new Error(body.error || "Could not list licenses");
  return body.licenses || [];
}

export async function pullRemoteLicense(licenseId: number): Promise<LicenseDocument> {
  const res = await licenseFetch("/api/license/activate.php", {
    method: "POST",
    body: JSON.stringify({ licenseId, instanceId: instanceId() }),
  });
  if (res.status === 401) {
    clearLicenseToken();
    throw new Error("Sign in to box-io.com again");
  }
  const body = (await res.json().catch(() => ({}))) as { document?: LicenseDocument; error?: string };
  if (!res.ok || !body.document) throw new Error(body.error || "Could not install the license");
  saveBoundDocument(body.document);
  return body.document;
}

export async function refreshLicenseFromServer(): Promise<void> {
  if (!licenseToken()) return;
  try {
    const res = await licenseFetch(`/api/license/refresh.php?instanceId=${encodeURIComponent(instanceId())}`);
    if (res.status === 401) {
      clearLicenseToken();
      return;
    }
    if (res.status === 404) {
      clearStoredLicense();
      return;
    }
    if (!res.ok) return;
    const body = (await res.json()) as { document?: LicenseDocument; revoked?: boolean; unbound?: boolean };
    if (body.revoked) {
      clearStoredLicense();
      return;
    }
    if (body.document) saveBoundDocument(body.document);
  } catch {
    /* keep the license already stored on this server */
  }
}

export async function returnInstalledLicense(): Promise<void> {
  const stored = readStoredLicense();
  if (!stored || !isDocument(stored.document)) {
    throw new Error("This server has no license to return");
  }
  const local = instanceId();
  let res: Response;
  try {
    res = await licenseFetch("/api/license/return.php", {
      method: "POST",
      body: JSON.stringify({
        licenseId: stored.document.id,
        instanceId: local,
        proof: returnProof(stored.document.bindKey, local),
      }),
    });
  } catch {
    throw new Error("Could not reach box-io.com, so this checkout is still locked. Try again when this server is online.");
  }
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    released?: boolean;
    alreadyReleased?: boolean;
  };
  if (res.ok && (body.released || body.alreadyReleased)) {
    clearStoredLicense();
    return;
  }
  throw new Error(body.error || "Could not return the license");
}

export function licenseSummary(now = Date.now()): {
  licensed: boolean;
  kind: string;
  holder: string;
  expiresAt: string;
  pendingCheckout: string;
  instanceId: string;
  hasLicenseFile: boolean;
} {
  const local = existsSync(instancePath()) ? readFileSync(instancePath(), "utf8").trim() : "";
  if (process.env.BOXIO_LICENSE_DEV === "1") {
    return {
      licensed: true,
      kind: "dev",
      holder: "",
      expiresAt: "",
      pendingCheckout: "",
      instanceId: local,
      hasLicenseFile: false,
    };
  }
  const stored = readStoredLicense();
  const licensed = licenseAllowsData(now);
  if (!stored || !isDocument(stored.document)) {
    return {
      licensed: false,
      kind: "",
      holder: "",
      expiresAt: "",
      pendingCheckout: "",
      instanceId: local,
      hasLicenseFile: false,
    };
  }
  return {
    licensed,
    kind: stored.document.kind,
    holder: stored.document.holder,
    expiresAt: stored.document.expiresAt,
    pendingCheckout: stored.mode === "pending" ? stored.checkoutCode : "",
    instanceId: local,
    hasLicenseFile: true,
  };
}
