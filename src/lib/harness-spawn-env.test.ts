// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restoreAllowedGitHubTokenEnv, restoreGrantedVaultGitHubTokenEnv, subtractScopedVaultKeys } from "./harness-spawn-env.ts";
import { isVaultKeyGrantedTo, loadVaultMap, normalizeVaultScope, saveVaultMap } from "./vault.ts";
import { setLocalEncryptedSecret } from "./local-encrypted-vault.ts";

// ── scope normalization ───────────────────────────────────────────────────────

assert.equal(normalizeVaultScope(undefined), "shared");
assert.equal(normalizeVaultScope(null), "shared");
assert.equal(normalizeVaultScope("shared"), "shared");
assert.equal(normalizeVaultScope("  SHARED "), "shared");
assert.equal(normalizeVaultScope(""), "shared");
assert.deepEqual(normalizeVaultScope("nova"), ["nova"], "bare familiar name becomes a one-item grant list");
assert.deepEqual(normalizeVaultScope(["Nova", " sage "]), ["nova", "sage"]);
assert.deepEqual(normalizeVaultScope(["nova", 42, ""]), ["nova"], "non-string grant members are dropped");
assert.deepEqual(normalizeVaultScope([]), []);
assert.deepEqual(normalizeVaultScope({ nova: true }), [], "malformed scope fails closed (nobody granted)");
assert.deepEqual(normalizeVaultScope(7), [], "malformed scope fails closed (nobody granted)");

// ── grant checks ──────────────────────────────────────────────────────────────

assert.equal(isVaultKeyGrantedTo({ ref: "op://a/b/c" }, "nova"), true, "unscoped entry is shared");
assert.equal(isVaultKeyGrantedTo({ ref: "op://a/b/c", scope: "shared" }, undefined), true);
assert.equal(isVaultKeyGrantedTo({ scope: ["nova"] }, "nova"), true);
assert.equal(isVaultKeyGrantedTo({ scope: ["nova"] }, "NOVA"), true, "familiar id match is case-insensitive");
assert.equal(isVaultKeyGrantedTo({ scope: ["nova"] }, "sage"), false);
assert.equal(isVaultKeyGrantedTo({ scope: ["nova"] }, undefined), false, "no familiar context gets shared keys only");
assert.equal(isVaultKeyGrantedTo({ scope: ["nova"] }, "  "), false);
assert.equal(isVaultKeyGrantedTo({ scope: [] }, "nova"), false, "empty grant list grants nobody");
assert.equal(isVaultKeyGrantedTo(undefined, "nova"), true, "keys absent from the vault map are untouched");

// ── spawn-env subtraction ─────────────────────────────────────────────────────

const map = {
  SHARED_TOKEN: { ref: "op://a/b/c" },
  NOVA_ONLY: { storage: "encrypted", scope: ["nova"] },
  SAGE_ONLY: { storage: "encrypted", scope: ["sage"] },
  NOBODY: { ref: "op://a/b/d", scope: [] },
};
const baseEnv = () => ({
  PATH: "/usr/bin",
  HOME: "/Users/example",
  SHARED_TOKEN: "s",
  NOVA_ONLY: "n",
  SAGE_ONLY: "g",
  NOBODY: "x",
  UNRELATED: "keep",
});

const forNova = subtractScopedVaultKeys(baseEnv(), map, "nova");
assert.equal(forNova.SHARED_TOKEN, "s");
assert.equal(forNova.NOVA_ONLY, "n", "granted familiar keeps its scoped key");
assert.equal("SAGE_ONLY" in forNova, false, "non-granted scoped key is subtracted");
assert.equal("NOBODY" in forNova, false);
assert.equal(forNova.PATH, "/usr/bin", "denylist subtraction leaves PATH intact");
assert.equal(forNova.UNRELATED, "keep", "non-vault env vars pass through");

const forNoFamiliar = subtractScopedVaultKeys(baseEnv(), map, undefined);
assert.equal(forNoFamiliar.SHARED_TOKEN, "s");
assert.equal("NOVA_ONLY" in forNoFamiliar, false, "probes/runners/daemon get shared keys only");
assert.equal("SAGE_ONLY" in forNoFamiliar, false);

