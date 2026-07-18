// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const grantsRoute = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const proposalsRoute = await readFile(new URL("../grant-proposals/route.ts", import.meta.url), "utf8");
const proposalItemRoute = await readFile(new URL("../grant-proposals/[id]/route.ts", import.meta.url), "utf8");
const permissions = await readFile(new URL("../../../lib/project-permissions.ts", import.meta.url), "utf8");
const targets = await readFile(new URL("../../../lib/server/project-grant-targets.ts", import.meta.url), "utf8");

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
  /grantProposal\.status = "accepting";[\s\S]{0,240}GRANT_ACCEPT_UNDO_WINDOW_MS/,
  "accepting a proposal should park it in the undo window instead of granting instantly",
);
assert.match(
  permissions,
  /export function materializeDueGrantProposals\([\s\S]*?ensureProjectGrant\(/,
  "the grant should materialize only when the undo window elapses",
);
assert.match(
  permissions,
  /export async function undoGrantProposal\(/,
  "permission core should expose human undo inside the acceptance window",
);

assert.match(grantsRoute, /export async function GET\(/, "project grants route should list grants");

assert.match(
  targets,
  /import \{ loadProjects, projectById \} from "@\/lib\/cave-projects";/,
  "grant-target validation should use the shared project loader helpers",
);
assert.match(
  targets,
  /import \{ loadVisibleFamiliarRoster \} from "@\/lib\/server\/familiar-roster";/,
  "grant-target validation should reuse the shared visible familiar roster loader",
);
assert.match(
  targets,
  /import \{ isValidFamiliarId \} from "@\/lib\/server\/familiar-id";/,
  "grant-target validation should use the shared familiar id guard",
);
assert.match(
  targets,
  /if \(!isValidFamiliarId\(input\.familiarId\)\) return \{ ok: false, status: 400, error: "invalid familiar id" \};/,
  "malformed familiar ids fail before any filesystem or roster access",
);
assert.match(
  targets,
  /const project = projectById\(input\.projectId, await loadProjects\(\)\);[\s\S]*if \(!project\) return \{ ok: false, status: 404, error: "project not found" \};/,
  "grant-target validation rejects unknown project ids",
);
assert.match(
  targets,
  /const roster = await loadVisibleFamiliarRoster\(\);[\s\S]*if \(!roster\.ok\) return \{ ok: false, status: roster\.status === 401 \|\| roster\.status === 403 \? roster\.status : 503, error: roster\.error \};/,
  "grant-target validation fails closed when the familiar roster cannot be loaded",
);
assert.match(
  targets,
  /const familiar = roster\.roster\.find\(\(entry\) => entry\.id\.toLowerCase\(\) === input\.familiarId\.toLowerCase\(\)\);[\s\S]*if \(!familiar\) return \{ ok: false, status: 404, error: "familiar not found" \};/,
  "grant-target validation rejects nonexistent or removed familiar ids",
);
assert.match(grantsRoute, /export async function POST\(/, "project grants route should create human grants");
assert.match(grantsRoute, /export async function DELETE\(/, "project grants route should revoke human grants");
assert.match(
  grantsRoute,
  /requireLocalHumanGrantMutation\(req\)/,
  "direct grant mutations should require a local human request",
);
assert.match(
  grantsRoute,
  /rejectRelayedApproval\(payload\)/,
  "direct grant mutations should reject actor/relayed-human fields instead of trusting familiar claims",
);
assert.match(
  grantsRoute,
  /const target = await resolveProjectGrantTarget\(input\);[\s\S]*if \(!target\.ok\) \{[\s\S]*status: target\.status[\s\S]*\}/,
  "direct grants should validate the project and familiar targets before mutating permissions",
);
assert.match(
  grantsRoute,
  /grantProjectToFamiliar\(\{ familiarId: target\.familiarId, projectId: target\.projectId, source: "human", access \}\)/,
  "direct grants should always be recorded with source=human against the validated target ids",
);
assert.match(
  grantsRoute,
  /revokeProjectFromFamiliar/,
  "direct grants route should call the revocation primitive",
);
assert.match(
  grantsRoute,
  /listAccessGroups/,
  "grants GET should ride access groups along so one fetch renders effective access",
);
assert.match(
  grantsRoute,
  /if \(payload\.access === undefined\) return "write";/,
  "grants POST should default the access level to write (v1 semantics)",
);
assert.match(
  grantsRoute,
  /payload\.access === "read" \|\| payload\.access === "write"/,
  "grants POST should only accept read|write access levels",
);
assert.match(
  permissions,
  /requiredAccessLevel/,
  "the enforcement chokepoint should map surfaces to required access levels",
);

assert.match(proposalsRoute, /export async function GET\(/, "grant proposals route should list proposals");
assert.match(proposalsRoute, /export async function POST\(/, "grant proposals route should create proposals");
assert.match(
  proposalsRoute,
  /isLocalOrigin\(req\)/,
  "proposal creation should require a local human request",
);
assert.match(
  proposalsRoute,
  /createGrantProposal\(\{[\s\S]*proposedBy:[\s\S]*targetFamiliarId:[\s\S]*projectId:[\s\S]*claimedHumanApproval:/,
  "proposal route should pass Supreme proposal claims to the guarded core primitive",
);

assert.match(proposalItemRoute, /export async function PATCH\(/, "proposal item route should resolve proposals");
assert.match(
  proposalItemRoute,
  /isLocalOrigin\(req\)/,
  "proposal resolution should require a local human request",
);
assert.match(
  proposalItemRoute,
  /rejectRelayedApproval\(payload\)/,
  "proposal resolution should reject relayed human approval claims",
);
assert.match(
  proposalItemRoute,
  /resolveGrantProposal\(\{[\s\S]*proposalId: params\.id[\s\S]*decision/,
  "proposal item route should resolve the addressed proposal id",
);

console.log("project-grants route.test.ts: ok");
