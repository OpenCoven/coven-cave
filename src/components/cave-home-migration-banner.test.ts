// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("./cave-home-migration-banner.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./shell.tsx", import.meta.url), "utf8");
const status = await readFile(
  new URL("../lib/server/cave-home-migration-status.ts", import.meta.url),
  "utf8",
);
const runner = await readFile(new URL("../../scripts/run-tests.mjs", import.meta.url), "utf8");

assert.match(
  src,
  /export function CaveHomeMigrationBannerTrigger/,
  "exports a shell banner trigger for the cave home migration",
);
assert.match(src, /pushBanner\(/, "trigger publishes through the shared shell banner system");
assert.match(
  src,
  /\/api\/cave-home-migration/,
  "trigger qualifies participants through the migration status route",
);
assert.match(
  src,
  /if \(pending\.length > 0\)/,
  "fixable pending files take precedence over conflict surfacing",
);
assert.match(
  src,
  /dismissedMigrationBanner\(pending\)/,
  "pending banner respects per-set dismissal",
);
assert.match(
  src,
  /conflicts\.length > 0 && !dismissedConflictsBanner\(conflicts\)/,
  "unfixable conflicts surface as a review banner instead of staying invisible (cave-lzx3)",
);
assert.match(
  src,
  /coven-cave:cave-home-migration:conflicts-dismissed:/,
  "conflict dismissal persists per conflict set so new conflicts re-surface",
);
assert.match(
  src,
  /the ~\/\.coven\/cave versions win\. Review and remove the legacy/,
  "conflicts banner states the outcome and the next step",
);
assert.match(
  src,
  /left for manual review/,
  "a run that finishes with collisions hands off to the review path, not a clean success",
);
assert.match(src, /severity: "warning"/, "pending legacy files warrant a warning banner");
assert.match(src, /Migrate now/, "banner exposes a one-click migrate button");
assert.match(
  src,
  /method: "POST"/,
  "migrate button runs the migration through the API route",
);
assert.match(
  src,
  /coven-cave:cave-home-migration:dismissed:/,
  "banner dismissal persists per pending set so new stragglers re-surface",
);
assert.match(src, /Retry migration/, "failed runs keep an actionable retry button");
assert.match(
  src,
  /Cave files migrated|nothing left to migrate/,
  "successful runs confirm the outcome in place",
);
assert.match(
  shell,
  /CaveHomeMigrationBannerTrigger/,
  "Shell imports and mounts the cave home migration banner trigger",
);
assert.match(
  status,
  /export async function caveHomeMigrationStatus/,
  "qualification logic lives in the shared server status module",
);
assert.match(
  status,
  /CAVE_HOME_MIGRATIONS/,
  "status derives from the migration manifest, never a parallel file list",
);
assert.match(
  runner,
  /src\/components\/cave-home-migration-banner\.test\.ts/,
  "banner test is wired into the test:app suite (scripts/run-tests.mjs)",
);
assert.match(
  runner,
  /src\/lib\/server\/cave-home-migration-status\.test\.ts/,
  "status test is wired into the test:app suite (scripts/run-tests.mjs)",
);
assert.match(
  runner,
  /src\/app\/api\/cave-home-migration\/route\.test\.ts/,
  "route test is wired into the test:app suite (scripts/run-tests.mjs)",
);

console.log("cave-home-migration-banner.test.ts: ok");
