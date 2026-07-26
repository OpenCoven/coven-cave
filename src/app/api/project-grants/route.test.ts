// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const grantsRoute = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const proposalsRoute = await readFile(new URL("../grant-proposals/route.ts", import.meta.url), "utf8");
const proposalItemRoute = await readFile(new URL("../grant-proposals/[id]/route.ts", import.meta.url), "utf8");
const permissions = await readFile(new URL("../../../lib/project-permissions.ts", import.meta.url), "utf8");

assert.match(
  permissions,
  /export async function revokeProjectFromFamiliar\(/,
  "permission core should expose human grant revocation",
);
assert.match(
  permissions,
  /export async function resolveGrantProposal\(/,
  "permission core should expose human proposal accept/reject",
);
assert.match(
  permissions,
  /grantProposal\.status = input\.decision === "accepted" \? "accepted" : "rejected"/,
  "proposal resolution should persist accepted/rejected state",
);
assert.match(
  permissions,
  /if \(input\.decision === "accepted"\)[\s\S]*ensureProjectGrant/,
  "accepting a proposal should create the target project grant",
);

assert.match(grantsRoute, /export async function GET\(/, "project grants route should list grants");
assert.match(grantsRoute, /export async function POST\(/, "project grants route should create human grants");
assert.match(grantsRoute, /export async function DELETE\(/, "project grants route should revoke human grants");
assert.match(
  grantsRoute,
  /directGrantMutationDenied/,
  "direct grant mutations should fail closed instead of trusting request bodies",
);
assert.doesNotMatch(
  grantsRoute,
  /grantProjectToFamiliar|revokeProjectFromFamiliar/,
  "direct grants route should not expose unauthenticated grant mutation primitives",
);

assert.match(proposalsRoute, /export async function GET\(/, "grant proposals route should list proposals");
assert.match(proposalsRoute, /export async function POST\(/, "grant proposals route should create proposals");
assert.match(
  proposalsRoute,
  /proposalMutationDenied/,
  "proposal creation should fail closed instead of trusting caller-supplied Supreme claims",
);
assert.doesNotMatch(
  proposalsRoute,
  /createGrantProposal/,
  "proposal route should not expose unauthenticated proposal creation",
);

assert.match(proposalItemRoute, /export async function PATCH\(/, "proposal item route should resolve proposals");
assert.match(
  proposalItemRoute,
  /authenticated human approval flow/,
  "proposal resolution should fail closed without authenticated human approval",
);
assert.doesNotMatch(
  proposalItemRoute,
  /resolveGrantProposal/,
  "proposal item route should not expose unauthenticated proposal resolution",
);

console.log("project-grants route.test.ts: ok");
