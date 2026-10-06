import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Pencil, Play, Plus, Save, Trash2 } from "lucide-react";
import { api, getToken } from "@/lib/api";
import {
  WIDGET_META,
  type BoardWidget,
  type ColorRule,
  type DeviceKey,
  type Project,
  type WidgetProps,
  type WidgetType,
} from "@/lib/types";
import {
  activatePage,
  emptyLayout,
  parseLayout,
  pinKey,
  serializeLayout,
  syncLayoutScreen,
  updateActivePage,
  type BoardLayout,
} from "@/lib/layout";
import {
  applyCustomScreen,
  applyScreenTemplate,
  matchingScreenTemplate,
  screenForNewPage,
  screenLabel,
  screenTemplates,
} from "@/lib/screen";
import { addColorDivision, dpadPins, lineWidth, liveStr, MAX_COLOR_DIVISIONS, removeColorDivision, sliderBounds } from "@/lib/utils";
import { addGraphSeries, LIVE_SPANS, MAX_GRAPH_SERIES, normalizeGraphSeries, normalizeLiveSpan, normalizeSampleEvery, retentionText } from "@/lib/graph";
import { WEBHOOK_CONTENT_TYPES, webhookContentType } from "@/lib/webhook";
import { Canvas, WidgetPalette } from "@/components/Canvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DevicePins {
  deviceKeyId: number;
  pins: { pin: number; value: string }[];
  properties: { pin: number; prop: string; value: string }[];
}

const selectClass = "h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm";

