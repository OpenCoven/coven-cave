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
  /filterInstallSeedFamiliars\(/,
  "Familiars API should hide the known first-install default roster before the picker sees it",
);
assert.match(
  source,
  /explicitFamiliarIdsFromToml/,
  "Familiars API should distinguish user-authored familiar ids from daemon fallback defaults",
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
