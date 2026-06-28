"use client";

import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { useTauriPlatform } from "@/lib/tauri-platform";

// The playlist the panel opens on by default.
const DEFAULT_PLAYLIST_ID = "PLp61JrZcGK7-uuXOWzezyZkz61RQb0XOG";
const DEFAULT_SRC = playlistEmbed(DEFAULT_PLAYLIST_ID);

const ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const PLAYLIST_RE = /^[a-zA-Z0-9_-]{12,}$/;

const COLLAPSED_KEY = "cave:youtube:collapsed";
const NATIVE_FRAME_LABEL = "cave-youtube-native-frame";

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

type TauriBridge = {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
};

async function loadTauriBridge(): Promise<TauriBridge | null> {
  if (typeof window === "undefined") return null;
  if ((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === undefined) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return { invoke };
}

function frameTitle(src: string): string {
  try {
    const url = new URL(src);
    const list = url.searchParams.get("list");
    const videoId = url.pathname.split("/").filter(Boolean).at(-1);
    if (videoId && ID_RE.test(videoId)) return `YouTube ${videoId}`;
    if (list) return "YouTube playlist";
  } catch {
    // fall through
  }
  return "YouTube";
}

function youtubeThumbnailFromEmbed(src: string): string | null {
  try {
    const url = new URL(src);
    const videoId = url.pathname.split("/").filter(Boolean).at(-1);
    return videoId && ID_RE.test(videoId) ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
  } catch {
    return null;
  }
}

/**
 * A compact YouTube player with an editable URL bar. Lives in the companion
 * rail's resizable bottom pane (the "Video" toggle). Paste any YouTube link,
 * video id, or playlist; the embed reloads when you hit Load / Enter.
 *
 * Desktop Tauri uses a native child webview aligned to the frame placeholder.
 * Plain browser dev gets a non-interactive visual frame with the same footprint.
 */
export function YoutubeViewer({ defaultSrc = DEFAULT_SRC }: { defaultSrc?: string }) {
  const [src, setSrc] = useState(defaultSrc);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [bridge, setBridge] = useState<TauriBridge | null>(null);
  const platform = useTauriPlatform();
  const nativeBrowserAvailable = platform === "desktop";
  const nativeFrameRef = useRef<HTMLDivElement>(null);
  const title = frameTitle(src);
  const playing = false;

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

  useEffect(() => {
    if (platform === "unknown") return;
    if (!nativeBrowserAvailable) {
      setBridge(null);
      return;
    }
    let cancelled = false;
    void loadTauriBridge().then((next) => {
      if (!cancelled) setBridge(next);
    });
    return () => {
      cancelled = true;
    };
  }, [nativeBrowserAvailable, platform]);

  useEffect(() => {
    if (!bridge || !nativeBrowserAvailable) return;
    const surface = nativeFrameRef.current;
    if (!surface) return;

    let raf = 0;
    let hidden = false;
    let last = { x: 0, y: 0, w: 0, h: 0 };

    const hide = () => {
      if (!hidden) {
        hidden = true;
        void bridge.invoke("browser_hide", { label: NATIVE_FRAME_LABEL });
      }
    };

    const tick = () => {
      const rect = surface.getBoundingClientRect();
      if (collapsed || rect.width <= 1 || rect.height <= 1) {
        hide();
      } else {
        const next = {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        };
        if (hidden || next.x !== last.x || next.y !== last.y || next.w !== last.w || next.h !== last.h) {
          last = next;
          hidden = false;
          void bridge.invoke("browser_set_bounds", { label: NATIVE_FRAME_LABEL, ...next });
        }
      }
      raf = requestAnimationFrame(tick);
    };

    const timer = window.setTimeout(() => {
      const rect = surface.getBoundingClientRect();
      if (collapsed || rect.width <= 1 || rect.height <= 1) {
        hide();
        return;
      }
      hidden = false;
      last = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
      void bridge.invoke("browser_navigate", {
        label: NATIVE_FRAME_LABEL,
        url: src,
        ...last,
        readOnlyUrl: src,
      });
      raf = requestAnimationFrame(tick);
    }, 80);

    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      void bridge.invoke("browser_close", { label: NATIVE_FRAME_LABEL });
    };
  }, [bridge, collapsed, nativeBrowserAvailable, src]);

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
        <div
          ref={nativeFrameRef}
          className="youtube-viewer__native-frame"
          aria-label="Embedded YouTube native web frame"
        >
          {!bridge || !nativeBrowserAvailable ? <YoutubeDevFrame src={src} /> : null}
        </div>
      </div>
      {/* Mini player — shown only when collapsed (CSS). It is a status row, not
          a custom playback controller. */}
      <div className="youtube-viewer__mini">
        <span className="youtube-viewer__nowplaying">
          <Equalizer playing={playing} />
          <span className="youtube-viewer__mini-title" title={title || "YouTube"}>
            {title || "YouTube"}
          </span>
        </span>
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
          This is a calm, upright now-playing indicator instead of a sideways
          video frame. The rail's transparent overlay handles tap-to-expand. */}
      <div className="youtube-viewer__strip" aria-hidden="true">
        <Equalizer playing={playing} className="youtube-viewer__eq--lg" />
        <span className="youtube-viewer__strip-title">{title || "YouTube"}</span>
      </div>
    </div>
  );
}

function YoutubeDevFrame({ src }: { src: string }) {
  const thumbnail = youtubeThumbnailFromEmbed(src);
  return (
    <div
      className="youtube-viewer__dev-frame"
      aria-hidden="true"
      style={thumbnail ? ({ backgroundImage: `linear-gradient(rgb(0 0 0 / 0.22), rgb(0 0 0 / 0.4)), url(${thumbnail})` } as CSSProperties) : undefined}
    >
      <div className="youtube-viewer__dev-frame-top">
        <span />
        <span />
        <span />
      </div>
      <div className="youtube-viewer__dev-frame-play">
        <Icon name="ph:play-fill" width={26} />
      </div>
      <div className="youtube-viewer__dev-frame-bottom">
        <span className="youtube-viewer__dev-frame-progress" />
        <span className="youtube-viewer__dev-frame-chip" />
        <span className="youtube-viewer__dev-frame-chip youtube-viewer__dev-frame-chip--short" />
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
