// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vaultModule from "./vault.ts";
import { setLocalEncryptedSecret } from "../local-encrypted-vault.ts";
import {
  canMirrorVaultKeyToProcessEnv,
  clearMirroredVaultSecretFromProcessEnv,
  mirrorVaultSecretToProcessEnv,
  validateOpRef,
} from "./vault.ts";
import {
  parseVaultPaste,
  vaultStorageForValue,
} from "./vault-storage.ts";

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
assert.equal(vaultStorageForValue("op://Personal/GitHub/token"), "1password");
assert.equal(vaultStorageForValue("dl://GitHub PAT/token"), "dashlane");
assert.equal(vaultStorageForValue("plain-secret"), "encrypted");
assert.deepEqual(
  parseVaultPaste("raw", "github pat").entries,
  [{ key: "GITHUB_PAT", storage: "encrypted", value: "raw" }],
  "raw paste uses the normalized fallback key and encrypted storage",
);
assert.deepEqual(
  parseVaultPaste("line one\nline two", "multiline secret").entries,
  [{ key: "MULTILINE_SECRET", storage: "encrypted", value: "line one\nline two" }],
  "multiline raw values remain one encrypted secret when no assignments are present",
);
assert.deepEqual(
  parseVaultPaste(
    "OPENAI_API_KEY='openai'\nexport GITHUB_PAT=op://Personal/GitHub/token\nDASHLANE_TOKEN=dl://GitHub PAT/token",
  ).entries,
  [
    { key: "OPENAI_API_KEY", storage: "encrypted", value: "openai" },
    { key: "GITHUB_PAT", storage: "1password", ref: "op://Personal/GitHub/token" },
    { key: "DASHLANE_TOKEN", storage: "dashlane", ref: "dl://GitHub PAT/token" },
  ],
  "multiline .env paste detects encrypted values and both reference providers",
);
assert.match(
  parseVaultPaste("TOKEN=one\nTOKEN=two").error ?? "",
  /appears more than once/,
  "bulk paste rejects duplicate normalized keys",
);

