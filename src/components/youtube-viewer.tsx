"use client";

import { useState } from "react";
import { Icon } from "@/lib/icon";

// The playlist the panel opens on by default.
const DEFAULT_PLAYLIST_ID = "PLp61JrZcGK7-uuXOWzezyZkz61RQb0XOG";
const DEFAULT_SRC = playlistEmbed(DEFAULT_PLAYLIST_ID);

const ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const PLAYLIST_RE = /^[a-zA-Z0-9_-]{12,}$/;

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

/**
 * A compact YouTube player with an editable URL bar. Lives in the companion
 * rail's resizable bottom pane (the "Video" toggle). Paste any YouTube link,
 * video id, or playlist; the embed reloads when you hit Load / Enter.
 */
export function YoutubeViewer({ defaultSrc = DEFAULT_SRC }: { defaultSrc?: string }) {
  const [src, setSrc] = useState(defaultSrc);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    <div className="youtube-viewer">
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
      </form>
      {error ? (
        <p className="youtube-viewer__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="youtube-viewer__frame">
        <iframe
          key={src}
          src={src}
          title="YouTube video player"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
    </div>
  );
}
