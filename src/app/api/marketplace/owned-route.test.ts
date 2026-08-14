// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const listRoute = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const uninstallRoute = readFileSync(new URL("./uninstall/route.ts", import.meta.url), "utf8");

assert.match(
  listRoute,
  /selectOwnedMarketplacePlugins\(\s*renderableCatalog,\s*cfg\.marketplace\.installed,\s*\)/,
  "Marketplace returns only locally owned catalog/install records",
);
assert.match(
  listRoute,
  /\.\.\.drafts\.map\(\(draft\) => draft\.plugin\)[\s\S]*\.\.\.ownedCatalog/,
  "local Craft drafts stay ahead of owned catalog items",
);
assert.match(
  uninstallRoute,
  /const installedRecord = cfg\.marketplace\.installed\[id\]/,
  "uninstall validates an unlisted id against current local install state",
);
assert.match(
  uninstallRoute,
  /installedRecord\?\.(?:runtime|craftVersion)/,
  "unlisted verified Craft records cannot fall through track-only removal",
);
assert.match(
  uninstallRoute,
  /if \(!plugin && !installedRecord\)/,
  "arbitrary ids remain rejected",
);

console.log("marketplace owned-route.test.ts: ok");
