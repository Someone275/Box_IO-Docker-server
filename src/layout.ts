/** Device keys a saved layout can read, including the project default. */
export function referencedDeviceKeyIds(layoutJson: string, projectKeyId: number | null): number[] {
  const ids = new Set<number>();
  if (projectKeyId && Number.isInteger(projectKeyId) && projectKeyId > 0) ids.add(projectKeyId);
  let data: { pages?: { widgets?: { deviceKeyId?: unknown }[] }[]; widgets?: { deviceKeyId?: unknown }[] } = {};
  try {
    const parsed = JSON.parse(layoutJson || "{}") as unknown;
    if (parsed && typeof parsed === "object") data = parsed as typeof data;
  } catch {
    return [...ids];
  }
  const pages = Array.isArray(data.pages) && data.pages.length ? data.pages : [{ widgets: data.widgets }];
  for (const page of pages) {
    for (const widget of page?.widgets || []) {
      const id = Number(widget?.deviceKeyId);
      if (Number.isInteger(id) && id > 0) ids.add(id);
    }
  }
  return [...ids];
}
