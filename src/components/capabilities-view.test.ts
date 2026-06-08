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
assert.match(source, /CapabilitiesGrid/, "should render the shared CapabilitiesView card grid");
assert.match(source, /harness_capabilities/, "should consume daemon harness manifests");
assert.match(source, /coven_skills/, "should surface daemon-owned coven skills");
assert.match(source, /read-only/i, "should label itself as read-only — daemon is read-only by design");

console.log("capabilities-view.test.ts: ok");
