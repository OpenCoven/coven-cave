// @ts-nocheck
// Behavioral tests for the thread-instruments preference (cave-xb6g5), plus
// source pins for how the toggle reaches the transcript.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = new Map<string, string>();
const listeners = new Map<string, Set<(e: unknown) => void>>();
globalThis.window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
  },
  addEventListener: (type: string, fn: (e: unknown) => void) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
  },
  removeEventListener: (type: string, fn: (e: unknown) => void) => {
    listeners.get(type)?.delete(fn);
  },
  dispatchEvent: (event: { type: string }) => {
    for (const fn of listeners.get(event.type) ?? []) fn(event);
    return true;
  },
} as never;
globalThis.CustomEvent = class {
  type: string;
  detail: unknown;
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type;
    this.detail = init?.detail;
  }
} as never;

const {
  readThreadInstrumentsVisible,
  writeThreadInstrumentsVisible,
} = await import("./thread-instruments-visibility.ts");

const KEY = "cave:chat:thread-instruments";

// ── default is ON, and only an explicit opt-out hides ─────────────────────
// Absent must not read as "hidden": the instruments already gate themselves to
// wide panes and long threads, so a fresh or cleared store should show them
// rather than leave the gutters mysteriously empty.
store.clear();
assert.equal(readThreadInstrumentsVisible(), true, "unset defaults to visible");

store.set(KEY, "0");
assert.equal(readThreadInstrumentsVisible(), false, "an explicit 0 hides them");

store.set(KEY, "1");
assert.equal(readThreadInstrumentsVisible(), true);

// Anything unrecognised is treated as "not opted out" — a corrupted value
// restores the default instead of silently disabling a feature.
for (const junk of ["", "true", "yes", "{}", "00"]) {
  store.set(KEY, junk);
  assert.equal(
    readThreadInstrumentsVisible(),
    true,
    `a junk value (${JSON.stringify(junk)}) must fall back to visible`,
  );
}

// ── writes persist and broadcast ──────────────────────────────────────────
let broadcast: unknown = null;
const onChange = (e: unknown) => { broadcast = (e as { detail: unknown }).detail; };
globalThis.window.addEventListener("cave:thread-instruments-change", onChange);

writeThreadInstrumentsVisible(false);
assert.equal(store.get(KEY), "0", "the choice is persisted");
assert.equal(broadcast, false, "and broadcast, so the transcript hears it without prop threading");

writeThreadInstrumentsVisible(true);
assert.equal(store.get(KEY), "1");
assert.equal(broadcast, true);

// ── the toggle actually reaches the transcript ────────────────────────────
const chatView = readFileSync(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
const header = readFileSync(
  new URL("../components/chat-session-header.tsx", import.meta.url),
  "utf8",
);
const instruments = readFileSync(
  new URL("../components/chat-thread-instruments.tsx", import.meta.url),
  "utf8",
);

// Unmount, don't just hide: CSS-hiding would leave the spine's scroll
// measurement and ResizeObservers running for furniture nobody can see.
assert.match(
  chatView,
  /\{activePath\.length > 0 && instrumentsVisible \? \(/,
  "an unchecked toggle must skip mounting the instruments entirely",
);
assert.match(
  header,
  /instruments: \(\) => \{\s*setInstrumentsVisible\(!instrumentsVisible\);/,
  "the kebab item must flip the shared preference",
);

// ── the stamp lane follows the machine's own clock ────────────────────────
// 24-hour "23:00" is 5 characters where 12-hour "11:00 PM" is 8, and the format
// is the reader's, not ours. A fixed lane clips one of them.
assert.match(
  instruments,
  /const stampChars = Math\.max\(\s*SPINE_STAMP_MIN_CHARS,\s*\.\.\.placed\.map\(\(n\) => n\.time\?\.length \?\? 0\),\s*\);/,
  "the lane must be measured from the stamps this thread actually renders",
);
assert.match(
  instruments,
  /"--cave-spine-stamp-chars": stampChars/,
  "and handed to the stylesheet as the lane knob",
);
assert.match(
  instruments,
  /const SPINE_STAMP_MIN_CHARS = 5;/,
  "a floor keeps a stampless thread from collapsing the lane back under the ring",
);

console.log("thread-instruments-visibility tests passed");
