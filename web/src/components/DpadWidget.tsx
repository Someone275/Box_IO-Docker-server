import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { pinKey } from "@/lib/layout";
import { buttonValues, dpadPins } from "@/lib/utils";
import type { BoardWidget } from "@/lib/types";

type Direction = "up" | "right" | "down" | "left";

const ARROWS: Record<Direction, string> = {
  up: "M6 14 L12 7 L18 14",
  right: "M10 6 L17 12 L10 18",
  down: "M6 10 L12 17 L18 10",
  left: "M14 6 L7 12 L14 18",
};

export function DpadWidget({
  widget,
  values = {},
  deviceKeyId = null,
  editing,
  colorOn,
  colorOff,
  onSend,
}: {
  widget: BoardWidget;
  values?: Record<string, string>;
  deviceKeyId?: number | null;
  editing?: boolean;
  colorOn: string;
  colorOff: string;
  onSend?: (value: string, pin?: number) => void;
}) {
  const pins = dpadPins(widget.props, widget.pin);
  const { onValue, offValue } = buttonValues(widget.props);
  const held = useRef(new Map<number, Direction>());
  const [local, setLocal] = useState<Set<Direction>>(() => new Set());

  function syncLocal() {
    setLocal(new Set(held.current.values()));
  }

  function press(event: ReactPointerEvent<HTMLButtonElement>, direction: Direction) {
    if (editing) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const already = [...held.current.values()].includes(direction);
    held.current.set(event.pointerId, direction);
    syncLocal();
    if (!already) onSend?.(onValue, pins[direction]);
  }

  function release(event: ReactPointerEvent<HTMLButtonElement>) {
    const direction = held.current.get(event.pointerId);
    if (!direction) return;
    held.current.delete(event.pointerId);
    syncLocal();
    if (![...held.current.values()].includes(direction)) onSend?.(offValue, pins[direction]);
  }

  function lit(direction: Direction) {
    if (local.has(direction)) return true;
    const current = values[pinKey(deviceKeyId, pins[direction])] ?? "";
    return current === onValue;
  }

  return (
    <div className="relative mx-auto aspect-square h-full max-h-full w-full max-w-full">
      <div
        className="grid h-full w-full"
        style={{ gridTemplateColumns: "1fr 1.08fr 1fr", gridTemplateRows: "1fr 1.08fr 1fr" }}
      >
        <span />
        <Arm
          direction="up"
          label={editing ? `V${pins.up}` : ""}
          active={lit("up")}
          colorOn={colorOn}
          colorOff={colorOff}
          radius="42% 42% 18% 18%"
          disabled={!!editing}
          onPointerDown={(event) => press(event, "up")}
          onPointerUp={release}
          onPointerCancel={release}
        />
        <span />
        <Arm
          direction="left"
          label={editing ? `V${pins.left}` : ""}
          active={lit("left")}
          colorOn={colorOn}
          colorOff={colorOff}
          radius="42% 18% 18% 42%"
          disabled={!!editing}
          onPointerDown={(event) => press(event, "left")}
          onPointerUp={release}
          onPointerCancel={release}
        />
        <span />
        <Arm
          direction="right"
          label={editing ? `V${pins.right}` : ""}
          active={lit("right")}
          colorOn={colorOn}
          colorOff={colorOff}
          radius="18% 42% 42% 18%"
          disabled={!!editing}
          onPointerDown={(event) => press(event, "right")}
          onPointerUp={release}
          onPointerCancel={release}
        />
        <span />
        <Arm
          direction="down"
          label={editing ? `V${pins.down}` : ""}
          active={lit("down")}
          colorOn={colorOn}
          colorOff={colorOff}
          radius="18% 18% 42% 42%"
          disabled={!!editing}
          onPointerDown={(event) => press(event, "down")}
          onPointerUp={release}
          onPointerCancel={release}
        />
        <span />
      </div>
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: "30%",
          height: "30%",
          background: "radial-gradient(circle at 38% 32%, #6a7588, #1c2433 68%)",
          boxShadow: "inset 0 3px 5px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.14)",
          border: "3px solid #121820",
        }}
      />
    </div>
  );
}

function Arm({
  direction,
  label,
  active,
  colorOn,
  colorOff,
  radius,
  disabled,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
}: {
  direction: Direction;
  label: string;
  active: boolean;
  colorOn: string;
  colorOff: string;
  radius: string;
  disabled: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`D-pad ${direction}`}
      data-testid={`dpad-${direction}`}
      disabled={disabled}
      className="relative z-0 flex items-center justify-center overflow-hidden text-[#d7e0ee] disabled:opacity-100"
      style={{
        borderRadius: radius,
        background: active
          ? `linear-gradient(180deg, ${colorOn}, ${colorOn}cc)`
          : `linear-gradient(180deg, #5c677a, ${colorOff})`,
        color: active ? "#071018" : "#d7e0ee",
        boxShadow: active
          ? `inset 0 1px 0 rgba(255,255,255,0.45), 0 0 14px ${colorOn}66`
          : "inset 0 2px 0 rgba(255,255,255,0.28), inset 0 -5px 0 rgba(0,0,0,0.38)",
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <svg viewBox="0 0 24 24" className="h-[42%] w-[42%]" aria-hidden>
        <path d={ARROWS[direction]} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label ? (
        <span className="absolute bottom-[8%] text-[10px] font-medium leading-none opacity-80">{label}</span>
      ) : null}
    </button>
  );
}
