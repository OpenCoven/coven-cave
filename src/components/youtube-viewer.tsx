"use client";

import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";

// The playlist the panel opens on by default.
const DEFAULT_PLAYLIST_ID = "PLp61JrZcGK7-uuXOWzezyZkz61RQb0XOG";
const DEFAULT_SRC = playlistEmbed(DEFAULT_PLAYLIST_ID);

const ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const PLAYLIST_RE = /^[a-zA-Z0-9_-]{12,}$/;

const COLLAPSED_KEY = "cave:youtube:collapsed";

// Shared params: `list=...` exposes YouTube's in-player playlist list/menu so you
// can browse and jump between entries without leaving the panel.
function playlistEmbed(listId: string, videoId?: string): string {
  const base = videoId ? `https://www.youtube.com/embed/${videoId}` : "https://www.youtube.com/embed/videoseries";
  return `${base}?list=${encodeURIComponent(listId)}`;
}

function videoEmbed(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}`;
}

/**
 * Turn whatever the user pasted into a YouTube embed src. Handles playlists
 * (any `list=` link, a `videoseries` embed, or a bare playlist id), watch URLs,
 * youtu.be / shorts / live links, /embed/ URLs, and bare 11-char video ids.
 * Returns null when nothing usable is found.
 */
export function parseYoutubeEmbed(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (ID_RE.test(value)) return videoEmbed(value);
  if (value.startsWith("PL") || value.startsWith("UU") || value.startsWith("FL") || value.startsWith("RD")) {
    if (PLAYLIST_RE.test(value)) return playlistEmbed(value);
  }
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    const host = url.hostname.replace(/^www\./, "");
    const list = url.searchParams.get("list");
    if (host === "youtu.be") {
      const id = url.pathname.slice(1).split("/")[0];
      if (list) return playlistEmbed(list, ID_RE.test(id) ? id : undefined);
      return ID_RE.test(id) ? videoEmbed(id) : null;
    }
    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      const v = url.searchParams.get("v");
      if (list) return playlistEmbed(list, v && ID_RE.test(v) ? v : undefined);
      if (v && ID_RE.test(v)) return videoEmbed(v);
      const parts = url.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex((p) => p === "embed" || p === "shorts" || p === "live");
      if (idx >= 0 && parts[idx + 1] && ID_RE.test(parts[idx + 1])) return videoEmbed(parts[idx + 1]);
    }
  } catch {
    return null;
  }
  return null;
}

// ── YouTube IFrame Player API ────────────────────────────────────────────────
// The collapsed "now playing" bar needs the real video title and live volume,
// which a bare <iframe> can't provide. Adding `enablejsapi=1` and attaching a
// YT.Player lets us read getVideoData()/getVolume() and drive
// play/pause/next/volume from native controls.

type YTPlayer = {
  getVolume: () => number;
  setVolume: (v: number) => void;
  isMuted: () => boolean;
  mute: () => void;
  unMute: () => void;
  playVideo: () => void;
  pauseVideo: () => void;
  nextVideo: () => void;
  previousVideo: () => void;
  getVideoData: () => { title?: string } | undefined;
  destroy?: () => void;
};

type YTNamespace = {
  Player: new (
    el: Element,
    opts: { events?: Record<string, (e: { target: YTPlayer; data?: number }) => void> },
  ) => YTPlayer;
  PlayerState: { PLAYING: number };
};

type YTWindow = Window & {
  YT?: YTNamespace;
  onYouTubeIframeAPIReady?: () => void;
};

let ytApiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  const w = window as YTWindow;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise<YTNamespace>((resolve) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (w.YT) resolve(w.YT);
    };
    if (!document.querySelector("script[data-youtube-iframe-api]")) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      s.dataset.youtubeIframeApi = "";
      document.head.appendChild(s);
    }
  });
  return ytApiPromise;
}

/** Append the params the Player API needs without mutating the logical src. */
function withJsApi(src: string): string {
  try {
    const url = new URL(src);
    url.searchParams.set("enablejsapi", "1");
    url.searchParams.set("playsinline", "1");
    if (typeof window !== "undefined") url.searchParams.set("origin", window.location.origin);
    return url.toString();
  } catch {
    return src;
  }
}

/**
 * A compact YouTube player with an editable URL bar. Lives in the companion
 * rail's resizable bottom pane (the "Video" toggle). Paste any YouTube link,
 * video id, or playlist; the embed reloads when you hit Load / Enter.
 *
 * Collapses to a full-width, minimal-height "now playing" bar (transport +
 * title + volume) so it keeps playing in the background while the rest of the
 * rail reclaims the height. The iframe stays mounted across the collapse so
 * audio never stops.
 */
export function YoutubeViewer({ defaultSrc = DEFAULT_SRC }: { defaultSrc?: string }) {
  const [src, setSrc] = useState(defaultSrc);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [collapsed, setCollapsed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [title, setTitle] = useState("");

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);

  // Restore the last collapse choice so the player reopens the way it was left.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSED_KEY) === "1") setCollapsed(true);
    } catch {
      // ignore storage failures
    }
  }, []);

  const persistCollapsed = useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // ignore storage failures
    }
  }, []);

  const syncTitle = useCallback(() => {
    try {
      const data = playerRef.current?.getVideoData?.();
      if (data?.title) setTitle(data.title);
    } catch {
      // getVideoData can throw before the player is ready
    }
  }, []);

  // Attach a YT.Player to the live iframe so the controls work. Recreated when
  // the source changes (the iframe remounts via its `key`).
  useEffect(() => {
    let cancelled = false;
    void loadYouTubeApi().then((YT) => {
      if (cancelled || !iframeRef.current) return;
      playerRef.current = new YT.Player(iframeRef.current, {
        events: {
          onReady: (e) => {
            try {
              setVolume(Math.round(e.target.getVolume()));
              setMuted(e.target.isMuted());
            } catch {
              // defaults stand in until the next state change
            }
            syncTitle();
          },
          onStateChange: (e) => {
            setPlaying(e.data === YT.PlayerState.PLAYING);
            syncTitle();
          },
        },
      });
    });
    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy?.();
      } catch {
        // the keyed iframe may already be gone — destroy is best-effort
      }
      playerRef.current = null;
    };
  }, [src, syncTitle]);

  const load = () => {
    const next = parseYoutubeEmbed(input);
    if (!next) {
      setError("Enter a YouTube link, video ID, or playlist");
      return;
    }
    setError(null);
    setSrc(next);
    setInput("");
  };

  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (playing) p.pauseVideo();
    else p.playVideo();
  }, [playing]);

  const toggleMute = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (muted) {
      p.unMute();
      setMuted(false);
      if (volume === 0) {
        p.setVolume(50);
        setVolume(50);
      }
    } else {
      p.mute();
      setMuted(true);
    }
  }, [muted, volume]);

  const changeVolume = useCallback(
    (next: number) => {
      const p = playerRef.current;
      setVolume(next);
      if (!p) return;
      p.setVolume(next);
      if (next === 0) {
        p.mute();
        setMuted(true);
      } else if (muted) {
        p.unMute();
        setMuted(false);
      }
    },
    [muted],
  );

  const effectiveVolume = muted ? 0 : volume;
  const volumeIcon =
    effectiveVolume === 0
      ? "ph:speaker-slash-fill"
      : effectiveVolume < 50
        ? "ph:speaker-low-fill"
        : "ph:speaker-high-fill";

  return (
    <div className="youtube-viewer" data-collapsed={collapsed ? "true" : undefined}>
      <form
        className="youtube-viewer__bar"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <Icon name="ph:video" width={14} className="youtube-viewer__icon" />
        <input
          type="text"
          className="youtube-viewer__input focus-ring"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Paste a YouTube link, video ID, or playlist…"
          aria-label="YouTube link, video ID, or playlist"
          aria-invalid={error ? true : undefined}
        />
        <button type="submit" className="youtube-viewer__load focus-ring">
          Load
        </button>
        <button
          type="button"
          className="youtube-viewer__chevron focus-ring"
          onClick={() => persistCollapsed(true)}
          aria-label="Collapse to mini player"
          title="Collapse to mini player"
        >
          <Icon name="ph:caret-down" width={14} />
        </button>
      </form>
      {error ? (
        <p className="youtube-viewer__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="youtube-viewer__frame">
        <iframe
          key={src}
          ref={iframeRef}
          src={withJsApi(src)}
          title="YouTube video player"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
      {/* Mini player — shown only when collapsed (CSS). Full width, one row:
          a primary play button, next, a now-playing equalizer + title, volume,
          and an expand caret. */}
      <div className="youtube-viewer__mini">
        <button
          type="button"
          className="youtube-viewer__mini-btn youtube-viewer__mini-btn--primary focus-ring"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
        >
          <Icon name={playing ? "ph:pause-fill" : "ph:play-fill"} width={13} />
        </button>
        <button
          type="button"
          className="youtube-viewer__mini-btn focus-ring"
          onClick={() => playerRef.current?.nextVideo()}
          aria-label="Next"
          title="Next"
        >
          <Icon name="ph:skip-forward-fill" width={13} />
        </button>
        <span className="youtube-viewer__nowplaying">
          <Equalizer playing={playing} />
          <span className="youtube-viewer__mini-title" title={title || "YouTube"}>
            {title || "YouTube"}
          </span>
        </span>
        <button
          type="button"
          className="youtube-viewer__mini-btn focus-ring"
          onClick={toggleMute}
          aria-label={effectiveVolume === 0 ? "Unmute" : "Mute"}
          title={effectiveVolume === 0 ? "Unmute" : "Mute"}
        >
          <Icon name={volumeIcon} width={14} />
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={effectiveVolume}
          onChange={(e) => changeVolume(Number(e.target.value))}
          className="youtube-viewer__volume"
          aria-label="Volume"
          style={{ "--vol": `${effectiveVolume}%` } as CSSProperties}
        />
        <button
          type="button"
          className="youtube-viewer__chevron focus-ring"
          onClick={() => persistCollapsed(false)}
          aria-label="Expand player"
          title="Expand player"
        >
          <Icon name="ph:caret-up" width={14} />
        </button>
      </div>
      {/* Vertical "now playing" strip — shown only when the whole rail is
          collapsed to its peek width (CSS, under .companion-rail--video-strip).
          The iframe keeps playing audio (hidden); this is a calm, upright
          now-playing indicator instead of a sideways-rotated video. The rail's
          transparent overlay handles tap-to-expand. */}
      <div className="youtube-viewer__strip" aria-hidden="true">
        <Equalizer playing={playing} className="youtube-viewer__eq--lg" />
        <span className="youtube-viewer__strip-title">{title || "YouTube"}</span>
      </div>
    </div>
  );
}

/** A tiny three-bar "now playing" equalizer; the bars animate while `playing`
 *  and rest at a low flat line when paused. Decorative (aria-hidden). */
function Equalizer({ playing, className }: { playing: boolean; className?: string }) {
  return (
    <span
      className={`youtube-viewer__eq${className ? ` ${className}` : ""}`}
      data-playing={playing ? "true" : undefined}
      aria-hidden="true"
    >
      <i />
      <i />
      <i />
    </span>
  );
}