for (const key of [
  "NODE_OPTIONS",
  "node_options",
  " Npm_Config_Node_Options ",
  "PATH",
  "Shell",
  "coven_bin",
  "Coven_Vault_File",
  "COVEN_CAVE_AUTH_TOKEN",
  "__NEXT_PRIVATE_INTERNAL",
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
  mirrorVaultSecretToProcessEnv(
    "COVEN_TEST_SAFE_SECRET",
    "vault-value",
    { source: "vault", storage: "encrypted" },
  );
  assert.equal(
    clearMirroredVaultSecretFromProcessEnv("COVEN_TEST_SAFE_SECRET"),
    true,
    "Vault-owned process values can be cleared safely",
  );
  process.env.COVEN_TEST_SAFE_SECRET = "owned";
  assert.equal(
    clearMirroredVaultSecretFromProcessEnv("COVEN_TEST_SAFE_SECRET"),
    false,
    "external process values are never deleted without matching Vault provenance",
  );
  assert.equal(process.env.COVEN_TEST_SAFE_SECRET, "owned");
} finally {
  if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
  else process.env.NODE_OPTIONS = previousNodeOptions;
  if (previousSafeSecret === undefined) delete process.env.COVEN_TEST_SAFE_SECRET;
  else process.env.COVEN_TEST_SAFE_SECRET = previousSafeSecret;
}

const vaultSource = readFileSync(new URL("./vault.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../../app/api/vault/route.ts", import.meta.url), "utf8");
const githubPatRouteSource = readFileSync(new URL("../../app/api/github/pat/route.ts", import.meta.url), "utf8");
const asanaPatRouteSource = readFileSync(new URL("../../app/api/asana/pat/route.ts", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../../components/vault-panel.tsx", import.meta.url), "utf8");
const marketplaceConfigureSource = readFileSync(new URL("../../components/marketplace/marketplace-configure.tsx", import.meta.url), "utf8");
const themesSource = readFileSync(new URL("../../styles/globals/themes.css", import.meta.url), "utf8");
const panelStylesSource = readFileSync(new URL("../../styles/vault-panel.css", import.meta.url), "utf8");

assert.match(vaultSource, /getLocalEncryptedSecret/, "vault resolver can load locally encrypted secrets");
assert.match(vaultSource, /"encrypted"/, "vault statuses include encrypted local storage");
assert.match(
  routeSource,
  /commitLocalEncryptedSecretBatch[\s\S]*saveVaultMap\(nextMap\)[\s\S]*saveVaultMap\(previousMap\)/,
  "/api/vault commits encrypted batches with metadata rollback",
);
assert.match(
  routeSource,
  /loadVaultMapForMutation/,
  "/api/vault refuses to overwrite corrupt Vault metadata",
);
assert.match(
  routeSource,
  /export async function PATCH[\s\S]*?action === "grant"[\s\S]*?grantVaultScope[\s\S]*?revokeVaultScope/,
  "/api/vault updates one familiar grant without rewriting the secret mapping",
);
assert.match(
  routeSource,
  /clearMirroredVaultSecretFromProcessEnv\(item\.key\)[\s\S]*?mirrorVaultSecretToProcessEnv\(item\.key, item\.secret/,
  "/api/vault routes encrypted values through the process-env safety gate",
);
assert.match(routeSource, /Array\.isArray\(body\.entries\)/, "/api/vault accepts validated batch intake");
assert.match(routeSource, /storage === "environment"/, "/api/vault supports metadata-only environment mappings");
assert.doesNotMatch(routeSource, /applyEnvUpdates/, "/api/vault must not persist encrypted secrets to .env.local");
assert.match(
  githubPatRouteSource,
  /loadVaultMapForMutation[\s\S]*commitLocalEncryptedSecretBatch/,
  "GitHub PAT setup validates metadata before transactionally storing tokens",
);
assert.match(
  asanaPatRouteSource,
  /loadVaultMapForMutation[\s\S]*commitLocalEncryptedSecretBatch/,
  "Asana PAT setup validates metadata before transactionally storing tokens",
);
assert.doesNotMatch(githubPatRouteSource, /updates\[PAT_KEY\] = pat/, "GitHub PAT setup does not write tokens to .env.local");
assert.match(panelSource, /Local encrypted/, "Vault panel exposes local encrypted storage as a first-class option");
assert.match(panelSource, /parseVaultPaste/, "Vault panel uses the shared smart-paste parser");
assert.match(panelSource, /navigator\.clipboard\.readText/, "Vault panel supports direct clipboard intake");
assert.match(panelSource, /Detected \{pasteResult\.entries\.length\} entries/, "Vault panel previews bulk .env intake");
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
  themesSource,
  /\.vault-row--warn\s*\{\s*border-color:\s*color-mix\(in oklch,\s*var\(--color-warning\)\s+35%,\s*transparent\);\s*\}/,
  "Vault warning rows use the warning token",
);
assert.match(
  panelStylesSource,
  /\.vault-status-badge--unresolved\s*\{[^}]*var\(--color-warning\)/,
  "Vault unresolved status uses the warning token",
);
assert.match(
  panelStylesSource,
  /\.vault-status-badge--error\s*\{[^}]*var\(--color-danger\)/,
  "Vault error status keeps the danger token",
);
assert.match(
  themesSource,
  /\.vault-row-error\s*\{[^}]*color:\s*var\(--color-danger\)/,
  "Vault row errors keep the danger token",
);
assert.match(marketplaceConfigureSource, /storage: "encrypted", value: draft/, "Marketplace sensitive config can save raw values through the encrypted vault");
assert.match(marketplaceConfigureSource, /vaultStorageForValue\(draft\)/, "Marketplace sensitive config shares provider detection with the Vault");

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

const statusRoot = mkdtempSync(join(tmpdir(), "cave-vault-status-"));
const statusOriginal = {
  COVEN_VAULT_FILE: process.env.COVEN_VAULT_FILE,
  COVEN_CAVE_LOCAL_VAULT_FILE: process.env.COVEN_CAVE_LOCAL_VAULT_FILE,
  COVEN_CAVE_LOCAL_VAULT_KEY_FILE: process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE,
  COVEN_STATUS_ENV: process.env.COVEN_STATUS_ENV,
  COVEN_STATUS_STORED: process.env.COVEN_STATUS_STORED,
  COVEN_STATUS_REF: process.env.COVEN_STATUS_REF,
  COVEN_STATUS_CACHE: process.env.COVEN_STATUS_CACHE,
  COVEN_STATUS_EXTERNAL: process.env.COVEN_STATUS_EXTERNAL,
};
const restoreStatusEnv = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};
try {
  process.env.COVEN_VAULT_FILE = join(statusRoot, "vault.yaml");
  process.env.COVEN_CAVE_LOCAL_VAULT_FILE = join(statusRoot, "local-vault.enc.json");
  process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE = join(statusRoot, "local-vault.key");
  process.env.COVEN_STATUS_ENV = "launcher-value";
  vaultModule.saveVaultMap({
    COVEN_STATUS_ENV: { storage: "environment" },
    COVEN_STATUS_STORED: { storage: "encrypted" },
    COVEN_STATUS_MISSING: { storage: "encrypted" },
    COVEN_STATUS_REF: { ref: "op://Personal/Test/token" },
    COVEN_STATUS_CACHE: { storage: "encrypted" },
    COVEN_STATUS_EXTERNAL: { storage: "encrypted" },
  });
  setLocalEncryptedSecret("COVEN_STATUS_STORED", "stored-value");
  setLocalEncryptedSecret("COVEN_STATUS_CACHE", "cached-value");
  mirrorVaultSecretToProcessEnv(
    "COVEN_STATUS_CACHE",
    "cached-value\n",
    { source: "vault", storage: "encrypted" },
  );
  setLocalEncryptedSecret("COVEN_STATUS_CACHE", "updated-value");
  assert.equal(
    vaultModule.resolveCachedVaultManagedSecret("COVEN_STATUS_CACHE"),
    "cached-value",
    "Vault-owned cache provenance survives trailing newlines while consumers receive a trimmed value",
  );
  assert.equal(
    process.env.COVEN_STATUS_CACHE,
    "cached-value\n",
    "provenance checks do not rewrite the exact mirrored process value",
  );
  process.env.COVEN_STATUS_EXTERNAL = "launcher-owned";
  setLocalEncryptedSecret("COVEN_STATUS_EXTERNAL", "vault-owned");
  assert.equal(
    vaultModule.resolveCachedVaultManagedSecret("COVEN_STATUS_EXTERNAL"),
    "vault-owned",
  );
  assert.equal(
    process.env.COVEN_STATUS_EXTERNAL,
    "launcher-owned",
    "Vault caching never overwrites an externally owned process value",
  );
  mirrorVaultSecretToProcessEnv(
    "COVEN_STATUS_STORED",
    "stored-value",
    { source: "vault", storage: "encrypted" },
  );
  mirrorVaultSecretToProcessEnv(
    "COVEN_STATUS_REF",
    "resolved-value",
    { source: "vault", storage: "1password" },
  );
  const statuses = Object.fromEntries(
    vaultModule.getVaultMetadataStatuses().map((status) => [status.key, status]),
  );
  assert.equal(statuses.COVEN_STATUS_ENV.status, "env-only");
  assert.equal(statuses.COVEN_STATUS_STORED.status, "encrypted");
  assert.equal(statuses.COVEN_STATUS_STORED.hasValue, true);
  assert.equal(statuses.COVEN_STATUS_MISSING.status, "unresolved");
  assert.equal(statuses.COVEN_STATUS_MISSING.hasValue, false);
  assert.equal(statuses.COVEN_STATUS_REF.status, "resolved");
  assert.equal(statuses.COVEN_STATUS_REF.hasValue, true);
  assert.equal(
    statuses.COVEN_STATUS_CACHE.status,
    "encrypted",
    "metadata status keeps newline-terminated mirrored values Vault-owned",
  );
  assert.equal(
    Object.fromEntries(
      vaultModule.getVaultStatuses().map((status) => [status.key, status]),
    ).COVEN_STATUS_CACHE.status,
    "encrypted",
    "materializing status keeps newline-terminated mirrored values Vault-owned",
  );

  writeFileSync(process.env.COVEN_CAVE_LOCAL_VAULT_FILE, "{not valid json");
  const corrupt = Object.fromEntries(
    vaultModule.getVaultMetadataStatuses().map((status) => [status.key, status]),
  );
  assert.equal(corrupt.COVEN_STATUS_STORED.status, "error");
  assert.equal(corrupt.COVEN_STATUS_STORED.hasValue, false);

  const invalidMetadata = "BROKEN: [\n";
  writeFileSync(process.env.COVEN_VAULT_FILE, invalidMetadata);
  assert.throws(
    () => vaultModule.loadVaultMapForMutation(),
    /Vault metadata is invalid/,
    "mutations fail closed when vault.yaml cannot be parsed",
  );
  assert.equal(
    readFileSync(process.env.COVEN_VAULT_FILE, "utf8"),
    invalidMetadata,
    "failed strict loading preserves corrupt Vault metadata for recovery",
  );
} finally {
  for (const [key, value] of Object.entries(statusOriginal)) {
    restoreStatusEnv(key, value);
  }
  vaultModule.loadVaultMap(true);
  rmSync(statusRoot, { recursive: true, force: true });
}

console.log("vault.test.ts: ok");
