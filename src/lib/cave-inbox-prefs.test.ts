// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./cave-inbox-prefs.ts", import.meta.url), "utf8");

// cave-g6ew: prefs mutations must serialize their read-modify-write. Before this,
// patchPrefs/toggleMute each did an unlocked load→merge→save, so two concurrent
// PATCHes (mute toggle from two surfaces, rapid toggles) last-writer-wins and
// silently dropped a change. A globalThis promise-chain (like withInboxLock)
// serializes them.
assert.match(src, /var __inboxPrefsWriteChain: Promise<unknown> \| undefined/, "a hot-reload-safe prefs write chain exists on globalThis");
assert.match(
  src,
  /function withPrefsLock<T>\(fn: \(\) => Promise<T>\): Promise<T> \{[\s\S]*?__inboxPrefsWriteChain[\s\S]*?prev\.then\(fn, fn\)/,
  "withPrefsLock chains each mutation after the previous",
);

// The actual load→merge→save is the *unlocked* internal; the exported patchPrefs
// wraps it in the lock.
assert.match(src, /async function patchPrefsUnlocked\(/, "the raw read-modify-write is an unlocked internal");
assert.match(
  src,
  /export function patchPrefs\([\s\S]*?return withPrefsLock\(\(\) => patchPrefsUnlocked\(patch\)\)/,
  "patchPrefs runs its read-modify-write under the lock",
);

// toggleMute reads the current set AND writes under ONE lock acquisition (else two
// toggles read the same set and one flip is lost), using the unlocked inner patch
// to avoid re-entrant deadlock on the single-acquisition chain.
assert.match(
  src,
  /export function toggleMute\([\s\S]*?return withPrefsLock\(async \(\) => \{[\s\S]*?loadPrefs\(\)[\s\S]*?patchPrefsUnlocked\(/,
  "toggleMute takes the lock once and reads+writes atomically via the unlocked patch",
);

// Kind muting (cave-uu2d) follows the same atomicity contract as familiar muting.
assert.match(
  src,
  /export function toggleMuteKind\([\s\S]*?return withPrefsLock\(async \(\) => \{[\s\S]*?loadPrefs\(\)[\s\S]*?patchPrefsUnlocked\(/,
  "toggleMuteKind takes the lock once and reads+writes atomically via the unlocked patch",
);

// mutedKinds is validated on BOTH load and patch — a hand-edited prefs file or
// a stale client can't persist kinds the delivery gate doesn't know (and
// response-needed must never be mutable: a reply request clears by replying).
// The kind list lives in the PURE shape module so the client bell can import
// the value without dragging fs/promises into the browser bundle.
const shapeSrc = readFileSync(new URL("./inbox-prefs-shape.ts", import.meta.url), "utf8");
assert.match(
  shapeSrc,
  /MUTABLE_KINDS = \["reminder", "agent", "daily-summary", "milestone"\] as const/,
  "the mutable-kind roster is exactly reminder/agent/daily-summary/milestone",
);
assert.doesNotMatch(
  shapeSrc,
  /MUTABLE_KINDS = \[[^\]]*"response-needed"/,
  "response-needed is never mutable — a reply request clears by replying, not by silencing",
);
assert.doesNotMatch(
  shapeSrc,
  /from "node:|require\("node:/,
  "the prefs shape module must stay free of node: imports (client components import it)",
);
assert.match(
  src,
  /mutedKinds: Array\.isArray\(parsed\.mutedKinds\)[\s\S]*?MUTABLE_KINDS as readonly string\[\]\)\.includes/,
  "loadPrefs filters mutedKinds to known kinds",
);
assert.match(
  src,
  /mutedKinds: patch\.mutedKinds[\s\S]*?MUTABLE_KINDS as readonly string\[\]\)\.includes/,
  "patchPrefs filters mutedKinds to known kinds",
);

console.log("cave-inbox-prefs.test.ts: ok");
