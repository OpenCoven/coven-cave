// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./use-autogrow-textarea.ts", import.meta.url), "utf8");

// ── Signature ────────────────────────────────────────────────────────────────
assert.match(
  src,
  /export function useAutogrowTextarea\(\s*ref: RefObject<HTMLTextAreaElement \| null>,\s*value: string,\s*opts\?: \{ fallbackMaxHeight\?: number \},\s*\): \{ resize: \(\) => void \}/,
  "useAutogrowTextarea(ref, value, { fallbackMaxHeight }) returns an imperative resize()",
);

// ── Growth behavior (extracted verbatim from the two composers) ──────────────
assert.match(
  src,
  /const AUTOGROW_FALLBACK_MAX_HEIGHT = 332;/,
  "the fallback cap stays aligned with the 13-row desktop composer height (13*24 + 20px padding)",
);
assert.match(
  src,
  /const computedMaxHeight = Number\.parseFloat\(window\.getComputedStyle\(el\)\.maxHeight\);[\s\S]*?const maxHeight = Number\.isFinite\(computedMaxHeight\) \? computedMaxHeight : fallbackMaxHeight;/,
  "the computed CSS max-height wins over the fallback, so responsive breakpoints control the cap",
);
assert.match(
  src,
  /el\.style\.height = "auto";[\s\S]*?el\.style\.height = `\$\{Math\.min\(el\.scrollHeight, maxHeight\)\}px`;/,
  "height resets to auto before measuring so shrinking content shrinks the textarea",
);
assert.match(
  src,
  /const isOverflowing = el\.scrollHeight > maxHeight;[\s\S]*?el\.style\.overflowY = isOverflowing \? "auto" : "hidden";/,
  "internal scrolling only turns on past the height cap",
);

// ── Reactivity ───────────────────────────────────────────────────────────────
assert.match(
  src,
  /useEffect\(\(\) => \{\s*resize\(\);\s*\}, \[value, resize\]\);/,
  "the textarea resizes automatically whenever the bound value changes",
);
assert.match(
  src,
  /const resize = useCallback\(/,
  "resize is identity-stable so consumers can list it in effect deps without loops",
);

console.log("use-autogrow-textarea.test.ts: ok");
