"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { EffectCards } from "swiper/modules";
import "swiper/css";
import "swiper/css/effect-cards";
import type { Swiper as SwiperClass } from "swiper/types";
import type { Album } from "./RecordPlayer";
import AlbumSleeveBack from "./AlbumSleeveBack";

type Props = {
  albums: Album[];
  hiddenDiscIds: string[];
  /** The id of whichever album is currently on the platter — its card shows
   *  a flipped-over sleeve back (blurred cover + track list) instead of the
   *  plain cover, since the record itself isn't in the sleeve right now. */
  loadedAlbumId: string | undefined;
  /** Which track of the loaded album is playing, to highlight it in that
   *  flipped sleeve's track list */
  currentTrackIndex: number;
  /** Fully revealed vs. just peeking at the bottom edge */
  expanded: boolean;
  onSelect: (index: number) => void;
  /** Picking a track directly from the loaded album's flipped sleeve */
  onSelectTrack: (trackIndex: number) => void;
  onActivity: () => void;
  /** An upward swipe on the peeked caption — desktop gets this for free
   *  via :hover, so this only really fires on touch */
  onExpand: () => void;
  /** A downward swipe on the expanded caption */
  onCollapse: () => void;
  /** Reports whichever card is currently front-and-center, for e.g. a background */
  onActiveChange: (album: Album | undefined) => void;
  registerDisc: (id: string, el: HTMLElement | null) => void;
  onSwiper: (swiper: SwiperClass) => void;
};

// Vertical drag distance (px) that counts as a deliberate swipe rather than
// an incidental wobble while tapping the caption handle.
const SWIPE_REVEAL_THRESHOLD_PX = 24;

export default function AlbumCarousel({
  albums,
  hiddenDiscIds,
  loadedAlbumId,
  currentTrackIndex,
  expanded,
  onSelect,
  onSelectTrack,
  onActivity,
  onExpand,
  onCollapse,
  onActiveChange,
  registerDisc,
  onSwiper,
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeAlbum = albums[activeIndex];
  const captionDragStartY = useRef<number | null>(null);

  // The caption pill is the bit that stays visible in the peeked state (it's
  // the last child, so it's what's left on screen once the rest scrolls off
  // the bottom edge) — it doubles as the touch "handle": swipe up to reveal
  // the full carousel, swipe down to tuck it back away.
  const handleCaptionPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    captionDragStartY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleCaptionPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const startY = captionDragStartY.current;
    if (startY === null) return;
    const dy = e.clientY - startY;
    if (dy <= -SWIPE_REVEAL_THRESHOLD_PX) {
      captionDragStartY.current = null;
      onExpand();
    } else if (dy >= SWIPE_REVEAL_THRESHOLD_PX) {
      captionDragStartY.current = null;
      onCollapse();
    }
  };

  const handleCaptionPointerEnd = () => {
    captionDragStartY.current = null;
  };

  useEffect(() => {
    onActiveChange(activeAlbum);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAlbum]);

  // Nothing to browse yet (e.g. before Spotify login finishes, or login
  // never happens). Swiper's cards effect assumes at least one slide
  // exists — mounting it with zero can throw during init, which in dev
  // surfaces as a full-viewport error overlay that eats clicks elsewhere
  // on the page until it clears. Simplest fix: don't mount it at all yet.
  if (albums.length === 0) {
    return null;
  }

  return (
    <div
      className="album-carousel"
      data-expanded={expanded}
      onPointerDown={onActivity}
      onClick={(e) => e.stopPropagation()}
    >
      <Swiper
        modules={[EffectCards]}
        effect="cards"
        grabCursor
        cardsEffect={{ slideShadows: false }}
        onSlideChange={(swiper) => setActiveIndex(swiper.activeIndex)}
        onSwiper={onSwiper}
        onClick={(swiper) => {
          const index = swiper.clickedIndex;
          if (typeof index === "number" && !Number.isNaN(index)) {
            onSelect(index);
          }
        }}
        className="album-swiper"
      >
        {albums.map((album, index) => (
          <SwiperSlide
            key={album.id}
            className="album-slide"
          >
            {/*
              Intentionally a div, not a <button>. Swiper treats native
              focusable controls (button/input/select/textarea/video/label)
              as special-cased "interactive" touch targets: on real touch
              devices, tapping a <button> focuses it, and Swiper's touchmove
              handler bails out early (killing both the swipe and the click)
              whenever the touch target is already the focused element. That
              made mobile taps/swipes silently do nothing after the first
              touch. Keep it keyboard-accessible manually instead.
            */}
            <div
              className="album-card"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(index);
                }
              }}
              aria-label={`Play ${album.title}`}
            >
              <span
                className="album-disc"
                ref={(el) => registerDisc(album.id, el)}
                style={
                  hiddenDiscIds.includes(album.id)
                    ? { visibility: "hidden" }
                    : undefined
                }
              >
                <img
                  className="album-disc-label"
                  src={album.cover}
                  alt=""
                />
              </span>
              {loadedAlbumId === album.id && (
                // The record itself isn't in its sleeve right now — it's
                // out on the platter — so show the sleeve's flipped-over
                // back instead: a scrollable track list tinted with the
                // cover's average color, like flipping a real record
                // jacket over to read the songs while it spins.
                <AlbumSleeveBack
                  album={album}
                  currentTrackIndex={currentTrackIndex}
                  onSelectTrack={onSelectTrack}
                />
              )}

              <img
                className="album-sleeve"
                src={album.cover}
                alt=""
              />
            </div>
          </SwiperSlide>
        ))}
      </Swiper>
      {activeAlbum && (
        <div
          className="album-caption"
          onPointerDown={handleCaptionPointerDown}
          onPointerMove={handleCaptionPointerMove}
          onPointerUp={handleCaptionPointerEnd}
          onPointerCancel={handleCaptionPointerEnd}
        >
          <span className="album-title">{activeAlbum.title}</span>
        </div>
      )}
    </div>
  );
}
