// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./command-palette.tsx", import.meta.url), "utf8");

// ── Input is a complete combobox ─────────────────────────────────────────────
// It already had aria-label/aria-controls/aria-activedescendant; these complete
// the pattern so screen readers announce the popup's open state + autocomplete.
assert.match(src, /role="combobox"/, "the search input declares the combobox role");
assert.match(src, /aria-expanded=\{rows\.length > 0\}/, "the input reports whether the results popup is open");
assert.match(src, /aria-autocomplete="list"/, "the input advertises list autocomplete");

// ── Corpus loader drops post-close/unmount responses ─────────────────────────
// The Promise.all of /api/board + /api/coven-memory + /api/memory previously set
// state with no guard; closing the palette mid-fetch hit a gone component.
assert.match(
  src,
  /let cancelled = false;[\s\S]*?Promise\.all\(\[[\s\S]*?\/api\/board[\s\S]*?\/api\/coven-memory[\s\S]*?\/api\/memory[\s\S]*?if \(cancelled\) return;[\s\S]*?setCards/,
  "the corpus loader bails out if the palette closed/unmounted before it resolved",
);
assert.match(
  src,
  /return \(\) => \{ cancelled = true; clearTimeout\(t\); \};/,
  "closing the palette cancels the in-flight corpus refresh",
);

// ── Active option is scrolled into view on keyboard nav ──────────────────────
assert.match(
  src,
  /getElementById\(`command-palette-option-\$\{activeIdx\}`\)\s*\?\.scrollIntoView\(\{ block: "nearest" \}\)/,
  "the keyboard-highlighted option is scrolled into view as activeIdx changes",
);
assert.match(
  src,
  /\}, \[activeIdx, open\]\);/,
  "the scroll-into-view effect tracks the active index",
);

// cave-wka1: the Enter/arrows that drive an IME candidate picker must not fire
// the active row or move the highlight (ChatView and group-chat have the same
// composer guard).
assert.match(
  src,
  /const onComposerKey = \(e: React\.KeyboardEvent\) => \{[\s\S]{0,320}?if \(e\.nativeEvent\.isComposing\) return;/,
  "palette keyboard handler ignores keydowns while an IME composition is in progress",
);

console.log("command-palette-a11y.test.ts: ok");
