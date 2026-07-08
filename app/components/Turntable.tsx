import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { Play, Pause, Square, Library } from "lucide-react";
import type { Album, PlaybackStatus } from "./RecordPlayer";
import { RECORD_TO_PLATTER_RATIO } from "./RecordPlayer";

type Props = {
  album?: Album;
  status: PlaybackStatus;
  busy: boolean;
  albumProgress: number;
  platterRef: RefObject<HTMLDivElement | null>;
  carouselVisible: boolean;
  onSeek: (trackIndex: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onToggleCarousel: () => void;
  /** Nudge the current track's playback position by this many seconds */
  onScrub: (deltaSeconds: number) => void;
  /** Fires once a disc-scrub gesture ends, e.g. to flush a throttled seek */
  onScrubEnd: () => void;
};

type Geometry = {
  pivot: { x: number; y: number };
  center: { x: number; y: number };
  armLen: number;
  recordRadius: number;
};

type Drag = {
  snapIndex: number;
  tip: { x: number; y: number };
};

type DiscDrag = {
  pointerId: number;
  lastAngle: number;
};

// Fractions of the record radius where the music starts and ends
const GROOVE_OUTER = 0.93;
const GROOVE_INNER = 0.5;
// Matches the transform-origin y offset in the .tonearm CSS
const PIVOT_Y = 8;
// Real 33⅓ RPM vinyl speed — matches .record's record-spin animation
// duration (1.8s) in globals.css, so dragging the disc scrubs time 1:1
// with how far a real record would have physically turned underneath it.
const SECONDS_PER_ROTATION = 1.8;

const normalizeAngle = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

// Smallest signed delta (deg) that rotates `from` into `to`, handling wrap
// around ±180° so a fast drag never registers as a near-360° swing.
const shortestAngleDelta = (from: number, to: number) =>
  ((((to - from + 180) % 360) + 360) % 360) - 180;

// Reads the disc's current on-screen rotation straight from its computed
// style, so grabbing it mid-spin (or handing control back afterwards)
// never causes a visible snap to some other angle.
const getCurrentRotationDeg = (el: HTMLElement): number => {
  const { transform } = getComputedStyle(el);
  const match = transform.match(/matrix\(([^)]+)\)/);
  if (!match) return 0;
  const [a, b] = match[1].split(",").map(Number);
  return Math.atan2(b, a) * (180 / Math.PI);
};

// Rotation (deg) that puts the needle tip exactly at radius r from the
// record center: solve |pivot + armLen·(-sinθ, cosθ) - center| = r
function angleForRadius(g: Geometry, r: number): number {
  const vx = g.center.x - g.pivot.x;
  const vy = g.center.y - g.pivot.y;
  const dist2 = vx * vx + vy * vy;
  const k = (r * r - g.armLen * g.armLen - dist2) / (2 * g.armLen);
  const s = Math.max(-1, Math.min(1, k / Math.sqrt(dist2)));
  const phi = Math.atan2(-vy, vx);
  const base = Math.asin(s);
  const a1 = normalizeAngle(base - phi);
  const a2 = normalizeAngle(Math.PI - base - phi);
  return (Math.abs(a1) < Math.abs(a2) ? a1 : a2) * (180 / Math.PI);
}

const radiusForProgress = (g: Geometry, p: number) =>
  g.recordRadius * (GROOVE_OUTER - p * (GROOVE_OUTER - GROOVE_INNER));

