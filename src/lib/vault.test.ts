// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateOpRef } from "./vault.ts";

assert.equal(validateOpRef("op://Personal/GitHub/token"), null);
assert.equal(validateOpRef(42), "ref must be a string");
assert.equal(validateOpRef(null), "ref must be a string");
assert.equal(validateOpRef({ ref: "op://Personal/GitHub/token" }), "ref must be a string");
assert.equal(validateOpRef("https://example.test"), "ref must start with op://");
assert.equal(validateOpRef("op://Personal/GitHub"), "ref must include vault, item, and field segments");
assert.equal(validateOpRef("op://Personal/GitHub/token;rm -rf"), "ref contains invalid characters");

const vaultSource = readFileSync(new URL("./vault.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../app/api/vault/route.ts", import.meta.url), "utf8");
const githubPatRouteSource = readFileSync(new URL("../app/api/github/pat/route.ts", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../components/vault-panel.tsx", import.meta.url), "utf8");
const marketplaceConfigureSource = readFileSync(new URL("../components/marketplace/marketplace-configure.tsx", import.meta.url), "utf8");

assert.match(vaultSource, /getLocalEncryptedSecret/, "vault resolver can load locally encrypted secrets");
assert.match(vaultSource, /"encrypted"/, "vault statuses include encrypted local storage");
assert.match(routeSource, /setLocalEncryptedSecret/, "/api/vault can save encrypted local secrets");
assert.match(routeSource, /deleteLocalEncryptedSecret/, "/api/vault deletes encrypted local secrets");
assert.doesNotMatch(routeSource, /applyEnvUpdates/, "/api/vault must not persist encrypted secrets to .env.local");
assert.match(githubPatRouteSource, /setLocalEncryptedSecret\(PAT_KEY, pat\)/, "GitHub PAT setup stores tokens in the encrypted local vault");
assert.doesNotMatch(githubPatRouteSource, /updates\[PAT_KEY\] = pat/, "GitHub PAT setup does not write tokens to .env.local");
assert.match(panelSource, /Local encrypted/, "Vault panel exposes local encrypted storage as a first-class option");
assert.match(panelSource, /type="password"/, "Vault panel uses a password input for raw local secrets");
assert.match(marketplaceConfigureSource, /storage: "encrypted", value: draft/, "Marketplace sensitive config can save raw values through the encrypted vault");

assert.match(
  vaultSource,
  /export function getVaultMetadataStatuses[\s\S]*status: "configured"[\s\S]*export function getVaultStatuses/,
  "marketplace status can inspect vault metadata without op read or secret caching",
);
assert.match(
  vaultSource,
  /export function hasConfiguredSecretMetadata[\s\S]*loadVaultMap\(\)[\s\S]*return !!entry\?\.ref/,
  "configured checks use vault metadata instead of resolving secret values",
);
assert.doesNotMatch(marketplaceConfigureSource, /enter a 1Password reference/, "Marketplace sensitive config no longer requires 1Password");

console.log("vault.test.ts: ok");
