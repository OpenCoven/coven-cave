import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const roles = await readFile(new URL("./route.ts", import.meta.url), "utf8");
assert.match(roles, /crafts:\s*string\[\]/, "Roles response keeps the canonical attached Craft ids");
assert.match(roles, /craftStates:\s*RoleCraftState\[\]/, "Roles response explains missing, stale, and ready Crafts");
assert.match(roles, /effective:\s*RoleEffectiveComposition/, "Roles response exposes origin-labelled effective capabilities");
assert.match(roles, /const crafts = parseRoleListField\(text, "crafts"\)/, "ROLE.md crafts list is canonical");
assert.match(roles, /\n\s*crafts,\n/, "canonical Craft ids are returned unchanged");
assert.match(roles, /roleCraftService\.resolve\(/, "effective composition uses the shared Craft resolver");
for (const field of ["skills", "tools", "mcpServers", "plugins", "workflows"]) {
  assert.match(roles, new RegExp(`${field}:\\s*direct\\.${field}`), `${field} stays the unchanged direct array`);
}

const routeUrl = new URL("./crafts/route.ts", import.meta.url);
assert.equal(existsSync(routeUrl), true, "Role Craft attachment route exists");
const route = await readFile(routeUrl, "utf8");
assert.match(route, /rejectNonLocalRequest\(req\)/, "attachment is local-origin guarded");
assert.match(route, /readJsonBody<[^>]+>\(req, MAX_BODY_BYTES\)/, "attachment uses bounded JSON parsing");
assert.match(route, /roleCraftService\.attach\(/, "attachment route delegates to the shared service");
assert.match(route, /roleCraftServiceStatus\(error\.code\)/, "structured service errors retain stable statuses");

const contracts = await readFile(new URL("../api-contracts.test.ts", import.meta.url), "utf8");
assert.match(
  contracts,
  /\{ route: "\/roles\/crafts", methods: \["POST"\], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true \},\n\s*\{ route: "\/roles\/workflows"/,
  "Role Craft route is registered alphabetically before workflows",
);

console.log("roles/crafts route.test.ts: ok");
