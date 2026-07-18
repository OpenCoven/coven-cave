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
  /export function useDraftPersistence\(\s*key: string,\s*value: string,\s*delayMs = 250,\s*\): \{ clearNow: \(\) => void \}/,
  "useDraftPersistence(key, value, delayMs) returns a synchronous clearNow()",
);

// ── Debounce (extracted verbatim from the two composers) ─────────────────────
assert.match(
  src,
  /useEffect\(\(\) => \{\s*const timer = window\.setTimeout\(\(\) => \{\s*writeComposerDraft\(key, value\);\s*\}, delayMs\);\s*return \(\) => window\.clearTimeout\(timer\);\s*\}, \[key, value, delayMs\]\);/,
  "draft writes are debounced so mobile typing does not hit localStorage per keystroke",
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
  /const clearNow = useCallback\(\(\) => writeComposerDraft\(key, ""\), \[key\]\);/,
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
