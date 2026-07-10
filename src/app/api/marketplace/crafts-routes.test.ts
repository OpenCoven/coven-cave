import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const plan = readFileSync(new URL("./crafts/plan/route.ts", import.meta.url), "utf8");
const install = readFileSync(new URL("./crafts/install/route.ts", import.meta.url), "utf8");
const uninstall = readFileSync(new URL("./crafts/uninstall/route.ts", import.meta.url), "utf8");
const genericInstall = readFileSync(new URL("./install/route.ts", import.meta.url), "utf8");
const genericUninstall = readFileSync(new URL("./uninstall/route.ts", import.meta.url), "utf8");

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

assert.match(genericInstall, /kind\s*===\s*["']craft["']/, "generic track-only install refuses Crafts");
assert.match(genericUninstall, /kind\s*===\s*["']craft["']/, "generic state-only uninstall refuses Crafts");
assert.match(genericInstall, /resolveCatalogPlugin/, "generic install classifies from the generated catalog");
const catalogCraftGuard = genericInstall.indexOf('catalogPlugin.kind === "craft"');
const manifestRead = genericInstall.indexOf("pluginManifest(name)");
assert.ok(catalogCraftGuard >= 0 && catalogCraftGuard < manifestRead, "Craft classification fails closed before manifest IO");

console.log("crafts-routes.test.ts: ok");
