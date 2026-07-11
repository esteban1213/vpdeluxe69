"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { EffectCards } from "swiper/modules";
import "swiper/css";
import "swiper/css/effect-cards";
import type { Swiper as SwiperClass } from "swiper/types";
import type { Album } from "./RecordPlayer";

type Props = {
  albums: Album[];
  hiddenDiscIds: string[];
  /** Fully revealed vs. just peeking at the bottom edge */
  expanded: boolean;
  onSelect: (index: number) => void;
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

// Mirrors the `@media (hover: hover) and (pointer: fine)` gate in
// globals.css that scopes hover-to-reveal to desktop. On anything without
// that (touch, coarse-pointer), the carousel only ever reveals itself via
// JS-driven `expanded` state — never implicitly from a hover the device
// can't produce — so a tap has to be treated as "reveal first" rather than
// an actual selection.
const isTouchOnlyDevice = () =>
  typeof window !== "undefined" &&
  !window.matchMedia("(hover: hover) and (pointer: fine)").matches;

export default function AlbumCarousel({
  albums,
  hiddenDiscIds,
  expanded,
  onSelect,
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
          if (typeof index !== "number" || Number.isNaN(index)) return;
          // Touch has no hover to preview the stack first — the first tap
          // on a collapsed carousel just reveals it, same as the caption
          // swipe, instead of immediately loading whatever card it landed
          // on. Once expanded, taps select normally.
          if (!expanded && isTouchOnlyDevice()) {
            onExpand();
            return;
          }
          onSelect(index);
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
          onClick={(e) => {
            // A plain tap (no swipe) on the peeked caption — the only
            // visible handle when collapsed — should reveal the carousel
            // too, not just the deliberate upward swipe.
            if (!expanded) {
              e.stopPropagation();
              onExpand();
            }
          }}
        >
          <span className="album-title">{activeAlbum.title}</span>
        </div>
      )}
    </div>
  );
}
