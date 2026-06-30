// @ts-nocheck
// Source-text test for the EvalGroups management panel: pins the CRUD wiring
// (create/save via POST, delete via DELETE), the rollup summary, and the
// scope/tracks/member controls that make the tab functional.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./eval-groups-panel.tsx", import.meta.url), "utf8");

// Client component receiving groups, derived states, familiars, and a refetch hook.
assert.match(source, /"use client"/, "is a client component");
assert.match(source, /export function EvalGroupsPanel/, "exports the panel");
assert.match(source, /groups: EvalGroup\[\]/, "receives the groups list");
assert.match(source, /states: (readonly )?ThreadEvalState\[\]/, "receives derived thread eval states");
assert.match(source, /familiars: ResolvedFamiliar\[\]/, "receives the familiars prop for member selection");
assert.match(source, /onChanged/, "calls back to refetch groups after a mutation");

// Rollup summary per group.
assert.match(source, /rollupEvalGroup\(/, "rolls each group's state into status counts");
assert.match(source, /freshThreads/, "shows fresh thread count");
assert.match(source, /staleThreads/, "shows stale thread count");
assert.match(source, /neverRunThreads/, "shows never-run thread count");

// CRUD wiring against the API.
assert.match(source, /fetch\("\/api\/evals\/groups"/, "saves a group via POST /api/evals/groups");
assert.match(source, /method: "POST"/, "creates/edits via POST");
assert.match(source, /JSON\.stringify\(\{ group/, "POST body wraps the group");
assert.match(source, /\/api\/evals\/groups\?id=/, "deletes via DELETE /api/evals/groups?id=");
assert.match(source, /method: "DELETE"/, "supports group deletion");
assert.match(source, /crypto\.randomUUID\(\)/, "new groups get a generated id");

// Form controls: scope select, tracks multi-toggle, stale TTL (hours), familiar members.
assert.match(source, /EvalGroupScope|SCOPE_OPTIONS/, "scope is constrained to EvalGroupScope");
assert.match(source, /EvalTrack|TRACK_OPTIONS/, "tracks are constrained to EvalTrack");
assert.match(source, /ttl|ttlMs/i, "stale policy TTL is editable");
assert.match(source, /kind: "familiar"/, "familiar members are stored as familiar-kind members");
assert.match(source, /schedulePolicy/, "sets a schedule policy on new groups");

console.log("eval-groups-panel.test.ts OK");
