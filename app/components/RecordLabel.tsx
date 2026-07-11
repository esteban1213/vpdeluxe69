"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  alt: string;
};

/** The small circular cover-art label at a record's center. Fades in once
 *  actually loaded instead of popping in abruptly — most noticeable on the
 *  flip clone (see Turntable), whose <img> elements are freshly mounted
 *  every flip even though the browser already has the image cached. */
export default function RecordLabel({ src, alt }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    // A cached image can finish loading before this effect (and thus the
    // onLoad listener below) ever runs — check the element's own
    // .complete rather than assuming onLoad will always fire after mount.
    if (imgRef.current?.complete) setLoaded(true);
  }, [src]);

  return (
    <img
      ref={imgRef}
      className="record-label"
      src={src}
      alt={alt}
      draggable={false}
      onLoad={() => setLoaded(true)}
      style={{ opacity: loaded ? 1 : 0 }}
    />
  );
}
