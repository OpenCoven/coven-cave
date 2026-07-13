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
}
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
