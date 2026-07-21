// @ts-nocheck
// Source pins for the proposal approval wiring (threads-986.17.6). Behavior
// lives in src/lib/proposal-flow.test.ts and the route E2E in
// src/app/api/proposals-flow-e2e.test.ts; these pins hold the React layer to
// the forward-only, fail-closed contract.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const flow = await readFile(new URL("./proposal-approval.tsx", import.meta.url), "utf8");
const freshness = await readFile(new URL("../lib/response-envelope-freshness.ts", import.meta.url), "utf8").catch(
  () => "",
);
const model = await readFile(new URL("../lib/proposal-flow.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/proposals/page.tsx", import.meta.url), "utf8");

assert.match(flow, /export function ProposalApproval\(/, "ProposalApproval must be exported");

// decisions derive from the view-model, never ad hoc enabling
assert.match(flow, /decisionAvailability\(state, proposal, note\)/, "buttons gate on note-aware decisionAvailability");
assert.match(flow, /availability\.allowed \?/, "unavailable decisions render the reason instead of buttons");
assert.match(flow, /availability\.actions\.map/, "only authority-derived actions render");
assert.match(flow, /action\.label\}/, "the view-model owns each visible action label");
assert.match(
  flow,
  /disabled=\{submitting !== null \|\| !action\.enabled\}/,
  "decision-specific disabled state reaches each button",
);
assert.match(flow, /decisionOutcomeFromResponse\(/, "outcomes derive from the response mapper");

// forward-only: POST to the daemon-forwarder routes, no optimistic UI
assert.match(flow, /fetch\(`\/api\/proposals\/\$\{encodeURIComponent\(payload\.id\)\}\/\$\{decision\}`/, "decisions POST to the forwarder routes");
assert.match(
  flow,
  /expectedRevision:\s*currentAvailability\.expectedRevision/,
  "verified Phase 5 decisions forward the authority revision",
);
assert.match(flow, /note:\s*note\.trim\(\)/, "the route body uses the trimmed decision note");
assert.match(flow, /re-validated before applying/, "applied outcome credits the daemon's re-validation");
assert.match(flow, /if \(result\.kind === "applied"\) onDecided\(\)/, "list refreshes only on an applied decision");

// daemon lifecycle data is rendered as trace, never reinterpreted locally
assert.match(flow, /authority\.approvalPath\.label/, "daemon approval label renders verbatim");
assert.match(flow, /authority\.lifecycle/, "daemon lifecycle renders");
assert.match(flow, /authority\.affectedRegions/, "daemon affected regions render");
assert.match(flow, /authority\.approvalPath\.vetoDeadline/, "daemon veto deadline renders");
assert.match(flow, /authority\.earliestClose/, "daemon earliest close renders");
assert.match(flow, /authority\.blockedReason/, "daemon blocked reason renders");
for (const source of [flow, model]) {
  assert.doesNotMatch(source, /Date\.now\s*\(/, "action eligibility never calls Date.now");
  assert.doesNotMatch(source, /Date\.parse\s*\(/, "action eligibility never parses daemon deadlines");
  assert.doesNotMatch(source, /\.getTime\s*\(/, "action eligibility never compares clock values");
}
assert.match(flow, /useResponseEnvelopeFreshness\(state\)/, "held responses re-render at staleAfter");
assert.match(
  flow,
  /responseEnvelopeStateAt\(state\)/,
  "decision submission rechecks response freshness at click time",
);
assert.match(freshness, /meta\.staleAfter/, "the freshness hook schedules from response meta.staleAfter");
assert.match(freshness, /clearTimeout/, "the freshness timer is cleanup-safe");
assert.match(
  freshness,
  /responseState\.banners\.some\(\(banner\) => banner\.kind === "stale"\)/,
  "an immediate expired-effect update cannot loop after stale UI renders",
);
assert.match(freshness, /if \(!active \|\| elapsed\) return/, "freshness callbacks are guarded against cleanup and duplicates");
assert.match(
  freshness,
  /immediateUpdateFor\.current === staleAfter/,
  "Strict Mode effect replay cannot request the same immediate update twice",
);
assert.doesNotMatch(
  freshness,
  /vetoDeadline|earliestClose/,
  "response freshness never schedules or compares daemon lifecycle deadlines",
);

// corrupt staged files: listed, inspectable, never actionable (R6)
assert.match(flow, /Corrupt staged file/, "corrupt card labeled");
assert.match(flow, /cannot be approved or\s+rejected from here/, "corrupt card denies both actions");

// full desired contents, honestly framed (§2.6)
assert.match(flow, /editPreviews\(proposal\)/, "edit previews derive from the view-model");
assert.match(flow, /full desired contents \(\{edit\.encoding\}\)/, "contents labeled as full desired contents");
assert.match(flow, /fraySummary\(proposal\)/, "the degradation reason renders per proposal");

// audit note travels with the decision; rationale paths expose conditional requirement semantics
assert.match(flow, /<label\s+htmlFor=\{noteInputId\}[^>]*>/, "decision note has a visible label");
assert.match(flow, /required to approve/, "rationale approval visibly marks the note as required");
assert.match(flow, /aria-describedby=\{noteHelpId\}/, "decision note references its visible help text");
assert.match(flow, /aria-required=\{approvalRationaleRequired\}/, "rationale requirement reaches assistive technology");
assert.match(
  flow,
  /disabledApproval\.disabledReason/,
  "the authority model's disabled reason is visible beside the required note",
);
assert.match(
  model,
  /Approval is disabled until you add a rationale\. Reject remains available without a note\./,
  "empty rationale explains why approval is disabled without blocking reject",
);
assert.match(flow, /Optional note for the audit log\./, "legacy and non-rationale paths still call the note optional");

// blocked + empty states are honest
assert.match(flow, /Blocked — cannot verify staged proposals/, "blocked list state present");
assert.match(flow, /Verified empty, not an error/, "empty pending list is calm");
assert.match(flow, /cache: "no-store"/, "reads are never cached");
assert.match(flow, /meta\.sourceCursor/, "freshness footer present");

// page: never applies edits itself, daemon re-validates
assert.match(page, /data, not authority/, "page states the staged-write rule");
assert.match(page, /never applies edits\s+itself/, "page denies a UI write path");

console.log("proposal-approval wiring: all assertions passed");
