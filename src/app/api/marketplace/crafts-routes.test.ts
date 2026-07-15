import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const plan = readFileSync(new URL("./crafts/plan/route.ts", import.meta.url), "utf8");
const drafts = readFileSync(new URL("./crafts/drafts/route.ts", import.meta.url), "utf8");
const install = readFileSync(new URL("./crafts/install/route.ts", import.meta.url), "utf8");
const uninstall = readFileSync(new URL("./crafts/uninstall/route.ts", import.meta.url), "utf8");
const genericInstall = readFileSync(new URL("./install/route.ts", import.meta.url), "utf8");
const genericUninstall = readFileSync(new URL("./uninstall/route.ts", import.meta.url), "utf8");
const craftService = readFileSync(new URL("../../../lib/server/craft-install-service.ts", import.meta.url), "utf8");
const roleCraftService = readFileSync(new URL("../../../lib/server/role-crafts.ts", import.meta.url), "utf8");

assert.match(plan, /export async function GET/);
assert.match(plan, /craftInstallService\.plan\(id\)/);
assert.doesNotMatch(plan, /rejectNonLocalRequest/, "read-only plan remains available without a local-origin gate");

for (const [name, source, method] of [
  ["install", install, "install"],
  ["uninstall", uninstall, "uninstall"],
] as const) {
  assert.match(source, /export async function POST/);
  assert.match(source, /rejectNonLocalRequest\(req\)/, `${name} is local-origin guarded`);
  assert.match(source, /readJsonBody/, `${name} uses the bounded JSON-body helper`);
  assert.match(source, new RegExp(`craftInstallService\\.${method}\\(id\\)`));
  assert.match(source, /CraftTransactionError/, `${name} returns structured transaction diagnostics`);
}

assert.match(drafts, /export async function GET/);
assert.match(drafts, /export async function POST/);
assert.match(drafts, /export async function DELETE/);
for (const handler of drafts.split("export async function").slice(1)) {
  assert.match(handler, /rejectNonLocalRequest\(req\)/, "every drafts handler is local-origin guarded");
}
assert.match(drafts, /isValidCraftDraftId\(id\)/, "draft deletion slug-guards the id before any path is built");
assert.match(drafts, /deleteCraftDraft/, "draft deletion goes through the guarded store helper");
assert.match(drafts, /readJsonBody/, "draft creation uses the bounded JSON-body helper");
assert.match(drafts, /familiar and roleIds required/, "draft creation validates familiar + roleIds");
assert.match(drafts, /role\.familiar === familiar/, "draft roles are scoped to the requested familiar");
assert.match(drafts, /buildCraftDraftFromRoles/, "drafts are built through the shared role-composition builder");
assert.match(drafts, /displayName\.trim\(\)\.slice\(0, 120\)/, "the optional operator rename is trimmed and bounded");

assert.match(genericInstall, /kind\s*===\s*["']craft["']/, "generic track-only install refuses Crafts");
assert.match(genericUninstall, /kind\s*===\s*["']craft["']/, "generic state-only uninstall refuses Crafts");
assert.match(genericInstall, /resolveCatalogPlugin/, "generic install classifies from the generated catalog");
const catalogCraftGuard = genericInstall.indexOf('catalogPlugin.kind === "craft"');
const manifestRead = genericInstall.indexOf("pluginManifest(name)");
assert.ok(catalogCraftGuard >= 0 && catalogCraftGuard < manifestRead, "Craft classification fails closed before manifest IO");
assert.match(craftService, /roleCraftService\.attachments\(definition\.id\)/, "default uninstall checks Role attachments");
assert.match(craftService, /beforeUninstall:/, "Role check runs inside the Craft uninstall transaction lock");
assert.match(craftService, /"craft_equipped"/, "equipped removal has a stable structured error code");
assert.match(craftService, /affectedRoles/, "equipped removal returns the affected Roles for detach-first UI");
assert.match(craftService, /withTransaction: withCraftTransaction/, "install and remove use the shared per-Craft transaction lock");
assert.match(roleCraftService, /withCraftTransaction/, "Role equip and detach use the same per-Craft transaction lock");
assert.match(craftService, /craftAffectedRoleDiagnostic\(affectedRoles\)/, "affected Role diagnostics are bounded and redacted before reaching the API");

console.log("crafts-routes.test.ts: ok");
