// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const listRoute = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const itemRoute = await readFile(new URL("./[id]/route.ts", import.meta.url), "utf8");
const shared = await readFile(new URL("./access-groups-route-shared.ts", import.meta.url), "utf8");
const permissions = await readFile(
  new URL("../../../lib/project-permissions.ts", import.meta.url),
  "utf8",
);

assert.match(
  permissions,
  /export async function createAccessGroup\(/,
  "permission core should expose access-group creation",
);
assert.match(
  permissions,
  /export async function updateAccessGroup\(/,
  "permission core should expose access-group updates",
);
assert.match(
  permissions,
  /export async function deleteAccessGroup\(/,
  "permission core should expose access-group deletion",
);

assert.match(listRoute, /export async function GET\(/, "access groups route should list groups");
assert.match(listRoute, /export async function POST\(/, "access groups route should create groups");
assert.match(itemRoute, /export async function PATCH\(/, "access group item route should update groups");
assert.match(itemRoute, /export async function DELETE\(/, "access group item route should delete groups");

for (const [name, source] of [["list", listRoute], ["item", itemRoute]]) {
  assert.match(
    source,
    /rejectRelayedApproval\(payload\)/,
    `${name} route mutations should reject actor/relayed-human fields — a group grant is a real grant to every member`,
  );
  assert.match(
    source,
    /payload\.familiarId != null[\s\S]*payload\.proposedBy != null[\s\S]*payload\.claimedHumanApproval === true/,
    `${name} route relayed-approval guard should reject familiar identity and relayed approval claims`,
  );
  assert.match(
    source,
    /requireLocalHumanGrantMutation\(req\)/,
    `${name} route mutations should require a local human request, mirroring direct project grants (PR #3306)`,
  );
}
assert.match(
  shared,
  /export function requireLocalHumanGrantMutation\(req: Request\)[\s\S]*isLocalOrigin\(req\)/,
  "the shared local-origin gate should delegate to the centralized isLocalOrigin guard",
);
const listMutations = listRoute.match(/export async function POST\(/g) ?? [];
const itemMutations = itemRoute.match(/export async function (PATCH|DELETE)\(/g) ?? [];
const listGates = listRoute.match(/requireLocalHumanGrantMutation\(req\)/g) ?? [];
const itemGates = itemRoute.match(/requireLocalHumanGrantMutation\(req\)/g) ?? [];
assert.equal(
  listGates.length,
  listMutations.length,
  "every list-route mutation handler should carry the local-origin gate",
);
assert.equal(
  itemGates.length,
  itemMutations.length,
  "every item-route mutation handler should carry the local-origin gate",
);
assert.doesNotMatch(
  listRoute.split("export async function GET")[1].split("export async function")[0],
  /requireLocalHumanGrantMutation/,
  "GET must stay ungated — mobile clients legitimately read access groups",
);
assert.match(
  shared,
  /access !== "read" && access !== "write"/,
  "group project grants should only accept read|write levels",
);

assert.match(
  itemRoute,
  /updateAccessGroup\(\{[\s\S]*groupId: params\.id/,
  "PATCH should update the addressed group id",
);
assert.match(
  itemRoute,
  /deleteAccessGroup\(params\.id\)/,
  "DELETE should delete the addressed group id",
);

console.log("access-groups route.test.ts: ok");
