import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { Album, PlaybackStatus } from "./RecordPlayer";
import { RECORD_TO_PLATTER_RATIO } from "./RecordPlayer";
import TimeDisplay from "./TimeDisplay";
import Tracklist from "./Tracklist";

type Props = {
  album?: Album;
  status: PlaybackStatus;
  busy: boolean;
  albumProgress: number;
  /** Seconds elapsed in the current track, shown on the deck's LCD */
  elapsedSeconds: number;
  platterRef: RefObject<HTMLDivElement | null>;
  /** Whether the platter motor is running (spins the record, no sound) */
  tableOn: boolean;
  /** Fired the instant the needle is grabbed — primes the audio element
   *  for iOS, which needs playback "unlocked" by a direct gesture before
   *  any later programmatic play() call is allowed to succeed */
  onPrimeAudio: () => void;
  /** Drop the needle onto a specific track's start groove */
  onSeek: (trackIndex: number) => void;
  /** Drop the needle onto the "Current Time" groove — resumes in place */
  onResume: () => void;
  /** Drop the needle onto the rest groove — halts playback */
  onStop: () => void;
  onToggleTable: () => void;
  /** Nudge the current track's playback position by this many seconds */
  onScrub: (deltaSeconds: number) => void;
  /** Fires once a disc-scrub gesture ends, e.g. to flush a throttled seek */
  onScrubEnd: () => void;
  /** Tapping the deck's LCD toggles the floating track list open/closed */
  onToggleTracklist: () => void;
  /** Whether the floating track list is currently open */
  tracklistOpen: boolean;
  /** Which track of the loaded album is playing, to highlight it in the
   *  floating track list */
  currentTrackIndex: number;
  /** Picking a track directly from the floating track list */
  onSelectTrack: (trackIndex: number) => void;
  /** Any click within the turntable that isn't the LCD or the track list
   *  itself (both of which stop their own clicks from bubbling this far)
   *  counts as "outside" the track list and closes it */
  onCloseTracklist: () => void;
};

type Geometry = {
  pivot: { x: number; y: number };
  center: { x: number; y: number };
  armLen: number;
  recordRadius: number;
};

type SnapPoint = {
  kind: "track" | "current" | "rest";
  index?: number;
  angle: number;
  label: string;
};

type Drag = {
  tip: { x: number; y: number };
  /** The snap point currently magnetically engaged, if the needle is close
   *  enough to one — undefined while freely swinging between them. */
  snap?: SnapPoint;
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
// Matches .tonearm's CSS default `transform: rotate(-28deg)` — the parked
// position off the record. Also doubles as the "Stop" snap point: dragging
// the needle back here halts playback, like lifting it off the vinyl.
const REST_ANGLE_DEG = -28;
// Angular tolerance (deg) within which the needle magnetically locks onto
// a snap point while dragging, instead of following the pointer exactly.
const SNAP_THRESHOLD_DEG = 6;
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

// Free-rotation angle (deg) that points the rigid arm directly at the
// pointer, ignoring distance (the arm's length is fixed) — this is what
// lets the needle track the pointer continuously instead of jumping
// between discrete positions.
function angleFromPivot(g: Geometry, px: number, py: number): number {
  const dx = px - g.pivot.x;
  const dy = py - g.pivot.y;
  return Math.atan2(-dx, dy) * (180 / Math.PI);
}

// The arm's full physical sweep: from parked (off the record) across the
// whole groove band to the innermost track. Order-agnostic so it doesn't
// matter which extreme is numerically larger.
function sweepBounds(g: Geometry): [number, number] {
  const angles = [
    REST_ANGLE_DEG,
    angleForRadius(g, g.recordRadius * GROOVE_OUTER),
    angleForRadius(g, g.recordRadius * GROOVE_INNER),
  ];
  return [Math.min(...angles), Math.max(...angles)];
}

// Every place the needle can meaningfully land: the start of each track,
// the current playback position (so you can drop back into where you
// left off), and the rest position (which stops the song).
function buildSnapPoints(
  g: Geometry,
  album: Album,
  albumProgress: number,
): SnapPoint[] {
  const count = album.tracks.length;
  const points: SnapPoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      kind: "track",
      index: i,
      angle: angleForRadius(g, radiusForProgress(g, i / count)),
      label: album.tracks[i].title,
    });
  }
  const p = Math.min(Math.max(albumProgress, 0), 1);
  points.push({
    kind: "current",
    angle: angleForRadius(g, radiusForProgress(g, p)),
    label: "Current Time",
  });
  points.push({ kind: "rest", angle: REST_ANGLE_DEG, label: "Stop" });
  return points;
}

function nearestSnap(points: SnapPoint[], angle: number) {
  let best = points[0];
  let bestDelta = Math.abs(shortestAngleDelta(angle, points[0].angle));
  for (let i = 1; i < points.length; i++) {
    const delta = Math.abs(shortestAngleDelta(angle, points[i].angle));
    if (delta < bestDelta) {
      bestDelta = delta;
      best = points[i];
    }
  }
  return { point: best, delta: bestDelta };
}

