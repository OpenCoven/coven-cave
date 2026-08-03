// cave-ioswipe.5: re-appearing views must not refetch the whole session list.
//
// iOS Swift is NOT compiled by CI, so this source-text contract is the only
// gate. Each assertion is checked to FAIL against its regression, not merely
// to pass.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");
const threads = await read("apps/ios/CovenCave/CovenCave/Views/FamiliarThreadsView.swift");

assert.match(
  model,
  /func loadSessionsIfStale\(maxAge: TimeInterval = AppModel\.sessionsStaleAfter\) async/,
  "there must be a staleness-guarded loader for re-appearance",
);
assert.match(
  model,
  /if sessionsLoaded, let at = lastSessionsLoadedAt, Date\(\)\.timeIntervalSince\(at\) < maxAge \{\s*\n\s*return\s*\n\s*\}/,
  "it must SKIP when the list was fetched inside the window — that skip is the whole point",
);
assert.match(
  model,
  /sessionsLoaded = true\s*\n\s*lastSessionsLoadedAt = Date\(\)/,
  "every real load must stamp the time, or the guard can never expire",
);

// Re-appearance uses the guarded call...
assert.match(
  threads,
  /\.task \{ await app\.loadSessionsIfStale\(\) \}/,
  "FamiliarThreadsView's .task must use the stale-guarded loader",
);
// ...but an explicit pull-to-refresh must still always hit the server.
assert.match(
  threads,
  /\.refreshable \{ await app\.loadSessions\(\) \}/,
  "pull-to-refresh is explicit user intent and must NOT be debounced",
);

console.log("ios-session-refetch: OK");
