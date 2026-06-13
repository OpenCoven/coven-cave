/**
 * Persistence + application for the font picker.
 *
 * Stores a catalog id per slot in localStorage and applies the selection by
 * overriding the canonical --font-sans / --font-mono vars on <html>. The
 * default id removes the override so the :root alias (Geist) takes over.
 *
 * NOTE: the no-FOUC boot script in src/components/theme-script.tsx applies the
 * same vars before paint. It cannot import this module (it runs as an inline
 * string before module code resolves), so it derives the stack itself — keep
 * the key strings and the stack shape in sync with this file.
 */
import {
  DEFAULT_FONT_ID,
  fontOptionById,
  fontStack,
  type FontSlot,
} from "./font-catalog.ts";

export const FONT_SANS_KEY = "cave:font:sans";
export const FONT_MONO_KEY = "cave:font:mono";

function keyFor(slot: FontSlot): string {
  return slot === "sans" ? FONT_SANS_KEY : FONT_MONO_KEY;
}

function varFor(slot: FontSlot): string {
  return slot === "sans" ? "--font-sans" : "--font-mono";
}

/** Stored id for the slot, validated against the catalog. Missing, unknown, or
 *  wrong-slot values fall back to the slot default. Never throws. */
export function readFontPref(slot: FontSlot): string {
  if (typeof window === "undefined") return DEFAULT_FONT_ID[slot];
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(keyFor(slot));
  } catch {
    /* private mode / disabled storage — ignore */
  }
  if (raw) {
    const opt = fontOptionById(raw);
    if (opt && opt.slot === slot) return raw;
  }
  return DEFAULT_FONT_ID[slot];
}

export function writeFontPref(slot: FontSlot, id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(slot), id);
  } catch {
    /* ignore */
  }
}

/** Point the slot's CSS var at the chosen family's stack. The default id (or an
 *  unknown id) removes the override so the :root Geist alias applies. */
export function applyFont(slot: FontSlot, id: string): void {
  if (typeof document === "undefined") return;
  const cssVar = varFor(slot);
  const root = document.documentElement;
  const opt = fontOptionById(id);
  if (id === DEFAULT_FONT_ID[slot] || !opt || opt.slot !== slot) {
    root.style.removeProperty(cssVar);
    return;
  }
  root.style.setProperty(cssVar, fontStack(opt));
}
