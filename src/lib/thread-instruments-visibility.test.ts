// @ts-nocheck
// Behavioral tests for the persisted activity-map preference, plus source pins
// for how the toggle reaches the chat.
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
assert.match(
  chatView,
  /\{activePath\.length > 0 && activityMapVisible \? \(/,
  "an unchecked toggle skips mounting the activity map entirely",
);
assert.match(
  header,
  /"activity-map": \(\) => \{\s*setActivityMapVisible\(!activityMapVisible\);/,
  "the kebab item must flip the shared preference",
);

console.log("thread-instruments-visibility tests passed");
