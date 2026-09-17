// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./inspector-pane.tsx", import.meta.url), "utf8");

// The canonical vault had the heavier contract here: a shared resource loader,
// a force/background request-ownership gate, and a readiness prop that acted as
// a PRIVACY boundary — Cave could only read that store on its own host, so a
// stale publication after readiness dropped would have leaked. All of it went
// with the vault, which now lives in the dedicated memory application.
//
// Asserted as absent rather than deleted quietly: the gate and the readiness
// prop are exactly the machinery someone would reintroduce by reflex.
assert.doesNotMatch(
  src,
  /loadCanonicalMemoryList|createMemoryFeedRequestGate|canonicalRequestGate/,
  "the vault's loader and request-ownership gate are retired",
);
assert.doesNotMatch(
  src,
  /localDaemonReady|CanonicalMemoryReader/,
  "the local-readiness privacy gate and the shared vault reader are retired",
);
assert.doesNotMatch(
  src,
  /fetch\(\s*["'`]\/api\/coven-memory/,
  "nothing reaches for the removed vault route",
);

// What remains is the file side, and its cancellation discipline is unchanged:
// the per-familiar list and the open-file read are real fetches that must abort
// on supersession and unmount, or a slow response can setState after cleanup.
const abortControllers = src.match(/new AbortController\(\)/g) ?? [];
assert.ok(abortControllers.length >= 2, "both Files loaders own AbortControllers");

assert.match(
  src,
  /fetch\(\s*url,\s*\{\s*cache:\s*"no-store",\s*signal:\s*controller\.signal,?\s*\}/,
  "the per-familiar memory list fetch is abortable",
);
assert.match(
  src,
  /\/api\/memory\/file\?path[\s\S]*?signal:\s*controller\.signal[\s\S]*?setOpenFile\(json\)/,
  "the open-file loader is abortable and publishes only the selected file",
);
assert.ok(
  (src.match(/controller\.abort\(\)/g) ?? []).length >= 2,
  "both Files effects abort during cleanup",
);

// The Familiar tab's capability panel (extracted to chat-familiar-capabilities.tsx)
// awaits four fetches with one Promise.all — same rule: a slow response must
// not setState after cleanup, even though the keyed host remounts per familiar.
const familiarView = readFileSync(new URL("./chat-familiar-capabilities.tsx", import.meta.url), "utf8");
assert.match(familiarView, /let cancelled = false;/, "the capability loader declares a cancelled guard");
assert.match(
  familiarView,
  /\.then\(\(\[rolesRes, skillsRes, capsRes, harnessesRes\]\) => \{\s*if \(cancelled\) return;/,
  "the capability loader drops stale/post-unmount responses before any setState",
);
assert.match(familiarView, /return \(\) => \{ cancelled = true; \};/, "the capability loader cleans up by cancelling in-flight work");

console.log("inspector-pane-load-guards.test.ts: ok");
