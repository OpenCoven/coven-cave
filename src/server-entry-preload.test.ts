// @ts-nocheck
// #5658: Next's all-entry preload (355 routes, ~1.9 s of main-thread work) is
// deferred past app launch rather than dropped: some route modules start
// background work when imported (inbox/reminder scheduler, GitHub
// subscription watcher, research media job recovery).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");

assert.match(config, /preloadEntriesOnStart: false,/, "Next does not preload every entry while the app launches");
assert.match(
  server,
  /const DEFERRED_ENTRY_PRELOAD_MS = \d[\d_]*;/,
  "the deferred preload has one named delay",
);
assert.match(
  server,
  /function scheduleDeferredEntryPreload\(\): void \{\s*if \(dev\) return;\s*const timer = setTimeout\(\(\) => \{[\s\S]*?\.server;[\s\S]*?getServer\?\.\(\)[\s\S]*?unstable_preloadEntries\?\.\(\)[\s\S]*?\}, DEFERRED_ENTRY_PRELOAD_MS\);\s*timer\.unref\?\.\(\);/,
  "server.ts runs Next's own entry preload after launch, through optional internals, without holding the process open",
);
assert.match(
  server,
  /void warmHarnessSpawnPath\(\);\s*\}\);\s*scheduleDeferredEntryPreload\(\);/,
  "it is scheduled as the server starts listening",
);

// The import-time jobs the preload exists for are still where they were.
for (const [route, job] of [
  ["./app/api/inbox/stream/route.ts", /^startScheduler\(\);$/m],
  ["./app/api/github/subscriptions/route.ts", /^startGithubWatcher\(\);$/m],
  ["./app/api/research/generations/route.ts", /^void startResearchMediaJobs\(\)/m],
]) {
  assert.match(readFileSync(new URL(route, import.meta.url), "utf8"), job, `${route} still starts its job on import`);
}

console.log("server-entry-preload.test.ts: ok");
