"use client";

import { useEffect, useRef, useState } from "react";

type Layer = { id: number; cover: string };

type Props = {
  /** URL of the cover art to show; the whole site backdrop when omitted */
  cover?: string;
};

// Full-viewport backdrop showing whichever cover is "current" (playing,
// mid-flight, or just being browsed), blurred so it reads as atmosphere
// rather than a picture. Cross-fades itself between covers so callers can
// just pass whatever cover is current without worrying about transitions.
export default function SiteBackground({ cover }: Props) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    if (!cover) return;
    setLayers((prev) => {
      if (prev[prev.length - 1]?.cover === cover) return prev;
      nextId.current += 1;
      // Keep only the outgoing + incoming layer; older ones have already
      // faded out and can be dropped without any visible jump.
      return [...prev, { id: nextId.current, cover }].slice(-2);
    });
  }, [cover]);

  return (
    <div
      className="site-background"
      aria-hidden="true"
    >
      {layers.map((layer, i) => (
        <img
          key={layer.id}
          className="site-background-image"
          data-active={i === layers.length - 1}
          src={layer.cover}
          alt=""
        />
      ))}
    </div>
  );
}
