import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const packageJson = JSON.parse(read("package.json"));
const agents = read("AGENTS.md");
const claude = read("CLAUDE.md");
const workflow = read("docs/workflows/github-work-tracking.md");
const legacyWorkflow = read("docs/workflows/beads-familiars.md");
const inventory = read("docs/legacy/beads-remaining-2026-09-14.md");
const claudeHooks = JSON.parse(read(".claude/settings.json"));
const codexHooks = JSON.parse(read(".codex/hooks.json"));
const watchdogPlan = read("docs/superpowers/plans/2026-08-22-beads-dolt-sync-watchdog.md");
const beadsConfig = read(".beads/config.yaml");
const beadsMetadata = JSON.parse(read(".beads/metadata.json"));
const beadsExport = read(".beads/issues.jsonl").trim().split("\n").map((line) => JSON.parse(line));
const beadsPreCommitHook = read(".beads/hooks/pre-commit");
const apiRoute = read("src/app/api/beads/route.ts");
const apiContracts = read("src/app/api/api-contracts.test.ts");

assert.equal(packageJson.scripts["work:issues"], "gh issue list --repo OpenCoven/coven-cave --state open --limit 20");
assert.equal(packageJson.scripts["work:project"], "gh project view 9 --owner OpenCoven");
assert.ok(Object.keys(packageJson.scripts).every((name) => !name.startsWith("beads:")),
  "routine package entrypoints must not restore the retired tracker");
for (const guide of [agents, claude, workflow, legacyWorkflow]) {
  assert.match(guide, /GitHub/);
  assert.doesNotMatch(guide, /bd prime|bd ready|bd update|bd close|pnpm beads:/,
    "current development guidance must not teach a Beads execution loop");
}
assert.match(workflow, /github\.com\/orgs\/OpenCoven\/projects\/9/);
assert.match(workflow, /GitHub assignment and comments are[\s\S]*not atomic execution leases/);
assert.match(workflow, /named primary blocker/i);
assert.match(workflow, /Do not commit, push, or merge without/);
assert.match(workflow, /Do not bulk-import every old row/);
assert.match(agents, /remote deletion remains proposal-only/);
assert.match(claude, /gate-incomplete, preserve the unit/);
assert.match(legacyWorkflow, /Status: Tombstone/);
assert.match(legacyWorkflow, /Familiar Work Queue is not the new development queue/);
assert.match(legacyWorkflow, /public-scrubbed before committing/);
assert.match(workflow, /legacy\/beads-remaining-2026-09-14\.md/);
assert.match(inventory, /Status: Archive/);
assert.match(inventory, /isolated filesystem copy/);
assert.match(inventory, /source changed after capture/i);
assert.match(inventory, /not another queue/);
const durableRows = inventory.split("## Durable records")[1].split("## Ephemeral records")[0];
const ephemeralRows = inventory.split("## Ephemeral records")[1];
assert.equal((durableRows.match(/^\| cave-[\w.-]+ \|/gm) ?? []).length, 186);
assert.equal((ephemeralRows.match(/^\| cave-[\w.-]+ \|/gm) ?? []).length, 1);
assert.doesNotMatch(inventory, /\/Users\/|\/home\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  "the frozen display inventory must omit personal paths and contact addresses");

for (const hooks of [claudeHooks, codexHooks]) {
  assert.doesNotMatch(JSON.stringify(hooks), /\bbd\s|dolt|beads:prime/,
    "automatic context and permission entries must not run Beads");
}
for (const hook of ["surface-claim-guard", "worktree-guard", "worktree-autolock",
  "worktree-retention-push", "worktree-session-exit-retirement"]) {
  assert.ok(JSON.stringify(claudeHooks.hooks).includes(hook), `preserve the independent ${hook} hook`);
}
const sweep = spawnSync("bash", [fileURLToPath(new URL("./worktree-sweep.sh", import.meta.url))], {
  encoding: "utf8",
  timeout: 5_000,
});
assert.ifError(sweep.error);
assert.equal(sweep.status, 2);
assert.match(sweep.stderr, /retired[\s\S]*no tracker or Git operation was attempted/);
assert.equal(sweep.stdout, "");

// Frozen records and optional application support retain independent safeguards.
assert.equal(beadsMetadata.dolt_database, "cave");
assert.match(beadsConfig, /sync\.remote:\s+"git\+https:\/\/github\.com\/OpenCoven\/coven-cave\.git"/);
assert.equal(beadsExport.length, 4, "preserve the historical dogfood export, not a current backlog count");
assert.deepEqual(beadsExport.map((issue) => issue.id).sort(),
  ["cave-hlv", "cave-hlv.1", "cave-hlv.2", "cave-hlv.3"]);
assert.doesNotMatch(read(".beads/issues.jsonl"), /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  "the committed legacy export must not publish local actor emails");
assert.match(watchdogPlan, /cleanup-unproven[\s\S]*cleanupUnprovenGuidance/);
assert.match(watchdogPlan, /confirms the owned process tree was[\s\S]*stop the surviving process tree before retrying[\s\S]*concurrent syncs/);
assert.match(watchdogPlan, /resolveBdLaunchCommand\(\{[\s\S]*env: options\.env,[\s\S]*platform: options\.platform,/);
assert.match(watchdogPlan, /releaseUnprovenChildHandles[\s\S]*if \(!cleanupProven\) releaseUnprovenChildHandles\(\)[\s\S]*\.catch\(\(\) => \{[\s\S]*releaseUnprovenChildHandles\(\)/);
assert.match(watchdogPlan, /child\.once\("error", \(error\) => \{[\s\S]*if \(terminating\) return;/);
assert.doesNotMatch(beadsPreCommitHook,
  /info "ok \(\$\{#STAGED_FILES\[@\]\} files scanned\)"\nexit 0[\s\S]*BEGIN BEADS INTEGRATION/,
  "preserved compatibility hook must not accidentally change its execution order");

assert.match(apiContracts, /\{ route: "\/beads", methods: \["GET", "POST"\]/);
assert.match(apiRoute, /export async function GET[\s\S]*rejectNonLocalRequest\(req\)/,
  "optional legacy reads remain local-only");
assert.match(apiRoute, /export async function POST[\s\S]*rejectNonLocalRequest\(req\)/,
  "optional legacy mutations remain local-only");
assert.match(apiRoute, /id required for mode=show/);
assert.match(apiRoute, /readJsonBody<[\s\S]*MAX_SESSION_JSON_BYTES/);
assert.match(apiRoute, /runBdCommand\(/, "preserve the argv-safe command adapter");
assert.match(apiRoute, /case "claim":[\s\S]*"--claim"/);
assert.match(apiRoute, /case "comment":[\s\S]*"comments"[\s\S]*"add"/);
assert.match(apiRoute, /case "close":[\s\S]*"close"/);
assert.doesNotMatch(apiRoute, /issues\.jsonl/, "the optional API must not mistake the export for live state");

console.log("beads-familiar-workflow.test.mjs: GitHub workflow and preserved legacy contracts ok");
