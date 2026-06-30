// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./use-pausable-poll.ts", import.meta.url), "utf8");

// ── Signature ────────────────────────────────────────────────────────────────
assert.match(
  src,
  /export function usePausablePoll\(\s*callback: \(\) => void,\s*intervalMs: number,\s*opts\?: \{ enabled\?: boolean; pauseWhileInputActive\?: boolean \},\s*\): void/,
  "usePausablePoll(callback, intervalMs, { enabled, pauseWhileInputActive }) returns void",
);

// ── Recurring poll pauses while the tab is hidden ────────────────────────────
assert.match(
  src,
  /const id = setInterval\(\(\) => \{[\s\S]*?if \(typeof document !== "undefined" && document\.hidden\) return;[\s\S]*?cbRef\.current\(\);[\s\S]*?\}, intervalMs\)/,
  "the interval skips the callback while the tab is hidden",
);
assert.match(
  src,
  /function pollPausedForActiveInput\(pauseWhileInputActive: boolean\): boolean/,
  "the shared input-focus pause helper is centralized for interval and focus refresh paths",
);
assert.match(
  src,
  /active instanceof HTMLTextAreaElement[\s\S]*active instanceof HTMLInputElement[\s\S]*active instanceof HTMLSelectElement[\s\S]*active\.isContentEditable/,
  "active text fields, selects, and contentEditable elements can pause nonessential polls",
);
assert.match(
  src,
  /if \(pollPausedForActiveInput\(pauseWhileInputActive\)\) return;/,
  "the interval skips nonessential callbacks while the user is composing text",
);
assert.match(src, /return \(\) => clearInterval\(id\)/, "the interval is cleared on cleanup");

// ── Disabled stops polling entirely ──────────────────────────────────────────
assert.match(src, /if \(!enabled\) return;/, "passing { enabled: false } suspends the poll");

// ── Resume reuses the existing foreground hook (no re-rolled visibilitychange) ─
assert.match(src, /import \{ useRefreshOnFocus \} from "@\/lib\/use-refresh-on-focus"/, "composes the existing useRefreshOnFocus");
assert.match(
  src,
  /useRefreshOnFocus\(\(\) => \{[\s\S]*?if \(pollPausedForActiveInput\(pauseWhileInputActive\)\) return;[\s\S]*?cbRef\.current\(\);[\s\S]*?\}, \{ enabled \}\)/,
  "foreground refresh also respects active input composition",
);
assert.doesNotMatch(src, /addEventListener\("visibilitychange"/, "no hand-rolled visibilitychange listener — that lives in useRefreshOnFocus");

// ── Stable interval across callback identity changes ─────────────────────────
assert.match(src, /const cbRef = useRef\(callback\);\s*cbRef\.current = callback;/, "the callback is read via a ref so the interval isn't torn down each render");
assert.match(src, /\}, \[enabled, intervalMs, pauseWhileInputActive\]\)/, "the poll effect depends only on enabled + intervalMs + input-pause mode");

console.log("use-pausable-poll.test.ts: ok");
