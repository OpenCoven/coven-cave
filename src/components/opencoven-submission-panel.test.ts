// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./opencoven-submission-panel.tsx", import.meta.url),
  "utf8",
);
const capabilitiesView = readFileSync(
  new URL("./capabilities-view.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /OpenCoven submissions/);
assert.match(source, /Runtime[\s\S]*Harness/, "authors should choose Runtime or Harness");
assert.match(source, /One package/, "the UI should ask for one package containing manifest and artifacts");
assert.match(source, /files/, "the sample package should include actual file entries, not only artifact path names");
assert.match(source, /type="file"/, "authors should be able to upload a package JSON file");
assert.match(source, /\/api\/opencoven\/submissions/, "panel should use the OpenCoven submission API");
assert.match(source, /pass[\s\S]*warning[\s\S]*fail[\s\S]*review-required/, "validation statuses should be visible");
assert.match(source, /Publish to OpenCoven catalog/, "passing packages publish into OpenCoven catalog");
assert.match(source, /Execution routing/, "catalog output should show routing through OpenCoven execution services");
assert.match(source, /Catalog discovery/, "catalog output should be a discovery layer, not a tiny status list");
assert.match(source, /Capabilities/, "catalog entries should show capabilities");
assert.match(source, /Compatibility/, "catalog entries should show compatibility requirements");
assert.match(source, /Examples \/ docs/, "catalog entries should show examples/docs");
assert.match(source, /Validation status/, "catalog entries should show validation status");
assert.match(source, /Route readiness/, "catalog entries should show route readiness for harnesses");
assert.match(source, /selectedHarnessId/, "authors should be able to select a harness route to inspect");
assert.match(source, /URLSearchParams/, "route inspection should call the API with explicit harness/runtime query params");
assert.match(source, /Resolve route/, "panel should expose a visible execution-route resolver");
assert.match(source, /\/api\/opencoven\/executions/, "panel should request OpenCoven execution-service plans");
assert.match(source, /Build execution plan/, "panel should expose a visible execution-plan builder");
assert.match(source, /executionPlan/, "panel should show execution-plan state from OpenCoven execution services");
assert.doesNotMatch(source, /clawhub|openclaw/i, "submission panel must not point authors at external publishing paths");
assert.match(capabilitiesView, /OpenCovenSubmissionPanel/, "Capabilities tab should render the OpenCoven submission panel");

console.log("opencoven-submission-panel.test.ts: ok");
