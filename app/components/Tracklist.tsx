"use client";

import { useColor } from "color-thief-react";
import type { Album } from "./RecordPlayer";

type Props = {
  album: Album;
  currentTrackIndex: number;
  onSelectTrack: (trackIndex: number) => void;
  /** Added to each displayed track number — lets side B's list continue
   *  the album's original numbering instead of restarting at 1 */
  trackNumberOffset: number;
};

// Falls back to this dark tint until the cover's average color has loaded
// (or if extraction fails, e.g. the image not being fetchable).
const FALLBACK_TINT = "rgba(20, 20, 20, 1)";

/** Floats under the deck's LCD once tapped open — the loaded album's
 *  track list, tinted with its cover's average color. */
export default function Tracklist({
  album,
  currentTrackIndex,
  onSelectTrack,
  trackNumberOffset,
}: Props) {
  const { data: rgb } = useColor(album.cover, "rgbArray", {
    crossOrigin: "anonymous",
    quality: 10,
  });

  const tint = rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 1)` : FALLBACK_TINT;

  return (
    <ul
      className="tracklist-float"
      style={{ backgroundColor: tint }}
      onPointerDown={(e) => e.stopPropagation()}
      // A click anywhere in here — including empty padding, not just a
      // track row (which already stops its own click below) — must never
      // bubble out to the turntable's "close on outside click" handler.
      onClick={(e) => e.stopPropagation()}
    >
      {album.tracks.map((track, i) => (
        <li
          key={track.title + i}
          className="tracklist-float-track"
          role="button"
          tabIndex={0}
          data-active={i === currentTrackIndex}
          onClick={(e) => {
            e.stopPropagation();
            onSelectTrack(i);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onSelectTrack(i);
            }
          }}
        >
          <span className="tracklist-float-track-index">
            {trackNumberOffset + i + 1}
          </span>
          <span className="tracklist-float-track-title">{track.title}</span>
        </li>
      ))}
    </ul>
  );
}
