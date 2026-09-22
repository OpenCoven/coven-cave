// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./command-palette.tsx", import.meta.url), "utf8");

// ── Input is a complete combobox ─────────────────────────────────────────────
// It already had aria-label/aria-controls/aria-activedescendant; these complete
// the pattern so screen readers announce the popup's open state + autocomplete.
assert.match(src, /role="combobox"/, "the search input declares the combobox role");
assert.match(src, /aria-expanded=\{displayRows\.length > 0\}/, "the input reports whether the results popup is open");
assert.match(src, /aria-autocomplete="list"/, "the input advertises list autocomplete");

// ── Corpus loader drops post-close/unmount responses ─────────────────────────
// Each corpus settles independently, and every publisher checks the same
// close/unmount guard before touching state.
assert.match(
  src,
  /const loadBoardCorpus = async \(\)[\s\S]*?if \(cancelled\) return;[\s\S]*?setCards/,
  "the board corpus cannot publish after the palette closes",
);
assert.match(
  src,
  /const loadFileMemoryCorpus = async \(\)[\s\S]*?\/api\/memory[\s\S]*?if \(cancelled\) return;[\s\S]*?setFsMemory/,
  "the file-memory corpus cannot publish after the palette closes",
);
// The canonical corpus went with the vault. The property that mattered is
// unchanged with two corpora instead of three: they settle INDEPENDENTLY, so
// one failure cannot suppress the others' results.
assert.match(
  src,
  /Promise\.allSettled\(\[\s*loadBoardCorpus\(\),\s*loadFileMemoryCorpus\(\),?\s*\]\)/,
  "board and file-memory corpora settle independently",
);
assert.doesNotMatch(
  src,
  /Promise\.all\(\[[\s\S]{0,500}\/api\/board[\s\S]{0,500}\/api\/memory/,
  "one corpus failure cannot suppress unrelated board or file-memory results",
);
assert.match(
  src,
  /return \(\) => \{ cancelled = true; controller\.abort\(\); clearTimeout\(t\); \};/,
  "closing the palette cancels the in-flight corpus refresh",
);
assert.doesNotMatch(
  src,
  /Familiar memories unavailable|canonicalMemoryState/,
  "the retired vault corpus takes its unavailable banner with it",
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
