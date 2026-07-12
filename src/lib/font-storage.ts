/**
 * Persistence + application for the font picker.
 *
 * Stores a catalog id per slot in localStorage and applies the selection by
 * overriding the canonical --font-serif / --font-sans / --font-mono vars on
 * <html>. The default id removes the override so the :root alias (per
 * DEFAULT_FONT_ID) takes over.
 *
 * The catalog now has three slots (see font-catalog.ts):
 *   - "serif" (--font-serif) — canonical: EB Garamond
 *   - "sans"  (--font-sans)  — canonical: Inter
 *   - "mono"  (--font-mono)  — canonical: JetBrains Mono
 *
 * NOTE: the no-FOUC boot script in src/components/theme-script.tsx applies the
 * same vars before paint. It cannot import this module (it runs as an inline
 * string before module code resolves), so it derives the stack itself — keep
 * the key strings and the stack shape in sync with this file.
 */
import {
  DEFAULT_FONT_PAIR_ID,
  DEFAULT_FONT_ID,
  fontPairById,
  fontPairForFonts,
  fontOptionById,
  fontStack,
  type FontPair,
  type FontSlot,
} from "./font-catalog.ts";
import { readAppPreferences, updateAppPreferences } from "./app-preferences.ts";

export const FONT_SERIF_KEY = "cave:font:serif";
export const FONT_SANS_KEY = "cave:font:sans";
export const FONT_MONO_KEY = "cave:font:mono";

function keyFor(slot: FontSlot): string {
  if (slot === "serif") return FONT_SERIF_KEY;
  if (slot === "sans") return FONT_SANS_KEY;
  return FONT_MONO_KEY;
}

function varFor(slot: FontSlot): string {
  if (slot === "serif") return "--font-serif";
  if (slot === "sans") return "--font-sans";
  return "--font-mono";
}

/** Stored id for the slot, validated against the catalog. Missing, unknown, or
 *  wrong-slot values fall back to the slot default. Never throws. */
export function readFontPref(slot: FontSlot): string {
  const preferences = readAppPreferences();
  const fonts = preferences.appearance.fonts;
  const stored = slot === "serif" ? fonts.serif : slot === "sans" ? fonts.sans : fonts.mono;
  const storedOption = fontOptionById(stored);
  if (preferences.initialized && storedOption?.slot === slot) return stored;
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
  const value = fontOptionById(id)?.slot === slot ? id : DEFAULT_FONT_ID[slot];
  updateAppPreferences({ appearance: { fonts: { [slot]: value } } });
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(slot), value);
  } catch {
    /* ignore */
  }
}

export function readFontPairPref(): FontPair {
  const pair = fontPairForFonts(
    readFontPref("serif"),
    readFontPref("sans"),
    readFontPref("mono"),
  );
  return pair ?? fontPairById(DEFAULT_FONT_PAIR_ID)!;
}

export function writeFontPairPref(id: string): void {
  const pair = fontPairById(id) ?? fontPairById(DEFAULT_FONT_PAIR_ID)!;
  updateAppPreferences({
    appearance: {
      fonts: { serif: pair.serifId, sans: pair.sansId, mono: pair.monoId },
    },
  });
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(FONT_SERIF_KEY, pair.serifId);
      window.localStorage.setItem(FONT_SANS_KEY, pair.sansId);
      window.localStorage.setItem(FONT_MONO_KEY, pair.monoId);
    } catch {
      /* legacy mirror unavailable */
    }
  }
}

/** Point the slot's CSS var at the chosen family's stack. The default id (or an
 *  unknown id) removes the override so the :root default alias applies. */
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

export function applyFontPair(id: string): void {
  const pair = fontPairById(id) ?? fontPairById(DEFAULT_FONT_PAIR_ID)!;
  applyFont("serif", pair.serifId);
  applyFont("sans", pair.sansId);
  applyFont("mono", pair.monoId);
}