// A scoped key that was never resolved into the env stays absent — no throw.
const sparse = subtractScopedVaultKeys({ PATH: "/usr/bin" }, map, "sage");
assert.equal("NOVA_ONLY" in sparse, false);
assert.equal(sparse.PATH, "/usr/bin");

// ── scope survives a saveVaultMap → loadVaultMap round trip ──────────────────

const dir = mkdtempSync(join(tmpdir(), "vault-scope-"));
process.env.COVEN_VAULT_FILE = join(dir, "vault.yaml");
try {
  const { loadVaultMap, saveVaultMap } = await import("./vault.ts");
  saveVaultMap({
    SHARED_TOKEN: { ref: "op://a/b/c" },
    NOVA_ONLY: { storage: "encrypted", scope: ["Nova", "bad name!"] },
    NOBODY: { ref: "op://a/b/d", scope: [] },
  });
  const raw = readFileSync(process.env.COVEN_VAULT_FILE, "utf8");
  assert.match(raw, /NOVA_ONLY:[\s\S]*?scope: \["nova"\]/, "grants persist normalized to lowercase ids");
  assert.doesNotMatch(raw, /bad name!/, "grant names outside the familiar-id charset are not written");
  assert.match(raw, /NOBODY:[\s\S]*?scope: \[\]/, "an explicit empty grant list persists");
  assert.match(raw, /SHARED_TOKEN:\n  ref: "op:\/\/a\/b\/c"\n\n/, "shared stays implicit — no scope line");
  const reloaded = loadVaultMap(true);
  assert.deepEqual(reloaded.NOVA_ONLY.scope, ["nova"]);
  assert.deepEqual(reloaded.NOBODY.scope, []);
  assert.equal(reloaded.SHARED_TOKEN.scope, undefined);
} finally {
  delete process.env.COVEN_VAULT_FILE;
  rmSync(dir, { recursive: true, force: true });
}

// ── wiring: harness spawn sites subtract, none regress to covenSpawnEnv ──────

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const chatSendSource = read("../app/api/chat/send/route.ts");
assert.match(chatSendSource, /env: harnessSpawnEnv\(body\.familiarId\)/, "familiar chat spawn injects only granted keys");
assert.doesNotMatch(chatSendSource, /covenSpawnEnv/, "chat/send no longer forwards the unscoped spawn env");

const enrichSource = read("../app/api/board/enrich-steps/route.ts");
assert.match(enrichSource, /env: harnessSpawnEnv\(familiarId\)/, "enrich-steps harness spawn is familiar-scoped");
assert.doesNotMatch(enrichSource, /covenSpawnEnv/);

const automationSource = read("./server/automation-runner.ts");
assert.match(automationSource, /env: harnessSpawnEnv\(\)/, "automation runs no longer inherit the full process env");

const assistSource = read("./server/assist-runner.ts");
assert.match(assistSource, /env: harnessSpawnEnv\(\)/, "assist runs no longer inherit the full process env");

const daemonStartSource = read("./daemon-start.ts");
assert.match(daemonStartSource, /env: harnessSpawnEnv\(\)/, "the daemon is started without scoped vault secrets");
assert.doesNotMatch(daemonStartSource, /covenSpawnEnv/);

const vaultRouteSource = read("../app/api/vault/route.ts");
assert.match(vaultRouteSource, /scope: map\[key\]\?\.scope/, "/api/vault edits preserve existing grants");

const githubPatSource = read("../app/api/github/pat/route.ts");
assert.match(githubPatSource, /scope: map\[PAT_KEY\]\?\.scope/, "GitHub PAT re-save preserves existing grants");

const asanaPatSource = read("../app/api/asana/pat/route.ts");
assert.match(asanaPatSource, /scope: map\[PAT_KEY\]\?\.scope/, "Asana PAT re-save preserves existing grants");

