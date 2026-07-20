"use client";

import { useState } from "react";

const INITIAL_COLORS = [
  "#5b5bd6", "#7c3aed", "#db2777", "#ea580c",
  "#16a34a", "#0891b2", "#4f46e5", "#0d9488",
];

function faviconUrl(url: string): string {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`;
  } catch {
    return "";
  }
}

function initialColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return INITIAL_COLORS[Math.abs(hash) % INITIAL_COLORS.length];
}

/** The tab identity falls back to a deterministic initial when a site has no favicon. */
export function TabFavicon({ url, title, size = 20 }: { url: string; title: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = faviconUrl(url);
  const initial = (title || url).trim().slice(0, 1).toUpperCase() || "?";
  if (!src || failed) {
    return (
      <span className="flex shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[length:var(--text-2xs)] font-semibold text-white" style={{ width: size, height: size, background: initialColor(title || url) }}>
        {initial}
      </span>
    );
  }
  return <img src={src} alt="" width={size} height={size} className="rounded-[var(--radius-control)] object-contain [image-rendering:auto]!" onError={() => setFailed(true)} />;
}
