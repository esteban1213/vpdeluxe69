"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Swiper as SwiperClass } from "swiper/types";
import Turntable from "./Turntable";
import AlbumCarousel from "./AlbumCarousel";
import SiteBackground from "./SiteBackground";
import {
  beginSpotifyLogin,
  clearSpotifyToken,
  hasSpotifyToken,
  getSpotifyToken,
  fetchMyPlaylists,
  loadSpotifySdk,
  playSpotifyTrack,
  type SpotifyPlayer,
} from "./spotify";

export type Track = {
  title: string;
  /** Direct audio file source (mp3 etc.) */
  url?: string;
  /** Spotify track: URI, open.spotify.com link, or bare ID (needs Premium) */
  spotifyUri?: string;
};

export type Album = {
  id: string;
  title: string;
  artist: string;
  cover: string;
  tracks: Track[];
};

export type PlaybackStatus = "playing" | "paused" | "stopped";

type Flight = { index: number; dir: "out" | "back" };

export const RECORD_TO_PLATTER_RATIO = 220 / 240;

type Props = {
  albums: Album[];
};

export default function RecordPlayer({ albums: baseAlbums }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const crackleRef = useRef<HTMLAudioElement>(null);
  const crackleStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const platterRef = useRef<HTMLDivElement>(null);
  const flyRef = useRef<HTMLDivElement>(null);
  const flySleeveRef = useRef<HTMLImageElement>(null);
  const discRefs = useRef(new Map<string, HTMLElement>());
  const swiperRef = useRef<SwiperClass | null>(null);
  const spotifyRef = useRef<SpotifyPlayer | null>(null);
  const spotifyDeviceRef = useRef<string | null>(null);
  const spotifyStartedUriRef = useRef<string | null>(null);
  const spotifyLastPosRef = useRef(0);
  const spotifyDurationRef = useRef(0);
  const spotifyScrubPendingRef = useRef<number | null>(null);
  const spotifyScrubTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const carouselHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadedIndex, setLoadedIndex] = useState<number | null>(null);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>("stopped");
  const [tableOn, setTableOn] = useState(false);
  const [trackIndex, setTrackIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  // Master playback volume fader.
  const [volume, setVolume] = useState(1);
  const [spotifyAuthed, setSpotifyAuthed] = useState(false);
  const [spotifyReady, setSpotifyReady] = useState(false);
  const [spotifyAlbums, setSpotifyAlbums] = useState<Album[]>([]);
  const [carouselVisible, setCarouselVisible] = useState(true);
  const [browsingAlbum, setBrowsingAlbum] = useState<Album | undefined>(
    undefined,
  );

  const albums = useMemo(
    () => [...baseAlbums, ...spotifyAlbums],
    [baseAlbums, spotifyAlbums],
  );

  const loadedAlbum = loadedIndex !== null ? albums[loadedIndex] : undefined;
  const flightAlbum = flight ? albums[flight.index] : undefined;
  const busy = flight !== null || pendingIndex !== null;
  const currentTrack = loadedAlbum?.tracks[trackIndex];
  const isSpotifyTrack = !!currentTrack?.spotifyUri;
  const albumProgress = loadedAlbum
    ? (trackIndex + progress) / loadedAlbum.tracks.length
    : 0;
  // Whichever record is "current" for backdrop purposes: on the platter,
  // mid-flight toward/away from it, or — if nothing's loaded yet — just
  // front-and-center in the carousel.
  const backgroundAlbum = loadedAlbum ?? flightAlbum ?? browsingAlbum;
  // Seconds into the current track, for the deck's LCD. Progress is a
  // fraction, so scale by whichever engine's duration applies.
  const trackDurationSec = isSpotifyTrack
    ? spotifyDurationRef.current / 1000
    : audioRef.current?.duration || 0;
  const elapsedSeconds = progress * trackDurationSec;

  // How long the album carousel stays up with no interaction before it
  // auto-hides so the (now fixed-position) turntable can stand alone.
  const CAROUSEL_AUTOHIDE_MS = 5000;

  const clearCarouselAutoHide = () => {
    if (carouselHideTimer.current) {
      clearTimeout(carouselHideTimer.current);
      carouselHideTimer.current = null;
    }
  };

  const scheduleCarouselAutoHide = () => {
    clearCarouselAutoHide();
    carouselHideTimer.current = setTimeout(() => {
      setCarouselVisible(false);
    }, CAROUSEL_AUTOHIDE_MS);
  };

  // Hide immediately, e.g. once a record lands and starts playing
  const dismissCarousel = () => {
    clearCarouselAutoHide();
    setCarouselVisible(false);
  };

  // Any tap/swipe on the carousel resets its inactivity clock
  const handleCarouselActivity = () => {
    if (!carouselVisible) return;
    scheduleCarouselAutoHide();
  };

  const toggleCarousel = () => {
    if (carouselVisible) {
      dismissCarousel();
    } else {
      setCarouselVisible(true);
      scheduleCarouselAutoHide();
    }
  };

  // Start the inactivity clock for the carousel's initial visible state
  useEffect(() => {
    scheduleCarouselAutoHide();
    return clearCarouselAutoHide;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guard against a throttled Spotify scrub seek firing after unmount
  useEffect(() => {
    return () => {
      if (spotifyScrubTimerRef.current) {
        clearTimeout(spotifyScrubTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setSpotifyAuthed(hasSpotifyToken());
  }, []);

  // Fill the crate with the logged-in account's own Spotify library once
  // authenticated. Automatic and account-agnostic — no profile id or
  // playlist links to configure ahead of time.
  useEffect(() => {
    if (!spotifyAuthed) return;
    let cancelled = false;
    fetchMyPlaylists()
      .then((loaded) => {
        if (!cancelled) setSpotifyAlbums(loaded);
      })
      .catch((err) => {
        console.error("Failed to load Spotify playlists", err);
      });
    return () => {
      cancelled = true;
    };
  }, [spotifyAuthed]);

  // Connect this page as a Spotify device once authenticated
  useEffect(() => {
    if (!spotifyAuthed) return;
    let cancelled = false;
    let player: SpotifyPlayer | null = null;
    loadSpotifySdk().then((Spotify) => {
      if (cancelled) return;
      player = new Spotify.Player({
        name: "Forestpark Turntable",
        getOAuthToken: (cb) => {
          getSpotifyToken().then((token) => token && cb(token));
        },
        volume: 1,
      });
      player.addListener("ready", (data: { device_id: string }) => {
        spotifyDeviceRef.current = data.device_id;
        setSpotifyReady(true);
      });
      player.addListener("not_ready", () => setSpotifyReady(false));
      player.connect();
      spotifyRef.current = player;
    });
    return () => {
      cancelled = true;
      spotifyRef.current = null;
      player?.disconnect();
    };
  }, [spotifyAuthed]);

  const startOrResumeSpotify = async (uri: string) => {
    const device = spotifyDeviceRef.current;
    const player = spotifyRef.current;
    if (!device || !player) return;
    if (spotifyStartedUriRef.current === uri) {
      player.resume();
      return;
    }
    try {
      await playSpotifyTrack(device, uri);
      spotifyStartedUriRef.current = uri;
    } catch {
      setStatus("stopped");
    }
  };

  // Drive whichever engine the current track needs; keep the other silent
  useEffect(() => {
    if (!currentTrack) return;
    if (currentTrack.spotifyUri) {
      audioRef.current?.pause();
      if (status === "playing") {
        startOrResumeSpotify(currentTrack.spotifyUri);
      }
    } else if (currentTrack.url) {
      spotifyRef.current?.pause();
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.src !== currentTrack.url) {
        audio.src = currentTrack.url;
      }
      if (status === "playing") {
        audio.muted = false;
        audio.play().catch(() => setStatus("stopped"));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, loadedIndex, trackIndex, currentTrack, spotifyReady]);

  // Master volume fader: apply to whichever engine is currently sounding.
  // Spotify's setVolume is a network call, so only fire it for that engine.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
    if (isSpotifyTrack) {
      spotifyRef.current?.setVolume(volume).catch(() => {});
    }
  }, [volume, isSpotifyTrack, spotifyReady]);

  // The audio element reports progress via timeupdate; Spotify needs polling.
  // The end-of-track heuristic: Spotify parks paused at position 0 after the
  // last position we saw was near the end.
  useEffect(() => {
    if (status !== "playing" || !isSpotifyTrack) return;
    const id = setInterval(async () => {
      const player = spotifyRef.current;
      if (!player) return;
      const state = await player.getCurrentState();
      if (!state || !state.duration) return;
      spotifyDurationRef.current = state.duration;
      if (
        state.paused &&
        state.position === 0 &&
        spotifyLastPosRef.current > state.duration - 3000
      ) {
        spotifyLastPosRef.current = 0;
        handleEnded();
        return;
      }
      if (!state.paused) {
        spotifyLastPosRef.current = state.position;
        setProgress(state.position / state.duration);
      }
    }, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, isSpotifyTrack, loadedIndex, trackIndex]);

  // Vinyl needle crackle: plays for a fixed few seconds from a random point
  // in the (28s) source clip each time a song starts (needle drop, resume,
  // or auto-advance to the next track), then stops outright — a simple
  // "the needle just touched down" texture, not a sustained ambience.
  const CRACKLE_FALLBACK_DURATION = 28;
  const CRACKLE_DURATION = 3;
  const CRACKLE_VOLUME = 0.28;

  const clearCrackleTimer = () => {
    if (crackleStopTimerRef.current) {
      clearTimeout(crackleStopTimerRef.current);
      crackleStopTimerRef.current = null;
    }
  };

  const playCrackle = () => {
    const audio = crackleRef.current;
    if (!audio) return;
    // A rapid string of song starts shouldn't stack overlapping crackles
    clearCrackleTimer();
    const total =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : CRACKLE_FALLBACK_DURATION;
    const maxStart = Math.max(0, total - CRACKLE_DURATION);
    audio.currentTime = Math.random() * maxStart;
    audio.volume = CRACKLE_VOLUME;
    audio.play().catch(() => {});
    crackleStopTimerRef.current = setTimeout(() => {
      audio.pause();
    }, CRACKLE_DURATION * 1000);
  };

  useEffect(() => clearCrackleTimer, []);

  const slideTo = (index: number) =>
    new Promise<void>((resolve) => {
      const swiper = swiperRef.current;
      if (!swiper || swiper.destroyed || swiper.activeIndex === index) {
        resolve();
        return;
      }
      const done = () => {
        swiper.off("transitionEnd", done);
        resolve();
      };
      swiper.on("transitionEnd", done);
      swiper.slideTo(index, 400);
    });

  const setTouchMove = (allowed: boolean) => {
    const swiper = swiperRef.current;
    if (swiper && !swiper.destroyed) {
      swiper.allowTouchMove = allowed;
    }
  };

  useEffect(() => {
    if (!flight) return;
    const flyEl = flyRef.current;
    const discEl = discRefs.current.get(albums[flight.index].id);
    const platterEl = platterRef.current;

    const finish = () => {
      if (flight.dir === "back") {
        setFlight(null);
        const next = pendingIndex;
        if (next !== null) {
          slideTo(next).then(() => {
            setPendingIndex(null);
            setFlight({ index: next, dir: "out" });
          });
        } else {
          setPendingIndex(null);
          setTouchMove(true);
        }
      } else {
        // A fresh disc on a silent deck: motor off, needle at rest. The
        // user has to hit start and drop the needle themselves.
        const track = albums[flight.index].tracks[0];
        if (track?.spotifyUri) {
          // Force a fresh start instead of resuming an earlier session
          spotifyStartedUriRef.current = null;
          spotifyLastPosRef.current = 0;
        } else {
          const audio = audioRef.current;
          if (audio) {
            audio.currentTime = 0;
            audio.muted = false;
          }
        }
        setTrackIndex(0);
        setProgress(0);
        setLoadedIndex(flight.index);
        setFlight(null);
        setStatus("stopped");
        setTableOn(false);
        setTouchMove(true);
        // The disc has landed — the crate can get out of the way now that
        // the animation is fully done.
        dismissCarousel();
      }
    };

    if (!flyEl || !discEl || !platterEl) {
      finish();
      return;
    }

    const discRect = discEl.getBoundingClientRect();
    const platterRect = platterEl.getBoundingClientRect();
    const recordSize = platterRect.width * RECORD_TO_PLATTER_RATIO;
    const recordRect = {
      left: platterRect.left + (platterRect.width - recordSize) / 2,
      top: platterRect.top + (platterRect.height - recordSize) / 2,
      width: recordSize,
      height: recordSize,
    };
    const sleeveRect = discEl.parentElement
      ?.querySelector(".album-sleeve")
      ?.getBoundingClientRect();
    // How far right the disc must move to fully clear the sleeve opening
    const exitDx = sleeveRect
      ? sleeveRect.right - discRect.left + 12
      : discRect.width;

    // Overlay a copy of this album's sleeve above the flying disc so the
    // disc passes behind its own pouch but in front of everything else
    const sleeveEl = flySleeveRef.current;
    if (sleeveEl && sleeveRect) {
      sleeveEl.style.left = `${sleeveRect.left}px`;
      sleeveEl.style.top = `${sleeveRect.top}px`;
      sleeveEl.style.width = `${sleeveRect.width}px`;
      sleeveEl.style.height = `${sleeveRect.height}px`;
      sleeveEl.style.visibility = "visible";
    }

    const from = flight.dir === "out" ? discRect : recordRect;
    const to = flight.dir === "out" ? recordRect : discRect;
    const scale = to.width / from.width;
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);

    flyEl.style.left = `${from.left}px`;
    flyEl.style.top = `${from.top}px`;
    flyEl.style.width = `${from.width}px`;
    flyEl.style.height = `${from.height}px`;
    flyEl.style.visibility = "visible";

    const keyframes =
      flight.dir === "out"
        ? [
            { transform: "translate(0px, 0px) scale(1)", easing: "ease-out" },
            {
              transform: `translate(${exitDx}px, 0px) scale(1)`,
              offset: 0.4,
              easing: "ease-in-out",
            },
            { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
          ]
        : [
            {
              transform: "translate(0px, 0px) scale(1)",
              easing: "ease-in-out",
            },
            {
              transform: `translate(${dx + exitDx}px, ${dy}px) scale(${scale})`,
              offset: 0.6,
              easing: "ease-out",
            },
            { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
          ];

    const animation = flyEl.animate(keyframes, {
      duration: flight.dir === "out" ? 750 : 600,
      fill: "forwards",
    });
    animation.onfinish = finish;
    return () => animation.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flight, pendingIndex, albums]);

  const registerDisc = (id: string, el: HTMLElement | null) => {
    if (el) {
      discRefs.current.set(id, el);
    } else {
      discRefs.current.delete(id);
    }
  };

  const play = () => setStatus("playing");

  const pause = () => {
    if (isSpotifyTrack) {
      spotifyRef.current?.pause();
    } else {
      audioRef.current?.pause();
    }
    setStatus("paused");
  };

  // The start/stop switch only spins the platter motor — it never drops the
  // needle. If the needle is already in a groove (motor stopped mid-track),
  // restarting the motor resumes from that spot.
  const toggleTable = () => {
    if (!loadedAlbum || busy) return;
    if (tableOn) {
      setTableOn(false);
      if (status === "playing") pause();
    } else {
      setTableOn(true);
      if (status === "paused") play();
    }
  };

  // Silence both engines: also used when switching albums mid-play
  const stop = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    const player = spotifyRef.current;
    if (player) {
      player.pause();
      player.seek(0);
    }
    setStatus("stopped");
    setTrackIndex(0);
    setProgress(0);
  };

  // iOS requires a media element to be "unlocked" by a successful play()
  // inside a direct user gesture at least once before any later
  // programmatic play() on it is allowed to succeed. The needle-drop
  // release already calls play() synchronously (see seekTrack below), but
  // some WebKit versions don't trust the pointerup that *ends* a drag as
  // strongly as the pointerdown that *starts* it — so this primes the
  // element the moment the needle is grabbed, muted and instantly paused,
  // purely to establish the gesture-unlock before the real play happens.
  const primeAudioForIOS = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const wasMuted = audio.muted;
    audio.muted = true;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(() => {
          audio.pause();
          audio.muted = wasMuted;
        })
        .catch(() => {
          audio.muted = wasMuted;
        });
    } else {
      audio.muted = wasMuted;
    }
  };

  // Dropping the needle into a groove — the only way sound ever starts.
  // Requires the motor to be running; the crackle marks the contact.
  //
  // iOS Safari only allows audio.play() to succeed when it's called
  // synchronously inside a user-gesture handler (the tonearm's pointerup,
  // which is what calls this). The status-driven effect above starts
  // playback too, but only after a setState + re-render — one tick too
  // late for iOS's autoplay policy, which silently blocks it. So this
  // starts the right engine directly, right here, instead of only flipping
  // `status` and waiting for the effect to notice.
  const seekTrack = (index: number) => {
    if (!loadedAlbum || busy || !tableOn) return;
    playCrackle();
    // Resolved directly from the index param, not the `currentTrack`
    // state var — that still reflects the *old* trackIndex until the
    // setTrackIndex below actually commits and re-renders.
    const track = loadedAlbum.tracks[index];
    if (index === trackIndex) {
      if (track.spotifyUri) {
        spotifyRef.current?.seek(0);
      } else if (audioRef.current) {
        audioRef.current.currentTime = 0;
      }
    } else {
      setTrackIndex(index);
    }
    setProgress(0);
    setStatus("playing");
    if (track.spotifyUri) {
      startOrResumeSpotify(track.spotifyUri);
    } else if (track.url) {
      const audio = audioRef.current;
      if (audio) {
        if (audio.src !== track.url) audio.src = track.url;
        audio.muted = false;
        audio.play().catch(() => setStatus("stopped"));
      }
    }
  };

  // Dropping the needle onto the "Current Time" groove: resumes exactly
  // where playback left off, without touching the track or its position —
  // unlike seekTrack, which always jumps to a track's start. Same
  // synchronous-play requirement as seekTrack above.
  const resumeAtCurrentPosition = () => {
    if (!loadedAlbum || busy || !tableOn) return;
    playCrackle();
    setStatus("playing");
    if (currentTrack?.spotifyUri) {
      startOrResumeSpotify(currentTrack.spotifyUri);
    } else if (currentTrack?.url) {
      const audio = audioRef.current;
      if (audio) {
        audio.muted = false;
        audio.play().catch(() => setStatus("stopped"));
      }
    }
  };

  // Spotify's seek() is a network call to Connect infrastructure, so it's
  // throttled to a trailing call at most every ~200ms while dragging; the
  // local <audio> element is cheap to seek directly on every move instead.
  const SPOTIFY_SCRUB_INTERVAL_MS = 200;

  const flushSpotifyScrub = () => {
    spotifyScrubTimerRef.current = null;
    const target = spotifyScrubPendingRef.current;
    spotifyScrubPendingRef.current = null;
    if (target === null) return;
    spotifyRef.current?.seek(target);
  };

  const scheduleSpotifyScrub = (targetMs: number) => {
    spotifyScrubPendingRef.current = targetMs;
    if (spotifyScrubTimerRef.current) return;
    spotifyScrubTimerRef.current = setTimeout(
      flushSpotifyScrub,
      SPOTIFY_SCRUB_INTERVAL_MS,
    );
  };

  // Nudges the *current track's* position by a relative amount, driven by
  // rotating the disc. Always clamped within the track — never advances or
  // rewinds onto a different one (that's what dragging the needle is for).
  const handleScrub = (deltaSeconds: number) => {
    if (!currentTrack || busy) return;
    if (isSpotifyTrack) {
      const duration = spotifyDurationRef.current;
      if (!duration) return;
      const base = spotifyScrubPendingRef.current ?? spotifyLastPosRef.current;
      const next = Math.min(duration, Math.max(0, base + deltaSeconds * 1000));
      spotifyLastPosRef.current = next;
      setProgress(next / duration);
      scheduleSpotifyScrub(next);
    } else {
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(audio.duration)) return;
      const next = Math.min(
        audio.duration,
        Math.max(0, audio.currentTime + deltaSeconds),
      );
      audio.currentTime = next;
      setProgress(next / audio.duration);
    }
  };

  // Flush any pending throttled Spotify seek once the drag gesture ends
  const handleScrubEnd = () => {
    if (spotifyScrubTimerRef.current) {
      clearTimeout(spotifyScrubTimerRef.current);
      flushSpotifyScrub();
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (audio && audio.duration && !isSpotifyTrack) {
      setProgress(audio.currentTime / audio.duration);
    }
  };

  const handleEnded = () => {
    if (loadedAlbum && trackIndex < loadedAlbum.tracks.length - 1) {
      // More tracks left on the record — the engine-driving effect above
      // picks up the new trackIndex and starts it, since status stays
      // "playing" throughout. Crackle marks this next song starting too.
      playCrackle();
      setTrackIndex(trackIndex + 1);
      setProgress(0);
    } else {
      // End of the album: power down the motor too (not just playback) —
      // status flipping to "stopped" already sends the needle back to its
      // rest position via Turntable's needle-angle effect.
      setStatus("stopped");
      setTableOn(false);
      setTrackIndex(0);
      setProgress(0);
    }
  };

  const signOutSpotify = () => {
    if (busy) return;
    stop();
    setTableOn(false);
    clearSpotifyToken();
    setSpotifyAlbums([]);
    setSpotifyAuthed(false);
    setSpotifyReady(false);
    setLoadedIndex(null);
    spotifyDeviceRef.current = null;
    spotifyStartedUriRef.current = null;
  };

  const selectAlbum = async (index: number) => {
    if (busy) return;
    // Selecting something (even just toggling play/pause below) counts as
    // activity, so a mid-browse carousel doesn't vanish out from under you
    handleCarouselActivity();
    if (index === loadedIndex) {
      toggleTable();
      return;
    }
    // Spotify albums need a login before anything can play
    if (albums[index].tracks[0]?.spotifyUri && !spotifyAuthed) {
      beginSpotifyLogin();
      return;
    }
    // Cancel anything left over from a previous pick — a still-playing
    // crackle — so a fast string of selections can't stack or leave a
    // stray one playing for the wrong record.
    clearCrackleTimer();
    stop();
    setTableOn(false);
    setTouchMove(false);
    if (loadedIndex !== null) {
      const returnIndex = loadedIndex;
      setPendingIndex(index);
      await slideTo(returnIndex);
      setLoadedIndex(null);
      setFlight({ index: returnIndex, dir: "back" });
    } else {
      setPendingIndex(index);
      await slideTo(index);
      setPendingIndex(null);
      setFlight({ index, dir: "out" });
    }
  };

  const hiddenDiscIds = [loadedAlbum?.id, flightAlbum?.id].filter(
    (id): id is string => id !== undefined,
  );

  return (
    // Tapping the background (anywhere the deck, carousel, and connect
    // button don't themselves capture) reveals the library.
    <div
      className="player"
      onClick={toggleCarousel}
    >
      <SiteBackground cover={backgroundAlbum?.cover} />
      <div className="background-tap-zone" />
      <Turntable
        album={loadedAlbum}
        status={status}
        busy={busy}
        albumProgress={albumProgress}
        elapsedSeconds={elapsedSeconds}
        platterRef={platterRef}
        tableOn={tableOn}
        volume={volume}
        onPrimeAudio={primeAudioForIOS}
        onSeek={seekTrack}
        onResume={resumeAtCurrentPosition}
        onStop={stop}
        onToggleTable={toggleTable}
        onVolumeChange={setVolume}
        onScrub={handleScrub}
        onScrubEnd={handleScrubEnd}
      />
      {spotifyAuthed ? null : (
        <button
          className="spotify-connect"
          onClick={(e) => {
            e.stopPropagation();
            beginSpotifyLogin();
          }}
        >
          Connect Spotify
        </button>
      )}
      <AlbumCarousel
        albums={albums}
        hiddenDiscIds={hiddenDiscIds}
        visible={carouselVisible}
        onSelect={selectAlbum}
        onActivity={handleCarouselActivity}
        onActiveChange={setBrowsingAlbum}
        registerDisc={registerDisc}
        onSwiper={(swiper) => {
          swiperRef.current = swiper;
        }}
      />
      {flightAlbum && (
        <>
          <div
            ref={flyRef}
            className="flying-disc"
            style={{ visibility: "hidden" }}
          >
            <img
              className="flying-disc-label"
              src={flightAlbum.cover}
              alt=""
            />
          </div>
          <img
            ref={flySleeveRef}
            className="flying-sleeve"
            src={flightAlbum.cover}
            alt=""
            style={{ visibility: "hidden" }}
          />
        </>
      )}
      <audio
        ref={audioRef}
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
      />
      <audio
        ref={crackleRef}
        src="/audio/crackle.mp3"
        preload="auto"
      />
    </div>
  );
}
