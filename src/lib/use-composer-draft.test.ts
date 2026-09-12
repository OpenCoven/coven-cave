// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./use-composer-draft.ts", import.meta.url), "utf8");

// ── Signatures ───────────────────────────────────────────────────────────────
assert.match(
  src,
  /export function readComposerDraft\(key: string\): string/,
  "readComposerDraft(key) is exported for lazy useState initializers",
);
assert.match(
  src,
  /export function useDraftPersistence\(\s*key: string,\s*value: string,\s*delayMs = 250,\s*\{ enabled = true \}: \{ enabled\?: boolean \} = \{\},\s*\): \{ clearNow: \(\) => void \}/,
  "draft persistence defaults to enabled and exposes a hydration gate",
);

// ── Debounce (extracted verbatim from the two composers) ─────────────────────
assert.match(
  src,
  /useEffect\(\(\) => \{\s*latestRef\.current = enabled \? \{ key, value \} : null;\s*if \(!enabled\) return;\s*const timer = window\.setTimeout\(\(\) => \{\s*writeComposerDraft\(key, value\);\s*\}, delayMs\);\s*return \(\) => window\.clearTimeout\(timer\);\s*\}, \[key, value, delayMs, enabled\]\);/,
  "draft writes are debounced so mobile typing does not hit localStorage per keystroke",
);

// ── Flush on unmount ─────────────────────────────────────────────────────────
// The debounce cleanup CANCELS a pending write, so an unmount within delayMs
// of the last keystroke dropped the draft's tail (pane-set remounts, mode
// switches). A ref-driven empty-dep cleanup flushes the latest value instead.
assert.match(
  src,
  /useEffect\(\s*\(\) => \(\) => \{\s*if \(latestRef\.current\) writeComposerDraft\(latestRef\.current\.key, latestRef\.current\.value\);\s*\},\s*\[\],\s*\);/,
  "unmount flushes only a restored draft, never the empty SSR placeholder",
);
const home = readFileSync(new URL("../components/home-composer.tsx", import.meta.url), "utf8");
assert.match(home, /useDraftPersistence\(HOME_DRAFT_KEY, text, HOME_DRAFT_WRITE_DELAY_MS, \{\s*enabled: draftRestored,/);
// clearNow must update latestRef too, or a send that unmounts the composer in
// the same tick would flush the PRE-send text — resurrecting the sent prompt.
assert.match(
  src,
  /const clearNow = useCallback\(\(\) => \{\s*latestRef\.current = \{ key, value: "" \};\s*writeComposerDraft\(key, ""\);\s*\}, \[key\]\);/,
  "clearNow updates latestRef so a send-then-unmount flushes empty, never pre-send text",
);

// ── Remove-on-empty ──────────────────────────────────────────────────────────
assert.match(
  src,
  /if \(text\) window\.localStorage\.setItem\(key, text\);\s*else window\.localStorage\.removeItem\(key\)/,
  "an emptied draft removes the key so sent prompts don't reappear on reload",
);

// ── Synchronous clear for send paths ─────────────────────────────────────────
assert.match(
  src,
  /const clearNow = useCallback\(\(\) => \{[\s\S]*?writeComposerDraft\(key, ""\);\s*\}, \[key\]\);/,
  "clearNow writes the empty draft synchronously — a send can unmount the composer and cancel the debounced writer",
);

// ── SSR / storage-failure safety ─────────────────────────────────────────────
assert.match(
  src,
  /if \(typeof window === "undefined"\) return "";/,
  "reads are SSR-safe",
);
assert.equal(
  (src.match(/\} catch \{/g) ?? []).length,
  2,
  "read and write both swallow storage failures (private mode, quota) — drafts are best effort",
);

console.log("use-composer-draft.test.ts: ok");