const helperSource = read("./harness-spawn-env.ts");
assert.match(helperSource, /loadVaultMap\(true\)/, "the vault map is re-read per spawn so tightened scopes apply immediately");
assert.match(
  helperSource,
  /COVEN_HARNESS_ALLOW_ENV_KEYS/,
  "any supported harness can explicitly opt into a launcher-provided credential without making generic child processes inherit it",
);
assert.match(
  helperSource,
  /for \(const key of GITHUB_HARNESS_TOKEN_ENV_KEYS\)[\s\S]*!allowed\.has\(key\)[\s\S]*\(key === "GITHUB_PAT" && hasCaveManagedGitHubPat\(managedKeys\)\)[\s\S]*process\.env\[key\]\?\.trim\(\)/,
  "the shared opt-in restores accepted launcher aliases while retaining Cave-owned PATs",
);
assert.match(
  helperSource,
  /restoreGrantedVaultGitHubTokenEnv[\s\S]*isVaultKeyGrantedTo\(entry, familiarId\)[\s\S]*resolveVaultManagedSecret\(key, entry\)\?\.trim\(\)/,
  "a Vault-managed GitHub alias is restored only for the granted familiar after the generic child-env scrub",
);

// Generic harnesses (Codex, Hermes, OpenCode, etc.) must receive a granted
// Vault token rather than a same-named launcher variable.
const tokenDir = mkdtempSync(join(tmpdir(), "harness-github-token-"));
const tokenOriginal = {
  COVEN_VAULT_FILE: process.env.COVEN_VAULT_FILE,
  COVEN_CAVE_LOCAL_VAULT_FILE: process.env.COVEN_CAVE_LOCAL_VAULT_FILE,
  COVEN_CAVE_LOCAL_VAULT_KEY_FILE: process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE,
  COVEN_CAVE_ENV_FILE: process.env.COVEN_CAVE_ENV_FILE,
  GITHUB_PAT: process.env.GITHUB_PAT,
  GH_TOKEN: process.env.GH_TOKEN,
};
process.env.COVEN_VAULT_FILE = join(tokenDir, "vault.yaml");
process.env.COVEN_CAVE_LOCAL_VAULT_FILE = join(tokenDir, "local-vault.enc.json");
process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE = join(tokenDir, "local-vault.key");
process.env.COVEN_CAVE_ENV_FILE = join(tokenDir, ".env.local");
process.env.GITHUB_PAT = "launcher-pat";
process.env.GH_TOKEN = "launcher-token";
try {
  assert.equal(
    restoreAllowedGitHubTokenEnv({}, new Set(["GITHUB_PAT"]), new Set()).GITHUB_PAT,
    "launcher-pat",
    "an explicitly opted-in launcher GITHUB_PAT reaches every supported harness",
  );

  saveVaultMap({
    GH_TOKEN: { storage: "encrypted", scope: ["nova"] },
    GITHUB_PAT: { storage: "encrypted", scope: ["nova"] },
  });
  setLocalEncryptedSecret("GH_TOKEN", "vault-token");
  setLocalEncryptedSecret("GITHUB_PAT", "vault-pat");
  assert.equal(
    restoreGrantedVaultGitHubTokenEnv({}, loadVaultMap(true), "nova").GH_TOKEN,
    "vault-token",
    "a granted harness gets its Vault value rather than a same-named launcher token",
  );
  assert.equal(
    restoreGrantedVaultGitHubTokenEnv({}, loadVaultMap(true), "nova").GITHUB_PAT,
    "vault-pat",
    "a granted harness receives a Cave-managed GitHub PAT without exposing it to other familiars",
  );
  assert.equal(
    restoreAllowedGitHubTokenEnv({}, new Set(["GITHUB_PAT"]), new Set(Object.keys(loadVaultMap(true)))).GITHUB_PAT,
    undefined,
    "an opt-in cannot replace a Vault-managed GitHub PAT with the launcher's same-named value",
  );
} finally {
  for (const [key, value] of Object.entries(tokenOriginal)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  loadVaultMap(true);
  rmSync(tokenDir, { recursive: true, force: true });
}

console.log("harness-spawn-env.test.ts: ok");