export default function Turntable({
  album,
  status,
  busy,
  albumProgress,
  platterRef,
  carouselVisible,
  onSeek,
  onPlay,
  onPause,
  onStop,
  onToggleCarousel,
  onScrub,
  onScrubEnd,
}: Props) {
  const deckRef = useRef<HTMLDivElement>(null);
  const tonearmRef = useRef<HTMLDivElement>(null);
  const recordRef = useRef<HTMLDivElement>(null);
  const rotationRef = useRef(0);
  const manualSpinRef = useRef(false);
  const discDragRef = useRef<DiscDrag | null>(null);
  const [needleAngle, setNeedleAngle] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [discScrubbing, setDiscScrubbing] = useState(false);

  const geometry = (): Geometry | null => {
    const arm = tonearmRef.current;
    const platter = platterRef.current;
    if (!arm || !platter) return null;
    return {
      pivot: {
        x: arm.offsetLeft + arm.offsetWidth / 2,
        y: arm.offsetTop + PIVOT_Y,
      },
      center: {
        x: platter.offsetLeft + platter.offsetWidth / 2,
        y: platter.offsetTop + platter.offsetHeight / 2,
      },
      armLen: arm.offsetHeight - PIVOT_Y,
      recordRadius: (platter.offsetWidth / 2) * RECORD_TO_PLATTER_RATIO,
    };
  };

  useEffect(() => {
    if (drag) return;
    if (!album || busy || status === "stopped") {
      setNeedleAngle(null);
      return;
    }
    const g = geometry();
    if (!g) return;
    const p = Math.min(Math.max(albumProgress, 0), 1);
    setNeedleAngle(angleForRadius(g, radiusForProgress(g, p)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album, busy, status, albumProgress, drag]);

  const applyDrag = (clientX: number, clientY: number) => {
    const g = geometry();
    const deck = deckRef.current;
    if (!g || !deck || !album) return;
    const rect = deck.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const outer = g.recordRadius * GROOVE_OUTER;
    const inner = g.recordRadius * GROOVE_INNER;
    const pointerRadius = Math.min(
      outer,
      Math.max(inner, Math.hypot(px - g.center.x, py - g.center.y)),
    );
    const rawProgress = (outer - pointerRadius) / (outer - inner);
    const count = album.tracks.length;
    const snapIndex = Math.min(
      count - 1,
      Math.max(0, Math.round(rawProgress * count)),
    );
    const angle = angleForRadius(g, radiusForProgress(g, snapIndex / count));
    const rad = (angle * Math.PI) / 180;
    setNeedleAngle(angle);
    setDrag({
      snapIndex,
      tip: {
        x: g.pivot.x - g.armLen * Math.sin(rad),
        y: g.pivot.y + g.armLen * Math.cos(rad),
      },
    });
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!album || busy) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    applyDrag(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    applyDrag(e.clientX, e.clientY);
  };

  const handlePointerUp = () => {
    if (!drag) return;
    onSeek(drag.snapIndex);
    setDrag(null);
  };

  // Rotating the disc itself scrubs time within the *current* track only —
  // moving the needle (above) is what jumps between tracks.
  const pointerAngle = (e: ReactPointerEvent<HTMLDivElement>, g: Geometry) => {
    const rect = deckRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    return Math.atan2(py - g.center.y, px - g.center.x) * (180 / Math.PI);
  };

  const handleDiscPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!album || busy || discDragRef.current) return;
    const recordEl = recordRef.current;
    const g = geometry();
    if (!recordEl || !deckRef.current || !g) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    // Take over from wherever the CSS auto-spin animation currently sits so
    // the disc doesn't jump the instant it's grabbed.
    rotationRef.current = getCurrentRotationDeg(recordEl);
    manualSpinRef.current = true;
    recordEl.style.animationName = "none";
    recordEl.style.transform = `rotate(${rotationRef.current}deg)`;

    discDragRef.current = {
      pointerId: e.pointerId,
      lastAngle: pointerAngle(e, g),
    };
    setDiscScrubbing(true);
  };

  const handleDiscPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = discDragRef.current;
    const recordEl = recordRef.current;
    const g = geometry();
    if (!dragState || dragState.pointerId !== e.pointerId || !recordEl || !g) {
      return;
    }
    const angle = pointerAngle(e, g);
    const delta = shortestAngleDelta(dragState.lastAngle, angle);
    dragState.lastAngle = angle;
    rotationRef.current += delta;
    recordEl.style.transform = `rotate(${rotationRef.current}deg)`;
    onScrub((delta / 360) * SECONDS_PER_ROTATION);
  };

  // Hand control back to the CSS spin animation at a matching phase (via a
  // negative delay) so it visually continues from exactly where the manual
  // drag left off instead of snapping back to the keyframe's 0deg frame.
  // Only meaningful once the disc has actually been taken under manual
  // control — a no-op otherwise.
  const resumeAutoSpin = () => {
    const recordEl = recordRef.current;
    if (!recordEl || !manualSpinRef.current) return;
    const phase = ((rotationRef.current % 360) + 360) % 360;
    recordEl.style.animationDelay = `${-(phase / 360) * SECONDS_PER_ROTATION}s`;
    recordEl.style.transform = "";
    recordEl.style.animationName = "";
    manualSpinRef.current = false;
  };

  // Freezes the disc exactly at its current dragged angle, staying under
  // manual control. Used instead of resumeAutoSpin() while paused/stopped:
  // .record[data-status="stopped"]'s `animation: none` shorthand resets
  // animation-delay too, so handing back control there would make the disc
  // snap to its 0deg resting frame the instant you let go. Staying frozen
  // in place keeps it exactly put until playback actually resumes (below).
  const freezeManualSpin = () => {
    const recordEl = recordRef.current;
    if (!recordEl) return;
    recordEl.style.animationName = "none";
    recordEl.style.transform = `rotate(${rotationRef.current}deg)`;
  };

  const endDiscDrag = () => {
    if (!discDragRef.current) return;
    discDragRef.current = null;
    setDiscScrubbing(false);
    if (status === "playing") {
      resumeAutoSpin();
    } else {
      freezeManualSpin();
    }
    onScrubEnd();
  };

  // Playback starting (or resuming) after a drag left the disc frozen mid
  // pause/stop hands control back to the CSS animation smoothly from
  // wherever it was left, instead of it staying frozen forever.
  useEffect(() => {
    if (status === "playing") resumeAutoSpin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Loading a different record onto the platter always starts its spin
  // fresh — clear any manual override left over from the previous record
  // (e.g. dragged while paused, then a new album was picked) so it can't
  // carry over onto this one.
  useEffect(() => {
    discDragRef.current = null;
    setDiscScrubbing(false);
    manualSpinRef.current = false;
    const recordEl = recordRef.current;
    if (recordEl) {
      recordEl.style.transform = "";
      recordEl.style.animationName = "";
      recordEl.style.animationDelay = "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album?.id]);

  return (
    <div className="turntable">
      <div
        className="deck"
        ref={deckRef}
      >
        <div
          className="platter"
          ref={platterRef}
        >
          {album ? (
            <div
              ref={recordRef}
              className="record"
              data-status={status}
              style={{
                cursor: busy ? "default" : discScrubbing ? "grabbing" : "grab",
              }}
              onPointerDown={handleDiscPointerDown}
              onPointerMove={handleDiscPointerMove}
              onPointerUp={endDiscDrag}
              onPointerCancel={endDiscDrag}
            >
              <img
                className="record-label"
                src={album.cover}
                alt={album.title}
                draggable={false}
              />
            </div>
          ) : (
            <span className="platter-hint">VP Deluxe 69</span>
          )}
        </div>
        <div
          ref={tonearmRef}
          className="tonearm"
          style={{
            ...(needleAngle !== null
              ? { transform: `rotate(${needleAngle}deg)` }
              : {}),
            ...(drag || discScrubbing
              ? { transition: "transform 0.15s ease" }
              : {}),
            cursor: album && !busy ? (drag ? "grabbing" : "grab") : "default",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => setDrag(null)}
        />
        {drag && album && (
          <div
            className="needle-tooltip"
            style={{
              left: drag.tip.x,
              top: drag.tip.y,
              transform: "translate(-50%, -140%)",
            }}
          >
            {album.tracks[drag.snapIndex].title}
          </div>
        )}
        <div className="controls">
          <button
            onClick={status === "playing" ? onPause : onPlay}
            disabled={!album || busy}
            data-pressed={status === "playing"}
            aria-label={status === "playing" ? "Pause" : "Play"}
          >
            {status === "playing" ? (
              <Pause
                size={16}
                fill="currentColor"
                strokeWidth={0}
              />
            ) : (
              <Play
                size={16}
                fill="currentColor"
                strokeWidth={0}
              />
            )}
          </button>
          <button
            onClick={onStop}
            disabled={busy || status === "stopped"}
            data-pressed={status === "stopped"}
            aria-label="Stop"
          >
            <Square
              size={14}
              fill="currentColor"
              strokeWidth={0}
            />
          </button>
          <button
            onClick={onToggleCarousel}
            disabled={busy}
            data-pressed={carouselVisible}
            aria-label={carouselVisible ? "Hide records" : "Show records"}
          >
            <Library size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
