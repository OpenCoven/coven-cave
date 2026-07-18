// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /const configEntry = config\.familiars\[f\.id\] \?\? \{\}/,
  "Familiars API should inspect the raw familiar config entry before resolving defaults",
);
assert.match(
  source,
  /defaultHarness: config\.defaults\.harness/,
  "Familiars API should expose the workspace default harness for UI copy",
);
assert.match(
  source,
  /harnessOverride: configEntry\.harness \?\? null/,
  "Familiars API should expose whether the familiar has an explicit harness override",
);
assert.match(
  source,
  /autoSelfReport: configEntry\.autoSelfReport \?\? false/,
  "Familiars API should expose per-familiar auto self-report config with a false default",
);
assert.match(
  source,
  /parseFamiliarsToml/,
  "Familiars API should read the locally-declared familiars so they can be merged and exempted",
);

// ── GET: the list must reflect the coven's real state (cave-7cv4) ────────────
// Hub rosters are real registered familiars — the install-seed guard judges
// entries against the LOCAL familiars.toml, which knows nothing about a
// remote coven, so it must not run in hub mode.
assert.match(
  source,
  /target\.mode === "hub"\s*\?\s*\(res\.data \?\? \[\]\)\s*:\s*filterInstallSeedFamiliars\(/,
  "hub rosters bypass the local-toml install-seed guard",
);
// Familiars declared in the local familiars.toml but missing from the daemon
// roster (not re-read yet / hub unaware) merge into the response — everything
// the POST duplicate check can 409 on must be visible in the list.
assert.match(
  source,
  /const declaredOnly[^=]*= declaredEntries\s*\.filter\(\(entry\) => !rosterIds\.has\(entry\.id\.toLowerCase\(\)\) && !removedIds\.has\(entry\.id\)\)/,
  "locally-declared familiars missing from the daemon roster are merged in (minus tombstones)",
);
assert.match(
  source,
  /\[\.\.\.visibleRoster, \.\.\.declaredOnly\]\.map\(/,
  "daemon roster and declared-only familiars flow through the same enrichment",
);
assert.match(
  source,
  /const target = daemonTargetForConfig\(config\);/,
  "Familiars API should resolve the roster authority from the same config snapshot used for the daemon call",
);
assert.match(
  source,
  /callDaemonTarget[\s\S]{0,80}\(target, \{/,
  "Familiars API should query the roster against the resolved target, not re-derive it",
);
assert.equal(
  source.match(/const covenDir = covenHome\(\)/g)?.length,
  2,
  "Familiars GET and POST should honor a custom COVEN_HOME",
);

// ── POST: in-app "create a familiar" write path ──────────────────────────────
// Source-text guards (same pattern as src/app/api/onboarding/setup/route.test.ts).
// Deep-merge semantics are covered by src/lib/cave-config.test.ts; draft
// normalization by the onboarding-familiars helpers this route reuses.

assert.match(source, /export async function POST\(/, "route should create a familiar via POST");

// Reuses the shared onboarding write primitives so a UI-created familiar is
// identical to a setup-created one.
assert.match(
  source,
  /normalizeFamiliarDraft\(body\.familiar\)/,
  "POST should normalize input through the shared onboarding helper",
);
assert.match(
  source,
  /buildFamiliarsToml\(draft\)/,
  "POST should build the [[familiar]] block through the shared helper",
);

// Duplicate protection: never append a second block with the same id.
assert.match(
  source,
  /familiarsTomlContainsId\(existingToml, draft\.id\)/,
  "POST should detect an existing id before appending",
);
assert.match(source, /status:\s*409/, "POST should return 409 on a duplicate id");

// The local familiars.toml is only half the truth — in hub mode (or before
// the local daemon re-reads the file) the roster can hold ids this machine
// has never declared. POST checks the live roster best-effort (daemon failure
// must not block creation) so it never shadows an existing remote familiar;
// tombstoned ids are exempt so Remove → re-create keeps working (cave-7cv4).
assert.match(
  source,
  /liveRoster\.ok &&\s*!removed\.has\(draft\.id\) &&\s*\(liveRoster\.data \?\? \[\]\)\.some\(\(f\) => f\.id\.toLowerCase\(\) === draft\.id\.toLowerCase\(\)\)/,
  "POST rejects ids that already exist in the live roster (best-effort, tombstone-exempt)",
);

// CRITICAL: creating an additional familiar must NOT rewrite the global
// defaults (that's onboarding's job for the first familiar). The route only
// upserts this familiar's binding via saveConfig({ familiars }); deep-merge
// leaves defaults/roles/addons/marketplace untouched.
assert.match(
  source,
  /saveConfig\(\{\s*familiars:/,
  "POST should upsert the new familiar binding via saveConfig({ familiars })",
);
assert.doesNotMatch(
  source,
  /defaults:\s*\{/,
  "POST must NOT write a defaults object — creating a familiar must not change the user's global default harness/model",
);

// Optional-body (fallback-empty) handling, per the API contract for this route.
assert.match(source, /let body[\s\S]{0,120}=\s*\{\}/, "POST should initialize an optional request body");
assert.match(
  source,
  /try\s*\{[\s\S]{0,120}req\.json\(\)[\s\S]{0,120}\}\s*catch\s*\{/,
  "POST should tolerate a malformed/empty JSON body",
);

// POST scaffolds the Familiar Contract so a new familiar is compliant from
// birth. Best-effort: the scaffold call is wrapped so a workspace write failure
// can't fail creation (the familiar is already registered in toml + config).
assert.match(
  source,
  /scaffoldFamiliarContractFiles\(\{[\s\S]*?id: draft\.id/,
  "POST should scaffold the familiar's contract files",
);
assert.match(
  source,
  /try\s*\{\s*contractWrote = await scaffoldFamiliarContractFiles\([\s\S]*?\}\s*catch\s*\{/,
  "contract scaffolding must be best-effort (never fail creation)",
);

console.log("familiars route.test.ts: ok");
