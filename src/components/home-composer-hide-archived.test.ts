// @ts-nocheck
//
// Guard: Home must use only the shell-resolved actor. Archive and eligibility
// checks belong to the shell roster boundary, not a second local fallback.
//
// Archived familiars are tracked by `cave-familiar-archive.ts` (localStorage,
// per-Cave). Showing them in a "start a new chat" picker is a footgun — the
// user can't tell the agent is archived from the dropdown, and starting a new
// session against an archived familiar produces a confusing state.
//
// We assert against the source string rather than rendering React so this guard
// stays light and matches the existing home-composer.test.ts pattern.
//
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");
assert.match(
  source,
  /familiars\.find\(\(familiar\) => familiar\.id === actingFamiliarId\) \?\? null/,
  "HomeComposer should display only the shell-resolved actor",
);

assert.doesNotMatch(
  source,
  /useArchivedFamiliars|resolveHomeComposerFamiliar|familiars\[0\]/,
  "HomeComposer should not recreate archive filtering or a first-familiar fallback",
);

assert.match(
  source,
  /onRequestActingFamiliar: \(\s*actionLabel: string,\s*authorityId: string,\s*requiresProjectAccess: boolean,/,
  "HomeComposer should delegate unresolved actor selection to the shell",
);

console.log("home-composer-hide-archived.test.ts: ok");