export function ProjectBoardPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [keys, setKeys] = useState<DeviceKey[]>([]);
  const [layout, setLayout] = useState<BoardLayout>(emptyLayout());
  const [values, setValues] = useState<Record<string, string>>({});
  const [properties, setProperties] = useState<Record<string, Record<string, string>>>({});
  const [editing, setEditing] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [name, setName] = useState("");
  const [projectKeyId, setProjectKeyId] = useState<number | "">("");
  const [importId, setImportId] = useState<number | "">("");
  const saveReady = useRef(false);
  const saveDirty = useRef(false);
  const saveSnapshot = useRef("");
  const saveTimer = useRef<number | undefined>(undefined);
  const saveGen = useRef(0);
  const applyRemoteRef = useRef<(row: Project) => void>(() => {});

  const page = layout.pages.find((p) => p.id === layout.activePageId) ?? layout.pages[0];
  const widgets = page?.widgets ?? [];
  const selected = widgets.find((w) => w.id === selectedId) || null;
  const projectDeviceKeyId = projectKeyId === "" ? null : projectKeyId;
  const deviceNames = useMemo(() => {
    const names: Record<number, string> = {};
    for (const key of keys) names[key.id] = key.name;
    return names;
  }, [keys]);

  const applyDevices = useCallback((devices: DevicePins[]) => {
    const nextValues: Record<string, string> = {};
    const nextProps: Record<string, Record<string, string>> = {};
    for (const device of devices) {
      for (const row of device.pins) nextValues[pinKey(device.deviceKeyId, row.pin)] = row.value;
      for (const row of device.properties) {
        const key = pinKey(device.deviceKeyId, row.pin);
        nextProps[key] = { ...(nextProps[key] || {}), [row.prop]: row.value };
      }
    }
    setValues(nextValues);
    setProperties(nextProps);
  }, []);

  const loadPins = useCallback(async () => {
        const data = await api.get<{ devices: DevicePins[] }>(`/api/projects/${id}/pins`);
    applyDevices(data.devices || []);
  }, [applyDevices]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const [p, k, list] = await Promise.all([
          api.get<{ project: Project }>(`/api/projects/${id}`),
          api.get<{ keys: DeviceKey[] }>("/api/keys"),
          api.get<{ projects: Project[] }>("/api/projects"),
        ]);
        if (cancelled) return;
        setProject(p.project);
        if (p.project.access === "view") setEditing(false);
        setName(p.project.name);
        setProjectKeyId(p.project.device_key_id ?? "");
        setKeys(k.keys);
        setProjects(list.projects);
        setLayout(parseLayout(p.project.layout_json));
        await loadPins();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Load failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, loadPins]);

  function boardBody(nextName: string, nextKey: number | "", nextLayout: BoardLayout) {
    return JSON.stringify({
      name: nextName,
      deviceKeyId: nextKey === "" ? null : nextKey,
      layout: serializeLayout(nextLayout),
    });
  }

  applyRemoteRef.current = (row) => {
    if (saveDirty.current) return;
    const nextLayout = parseLayout(row.layout_json);
    const nextKey = row.device_key_id ?? "";
    saveSnapshot.current = boardBody(row.name, nextKey, nextLayout);
    saveDirty.current = false;
    setProject(row);
    setName(row.name);
    setProjectKeyId(nextKey);
    setLayout(nextLayout);
    setSelectedId((current) => {
      const page = nextLayout.pages.find((p) => p.id === nextLayout.activePageId) ?? nextLayout.pages[0];
      return page?.widgets.some((w) => w.id === current) ? current : null;
    });
  };

  useEffect(() => {
    saveReady.current = false;
    saveDirty.current = false;
  }, [id]);

  useEffect(() => {
    if (!id || !project || project.access === "view") return;
    const body = boardBody(name, projectKeyId, layout);
    if (!saveReady.current) {
      saveSnapshot.current = body;
      saveReady.current = true;
      return;
    }
    if (body === saveSnapshot.current) return;
    const gen = ++saveGen.current;
    saveDirty.current = true;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          await api.put(`/api/projects/${id}`, JSON.parse(body) as object);
          if (saveGen.current === gen) {
            saveSnapshot.current = body;
            saveDirty.current = false;
          }
          setSaved("Layout saved");
          window.setTimeout(() => setSaved(""), 1500);
          setError("");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Save failed");
        }
      })();
    }, 700);
    return () => window.clearTimeout(saveTimer.current);
  }, [id, project, name, projectKeyId, layout]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "project" && String(msg.projectId) === id && msg.project) {
          applyRemoteRef.current(msg.project as Project);
          return;
        }
        if (msg.type !== "pin") return;
        const key = pinKey(Number(msg.deviceKeyId), Number(msg.pin));
        setValues((v) => ({ ...v, [key]: msg.value }));
        if (msg.properties) {
          setProperties((p) => ({ ...p, [key]: msg.properties }));
        }
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }, [id]);

  function updateActive(mut: (widgets: BoardWidget[]) => BoardWidget[]) {
    setLayout((current) => ({
      ...current,
      pages: current.pages.map((p) =>
        p.id === current.activePageId ? { ...p, widgets: mut(p.widgets) } : p,
      ),
    }));
  }

  async function save() {
    if (!id) return;
    const body = boardBody(name, projectKeyId, layout);
    const gen = ++saveGen.current;
    window.clearTimeout(saveTimer.current);
    try {
      await api.put(`/api/projects/${id}`, JSON.parse(body) as object);
      if (saveGen.current === gen) {
        saveSnapshot.current = body;
        saveDirty.current = false;
      }
      setSaved("Layout saved");
      setTimeout(() => setSaved(""), 1500);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  function addWidget(type: WidgetType) {
    const meta = WIDGET_META[type];
    const used = new Set<number>();
    for (const item of widgets) {
      if (item.deviceKeyId) continue;
      if (item.type === "line_h" || item.type === "line_v") continue;
      used.add(item.pin);
      if (item.type === "dpad") {
        const bound = dpadPins(item.props, item.pin);
        used.add(bound.up);
        used.add(bound.right);
        used.add(bound.down);
        used.add(bound.left);
      }
    }
    const decorative = type === "line_h" || type === "line_v";
    const reserved: number[] = [];
    for (let n = 0; reserved.length < (type === "dpad" ? 4 : 1) && n < 128; n += 1) {
      if (!used.has(n)) reserved.push(n);
    }
    while (reserved.length < (type === "dpad" ? 4 : 1)) reserved.push(reserved[reserved.length - 1] ?? 0);
    const pin = decorative ? 0 : (reserved[0] ?? 0);
    const maxY = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
    const props = defaultProps(type);
    if (type === "graph") {
      props.graphSeries = [{ pin, color: "#2ee0c5", label: `V${pin}` }];
    }
    if (type === "dpad") {
      props.pinUp = reserved[0];
      props.pinRight = reserved[1];
      props.pinDown = reserved[2];
      props.pinLeft = reserved[3];
      props.onValue = "1";
      props.offValue = "0";
    }
    const widget: BoardWidget = {
      id: crypto.randomUUID(),
      type,
      pin,
      x: 0,
      y: maxY,
      w: Math.min(meta.w, layout.columns),
      h: meta.h,
      props,
    };
    updateActive((list) => [...list, widget]);
    setSelectedId(widget.id);
  }

  async function send(widget: BoardWidget, value: string) {
    if (!id) return;
    const deviceKeyId = widget.deviceKeyId ?? projectDeviceKeyId;
    const key = pinKey(deviceKeyId, widget.pin);
    setValues((v) => ({ ...v, [key]: value }));
    try {
      await api.put(`/api/projects/${id}/pins/${widget.pin}`, {
        value,
        ...(deviceKeyId ? { deviceKeyId } : {}),
      });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    }
  }

  function updateSelected(patch: Partial<BoardWidget>) {
    if (!selected) return;
    updateActive((list) => list.map((w) => (w.id === selected.id ? { ...w, ...patch } : w)));
  }

  function updateProps(patch: WidgetProps) {
    if (!selected) return;
    updateActive((list) =>
      list.map((w) => (w.id === selected.id ? { ...w, props: { ...w.props, ...patch } } : w)),
    );
  }

  async function commitLiveText(prop: "label" | "textOn" | "textOff", next: string) {
    if (!selected || !id) return;
    const deviceKeyId = selected.deviceKeyId ?? projectDeviceKeyId;
    const key = pinKey(deviceKeyId, selected.pin);
    updateProps({ [prop]: next });
    setProperties((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), [prop]: next } }));
    if (!deviceKeyId) return;
    try {
      await api.put(`/api/projects/${id}/pins/${selected.pin}/properties`, {
        prop,
        value: next,
        deviceKeyId,
      });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update button text");
    }
  }

  async function commitSliderLimit(prop: "min" | "max", next: number) {
    if (!selected || !id) return;
    const deviceKeyId = selected.deviceKeyId ?? projectDeviceKeyId;
    const key = pinKey(deviceKeyId, selected.pin);
    const live = { ...(properties[key] || {}), [prop]: String(next) };
    const bounds = sliderBounds({ ...selected.props, [prop]: next }, live);
    updateProps({ [prop]: next });
    setProperties((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), [prop]: String(next) } }));
    const current = Number(values[key]);
    if (Number.isFinite(current) && (current < bounds.min || current > bounds.max)) {
      const clamped = Math.min(bounds.max, Math.max(bounds.min, current));
      void send(selected, String(clamped));
    }
    if (!deviceKeyId) return;
    try {
      await api.put(`/api/projects/${id}/pins/${selected.pin}/properties`, {
        prop,
        value: String(next),
        deviceKeyId,
      });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update slider range");
    }
  }

  function moveSelected(dir: -1 | 1) {
    if (!selected) return;
    updateActive((list) => {
      const index = list.findIndex((w) => w.id === selected.id);
      const nextIndex = index + dir;
      if (index < 0 || nextIndex < 0 || nextIndex >= list.length) return list;
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  }

  async function importProject(sourceId: number) {
    let data: { project: Project };
    try {
      data = await api.get<{ project: Project }>(`/api/projects/${sourceId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      return;
    }
    const source = parseLayout(data.project.layout_json);
    const incoming = source.pages.flatMap((p) => p.widgets);
    if (!incoming.length) {
      setError("That project has no widgets to import");
      return;
    }
    updateActive((list) => {
      const maxY = list.reduce((m, w) => Math.max(m, w.y + w.h), 0);
      const copies = incoming.map((w) => ({
        ...w,
        id: crypto.randomUUID(),
        y: w.y + maxY,
        deviceKeyId: w.deviceKeyId ?? data.project.device_key_id ?? undefined,
        props: { ...w.props },
      }));
      return [...list, ...copies];
    });
    setError("");
    setSaved(`Imported ${incoming.length} widget${incoming.length === 1 ? "" : "s"}`);
    setTimeout(() => setSaved(""), 1800);
  }

  const stopEditor = useMemo(() => selected?.props.colorStops || [], [selected]);
  const selectedLive = selected
    ? properties[pinKey(selected.deviceKeyId ?? projectDeviceKeyId, selected.pin)] || {}
    : {};
  const screenW = layout.columns * layout.snap;
  const screenH = layout.rows * layout.snap;

  if (error && !project) return <p className="text-danger">{error}</p>;
  if (!project) return <p className="text-muted">Loading board…</p>;
  const viewing = project.access === "view";
  const boardEditing = editing && !viewing;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          {viewing ? (
            <h1 className="truncate text-xl font-semibold">{name}</h1>
          ) : (
            <Input className="max-w-xs" value={name} onChange={(e) => setName(e.target.value)} />
          )}
          {!viewing && (
          <select
            className="h-10 max-w-xs rounded-lg border border-line bg-bg px-3 text-sm"
            value={projectKeyId}
            onChange={(e) => setProjectKeyId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">No device key</option>
            {keys.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {!viewing && (
          <Button
            variant="secondary"
            onClick={() => {
              setEditing((v) => {
                if (v) setSelectedId(null);
                return !v;
              });
            }}
          >
            {boardEditing ? <Play size={16} /> : <Pencil size={16} />}
            {boardEditing ? "Live" : "Edit"}
          </Button>
          )}
          {!viewing && (
          <>
          <Button onClick={() => void save()}>
            <Save size={16} />
            Save layout
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm("Delete this project?")) return;
              await api.del(`/api/projects/${id}`);
              navigate("/");
            }}
          >
            <Trash2 size={16} />
          </Button>
          </>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {saved && <p className="text-sm text-accent">{saved}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {layout.pages.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setLayout((current) => activatePage(current, p.id));
              setSelectedId(null);
            }}
            className={
              p.id === page?.id
                ? "rounded-full bg-accent/15 px-3 py-1 text-sm text-accent"
                : "rounded-full border border-line px-3 py-1 text-sm text-muted hover:text-ink"
            }
          >
            {p.name}
          </button>
        ))}
        {boardEditing && (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const pageId = crypto.randomUUID();
                setLayout((current) => {
                  const screen = screenForNewPage(current.pages);
                  return syncLayoutScreen({
                    ...current,
                    activePageId: pageId,
                    pages: [
                      ...current.pages,
                      {
                        id: pageId,
                        name: `Page ${current.pages.length + 1}`,
                        widgets: [],
                        snap: screen.snap,
                        columns: screen.columns,
                        rows: screen.rows,
                      },
                    ],
                  });
                });
                setSelectedId(null);
              }}
            >
              <Plus size={14} />
              Page
            </Button>
            {layout.pages.length > 1 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setLayout((current) => {
                    const pages = current.pages.filter((p) => p.id !== current.activePageId);
                    return syncLayoutScreen({
                      ...current,
                      pages,
                      activePageId: pages[0]?.id || current.activePageId,
                    });
                  });
                  setSelectedId(null);
                }}
              >
                Delete page
              </Button>
            )}
            <Input
              className="h-8 max-w-40"
              value={page?.name || ""}
              onChange={(e) =>
                setLayout((current) => ({
                  ...current,
                  pages: current.pages.map((p) =>
                    p.id === current.activePageId ? { ...p, name: e.target.value } : p,
                  ),
                }))
              }
            />
            <BackgroundField
              label="Page background"
              value={page?.background}
              onChange={(background) => setLayout((current) => updateActivePage(current, { background }))}
            />
          </>
        )}
      </div>

      {boardEditing && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex w-full flex-wrap items-center gap-2">
            {screenTemplates.map((screen) => (
              <button
                key={screen.name}
                type="button"
                data-testid={`screen-${screen.name}`}
                onClick={() => setLayout((current) => applyScreenTemplate(current, screen))}
                className={
                  matchingScreenTemplate(layout)?.name === screen.name
                    ? "rounded-full bg-accent/15 px-3 py-1 text-sm text-accent"
                    : "rounded-full border border-line px-3 py-1 text-sm text-muted hover:text-ink"
                }
              >
                {screen.name} {screen.width}×{screen.height}
              </button>
            ))}
            <button
              type="button"
              data-testid="screen-Custom"
              className={
                matchingScreenTemplate(layout) == null
                  ? "rounded-full bg-accent/15 px-3 py-1 text-sm text-accent"
                  : "rounded-full border border-line px-3 py-1 text-sm text-muted hover:text-ink"
              }
            >
              Custom {screenW}×{screenH}
            </button>
            <CustomSizeFields
              width={screenW}
              height={screenH}
              onCommit={(width, height) => setLayout((current) => applyCustomScreen(current, width, height))}
            />
          </div>
          <NumberSetting
            label="Snap grid"
            value={layout.snap}
            min={16}
            max={160}
            onCommit={(snap) => setLayout((current) => updateActivePage(current, { snap }))}
          />
          <NumberSetting
            label="Columns"
            value={layout.columns}
            min={4}
            max={48}
            onCommit={(columns) => setLayout((current) => updateActivePage(current, { columns }))}
          />
          <NumberSetting
            label="Rows"
            value={layout.rows}
            min={4}
            max={80}
            onCommit={(rows) => setLayout((current) => updateActivePage(current, { rows }))}
          />
          <Field label="Import widgets">
            <div className="flex gap-2">
              <select
                className="h-10 rounded-lg border border-line bg-bg px-3 text-sm"
                value={importId}
                onChange={(e) => setImportId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Another project…</option>
                {projects
                  .filter((p) => String(p.id) !== id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.device_name ? ` · ${p.device_name}` : ""}
                    </option>
                  ))}
              </select>
              <Button
                variant="secondary"
                disabled={importId === ""}
                onClick={() => {
                  if (importId !== "") void importProject(importId);
                }}
              >
                Import
              </Button>
            </div>
          </Field>
        </div>
      )}

      <div className={boardEditing ? "grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]" : ""}>
        <div className="min-w-0 overflow-auto rounded-2xl bg-[#070d18] p-3">
          <Canvas
            projectId={id}
            widgets={widgets}
            values={values}
            properties={properties}
            projectDeviceKeyId={projectDeviceKeyId}
            deviceNames={deviceNames}
            snap={layout.snap}
            columns={layout.columns}
            rows={layout.rows}
            editing={boardEditing}
            showFrameLabel={boardEditing}
            frameLabel={screenLabel(layout)}
            pageBackground={page?.background}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={(next) => updateActive(() => next)}
            onSend={(widget, value) => void send(widget, value)}
          />
        </div>
        {boardEditing && (
          <div className="space-y-4 xl:max-h-[calc(100svh-8rem)] xl:overflow-auto">
            <Card>
              <CardHeader>
                <CardTitle>Add widget</CardTitle>
              </CardHeader>
              <CardContent>
                <WidgetPalette onAdd={addWidget} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{selected ? "Widget properties" : "Select a widget"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!selected ? (
                  <p className="text-sm text-muted">
                    Tap a widget to bind a device, pin, colors, and text. Drag inside the grid to move it.
                    The corner handle resizes it, and the gauge scales with the box.
                  </p>
                ) : (
                  <>
                    {!(
                      selected.type === "line_h" ||
                      selected.type === "line_v" ||
                      (selected.type === "label" && selected.props.detached !== false)
                    ) && (
                      <>
                        <Field label="Device">
                          <select
                            className={selectClass}
                            value={selected.deviceKeyId ?? ""}
                            onChange={(e) =>
                              updateSelected({
                                deviceKeyId: e.target.value ? Number(e.target.value) : undefined,
                              })
                            }
                          >
                            <option value="">
                              Project device
                              {projectDeviceKeyId ? ` (${deviceNames[projectDeviceKeyId] || "selected"})` : ""}
                            </option>
                            {keys.map((k) => (
                              <option key={k.id} value={k.id}>
                                {k.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        {selected.type !== "dpad" && (
                          <Field label={selected.type === "watchdog" ? "Arduino pin" : "Virtual pin"}>
                            <Input
                              type="number"
                              min={0}
                              max={127}
                              value={selected.pin}
                              onChange={(e) => updateSelected({ pin: Number(e.target.value) })}
                            />
                          </Field>
                        )}
                        {selected.type === "watchdog" && (
                          <p className="text-xs text-muted">
                            GPIO on the Arduino. Pin 2 is digital pin 2 on the board, not virtual pin V2.
                          </p>
                        )}
                        {Object.keys(selectedLive).length > 0 && (
                          <p className="text-xs text-muted">
                            Firmware <code className="font-mono">setProperty</code> is live on this pin:{" "}
                            {Object.keys(selectedLive).join(", ")}
                          </p>
                        )}
                      </>
                    )}
                    {selected.type === "label" ? (
                      <>
                        <Field label="Text">
                          <Input
                            value={selected.props.text ?? ""}
                            onChange={(e) => updateProps({ text: e.target.value })}
                          />
                        </Field>
                        <Check
                          label="Attach to a pin"
                          checked={selected.props.detached === false}
                          onChange={(checked) => updateProps({ detached: !checked })}
                        />
                        <p className="text-xs text-muted">
                          Attached labels show the pin value, so a sketch can change the text. Unattached
                          labels stay on the text above.
                        </p>
                      </>
                    ) : selected.type === "button_round" || selected.type === "button_oval" ? (
                      <LiveTextField
                        label="Label"
                        value={selected.props.label || ""}
                        onCommit={(next) => void commitLiveText("label", next)}
                      />
                    ) : (
                      <Field label="Label">
                        <Input
                          value={selected.props.label || ""}
                          onChange={(e) => updateProps({ label: e.target.value })}
                        />
                      </Field>
                    )}
                    <Check
                      label="Hide label"
                      checked={!!selected.props.hideLabel}
                      onChange={(checked) => updateProps({ hideLabel: checked })}
                    />
                    <Field label="Font size">
                      <Input
                        type="number"
                        min={8}
                        max={160}
                        placeholder="Auto"
                        value={selected.props.fontSize ?? ""}
                        onChange={(e) =>
                          updateProps({ fontSize: e.target.value === "" ? undefined : Number(e.target.value) })
                        }
                      />
                    </Field>
                    <BackgroundField
                      label="Background"
                      value={selected.props.background}
                      onChange={(background) => updateProps({ background })}
                    />
                    <Field label={`Opacity ${Math.round((selected.props.opacity ?? 1) * 100)}%`}>
                      <input
                        type="range"
                        min={10}
                        max={100}
                        value={Math.round((selected.props.opacity ?? 1) * 100)}
                        onChange={(e) => updateProps({ opacity: Number(e.target.value) / 100 })}
                        className="w-full accent-[#2ee0c5]"
                      />
                    </Field>
                    {(selected.type === "led" || selected.type === "input") && (
                      <>
                        <Field label="Color on">
                          <Input
                            type="color"
                            value={selected.props.colorOn || "#2ee0c5"}
                            onChange={(e) => updateProps({ colorOn: e.target.value })}
                          />
                        </Field>
                        <Field label="Color off">
                          <Input
                            type="color"
                            value={selected.props.colorOff || "#314057"}
                            onChange={(e) => updateProps({ colorOff: e.target.value })}
                          />
                        </Field>
                      </>
                    )}
                    {(selected.type === "value" ||
                      selected.type === "slider_h" ||
                      selected.type === "slider_v" ||
                      selected.type === "label" ||
                      selected.type === "line_h" ||
                      selected.type === "line_v") && (
                      <Field label="Color">
                        <Input
                          type="color"
                          value={
                            selected.props.color ||
                            (selected.type === "label" || selected.type === "line_h" || selected.type === "line_v"
                              ? "#e8eef8"
                              : "#2ee0c5")
                          }
                          onChange={(e) => updateProps({ color: e.target.value })}
                        />
                      </Field>
                    )}
                    {(selected.type === "line_h" || selected.type === "line_v") && (
                      <Field label="Width">
                        <Input
                          type="number"
                          min={1}
                          max={64}
                          data-testid="line-width"
                          value={lineWidth(selected.props.lineWidth)}
                          onChange={(e) => updateProps({ lineWidth: lineWidth(e.target.value) })}
                        />
                      </Field>
                    )}
                    {selected.type === "webhook" && (
                      <>
                        <Field label="URL">
                          <Input
                            value={selected.props.url || ""}
                            placeholder="https://example.com/hook?reading={1}"
                            onChange={(e) => updateProps({ url: e.target.value })}
                          />
                        </Field>
                        <Field label="Method">
                          <select
                            className={selectClass}
                            value={selected.props.method || "POST"}
                            onChange={(e) => updateProps({ method: e.target.value as "GET" | "POST" | "PUT" })}
                          >
                            <option value="GET">GET</option>
                            <option value="POST">POST</option>
                            <option value="PUT">PUT</option>
                          </select>
                        </Field>
                        <Field label="Content type">
                          <select
                            className={selectClass}
                            value={webhookContentType(selected.props.contentType, selected.props.data)}
                            onChange={(e) =>
                              updateProps({
                                contentType: e.target.value as (typeof WEBHOOK_CONTENT_TYPES)[number],
                              })
                            }
                          >
                            {WEBHOOK_CONTENT_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Data">
                          <textarea
                            className="min-h-24 w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm text-ink"
                            value={selected.props.data || ""}
                            placeholder={'{"temp":"{1}","room":"{2}"}'}
                            onChange={(e) => updateProps({ data: e.target.value })}
                          />
                        </Field>
                        <Check
                          label="Hide in live"
                          checked={!!selected.props.hideInLive}
                          onChange={(checked) => updateProps({ hideInLive: checked })}
                        />
                        <p className="text-xs text-muted">
                          Hide removes the widget while Live is on. It stays visible in Edit. A virtualWrite on this pin calls the URL. Comma-separated values fill {"{1}"}, {"{2}"}, and so on.
                          {"{value}"} is the whole string. JSON escapes quotes inside the template. Form data encodes
                          each value as application/x-www-form-urlencoded. Plain text is sent unchanged. GET adds Data
                          onto the URL. POST and PUT send Data as the body. Save the layout after editing.
                        </p>
                      </>
                    )}
                    {selected.type === "watchdog" && (
                      <>
                        <Field label="Site or IP">
                          <Input
                            value={selected.props.target || ""}
                            placeholder="192.168.1.1 or https://example.com"
                            onChange={(e) => updateProps({ target: e.target.value })}
                          />
                        </Field>
                        <Field label="Ping interval (seconds)">
                          <Input
                            type="number"
                            min={5}
                            max={86400}
                            value={selected.props.intervalSec ?? 30}
                            onChange={(e) => updateProps({ intervalSec: Math.max(5, Number(e.target.value) || 30) })}
                          />
                        </Field>
                        <Field label="Missed pings before failure">
                          <Input
                            type="number"
                            min={1}
                            max={50}
                            value={selected.props.misses ?? 3}
                            onChange={(e) => updateProps({ misses: Math.max(1, Number(e.target.value) || 3) })}
                          />
                        </Field>
                        <Field label="On failure">
                          <select
                            className={selectClass}
                            value={selected.props.direction === "low-to-high" ? "low-to-high" : "high-to-low"}
                            onChange={(e) =>
                              updateProps({
                                direction: e.target.value === "low-to-high" ? "low-to-high" : "high-to-low",
                              })
                            }
                          >
                            <option value="high-to-low">High, then low</option>
                            <option value="low-to-high">Low, then high</option>
                          </select>
                        </Field>
                        <Field label="Transition (seconds)">
                          <Input
                            type="number"
                            min={1}
                            max={3600}
                            value={selected.props.transitionSec ?? 5}
                            onChange={(e) => updateProps({ transitionSec: Math.max(1, Number(e.target.value) || 5) })}
                          />
                        </Field>
                        <p className="text-xs text-muted">
                          The Arduino checks that address from the board while BoxIO.run() is in loop(). A host or IP is a
                          connection to port 80. An https URL uses port 443. After the missed checks, the board drives this
                          GPIO high then low, or low then high, and waits the transition between those levels. A later
                          success arms it again. Save the layout and the board picks up the settings.
                        </p>
                      </>
                    )}
                    {(selected.type === "button_round" || selected.type === "button_oval") && (
                      <ButtonFields
                        widget={selected}
                        properties={selectedLive}
                        updateProps={updateProps}
                        onCommitText={(prop, next) => void commitLiveText(prop, next)}
                      />
                    )}
                    {(selected.type === "circle_meter" || selected.type === "bar_meter") && (
                      <>
                        <Field label="Min">
                          <Input
                            type="number"
                            value={selected.props.min ?? 0}
                            onChange={(e) => updateProps({ min: Number(e.target.value) })}
                          />
                        </Field>
                        <Field label="Max">
                          <Input
                            type="number"
                            value={selected.props.max ?? 100}
                            onChange={(e) => updateProps({ max: Number(e.target.value) })}
                          />
                        </Field>
                        {selected.type === "circle_meter" && (
                          <>
                            <Field label="Start (degrees)">
                              <Input
                                type="number"
                                min={0}
                                max={360}
                                value={selected.props.startDeg ?? 225}
                                onChange={(e) =>
                                  updateProps({ startDeg: Math.min(360, Math.max(0, Number(e.target.value) || 0)) })
                                }
                              />
                            </Field>
                            <Field label="End (degrees)">
                              <Input
                                type="number"
                                min={0}
                                max={360}
                                value={selected.props.endDeg ?? 135}
                                onChange={(e) =>
                                  updateProps({ endDeg: Math.min(360, Math.max(0, Number(e.target.value) || 0)) })
                                }
                              />
                            </Field>
                            <p className="text-xs text-muted sm:col-span-2">
                              0° is straight up and degrees go clockwise. The value travels from Start to End. 225 to 135
                              runs from the lower left to the lower right. The same number for both, or 0 and 360, is a
                              full circle.
                            </p>
                          </>
                        )}
                        <Field label="Color by">
                          <select
                            className={selectClass}
                            value={selected.props.colorMode || "percentage"}
                            onChange={(e) =>
                              updateProps({ colorMode: e.target.value as "percentage" | "values" })
                            }
                          >
                            <option value="percentage">Percentage of max</option>
                            <option value="values">Raw data values</option>
                          </select>
                        </Field>
                        <p className="text-xs text-muted">
                          Color divisions: {stopEditor.length} of {MAX_COLOR_DIVISIONS}. One color fills the gauge.
                          Add a division to change color when the reading reaches that number.
                        </p>
                        {stopEditor.map((stop, i) => (
                          <div key={i} className="flex items-center gap-2">
                            {stopEditor.length > 1 ? (
                              <Input
                                type="number"
                                aria-label={`Division ${i + 1} threshold`}
                                value={stop.at}
                                onChange={(e) => {
                                  const colorStops = [...stopEditor];
                                  colorStops[i] = { ...stop, at: Number(e.target.value) };
                                  updateProps({ colorStops });
                                }}
                              />
                            ) : null}
                            <Input
                              type="color"
                              aria-label={`Division ${i + 1} color`}
                              value={stop.color}
                              onChange={(e) => {
                                const colorStops = [...stopEditor];
                                colorStops[i] = { ...stop, color: e.target.value };
                                updateProps({ colorStops });
                              }}
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={stopEditor.length <= 1}
                              onClick={() => updateProps({ colorStops: removeColorDivision(stopEditor, i) })}
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={stopEditor.length >= MAX_COLOR_DIVISIONS}
                          onClick={() => updateProps({ colorStops: addColorDivision(stopEditor) })}
                        >
                          Add division
                        </Button>
                      </>
                    )}
                    {(selected.type === "slider_h" || selected.type === "slider_v") && (
                      <SliderRangeFields
                        widget={selected}
                        properties={properties[pinKey(selected.deviceKeyId ?? projectDeviceKeyId, selected.pin)] || {}}
                        value={values[pinKey(selected.deviceKeyId ?? projectDeviceKeyId, selected.pin)]}
                        onCommit={(prop, next) => void commitSliderLimit(prop, next)}
                      />
                    )}
                    {selected.type === "dpad" && (
                      <DpadFields
                        widget={selected}
                        updateProps={updateProps}
                        updatePin={(pin) => updateSelected({ pin })}
                      />
                    )}
                    {selected.type === "graph" && (
                      <GraphFields
                        widget={selected}
                        updateProps={updateProps}
                        updatePin={(pin) => updateSelected({ pin })}
                      />
                    )}
                    {selected.type === "grid" && (
                      <GridPropsEditor
                        widget={selected}
                        liveProperties={
                          properties[pinKey(selected.deviceKeyId ?? projectDeviceKeyId, selected.pin)] || {}
                        }
                        updateProps={updateProps}
                      />
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" variant="secondary" onClick={() => moveSelected(1)}>
                        Bring forward
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => moveSelected(-1)}>
                        Send backward
                      </Button>
                    </div>
                    <Button
                      variant="danger"
                      className="w-full"
                      onClick={() => {
                        updateActive((list) => list.filter((w) => w.id !== selected.id));
                        setSelectedId(null);
                      }}
                    >
                      Remove widget
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function DpadFields({
  widget,
  updateProps,
  updatePin,
}: {
  widget: BoardWidget;
  updateProps: (patch: WidgetProps) => void;
  updatePin: (pin: number) => void;
}) {
  const pins = dpadPins(widget.props, widget.pin);
  function setPin(key: "pinUp" | "pinRight" | "pinDown" | "pinLeft", raw: string) {
    const pin = Math.max(0, Math.min(127, Math.round(Number(raw))));
    if (!Number.isFinite(pin)) return;
    updateProps({ [key]: pin });
    if (key === "pinUp") updatePin(pin);
  }
  const fields: { key: "pinUp" | "pinRight" | "pinDown" | "pinLeft"; label: string; value: number }[] = [
    { key: "pinUp", label: "Up pin", value: pins.up },
    { key: "pinRight", label: "Right pin", value: pins.right },
    { key: "pinDown", label: "Down pin", value: pins.down },
    { key: "pinLeft", label: "Left pin", value: pins.left },
  ];
  return (
    <>
      <p className="text-xs text-muted">Each arrow writes its own virtual pin while you hold it, and the released value when you let go.</p>
      {fields.map((field) => (
        <Field key={field.key} label={field.label}>
          <Input
            type="number"
            min={0}
            max={127}
            value={field.value}
            onChange={(e) => setPin(field.key, e.target.value)}
          />
        </Field>
      ))}
      <Field label="Value when pressed">
        <Input
          value={widget.props.onValue || "1"}
          onChange={(e) => updateProps({ onValue: e.target.value, sendValue: e.target.value })}
        />
      </Field>
      <Field label="Value when released">
        <Input value={widget.props.offValue ?? "0"} onChange={(e) => updateProps({ offValue: e.target.value })} />
      </Field>
      <Field label="Pressed color">
        <Input type="color" value={widget.props.colorOn || "#2ee0c5"} onChange={(e) => updateProps({ colorOn: e.target.value })} />
      </Field>
      <Field label="Pad color">
        <Input type="color" value={widget.props.colorOff || "#314057"} onChange={(e) => updateProps({ colorOff: e.target.value })} />
      </Field>
    </>
  );
}

function GraphFields({
  widget,
  updateProps,
  updatePin,
}: {
  widget: BoardWidget;
  updateProps: (patch: WidgetProps) => void;
  updatePin: (pin: number) => void;
}) {
  const series = normalizeGraphSeries(widget.props.graphSeries, widget.pin);
  const sampleEvery = normalizeSampleEvery(widget.props.sampleEvery);
  const liveSpan = normalizeLiveSpan(widget.props.liveSpan);
  function commit(next: typeof series) {
    updateProps({ graphSeries: next });
    if (next[0]) updatePin(next[0].pin);
  }
  return (
    <>
      <Field label="Store a reading">
        <select
          className={selectClass}
          value={sampleEvery}
          onChange={(e) => updateProps({ sampleEvery: e.target.value as "second" | "minute" | "hour" })}
        >
          <option value="second">One per second</option>
          <option value="minute">One per minute</option>
          <option value="hour">One per hour</option>
        </select>
      </Field>
      <p className="text-xs text-muted">{retentionText(sampleEvery)}</p>
      <Field label="Live view">
        <select
          className={selectClass}
          value={liveSpan}
          onChange={(e) => updateProps({ liveSpan: e.target.value as "minute" | "15m" | "hour" | "6h" | "day" | "week" | "month" })}
        >
          {LIVE_SPANS.map((span) => (
            <option key={span.id} value={span.id}>
              {span.label}
            </option>
          ))}
        </select>
      </Field>
      <p className="text-xs text-muted">On the graph, Live uses this window. Day, Week, and Month use the date you pick.</p>
      <Check
        label="Time scale"
        checked={widget.props.showTimeScale === true}
        onChange={(checked) => updateProps({ showTimeScale: checked })}
      />
      <Check
        label="Horizontal data scale"
        checked={widget.props.showDataScale === true}
        onChange={(checked) => updateProps({ showDataScale: checked })}
      />
      <p className="text-xs text-muted">Both scales stay off until you turn them on. Time labels the bottom. Data draws horizontal value lines.</p>
      {series.map((item, index) => (
        <div key={`${item.pin}-${index}`} className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            max={127}
            aria-label={`Pin ${index + 1}`}
            value={item.pin}
            onChange={(e) => {
              const pin = Math.min(127, Math.max(0, Math.round(Number(e.target.value) || 0)));
              const next = series.map((entry, i) => (i === index ? { ...entry, pin, label: entry.label === `V${entry.pin}` ? `V${pin}` : entry.label } : entry));
              commit(normalizeGraphSeries(next, pin));
            }}
          />
          <Input
            aria-label={`Label ${index + 1}`}
            value={item.label}
            onChange={(e) => {
              const next = series.map((entry, i) => (i === index ? { ...entry, label: e.target.value } : entry));
              commit(next);
            }}
          />
          <Input
            type="color"
            aria-label={`Color ${index + 1}`}
            value={item.color}
            onChange={(e) => {
              const next = series.map((entry, i) => (i === index ? { ...entry, color: e.target.value } : entry));
              commit(next);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={series.length <= 1}
            onClick={() => commit(series.filter((_, i) => i !== index))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        disabled={series.length >= MAX_GRAPH_SERIES}
        onClick={() => commit(addGraphSeries(series))}
      >
        Add pin
      </Button>
    </>
  );
}

function defaultProps(type: WidgetType): WidgetProps {
  const base: WidgetProps = {
    label: WIDGET_META[type].name,
    colorOn: "#2ee0c5",
    colorOff: "#314057",
    color: type === "label" ? "#e8eef8" : "#2ee0c5",
    min: 0,
    max: 100,
    colorMode: "percentage",
    colorStops: [
      { at: 0, color: "#2ee0c5" },
      { at: 60, color: "#f5b942" },
      { at: 85, color: "#ff5d73" },
    ],
    sendValue: "1",
  };
  if (type === "circle_meter") {
    return { ...base, startDeg: 225, endDeg: 135 };
  }
  if (type === "graph") {
    return {
      label: "Graph",
      sampleEvery: "minute",
      liveSpan: "hour",
      graphSeries: [{ pin: 0, color: "#2ee0c5", label: "V0" }],
    };
  }
  if (type === "dpad") {
    return {
      ...base,
      label: "D-pad",
      onValue: "1",
      offValue: "0",
      pinUp: 0,
      pinRight: 1,
      pinDown: 2,
      pinLeft: 3,
    };
  }
  if (type === "button_round" || type === "button_oval") {
    return {
      ...base,
      textOn: "On",
      textOff: "Off",
      onValue: "1",
      offValue: "0",
      textColorOn: "#071018",
      textColorOff: "#e8eef8",
    };
  }
  if (type === "webhook") {
    return {
      label: "Webhook",
      url: "https://",
      method: "POST",
      contentType: "application/json",
      data: "{\"value\":\"{1}\",\"extra\":\"{2}\"}",
    };
  }
  if (type === "watchdog") {
    return {
      label: "Ping watchdog",
      target: "",
      intervalSec: 30,
      misses: 3,
      direction: "high-to-low",
      transitionSec: 5,
    };
  }
  if (type === "label") {
    return {
      label: "Label",
      text: "Label",
      color: "#e8eef8",
      detached: true,
      hideLabel: true,
      fontSize: 28,
    };
  }
  if (type === "line_h" || type === "line_v") {
    return {
      label: WIDGET_META[type].name,
      color: "#e8eef8",
      lineWidth: 8,
      hideLabel: true,
      background: "transparent",
    };
  }
  if (type === "grid") {
    return {
      ...base,
      rows: 4,
      cols: 4,
      mode: "readonly",
      colorRules: [
        { low: 0, high: 30, color: "#2ee0c5", cells: "all" },
        { low: 31, high: 70, color: "#f5b942", cells: "all" },
        { low: 71, high: 100, color: "#ff5d73", cells: "all" },
      ],
    };
  }
  return base;
}

function SliderRangeFields({
  widget,
  properties,
  value,
  onCommit,
}: {
  widget: BoardWidget;
  properties: Record<string, string>;
  value?: string;
  onCommit: (prop: "min" | "max", next: number) => void;
}) {
  const bounds = sliderBounds(widget.props, properties);
  const current = Number(value);
  const outside = Number.isFinite(current) && (current < bounds.min || current > bounds.max);
  return (
    <>
      <BoundField key={`${widget.id}-min`} label="Min" value={bounds.min} onCommit={(n) => onCommit("min", n)} />
      <BoundField key={`${widget.id}-max`} label="Max" value={bounds.max} onCommit={(n) => onCommit("max", n)} />
      <p className="text-xs text-muted">
        The track runs from {bounds.min} to {bounds.max}. Press Enter to apply.
        {outside ? ` The pin value ${current} is outside that range, so the slider holds it at the nearest end.` : ""}
      </p>
    </>
  );
}

function BoundField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(String(value));
  }, [editing, value]);
  function commit() {
    const n = Number(text);
    if (!Number.isFinite(n)) {
      setText(String(value));
      return;
    }
    setText(String(n));
    if (n !== value) onCommit(n);
  }
  return (
    <Field label={label}>
      <Input
        type="text"
        inputMode="decimal"
        value={text}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </Field>
  );
}

const backgroundSwatches = ["#101827", "#0a1220", "#071018", "#1b2838", "#2ee0c5", "#e8eef8"];

function BackgroundField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
  onChange: (value: string | undefined) => void;
}) {
  const transparent = value === "transparent";
  const hex = value && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : "#101827";
  return (
    <Field label={label}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="color"
          aria-label={label}
          className="h-10 w-14 p-1"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
        />
        {backgroundSwatches.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={`${label} ${swatch}`}
            className="h-6 w-6 rounded-full border-2"
            style={{
              background: swatch,
              borderColor: value?.toLowerCase() === swatch ? "#fff" : "#243044",
            }}
            onClick={() => onChange(swatch)}
          />
        ))}
        <button
          type="button"
          data-testid={label === "Page background" ? "page-fill-transparent" : "widget-fill-transparent"}
          className={
            transparent
              ? "rounded-full bg-accent/15 px-3 py-1 text-sm text-accent"
              : "rounded-full border border-line px-3 py-1 text-sm text-muted"
          }
          style={{
            backgroundImage: transparent
              ? undefined
              : "linear-gradient(45deg, #243044 25%, transparent 25%, transparent 75%, #243044 75%), linear-gradient(45deg, #243044 25%, transparent 25%, transparent 75%, #243044 75%)",
            backgroundSize: "8px 8px",
            backgroundPosition: "0 0, 4px 4px",
          }}
          onClick={() => onChange("transparent")}
        >
          Transparent
        </button>
        <button
          type="button"
          className={
            !value
              ? "rounded-full bg-accent/15 px-3 py-1 text-sm text-accent"
              : "rounded-full border border-line px-3 py-1 text-sm text-muted"
          }
          onClick={() => onChange(undefined)}
        >
          Default
        </button>
      </div>
    </Field>
  );
}

function CustomSizeFields({
  width,
  height,
  onCommit,
}: {
  width: number;
  height: number;
  onCommit: (width: number, height: number) => void;
}) {
  const [w, setW] = useState(String(width));
  const [h, setH] = useState(String(height));
  useEffect(() => setW(String(width)), [width]);
  useEffect(() => setH(String(height)), [height]);
  function commit(nextW: string, nextH: string) {
    const parsedW = Math.round(Number(nextW));
    const parsedH = Math.round(Number(nextH));
    if (!Number.isFinite(parsedW) || !Number.isFinite(parsedH) || parsedW < 1 || parsedH < 1) return;
    if (parsedW === width && parsedH === height) return;
    onCommit(parsedW, parsedH);
  }
  return (
    <>
      <Field label="Width">
        <Input
          type="number"
          min={1}
          className="w-24"
          data-testid="screen-Width"
          value={w}
          onChange={(e) => setW(e.target.value)}
          onBlur={() => commit(w, String(height))}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </Field>
      <Field label="Height">
        <Input
          type="number"
          min={1}
          className="w-24"
          data-testid="screen-Height"
          value={h}
          onChange={(e) => setH(e.target.value)}
          onBlur={() => commit(String(width), h)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </Field>
    </>
  );
}

function NumberSetting({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <Field label={label}>
      <Input
        type="number"
        min={min}
        max={max}
        className="w-24"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = Math.round(Number(text));
          const n = Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : value;
          setText(String(n));
          if (n !== value) onCommit(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </Field>
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

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input
        type="checkbox"
        className="accent-[#2ee0c5]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function LiveTextField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(value);
  }, [editing, value]);
  return (
    <Field label={label}>
      <Input
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (text !== value) onCommit(text);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </Field>
  );
}

function ButtonFields({
  widget,
  properties,
  updateProps,
  onCommitText,
}: {
  widget: BoardWidget;
  properties: Record<string, string>;
  updateProps: (patch: WidgetProps) => void;
  onCommitText: (prop: "textOn" | "textOff", next: string) => void;
}) {
  return (
    <>
      <LiveTextField
        label="On text"
        value={liveStr(properties, "textOn", widget.props.textOn) || "On"}
        onCommit={(next) => onCommitText("textOn", next)}
      />
      <LiveTextField
        label="Off text"
        value={liveStr(properties, "textOff", widget.props.textOff) || "Off"}
        onCommit={(next) => onCommitText("textOff", next)}
      />
      <Field label="Value sent when on">
        <Input
          value={widget.props.onValue ?? widget.props.sendValue ?? "1"}
          onChange={(e) => updateProps({ onValue: e.target.value, sendValue: e.target.value })}
        />
      </Field>
      <Field label="Value sent when off">
        <Input
          value={widget.props.offValue ?? "0"}
          onChange={(e) => updateProps({ offValue: e.target.value })}
        />
      </Field>
      <Field label="Background on">
        <Input
          type="color"
          value={widget.props.colorOn || "#2ee0c5"}
          onChange={(e) => updateProps({ colorOn: e.target.value })}
        />
      </Field>
      <Field label="Background off">
        <Input
          type="color"
          value={widget.props.colorOff || "#314057"}
          onChange={(e) => updateProps({ colorOff: e.target.value })}
        />
      </Field>
      <Field label="Text color on">
        <Input
          type="color"
          value={widget.props.textColorOn || "#071018"}
          onChange={(e) => updateProps({ textColorOn: e.target.value })}
        />
      </Field>
      <Field label="Text color off">
        <Input
          type="color"
          value={widget.props.textColorOff || "#e8eef8"}
          onChange={(e) => updateProps({ textColorOff: e.target.value })}
        />
      </Field>
    </>
  );
}

function GridPropsEditor({
  widget,
  liveProperties,
  updateProps,
}: {
  widget: BoardWidget;
  liveProperties: Record<string, string>;
  updateProps: (patch: BoardWidget["props"]) => void;
}) {
  const rows = widget.props.rows ?? 4;
  const cols = widget.props.cols ?? 4;
  const rules = widget.props.colorRules || [];
  const deviceOverride = Boolean(
    liveProperties.rows || liveProperties.cols || liveProperties.colorRules || liveProperties.colorOff,
  );

  function setRules(next: ColorRule[]) {
    updateProps({ colorRules: next });
  }

  return (
    <>
      {deviceOverride && (
        <p className="text-xs text-muted">
          Firmware <code className="font-mono">setProperty</code> is overriding size or color
          rules on this pin. Dashboard read/write mode still applies.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Rows">
          <Input
            type="number"
            min={1}
            max={16}
            value={rows}
            onChange={(e) => updateProps({ rows: Math.max(1, Math.min(16, Number(e.target.value) || 1)) })}
          />
        </Field>
        <Field label="Columns">
          <Input
            type="number"
            min={1}
            max={16}
            value={cols}
            onChange={(e) => updateProps({ cols: Math.max(1, Math.min(16, Number(e.target.value) || 1)) })}
          />
        </Field>
      </div>
      <Check
        label="Each cell is a pin"
        checked={widget.props.pinPerCell === true}
        onChange={(checked) => updateProps({ pinPerCell: checked })}
      />
      <p className="text-xs text-muted">
        Cell 0 is the virtual pin. Each next cell is the next pin, so pin 2 on a two-cell grid shows live V2 and V3.
        Leave this off to keep one comma-separated value on this pin.
      </p>
      <Field label="Mode">
        <select
          className={selectClass}
          value={widget.props.mode || "readonly"}
          onChange={(e) =>
            updateProps({ mode: e.target.value === "readwrite" ? "readwrite" : "readonly" })
          }
        >
          <option value="readonly">Read only</option>
          <option value="readwrite">Read and write</option>
        </select>
      </Field>
      <Field label="Default cell color">
        <Input
          type="color"
          value={widget.props.colorOff || "#314057"}
          onChange={(e) => updateProps({ colorOff: e.target.value })}
        />
      </Field>
      <div className="flex items-center justify-between">
        <Label>Color rules</Label>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() =>
            setRules([...rules, { low: 0, high: 100, color: "#2ee0c5", cells: "all" }])
          }
        >
          Add rule
        </Button>
      </div>
      {rules.map((rule, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-line p-2">
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <Field label="Low">
              <Input
                type="number"
                value={rule.low}
                onChange={(e) => {
                  const next = [...rules];
                  next[i] = { ...rule, low: Number(e.target.value) };
                  setRules(next);
                }}
              />
            </Field>
            <Field label="High">
              <Input
                type="number"
                value={rule.high}
                onChange={(e) => {
                  const next = [...rules];
                  next[i] = { ...rule, high: Number(e.target.value) };
                  setRules(next);
                }}
              />
            </Field>
            <Input
              type="color"
              className="h-10 w-12 p-1"
              value={rule.color}
              onChange={(e) => {
                const next = [...rules];
                next[i] = { ...rule, color: e.target.value };
                setRules(next);
              }}
            />
          </div>
          <Field label="Apply to">
            <select
              className={selectClass}
              value={rule.cells === "all" ? "all" : "specific"}
              onChange={(e) => {
                const next = [...rules];
                next[i] = { ...rule, cells: e.target.value === "all" ? "all" : [] };
                setRules(next);
              }}
            >
              <option value="all">All cells</option>
              <option value="specific">Certain cells</option>
            </select>
          </Field>
          {rule.cells !== "all" && (
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: rows * cols }, (_, cell) => {
                const selectedCells = Array.isArray(rule.cells) ? rule.cells : [];
                const on = selectedCells.includes(cell);
                return (
                  <button
                    key={cell}
                    type="button"
                    title={`Cell ${cell}`}
                    className="h-7 rounded-md border text-[10px] font-mono"
                    style={{
                      background: on ? rule.color : "#0b1220",
                      color: on ? "#071018" : "#8b9bb4",
                      borderColor: on ? rule.color : "#243044",
                    }}
                    onClick={() => {
                      const picked = new Set(selectedCells);
                      if (picked.has(cell)) picked.delete(cell);
                      else picked.add(cell);
                      const next = [...rules];
                      next[i] = { ...rule, cells: [...picked].sort((a, b) => a - b) };
                      setRules(next);
                    }}
                  >
                    {cell}
                  </button>
                );
              })}
            </div>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="w-full"
            onClick={() => setRules(rules.filter((_, idx) => idx !== i))}
          >
            Remove rule
          </Button>
        </div>
      ))}
    </>
  );
}
