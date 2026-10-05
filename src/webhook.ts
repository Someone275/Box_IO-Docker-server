import { db } from "./db.js";
import { writePinProperty, type DeviceRow } from "./device.js";
import { deliverWebhook, webhookRequest } from "./webhook-template.js";

interface SavedWidget {
  type?: string;
  pin?: number;
  deviceKeyId?: number;
  props?: { url?: string; method?: string; data?: string; contentType?: string };
}

function widgetsFromLayout(layoutJson: string): SavedWidget[] {
  let data: { pages?: { widgets?: SavedWidget[] }[]; widgets?: SavedWidget[] } = {};
  try {
    const parsed = JSON.parse(layoutJson || "{}") as unknown;
    if (parsed && typeof parsed === "object") data = parsed as typeof data;
  } catch {
    return [];
  }
  const pages = Array.isArray(data.pages) && data.pages.length ? data.pages : [{ widgets: data.widgets }];
  const widgets: SavedWidget[] = [];
  for (const page of pages) {
    for (const widget of page?.widgets || []) widgets.push(widget);
  }
  return widgets;
}

/** Call every webhook widget bound to this device pin. virtualWrite is the only trigger. */
export async function fireWebhooksForPin(device: DeviceRow, pin: number, value: string): Promise<void> {
  const projects = db
    .prepare("SELECT device_key_id, layout_json FROM projects WHERE user_id = ?")
    .all(device.user_id) as { device_key_id: number | null; layout_json: string }[];
  const lines: string[] = [];
  for (const project of projects) {
    for (const widget of widgetsFromLayout(project.layout_json)) {
      if (widget?.type !== "webhook" || Number(widget.pin) !== pin) continue;
      const bound = Number(widget.deviceKeyId) || project.device_key_id;
      if (bound !== device.id) continue;
      const built = webhookRequest({
        url: widget.props?.url,
        method: widget.props?.method,
        data: widget.props?.data,
        contentType: widget.props?.contentType,
        value,
      });
      if (!built.ok) {
        lines.push(built.error);
        continue;
      }
      try {
        lines.push(await deliverWebhook(built.call));
      } catch (err) {
        const message = err instanceof Error ? err.message : "request failed";
        lines.push(message);
      }
    }
  }
  if (!lines.length) return;
  writePinProperty(device, pin, "webhookStatus", lines.join(" · ").slice(0, 240));
}
