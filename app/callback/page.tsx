"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { completeSpotifyLogin } from "../components/spotify";

export default function SpotifyCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) {
      setError(params.get("error") ?? "missing authorization code");
      return;
    }
    completeSpotifyLogin(code)
      .then(() => router.replace("/"))
      .catch((e) => setError(String(e)));
  }, [router]);

  return (
    <main className="start">
      <p>{error ? `Spotify login failed: ${error}` : "Connecting Spotify…"}</p>
    </main>
  );
}
