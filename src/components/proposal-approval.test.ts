// @ts-nocheck
// Source pins for the proposal approval wiring (threads-986.17.6). Behavior
// lives in src/lib/proposal-flow.test.ts and the route E2E in
// src/app/api/proposals-flow-e2e.test.ts; these pins hold the React layer to
// the forward-only, fail-closed contract.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const flow = await readFile(new URL("./proposal-approval.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/proposals/page.tsx", import.meta.url), "utf8");

assert.match(flow, /export function ProposalApproval\(/, "ProposalApproval must be exported");

// decisions derive from the view-model, never ad hoc enabling
assert.match(flow, /decisionAvailability\(state, proposal\)/, "buttons gate on decisionAvailability");
assert.match(flow, /availability\.allowed \?/, "unavailable decisions render the reason instead of buttons");
assert.match(flow, /decisionOutcomeFromResponse\(/, "outcomes derive from the response mapper");

// forward-only: POST to the daemon-forwarder routes, no optimistic UI
assert.match(flow, /fetch\(`\/api\/proposals\/\$\{encodeURIComponent\(payload\.id\)\}\/\$\{decision\}`/, "decisions POST to the forwarder routes");
assert.match(flow, /re-validated before applying/, "applied outcome credits the daemon's re-validation");
assert.match(flow, /if \(result\.kind === "applied"\) onDecided\(\)/, "list refreshes only on an applied decision");

// corrupt staged files: listed, inspectable, never actionable (R6)
assert.match(flow, /Corrupt staged file/, "corrupt card labeled");
assert.match(flow, /cannot be approved or\s+rejected from here/, "corrupt card denies both actions");

// full desired contents, honestly framed (§2.6)
assert.match(flow, /editPreviews\(proposal\)/, "edit previews derive from the view-model");
assert.match(flow, /full desired contents \(\{edit\.encoding\}\)/, "contents labeled as full desired contents");
assert.match(flow, /fraySummary\(proposal\)/, "the degradation reason renders per proposal");

// audit note travels with the decision
assert.match(flow, /optional note for the audit log/, "note field present");

// blocked + empty states are honest
assert.match(flow, /Blocked — cannot verify staged proposals/, "blocked list state present");
assert.match(flow, /Verified empty, not an error/, "empty pending list is calm");
assert.match(flow, /cache: "no-store"/, "reads are never cached");
assert.match(flow, /meta\.sourceCursor/, "freshness footer present");

// page: never applies edits itself, daemon re-validates
assert.match(page, /data, not authority/, "page states the staged-write rule");
assert.match(page, /never applies edits\s+itself/, "page denies a UI write path");

console.log("proposal-approval wiring: all assertions passed");
