// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./capabilities-view.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /export function CapabilitiesViewSurface/);
assert.match(source, /\/api\/capabilities/, "should fetch from the Cave capabilities proxy");
assert.match(source, /refresh=1/, "should support a refresh that bypasses the daemon cache");
assert.doesNotMatch(source, /CapabilitiesGrid/, "operator map replaces the old shared card grid");
assert.match(source, /harness_capabilities/, "should consume daemon harness manifests");
assert.match(source, /coven_skills/, "should surface daemon-owned coven skills");
assert.match(source, /read-only/i, "should label itself as read-only — daemon is read-only by design");
assert.match(source, /normalizeCapabilities/, "should derive an operator map view model from daemon manifests");
assert.match(source, /CapabilityMap/, "should render the hybrid capability map");
assert.match(source, /CapabilityInspector/, "should render a right-side inspector for selected harness or capability");
assert.match(source, /placeholder="Search skills, plugins, paths, commands"/, "should expose operator-grade search");
assert.match(source, /copyCapabilityDetail/, "inspector should expose read-only copy actions");
assert.doesNotMatch(source, /\bharnessLabel,\n/, "should not import unused harnessLabel into the view component");
assert.match(source, /initialHarness\(activeHarness\?: string \| null\)[\s\S]*activeHarness \?\? readUrlParam\("harness"\)/, "null activeHarness should allow URL harness deep-links");
assert.match(source, /initialQuery\(\)[\s\S]*readUrlParam\("q"\)/, "query filter should initialize from the URL");
assert.match(source, /initialTypeFilter\(\)[\s\S]*readCapabilityTypeParam\("type"\)/, "type filter should initialize from the URL");
assert.match(source, /initialStatusFilter\(\)[\s\S]*readCapabilityStatusParam\("status"\)/, "status filter should initialize from the URL");
assert.match(source, /if \(statusFilter !== "all"\) params\.set\("status", statusFilter\);[\s\S]*else params\.delete\("status"\);/, "status filter should sync into shareable URLs");
assert.match(source, /\}, \[harnessFilter, query, typeFilter, statusFilter\]\);/, "URL sync should rerun when status changes");
assert.match(source, /const applyQueryFilter = \(value: string\) => \{[\s\S]*setQuery\(value\);[\s\S]*setSelectionId\(null\);[\s\S]*\};/, "query changes should clear stale inspector selection");
assert.match(source, /const applyTypeFilter = \(value: CapabilityType \| "all"\) => \{[\s\S]*setTypeFilter\(value\);[\s\S]*setSelectionId\(null\);[\s\S]*\};/, "type changes should clear stale inspector selection");
assert.match(source, /const applyStatusFilter = \(value: CapabilityStatus \| "all"\) => \{[\s\S]*setStatusFilter\(value\);[\s\S]*setSelectionId\(null\);[\s\S]*\};/, "status changes should clear stale inspector selection");
assert.match(source, /const readinessStatus = operatorView\.summary\.warnings > 0 \? "warning" : operatorView\.summary\.disabled > 0 \? "disabled" : "all";/, "readiness tile should route to disabled when disabled is the only issue type");
assert.match(source, /type="search"[\s\S]*aria-label="Search capabilities"/, "search input should expose a stable accessible name");

console.log("capabilities-view.test.ts: ok");
