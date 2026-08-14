// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as vaultModule from "./vault.ts";
import {
  canMirrorVaultKeyToProcessEnv,
  mirrorVaultSecretToProcessEnv,
  validateOpRef,
} from "./vault.ts";

assert.equal(
  typeof vaultModule.grantVaultScope,
  "function",
  "vault scopes expose a grant helper",
);
assert.equal(
  typeof vaultModule.revokeVaultScope,
  "function",
  "vault scopes expose a revoke helper",
);
assert.deepEqual(
  vaultModule.grantVaultScope(["sage"], "Nova"),
  ["sage", "nova"],
  "granting normalizes and appends a familiar without widening the key to shared",
);
assert.deepEqual(
  vaultModule.grantVaultScope(["sage", "nova"], "NOVA"),
  ["sage", "nova"],
  "granting is idempotent",
);
assert.deepEqual(
  vaultModule.revokeVaultScope(["sage", "nova"], "NOVA"),
  ["sage"],
  "revoking removes only the selected familiar",
);
assert.equal(
  vaultModule.revokeVaultScope("shared", "nova"),
  "shared",
  "a per-familiar action cannot narrow a globally shared key",
);

assert.equal(validateOpRef("op://Personal/GitHub/token"), null);
assert.equal(validateOpRef(42), "ref must be a string");
assert.equal(validateOpRef(null), "ref must be a string");
assert.equal(validateOpRef({ ref: "op://Personal/GitHub/token" }), "ref must be a string");
assert.equal(validateOpRef("https://example.test"), "ref must start with op://");
assert.equal(validateOpRef("op://Personal/GitHub"), "ref must include vault, item, and field segments");
assert.equal(validateOpRef("op://Personal/GitHub/token;rm -rf"), "ref contains invalid characters");

for (const key of [
  "NODE_OPTIONS",
  "node_options",
  " Npm_Config_Node_Options ",
  "PATH",
  "Shell",
  "coven_bin",
  "Coven_Vault_File",
]) {
  assert.equal(
    canMirrorVaultKeyToProcessEnv(key),
    false,
    `${key} cannot be mirrored into process.env`,
  );
}
assert.equal(
  canMirrorVaultKeyToProcessEnv("GITHUB_PERSONAL_ACCESS_TOKEN"),
  true,
  "ordinary plugin secrets can still be cached in the server process",
);

const previousNodeOptions = process.env.NODE_OPTIONS;
const previousSafeSecret = process.env.COVEN_TEST_SAFE_SECRET;
try {
  delete process.env.NODE_OPTIONS;
  assert.equal(
    mirrorVaultSecretToProcessEnv("Node_Options", "--require=attacker.cjs"),
    false,
    "mixed-case runtime-control keys are rejected before assignment",
  );
  assert.equal(process.env.Node_Options, undefined);
  assert.equal(process.env.NODE_OPTIONS, undefined);

  assert.equal(
    mirrorVaultSecretToProcessEnv("COVEN_TEST_SAFE_SECRET", "safe-value"),
    true,
    "safe vault keys remain cacheable",
  );
  assert.equal(process.env.COVEN_TEST_SAFE_SECRET, "safe-value");
} finally {
  if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
  else process.env.NODE_OPTIONS = previousNodeOptions;
  if (previousSafeSecret === undefined) delete process.env.COVEN_TEST_SAFE_SECRET;
  else process.env.COVEN_TEST_SAFE_SECRET = previousSafeSecret;
}

const vaultSource = readFileSync(new URL("./vault.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../app/api/vault/route.ts", import.meta.url), "utf8");
const githubPatRouteSource = readFileSync(new URL("../app/api/github/pat/route.ts", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../components/vault-panel.tsx", import.meta.url), "utf8");
const marketplaceConfigureSource = readFileSync(new URL("../components/marketplace/marketplace-configure.tsx", import.meta.url), "utf8");
const themesSource = readFileSync(new URL("../styles/globals/themes.css", import.meta.url), "utf8");

assert.match(vaultSource, /getLocalEncryptedSecret/, "vault resolver can load locally encrypted secrets");
assert.match(vaultSource, /"encrypted"/, "vault statuses include encrypted local storage");
assert.match(routeSource, /setLocalEncryptedSecret/, "/api/vault can save encrypted local secrets");
assert.match(routeSource, /deleteLocalEncryptedSecret/, "/api/vault deletes encrypted local secrets");
assert.match(
  routeSource,
  /export async function PATCH[\s\S]*?action === "grant"[\s\S]*?grantVaultScope[\s\S]*?revokeVaultScope/,
  "/api/vault updates one familiar grant without rewriting the secret mapping",
);
assert.match(
  routeSource,
  /mirrorVaultSecretToProcessEnv\(key, body\.value, \{ source: "vault", storage: "encrypted" \}\)/,
  "/api/vault routes encrypted values through the process-env safety gate",
);
assert.doesNotMatch(routeSource, /applyEnvUpdates/, "/api/vault must not persist encrypted secrets to .env.local");
assert.match(githubPatRouteSource, /setLocalEncryptedSecret\(PAT_KEY, pat\)/, "GitHub PAT setup stores tokens in the encrypted local vault");
assert.doesNotMatch(githubPatRouteSource, /updates\[PAT_KEY\] = pat/, "GitHub PAT setup does not write tokens to .env.local");
assert.match(panelSource, /Local encrypted/, "Vault panel exposes local encrypted storage as a first-class option");
assert.match(panelSource, /type="password"/, "Vault panel uses a password input for raw local secrets");
assert.match(
  panelSource,
  /method: "PATCH"[\s\S]*?action: granted \? "revoke" : "grant"/,
  "Familiar Vault rows grant or revoke scope through the non-destructive API",
);
assert.match(
  panelSource,
  /familiarId \?[\s\S]*?updateFamiliarGrant[\s\S]*?:[\s\S]*?handleDelete/,
  "The scoped Vault action cannot call the global delete path",
);
assert.match(
  panelSource,
  /unresolved:\s*\{[^}]*color:\s*"var\(--color-warning\)"[^}]*icon:\s*"ph:warning"/,
  "Vault unresolved status uses the warning token",
);
assert.match(
  panelSource,
  /error:\s*\{[^}]*color:\s*"var\(--color-danger\)"/,
  "Vault error status keeps the danger token",
);
assert.match(
  themesSource,
  /\.vault-row--warn\s*\{\s*border-color:\s*color-mix\(in oklch,\s*var\(--color-warning\)\s+35%,\s*transparent\);\s*\}/,
  "Vault warning rows use the warning token",
);
assert.match(
  themesSource,
  /\.vault-row-error\s*\{[^}]*color:\s*var\(--color-danger\)/,
  "Vault row errors keep the danger token",
);
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
