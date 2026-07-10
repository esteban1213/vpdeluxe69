import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

type Props = {
  label: string;
  value: number;
  onChange: (value: number) => void;
};

type Drag = { pointerId: number; startY: number; startValue: number };

// Matches a typical analog pot's sweep: 270° of travel with a 90° dead
// zone at the bottom where the indicator never points.
const MIN_ANGLE = -135;
const MAX_ANGLE = 135;
// Pixels of vertical drag needed to sweep the knob from empty to full.
const DRAG_RANGE_PX = 120;
const STEP = 0.05;

export default function MixerKnob({ label, value, onChange }: Props) {
  const dragRef = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);

  const angle = MIN_ANGLE + value * (MAX_ANGLE - MIN_ANGLE);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startY: e.clientY, startValue: value };
    setDragging(true);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const deltaValue = (drag.startY - e.clientY) / DRAG_RANGE_PX;
    onChange(Math.min(1, Math.max(0, drag.startValue + deltaValue)));
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      onChange(Math.min(1, value + STEP));
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      onChange(Math.max(0, value - STEP));
    }
  };

  return (
    <div className="control-with-caption">
      <div
        className="mixer-knob"
        data-dragging={dragging || undefined}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
      >
        <div
          className="mixer-knob-face"
          style={{ transform: `rotate(${angle}deg)` }}
        >
          <span className="mixer-knob-indicator" />
        </div>
      </div>
      <span className="control-caption">{label}</span>
    </div>
  );
}
