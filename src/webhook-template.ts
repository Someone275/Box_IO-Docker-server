export type WebhookMethod = "GET" | "POST" | "PUT";

export type WebhookContentType = "application/json" | "text/plain" | "application/x-www-form-urlencoded";

export interface WebhookCall {
  url: string;
  method: WebhookMethod;
  body?: string;
  contentType?: string;
}

/** The header that will be sent. Missing values follow the shape of the data template. */
export function webhookContentType(raw?: string, data?: string): WebhookContentType {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "application/json") return "application/json";
  if (value === "text/plain") return "text/plain";
  if (value === "application/x-www-form-urlencoded") return "application/x-www-form-urlencoded";
  const trimmed = String(data || "").trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "application/json";
  if (trimmed.includes("=")) return "application/x-www-form-urlencoded";
  return "text/plain";
}

/** Comma-separated virtualWrite fields. `{1}` is the first field. */
export function webhookParts(value: string): string[] {
  return String(value ?? "").split(",").map((part) => part.trim());
}

function insertToken(raw: string, mode: "url" | "text" | "json" | "form") {
  if (mode === "url") return encodeURIComponent(raw);
  if (mode === "form") return encodeURIComponent(raw).replace(/%20/g, "+");
  if (mode === "json") return raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  return raw;
}

/** Replace `{1}`, `{2}`, … and `{value}` in a URL or body template. */
export function fillWebhookTemplate(template: string, value: string, mode: "url" | "text" | "json" | "form") {
  const parts = webhookParts(value);
  return String(template ?? "").replace(/\{(\d+|value)\}/gi, (match, token: string) => {
    if (token.toLowerCase() === "value") return insertToken(value, mode);
    const index = Number(token);
    if (!Number.isInteger(index) || index < 1) return match;
    return insertToken(parts[index - 1] ?? "", mode);
  });
}

function headerFor(contentType: WebhookContentType) {
  if (contentType === "text/plain") return "text/plain;charset=utf-8";
  return contentType;
}

export function webhookRequest(opts: {
  url?: string;
  method?: string;
  data?: string;
  contentType?: string;
  value: string;
}): { ok: true; call: WebhookCall } | { ok: false; error: string } {
  const method = String(opts.method || "POST").trim().toUpperCase();
  if (method !== "GET" && method !== "POST" && method !== "PUT") {
    return { ok: false, error: "Method must be GET, POST, or PUT" };
  }
  const rawUrl = String(opts.url || "").trim();
  if (!rawUrl) return { ok: false, error: "URL is empty" };
  if (rawUrl.length > 2000) return { ok: false, error: "URL is too long" };
  const dataTemplate = String(opts.data || "");
  if (dataTemplate.length > 8000) return { ok: false, error: "Data is too long" };

  const contentType = webhookContentType(opts.contentType, dataTemplate);
  const bodyMode = contentType === "application/json" ? "json" : contentType === "application/x-www-form-urlencoded" ? "form" : "text";
  let url = fillWebhookTemplate(rawUrl, opts.value, "url");
  const data = fillWebhookTemplate(dataTemplate, opts.value, bodyMode);
  if (method === "GET" && dataTemplate.trim()) {
    const query = fillWebhookTemplate(dataTemplate, opts.value, contentType === "application/x-www-form-urlencoded" ? "form" : "url");
    if (query.startsWith("?") || query.startsWith("&")) {
      url += url.includes("?") ? query.replace(/^\?/, "&") : query.replace(/^&/, "?");
    } else {
      url += `${url.includes("?") ? "&" : "?"}${query}`;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "URL is not valid" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "URL must start with http:// or https://" };
  }
  if (method === "GET") return { ok: true, call: { url: parsed.toString(), method } };
  return { ok: true, call: { url: parsed.toString(), method, body: data, contentType: headerFor(contentType) } };
}

export async function deliverWebhook(call: WebhookCall): Promise<string> {
  const res = await fetch(call.url, {
    method: call.method,
    headers: call.body !== undefined && call.contentType ? { "Content-Type": call.contentType } : undefined,
    body: call.method === "GET" ? undefined : call.body,
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
  });
  return `${res.status} ${call.method}`;
}
