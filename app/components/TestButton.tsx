"use client";

import { useEffect, useState } from "react";

export default function TestButton() {
  const [taps, setTaps] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  const label = hydrated
    ? taps === 0
      ? "JS ✓ — test tap"
      : `Tapped ${taps}×`
    : "JS NOT RUNNING";

  return (
    <button className="test-button" onClick={() => setTaps(taps + 1)}>
      {label}
    </button>
  );
}
