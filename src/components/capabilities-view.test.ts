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

console.log("capabilities-view.test.ts: ok");
