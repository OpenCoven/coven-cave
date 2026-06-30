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
assert.match(source, /statesById: Map<string, ThreadEvalState\[\]>/, "receives derived thread eval states scoped per group id");
assert.match(source, /familiars: ResolvedFamiliar\[\]/, "receives the familiars prop for member selection");
assert.match(source, /onChanged/, "calls back to refetch groups after a mutation");

// Rollup summary per group.
assert.match(source, /rollupEvalGroup\(/, "rolls each group's state into status counts");
assert.match(source, /groupTotals/, "derives a page-level groups summary");
assert.match(source, /evals-groups-hero/, "renders a dedicated Groups tab header");
assert.match(source, /Tracked groups/, "shows tracked group count");
assert.match(source, /Runnable threads/, "shows runnable thread count");
assert.match(source, /Stale or never run/, "shows stale work needing attention");
assert.match(source, /No tracked groups/, "distinguishes an empty groups list from the editor");
assert.match(source, /Group set/, "labels the group list region");
assert.match(source, /freshThreads/, "shows fresh thread count");
assert.match(source, /staleThreads/, "shows stale thread count");
assert.match(source, /neverRunThreads/, "shows never-run thread count");
assert.match(source, /aria-label="Toggle group debug details"/, "each group exposes a debug details toggle");
assert.match(source, /is-active/, "debug action exposes its active state visually");
assert.match(source, /Group debug details/, "labels the inline debug payload");
assert.match(source, /statesById\.get\(group\.id\)/, "debug payload uses the exact derived states for the group");
assert.match(source, /JSON\.stringify\(\s*\{\s*group:/, "renders copyable JSON debug data");
assert.match(source, /rollup:/, "includes rollup status counts in debug data");
assert.match(source, /states:/, "includes thread state diagnostics in debug data");

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
