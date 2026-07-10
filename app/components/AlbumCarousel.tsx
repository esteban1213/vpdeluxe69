"use client";

import { useEffect, useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { EffectCards } from "swiper/modules";
import "swiper/css";
import "swiper/css/effect-cards";
import type { Swiper as SwiperClass } from "swiper/types";
import type { Album } from "./RecordPlayer";

type Props = {
  albums: Album[];
  hiddenDiscIds: string[];
  visible: boolean;
  onSelect: (index: number) => void;
  onActivity: () => void;
  /** Reports whichever card is currently front-and-center, for e.g. a background */
  onActiveChange: (album: Album | undefined) => void;
  registerDisc: (id: string, el: HTMLElement | null) => void;
  onSwiper: (swiper: SwiperClass) => void;
};

export default function AlbumCarousel({
  albums,
  hiddenDiscIds,
  visible,
  onSelect,
  onActivity,
  onActiveChange,
  registerDisc,
  onSwiper,
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeAlbum = albums[activeIndex];

  useEffect(() => {
    onActiveChange(activeAlbum);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAlbum]);

  return (
    <div
      className="album-carousel"
      data-visible={visible}
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
        <div className="album-caption">
          <span className="album-title">{activeAlbum.title}</span>
          <span className="album-artist">{activeAlbum.artist}</span>
        </div>
      )}
    </div>
  );
}
