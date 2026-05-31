"use client";

/**
 * Platform-aware keyboard glyph helpers. Mac uses ⌘ / ⌥ / ⌃ / ⇧; Windows
 * and Linux render `Ctrl` / `Alt` / `Shift` instead. Cave runs as a Tauri
 * desktop app today but also boots in `next dev` (web) for inner-loop work,
 * so we detect the platform once on mount and feed the values into shortcut
 * hints from a single source of truth.
 *
 * Use [`useKeySymbols`] inside client components to read live values. SSR
 * gets the Mac fallback (the dominant dev environment) — the first client
 * render replaces them, which matches what muscle-memory expects.
 */

import { useEffect, useState } from "react";

export type KeySymbols = {
  /** Cmd on Mac, Ctrl elsewhere — the "default modifier" most palettes bind. */
  mod: string;
  alt: string;
  shift: string;
  ctrl: string;
  /** Return / Enter key glyph. */
  enter: string;
  /** Arrow keys, kept here so a single import covers everything a hint strip needs. */
  up: string;
  down: string;
};

const MAC_SYMBOLS: KeySymbols = {
  mod: "⌘",
  alt: "⌥",
  shift: "⇧",
  ctrl: "⌃",
  enter: "↵",
  up: "↑",
  down: "↓",
};

const PC_SYMBOLS: KeySymbols = {
  mod: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  ctrl: "Ctrl",
  enter: "Enter",
  up: "↑",
  down: "↓",
};

function detectIsMac(): boolean {
  if (typeof navigator === "undefined") return true;
  // `userAgentData.platform` is the modern API; fall back to UA sniffing.
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function useKeySymbols(): KeySymbols {
  const [symbols, setSymbols] = useState<KeySymbols>(MAC_SYMBOLS);
  useEffect(() => {
    setSymbols(detectIsMac() ? MAC_SYMBOLS : PC_SYMBOLS);
  }, []);
  return symbols;
}

/** Pure helper for places that already know they're client-side (event handlers, etc.). */
export function keySymbolsNow(): KeySymbols {
  return detectIsMac() ? MAC_SYMBOLS : PC_SYMBOLS;
}

/**
 * Replace Mac-canonical key glyphs (⌘ ⌥ ⌃ ⇧ ↵) in a static string with the
 * platform-appropriate label. The static catalogs (slash command hints,
 * help text) author hints with the Mac symbols and let this helper retarget
 * at render time, so we don't have to thread a function through every const.
 */
export function platformizeHint(hint: string, keys: KeySymbols): string {
  return hint
    .replaceAll("⌘", keys.mod)
    .replaceAll("⌥", keys.alt)
    .replaceAll("⌃", keys.ctrl)
    .replaceAll("⇧", keys.shift)
    .replaceAll("↵", keys.enter);
}
