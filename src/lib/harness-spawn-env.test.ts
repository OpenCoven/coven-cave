// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalProbeSpawnEnv,
  restoreAllowedGitHubTokenEnv,
  restoreGrantedVaultGitHubTokenEnv,
  subtractScopedVaultKeys,
  vaultFreeDiscoveryEnv,
} from "./harness-spawn-env.ts";
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

{
  const sourceEnv = baseEnv();
  const sourceSnapshot = { ...sourceEnv };
  const discoveryEnv = vaultFreeDiscoveryEnv(sourceEnv, map);
  assert.deepEqual(
    discoveryEnv,
    {
      PATH: "/usr/bin",
      HOME: "/Users/example",
      UNRELATED: "keep",
    },
    "discovery removes every shared and familiar-scoped vault key while preserving ordinary env",
  );
  assert.notEqual(discoveryEnv, sourceEnv, "discovery returns a scrubbed copy");
  assert.deepEqual(sourceEnv, sourceSnapshot, "discovery does not mutate its source env");
}

{
  const windowsSource = {
    Path: "C:\\Windows\\System32",
    OpenAI_Api_Key: "vault-secret",
    cOvEn_CaVe_AuTh_ToKeN: "sidecar-secret",
    gItHuB_tOkEn: "github-secret",
    Ordinary_Value: "keep",
  };
  const windowsSnapshot = { ...windowsSource };
  assert.deepEqual(
    vaultFreeDiscoveryEnv(
      windowsSource,
      { OPENAI_API_KEY: { ref: "op://a/b/c" } },
      "win32",
    ),
    {
      Path: "C:\\Windows\\System32",
      Ordinary_Value: "keep",
    },
    "Windows discovery compares Vault, sidecar, and forbidden aliases case-insensitively",
  );
  assert.deepEqual(
    windowsSource,
    windowsSnapshot,
    "Windows case-insensitive discovery still leaves its source untouched",
  );
}

for (const platform of ["linux", "darwin"]) {
  const posixSource = {
    PATH: "/usr/bin",
    OpenAI_Api_Key: "differently-cased-vault-name",
    Coven_Cave_Auth_Token: "differently-cased-sidecar-name",
    Github_Token: "differently-cased-github-name",
    Ordinary_Value: "keep",
  };
  assert.deepEqual(
    vaultFreeDiscoveryEnv(
      posixSource,
      { OPENAI_API_KEY: { ref: "op://a/b/c" } },
      platform,
    ),
    posixSource,
    `${platform} discovery keeps differently-cased env names`,
  );
}

{
  let mapLoads = 0;
  let discoveryCalls = 0;
  const probeSource = {
    PATH: "/launch-path",
    SHARED_TOKEN: "shared-secret",
    NOVA_ONLY: "scoped-secret",
    COVEN_CAVE_AUTH_TOKEN: "sidecar-secret",
    UNRELATED: "keep",
  };
  const probeEnv = canonicalProbeSpawnEnv(
    { discoveryDeadline: 2_500, now: () => 1_000 },
    {
      sourceEnv: probeSource,
      loadMap: () => {
        mapLoads += 1;
        return map;
      },
      spawnEnv: (options) => {
        discoveryCalls += 1;
        assert.equal(options.discoveryDeadline, 2_500);
        assert.equal(options.discoveryEnv?.SHARED_TOKEN, undefined);
        assert.equal(options.discoveryEnv?.NOVA_ONLY, undefined);
        assert.equal(options.discoveryEnv?.COVEN_CAVE_AUTH_TOKEN, undefined);
        assert.equal(options.discoveryEnv?.PATH, "/launch-path");
        return {
          ...probeSource,
          PATH: "/canonical-path",
        };
      },
    },
  );
  assert.equal(mapLoads, 1, "the probe uses one Vault-map snapshot for discovery and final scrub");
  assert.equal(discoveryCalls, 1);
  assert.deepEqual(
    probeEnv,
    {
      PATH: "/canonical-path",
      UNRELATED: "keep",
    },
    "the probe preserves canonical PATH and unrelated values while stripping every mapped/sidecar key",
  );
}

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

// The one-shot spawn moved into a shared runner when the reader's Rewrite
// control needed it too (cave-xailn). Asserted end to end: the runner scopes
// the env by familiar, and every caller hands it a familiar id — a runner that
// scopes correctly is worthless if a caller passes nothing.
const oneShotSource = read("./server/coven-oneshot.ts");
assert.match(
  oneShotSource,
  /env: covenWrapperSpawnEnv\(harnessSpawnEnv\(familiarId\)\)/,
  "one-shot Coven wrapper spawn stays familiar-scoped and opts into hidden native launch",
);
assert.doesNotMatch(oneShotSource, /covenSpawnEnv/);

const enrichSource = read("../app/api/board/enrich-steps/route.ts");
assert.match(
  enrichSource,
  /runCovenOneShot\(args, req\.signal, workspace, familiarId\)/,
  "enrich-steps runs through the shared runner with its familiar id",
);
assert.doesNotMatch(enrichSource, /covenSpawnEnv/);

const rewriteSource = read("../app/api/chat/rewrite/route.ts");
assert.match(
  rewriteSource,
  /runCovenOneShot\(args, req\.signal, workspace, familiarId\)/,
  "reader rewrite runs through the shared runner with its familiar id",
);
const rewritePermissionIndex = rewriteSource.search(/['"]--permission['"]\s*,\s*['"]read-only['"]/);
const rewriteSeparatorIndex = rewriteSource.search(/['"]--['"]\s*,/);
assert.notEqual(
  rewritePermissionIndex,
  -1,
  "reader rewrite includes a read-only permission flag in the harness args",
);
assert.notEqual(
  rewriteSeparatorIndex,
  -1,
  "reader rewrite includes the prompt separator in the harness args",
);
assert.ok(
  rewritePermissionIndex < rewriteSeparatorIndex,
  "reader rewrite constrains untrusted answer text to a read-only harness run",
);
assert.doesNotMatch(rewriteSource, /covenSpawnEnv/);

const automationSource = read("./server/automation-runner.ts");
assert.match(
  automationSource,
  /env: codexManagedPackageSpawnEnv\(\s*dependencies\.env \?\? harnessSpawnEnv\(\),\s*invocation\.managedPackage/,
  "automation runs keep the scoped harness env while adding only the validated Codex package contract",
);

const assistSource = read("./server/assist-runner.ts");
assert.match(assistSource, /env: harnessSpawnEnv\(\)/, "assist runs no longer inherit the full process env");

const daemonStartSource = read("./daemon-start.ts");
assert.match(
  daemonStartSource,
  /spawnEnvironment = harnessSpawnEnv[\s\S]*?const spawnEnv = spawnEnvironment\(\);[\s\S]*?env: covenWrapperSpawnEnv\(\{\s*\.\.\.spawnEnv,[\s\S]*?COVEN_CAVE_CORRELATION_ID/,
  "the daemon keeps its scoped environment seam, adds only diagnostics, and opts the Coven wrapper into hidden launch",
);
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
{
  const helperStart = helperSource.indexOf("export function canonicalProbeSpawnEnv");
  const helperEnd = helperSource.indexOf("/**\n * `covenSpawnEnv()` minus scoped", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "the canonical probe helper is present");
  const probeHelperSource = helperSource.slice(helperStart, helperEnd);
  assert.doesNotMatch(
    probeHelperSource,
    /restoreGrantedVaultGitHubTokenEnv|restoreAllowedGitHubTokenEnv|resolveVaultManagedSecret/,
    "probe environment construction never restores or materializes familiar/shared credentials",
  );
}

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
