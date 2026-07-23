// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { subtractScopedVaultKeys } from "./harness-spawn-env.ts";
import { isVaultKeyGrantedTo, normalizeVaultScope } from "./vault.ts";

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
  /for \(const key of GITHUB_TOKEN_ENV_KEYS\)[\s\S]*if \(!allowed\.has\(key\) \|\| managedKeys\.has\(key\)\) continue;[\s\S]*process\.env\[key\]\?\.trim\(\)/,
  "the shared opt-in restores only accepted external GitHub token aliases",
);
assert.match(
  helperSource,
  /restoreGrantedVaultGitHubTokenEnv[\s\S]*isVaultKeyGrantedTo\(entry, familiarId\)[\s\S]*resolveSecret\(key\)\?\.trim\(\)/,
  "a Vault-managed GitHub alias is restored only for the granted familiar after the generic child-env scrub",
);

console.log("harness-spawn-env.test.ts: ok");
