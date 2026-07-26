// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Copilot review follow-ups on #3879: a ClampedText instance is reused across
// passages (mission/iteration switches), so its state must not outlive `text`,
// and measurement must not assume ResizeObserver exists.

const source = await readFile(new URL("./clamped-text.tsx", import.meta.url), "utf8");

// A new passage starts collapsed and re-measured — the reset happens during
// render (derive-state-from-props), so the stale expanded frame never paints.
assert.match(
  source,
  /const \[prevText, setPrevText\] = useState\(text\);\s*if \(prevText !== text\) \{\s*setPrevText\(text\);\s*setExpanded\(false\);\s*setOverflows\(false\);\s*\}/,
  "text changes reset expansion + overflow verdict during render",
);

// Measure once, then observe reflow only where ResizeObserver exists (house
// rule — mirrors Sparkline's guard).
assert.match(
  source,
  /measure\(\);\s*if \(typeof ResizeObserver === "undefined"\) return;\s*const observer = new ResizeObserver\(measure\);/,
  "ResizeObserver is guarded, with a one-shot measure fallback",
);

console.log("clamped-text source assertions passed");