export default function Turntable({
  album,
  status,
  busy,
  albumProgress,
  elapsedSeconds,
  platterRef,
  tableOn,
  onPrimeAudio,
  onSeek,
  onResume,
  onStop,
  onToggleTable,
  onScrub,
  onScrubEnd,
  onToggleTracklist,
  tracklistOpen,
  currentTrackIndex,
  onSelectTrack,
  onCloseTracklist,
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

  // The needle follows the pointer continuously across its full physical
  // sweep — it only locks (magnetically) onto a snap point once close
  // enough to one; otherwise it's free, so the user can swing it anywhere.
  const applyDrag = (clientX: number, clientY: number) => {
    const g = geometry();
    const deck = deckRef.current;
    if (!g || !deck || !album) return;
    const rect = deck.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const freeAngle = angleFromPivot(g, px, py);
    const [minAngle, maxAngle] = sweepBounds(g);
    const clamped = Math.min(maxAngle, Math.max(minAngle, freeAngle));
    const points = buildSnapPoints(g, album, albumProgress);
    const { point, delta } = nearestSnap(points, clamped);
    const engaged = delta <= SNAP_THRESHOLD_DEG;
    const angle = engaged ? point.angle : clamped;
    const rad = (angle * Math.PI) / 180;
    setNeedleAngle(angle);
    setDrag({
      snap: engaged ? point : undefined,
      tip: {
        x: g.pivot.x - g.armLen * Math.sin(rad),
        y: g.pivot.y + g.armLen * Math.cos(rad),
      },
    });
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // The needle only comes off its rest while the platter is spinning
    if (!album || busy || !tableOn) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // Prime audio right at the moment of contact — the earliest, most
    // gesture-trusted point of this interaction (see the Props comment).
    onPrimeAudio();
    applyDrag(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    applyDrag(e.clientX, e.clientY);
  };

  // Only a snap actually engaged at release commits to anything; letting go
  // in open air (no snap locked in) leaves nothing changed — the needle
  // settles back to wherever it belongs (still playing, paused, or at rest)
  // via the effect above once `drag` clears.
  const handlePointerUp = () => {
    if (!drag) return;
    const snap = drag.snap;
    setDrag(null);
    if (!snap) return;
    if (snap.kind === "track" && snap.index !== undefined) {
      onSeek(snap.index);
    } else if (snap.kind === "current") {
      onResume();
    } else if (snap.kind === "rest") {
      onStop();
    }
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
    if (tableOn) {
      resumeAutoSpin();
    } else {
      freezeManualSpin();
    }
    onScrubEnd();
  };

  // The motor (not playback) is what actually spins the disc — CSS drives
  // the spin off `data-spinning`, which tracks `tableOn`. Hand control back
  // to the CSS animation whenever the motor turns on, so a disc dragged
  // (and frozen) while powered off still spins up correctly once Power is
  // pressed, even before the needle drops into a groove.
  useEffect(() => {
    if (tableOn) resumeAutoSpin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableOn]);

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
    // Tapping anywhere outside the player (the background) reveals the
    // library — stop the click here so interacting with the deck itself
    // never counts as "outside". Anything that reaches this far (the LCD
    // and the track list both stop their own clicks first) also counts as
    // "outside the track list", so it closes that too.
    <div
      className="turntable"
      onClick={(e) => {
        e.stopPropagation();
        onCloseTracklist();
      }}
    >
      <span className="turntable-screw turntable-screw-tl" />
      <span className="turntable-screw turntable-screw-tr" />
      <span className="turntable-screw turntable-screw-bl" />
      <span className="turntable-screw turntable-screw-br" />
      <div
        className="deck"
        ref={deckRef}
      >
        <TimeDisplay seconds={elapsedSeconds} onClick={onToggleTracklist} />
        {tracklistOpen && album && (
          <Tracklist
            album={album}
            currentTrackIndex={currentTrackIndex}
            onSelectTrack={onSelectTrack}
          />
        )}

        <div
          className="platter"
          ref={platterRef}
        >
          {/* Always present, not just when empty — the record's center hole
              is a real cutout (mask-image on .record), so this shows
              through it once a disc is loaded, exactly like a real spindle. */}
          <span className="platter-spindle" />
          {album ? (
            <div
              ref={recordRef}
              className="record"
              data-spinning={tableOn ? "true" : "false"}
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
            cursor:
              album && !busy && tableOn
                ? drag
                  ? "grabbing"
                  : "grab"
                : "default",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => setDrag(null)}
        />
        {drag?.snap && (
          <div
            className="needle-tooltip"
            style={{
              left: drag.tip.x,
              top: drag.tip.y,
              transform: "translate(-50%, -140%)",
            }}
          >
            {drag.snap.label}
          </div>
        )}
        {/* Bottom-right of the deck, sharing the tonearm's horizontal
            position above — pivot and Power form one column beside the disc. */}
        <div className="control-with-caption power-control">
          <button
            onClick={onToggleTable}
            disabled={!album || busy}
            data-pressed={tableOn}
            aria-pressed={tableOn}
            aria-label={tableOn ? "Power off" : "Power on"}
          />
          <span className="control-caption">Power</span>
        </div>
      </div>
    </div>
  );
}
