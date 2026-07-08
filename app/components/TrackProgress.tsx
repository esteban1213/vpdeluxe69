"use client";

type Props = {
  /** 0–1 progress through the currently loaded track */
  progress: number;
  visible: boolean;
};

// Fixed bar pinned to the very bottom of the viewport showing the current
// track's playback position. Deliberately decoupled from the turntable's
// needle/tonearm math — this is just a simple, always-legible readout.
export default function TrackProgress({ progress, visible }: Props) {
  const clamped = Math.min(Math.max(progress, 0), 1);

  return (
    <div
      className="track-progress"
      data-visible={visible}
    >
      <div
        className="track-progress-fill"
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}
