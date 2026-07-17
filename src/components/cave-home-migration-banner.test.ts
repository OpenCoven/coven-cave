// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("./cave-home-migration-banner.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./shell.tsx", import.meta.url), "utf8");
const status = await readFile(new URL("../lib/server/cave-home-migration-status.ts", import.meta.url), "utf8");
const reconciliation = await readFile(new URL("../lib/server/cave-home-reconciliation.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const runner = await readFile(new URL("../../scripts/run-tests.mjs", import.meta.url), "utf8");

assert.match(src, /export function CaveHomeMigrationBannerTrigger/, "exports the shell migration trigger");
assert.match(src, /pushBanner\(/, "publishes through the shared shell banner system");
assert.match(src, /Review files/, "count warning opens a review workflow");
assert.match(src, /Both copies are preserved until you choose/, "banner communicates the data-safety model");
assert.match(src, /status\.details\.map/, "review names every affected file");
assert.match(src, /legacyMtimeMs/, "review shows legacy timestamps");
assert.match(src, /canonicalMtimeMs/, "review shows canonical timestamps");
assert.match(src, /detail\.differences\.map/, "review shows a bounded content-difference summary");
assert.match(src, /Merge safely/, "review offers safe schema merge");
assert.match(src, /Keep current/, "review offers canonical selection");
assert.match(src, /Recover legacy/, "review offers legacy recovery");
assert.match(src, /Open backup folder/, "review exposes verified recovery bundles");
assert.match(src, /return "Defer"/, "review lets users defer ambiguous decisions");
assert.match(src, /shell_open_path/, "desktop opens the absolute backup directory through the validated command");
assert.match(src, /usePausablePoll\(\(\) => void refresh\(\), 30_000/, "managed mirrors are rechecked for stale legacy writes while Cave remains open");
assert.match(src, /JSON\.stringify\(\{ legacy: detail\.legacy, action \}\)/, "actions identify one manifest entry");
assert.match(src, /review-dismissed:/, "dismissal is keyed by the exact review set");
assert.match(src, /detail\.legacyHash \?\? "missing"/, "a changed legacy mirror re-surfaces after an earlier dismissal");
assert.match(src, /detail\.canonicalHash \?\? "missing"/, "a changed canonical copy re-surfaces after an earlier dismissal");
assert.match(css, /\.cave-migration-review/, "review workflow has responsive shell styling");
assert.match(shell, /CaveHomeMigrationBannerTrigger/, "Shell mounts the migration trigger");
assert.match(status, /caveHomeReconciliationStatus\(CAVE_HOME_MIGRATIONS\)/, "qualification stays centralized");
assert.match(reconciliation, /migration-state\.json/, "reconciliation persists an atomic journal");
assert.match(reconciliation, /migration-backups/, "reconciliation creates recovery bundles");
assert.match(runner, /src\/components\/cave-home-migration-banner\.test\.ts/, "banner regression is wired");
assert.match(runner, /src\/lib\/server\/cave-home-migration-status\.test\.ts/, "status regression is wired");
assert.match(runner, /src\/app\/api\/cave-home-migration\/route\.test\.ts/, "route regression is wired");

console.log("cave-home-migration-banner.test.ts: ok");
