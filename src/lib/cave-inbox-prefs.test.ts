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

console.log("cave-inbox-prefs.test.ts: ok");
