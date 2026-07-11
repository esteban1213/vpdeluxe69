"use client";

import { useColor } from "color-thief-react";
import type { Album } from "./RecordPlayer";

type Props = {
  album: Album;
  currentTrackIndex: number;
  onSelectTrack: (trackIndex: number) => void;
};

// Falls back to the old flat black tint until the cover's average color
// has loaded (or if extraction fails, e.g. the image not being fetchable).
const FALLBACK_TINT = "rgba(0, 0, 0, 0.5)";

/** The sleeve's flipped-over back — a scrollable track list tinted with
 *  the album cover's average color, standing in for the record itself
 *  while it's out of the sleeve and on the platter. */
export default function AlbumSleeveBack({
  album,
  currentTrackIndex,
  onSelectTrack,
}: Props) {
  const { data: rgb } = useColor(album.cover, "rgbArray", {
    crossOrigin: "anonymous",
    quality: 10,
  });

  const tint = rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 1)` : FALLBACK_TINT;

  return (
    <div
      className="album-sleeve album-sleeve-back"
      style={{
        position: "absolute",
        zIndex: 10,
        backgroundColor: tint,
      }}
    >
      <ul
        className="album-sleeve-tracklist"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {album.tracks.map((track, i) => (
          <li
            key={track.title + i}
            className="album-sleeve-track"
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
            <span className="album-sleeve-track-index">{i + 1}</span>
            <span className="album-sleeve-track-title">{track.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
