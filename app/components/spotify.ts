// Spotify auth (PKCE, no server needed) + Web Playback SDK helpers.
// Requires a Spotify app registered at developer.spotify.com with
// http://127.0.0.1:3000/callback as a redirect URI, and a Premium account.

const CLIENT_ID = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID ?? "";
const SCOPES =
  "streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state playlist-read-private playlist-read-collaborative";
const TOKEN_KEY = "forestpark-spotify-token";
const VERIFIER_KEY = "forestpark-spotify-verifier";

type StoredToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

const redirectUri = () => `${window.location.origin}/callback`;

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export async function beginSpotifyLogin() {
  const verifierBytes = new Uint8Array(48);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64url(verifierBytes);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: base64url(new Uint8Array(digest)),
    // Always show the consent screen so a signed-out user can switch accounts
    show_dialog: "true",
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

function readToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as StoredToken) : null;
  } catch {
    return null;
  }
}

async function requestToken(body: URLSearchParams): Promise<StoredToken> {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Spotify token request failed (${res.status})`);
  }
  const data: TokenResponse = await res.json();
  const token: StoredToken = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? readToken()?.refreshToken ?? "",
    expiresAt: Date.now() + data.expires_in * 1000 - 60_000,
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  return token;
}

export async function completeSpotifyLogin(code: string) {
  await requestToken(
    new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      code_verifier: sessionStorage.getItem(VERIFIER_KEY) ?? "",
    }),
  );
}

export const hasSpotifyToken = () => readToken() !== null;

export const clearSpotifyToken = () => {
  localStorage.removeItem(TOKEN_KEY);
};

export async function getSpotifyToken(): Promise<string | null> {
  const token = readToken();
  if (!token) return null;
  if (Date.now() < token.expiresAt) return token.accessToken;
  try {
    const refreshed = await requestToken(
      new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
    );
    return refreshed.accessToken;
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    return null;
  }
}

// --- Web Playback SDK ---

export type SpotifyState = {
  paused: boolean;
  position: number;
  duration: number;
};

export type SpotifyPlayer = {
  connect(): Promise<boolean>;
  disconnect(): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addListener(event: string, cb: (data: any) => void): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  getCurrentState(): Promise<SpotifyState | null>;
  activateElement?: () => Promise<void>;
};

type SpotifyNamespace = {
  Player: new (options: {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }) => SpotifyPlayer;
};

declare global {
  interface Window {
    Spotify?: SpotifyNamespace;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

let sdkPromise: Promise<SpotifyNamespace> | null = null;

export function loadSpotifySdk(): Promise<SpotifyNamespace> {
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve) => {
      if (window.Spotify) {
        resolve(window.Spotify);
        return;
      }
      window.onSpotifyWebPlaybackSDKReady = () => resolve(window.Spotify!);
      const script = document.createElement("script");
      script.src = "https://sdk.scdn.co/spotify-player.js";
      document.head.appendChild(script);
    });
  }
  return sdkPromise;
}

// Accepts spotify:track:ID, open.spotify.com/track/ID links, or a bare ID
export const normalizeSpotifyUri = (value: string) => {
  const match = value.match(/track[/:]([A-Za-z0-9]+)/);
  return `spotify:track:${match ? match[1] : value}`;
};

async function apiGet<T>(path: string): Promise<T> {
  const token = await getSpotifyToken();
  if (!token) throw new Error("Not authenticated with Spotify");
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    // Errors here were previously swallowed by callers, making failures like
    // missing scopes or 403s on playlists we don't own invisible. Log the
    // body so it shows up in the console instead of silently returning [].
    const body = await res.text().catch(() => "");
    console.error(`Spotify GET ${path} failed (${res.status})`, body);
    throw new Error(`Spotify request failed (${res.status})`);
  }
  return res.json();
}

type PlaylistSummary = {
  id: string;
  name: string;
  images: { url: string }[] | null;
  owner: { display_name?: string };
};

type PlaylistItemsResponse = {
  items: {
    is_local: boolean;
    item: { name: string; uri: string } | null;
  }[];
};

type PlaylistAlbum = import("./RecordPlayer").Album;

// Note: playlist item contents are only readable when the logged-in Spotify
// account owns the playlist or collaborates on it — a playlist just being
// public is not enough. A 403 here usually means the connected account isn't
// the owner/collaborator, not that anything is misconfigured.
// https://developer.spotify.com/documentation/web-api/reference/get-playlists-items
async function playlistToAlbum(
  playlist: PlaylistSummary,
): Promise<PlaylistAlbum> {
  const itemsRes = await apiGet<PlaylistItemsResponse>(
    `/playlists/${playlist.id}/items?limit=50&fields=items(is_local,item(name,uri))`,
  );
  const tracks = itemsRes.items
    .filter((entry) => entry.item && !entry.is_local)
    .map((entry) => ({
      title: entry.item!.name,
      spotifyUri: entry.item!.uri,
    }));
  return {
    id: `spotify-playlist-${playlist.id}`,
    title: playlist.name,
    artist: playlist.owner.display_name ?? "Spotify",
    cover:
      playlist.images?.[0]?.url ??
      `https://picsum.photos/seed/${playlist.id}/400/400`,
    tracks,
  };
}

type PlaylistsPage = {
  items: PlaylistSummary[];
  next: string | null;
};

// Every playlist the *currently logged-in* Spotify account owns or follows,
// as turntable albums. Deliberately account-agnostic — no profile id or
// share links to configure, it always reflects whoever is connected.
// https://developer.spotify.com/documentation/web-api/reference/get-a-list-of-current-users-playlists
export async function fetchMyPlaylists(): Promise<PlaylistAlbum[]> {
  const playlists: PlaylistSummary[] = [];
  let path: string | null = "/me/playlists?limit=50";
  while (path) {
    const page: PlaylistsPage = await apiGet<PlaylistsPage>(path);
    playlists.push(...page.items);
    // Spotify returns `next` as a full URL; apiGet wants a path.
    path = page.next
      ? page.next.replace(/^https:\/\/api\.spotify\.com\/v1/, "")
      : null;
  }
  const albums = await Promise.all(
    playlists.map((playlist) =>
      playlistToAlbum(playlist).catch((err) => {
        // A playlist can be listed here (followed) without being readable —
        // the items endpoint still 403s unless you own it or collaborate on
        // it. Skip that one instead of blanking the whole crate.
        console.error(`Skipping playlist "${playlist.name}"`, err);
        return null;
      }),
    ),
  );
  return albums.filter(
    (album): album is PlaylistAlbum => !!album && album.tracks.length > 0,
  );
}

export async function playSpotifyTrack(deviceId: string, uri: string) {
  const token = await getSpotifyToken();
  if (!token) throw new Error("Not authenticated with Spotify");
  const res = await fetch(
    `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uris: [normalizeSpotifyUri(uri)] }),
    },
  );
  if (!res.ok) throw new Error(`Spotify play failed (${res.status})`);
}
