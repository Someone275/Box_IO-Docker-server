export const WEBHOOK_CONTENT_TYPES = [
  "application/json",
  "text/plain",
  "application/x-www-form-urlencoded",
] as const;

export type WebhookContentType = (typeof WEBHOOK_CONTENT_TYPES)[number];

/** Matches the server. A saved content type wins. Otherwise JSON, form, then plain text. */
export function webhookContentType(raw?: string, data?: string): WebhookContentType {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "application/json" || value === "text/plain" || value === "application/x-www-form-urlencoded") {
    return value;
  }
  const trimmed = String(data || "").trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "application/json";
  if (trimmed.includes("=")) return "application/x-www-form-urlencoded";
  return "text/plain";
}
