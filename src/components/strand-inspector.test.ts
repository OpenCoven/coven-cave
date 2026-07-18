// @ts-nocheck
// Source pins for the strand inspection wiring (threads-986.17.5). Behavior
// lives in src/lib/strand-inspect.test.ts; these pins hold the React layer
// to the fail-closed diff treatment and the lineage deep-link.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const inspector = await readFile(new URL("./strand-inspector.tsx", import.meta.url), "utf8");
const view = await readFile(new URL("./weaves-view.tsx", import.meta.url), "utf8");

assert.match(inspector, /export function StrandInspector\(/, "StrandInspector must be exported");

// per-strand detail from the view-model, never ad hoc
assert.match(inspector, /strandDetailRows\(strand\)/, "detail rows derive from the view-model");
assert.match(inspector, /strandDiff\(strand\)/, "diff derives from the view-model");
assert.match(inspector, /blamedStrandId\(thread\.tension\)/, "blamed strand comes from the tension");
assert.match(inspector, /blamed by the fray/, "blamed strand is visibly marked");

// current-vs-expected block, with the null-observation blocked treatment
assert.match(inspector, /current vs expected/, "diff block labeled");
assert.match(inspector, /could not observe — treated as blocked, not healthy/, "null observation fails closed");

// strand referent kept: fiber of commitment, channel survival
assert.match(inspector, /fiber of commitment/, "strand referent stated");
assert.match(inspector, /survive that channel/, "channel-survival rule stated");
assert.match(inspector, /fray it on\s+every structured channel/, "zero-strand consequence stated");

// lineage: strand -> ward_audit entries -> source (R7 marked, never dropped)
assert.match(inspector, /Audit lineage/, "lineage section present");
assert.match(inspector, /annotateLineage\(auditState\.data, knownProposalIds\)/, "lineage annotated against known proposals");
assert.match(inspector, /unresolved reference/, "unresolved proposal refs are marked");
assert.match(inspector, /verified empty, not an error/, "empty lineage is honest, not alarming");
assert.match(inspector, /meta\.sourceCursor/, "lineage shows the source cursor");
// blocked reads render the blocked message, never an empty-healthy list
assert.match(inspector, /strandsState\.message/, "blocked strand read shows why");
assert.match(inspector, /auditState\.message/, "blocked audit read shows why");
assert.match(inspector, /cache: "no-store"/, "reads are never cached");

// wired into the weaves view under the selected thread
assert.match(view, /StrandInspector/, "weaves view renders the inspector");
assert.match(view, /knownProposalIds/, "view supplies known proposal ids for R7 annotation");

console.log("strand-inspector wiring: all assertions passed");
