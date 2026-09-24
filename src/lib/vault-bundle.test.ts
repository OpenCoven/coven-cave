import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, mock, test } from "node:test";
import { setLocalEncryptedSecret } from "./local-encrypted-vault.ts";
import {
  getSecretStatus,
  getVaultMetadataStatuses,
  getVaultStatuses,
  hasConfiguredSecretMetadata,
  loadVaultMap,
  loadVaultMapForMutation,
  mirrorVaultSecretToProcessEnv,
  resolveSecret,
  resolveCachedVaultManagedSecret,
  resolveVaultManagedSecret,
  saveVaultMap,
} from "./vault.ts";

// Real bundle/user path selection and persistence; only the external password
// manager process is replaced. Tests must never unlock a real vault.
const originalCwd = process.cwd();
const shippedMap = fileURLToPath(new URL("../../vault.yaml", import.meta.url));
const envKeys = [
  "COVEN_CAVE_BUNDLE", "COVEN_HOME", "COVEN_CAVE_HOME", "COVEN_VAULT_FILE",
  "COVEN_CAVE_ENV_FILE", "COVEN_CAVE_LOCAL_VAULT_FILE", "COVEN_CAVE_LOCAL_VAULT_KEY_FILE",
  "CAVE_SETUP_TEST_KEY", "CAVE_SETUP_ENV_KEY", "CAVE_SETUP_FILE_KEY",
];
let previousEnv: Record<string, string | undefined>;
let root: string;
let bundle: string;
let writable: string;
let calls: Array<{ command: string; args: readonly string[] }>;

beforeEach(() => {
  previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  root = mkdtempSync(join(tmpdir(), "cave-vault-setup-"));
  bundle = join(root, "bundle");
  mkdirSync(bundle);
  process.chdir(bundle);
  process.env.COVEN_CAVE_BUNDLE = "1";
  process.env.COVEN_CAVE_HOME = join(root, "user");
  writable = join(root, "user", "vault.yaml");
  calls = [];
  mock.method(childProcess, "execFileSync", (command: string, args: readonly string[]) => {
    calls.push({ command, args });
    return "fixture-provider-value";
  });
  syncBuiltinESMExports();
});

afterEach(() => {
  process.chdir(originalCwd);
  mock.restoreAll();
  syncBuiltinESMExports();
  for (const key of envKeys) {
    const value = previousEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  loadVaultMap(true);
  rmSync(root, { recursive: true, force: true });
});

test("fresh packaged startup never adopts or resolves app-shipped references", () => {
  const bundled = 'CAVE_SETUP_TEST_KEY:\n  ref: "op://Developer/Private/credential"\n';
  writeFileSync(join(bundle, "vault.yaml"), bundled);
  assert.deepEqual(loadVaultMap(true), {});
  assert.deepEqual(loadVaultMapForMutation(), {});
  assert.deepEqual(getVaultMetadataStatuses(), []);
  assert.equal(getSecretStatus("CAVE_SETUP_TEST_KEY").hasValue, false);
  assert.equal(resolveSecret("CAVE_SETUP_TEST_KEY"), undefined);
  assert.deepEqual(calls, [], "opening an unconfigured app must not invoke a password manager");
  assert.equal(existsSync(writable), false, "reading setup must not create user configuration");
  assert.equal(readFileSync(join(bundle, "vault.yaml"), "utf8"), bundled);
});

test("the checked-in map also starts empty for source installs", () => {
  delete process.env.COVEN_CAVE_BUNDLE;
  process.env.COVEN_VAULT_FILE = shippedMap;
  assert.deepEqual(loadVaultMap(true), {});
  assert.deepEqual(loadVaultMapForMutation(), {});
  assert.deepEqual(getVaultMetadataStatuses(), []);
  assert.deepEqual(calls, []);
});

test("saved user references survive restart and metadata inspection does not resolve them", () => {
  mkdirSync(join(root, "user"));
  const saved = 'CAVE_SETUP_TEST_KEY:\n  ref: "op://User/Chosen/credential"\n  scope: ["sage"]\n';
  writeFileSync(writable, saved);
  assert.deepEqual(loadVaultMap(true), {
    CAVE_SETUP_TEST_KEY: { ref: "op://User/Chosen/credential", scope: ["sage"] },
  });
  assert.equal(getVaultMetadataStatuses()[0].status, "configured");
  assert.equal(readFileSync(writable, "utf8"), saved);
  assert.deepEqual(calls, []);
  assert.equal(resolveSecret("CAVE_SETUP_TEST_KEY"), "fixture-provider-value");
  assert.deepEqual(calls, [{ command: "op", args: ["read", "op://User/Chosen/credential"] }]);
});

test("an explicit map override is honored without creating a bundle-mode map", () => {
  const override = join(root, "explicit.yaml");
  process.env.COVEN_VAULT_FILE = override;
  writeFileSync(override, 'CAVE_SETUP_TEST_KEY:\n  ref: "dl://User/credential"\n');
  assert.deepEqual(loadVaultMap(true), { CAVE_SETUP_TEST_KEY: { ref: "dl://User/credential" } });
  assert.equal(getVaultMetadataStatuses()[0].storage, "dashlane");
  assert.deepEqual(calls, []);
  assert.equal(resolveSecret("CAVE_SETUP_TEST_KEY"), "fixture-provider-value");
  assert.deepEqual(calls, [{ command: "dcli", args: ["read", "dl://User/credential"] }]);
  assert.equal(existsSync(writable), false);
});

test("explicit environment values remain usable without creating mappings", () => {
  process.env.CAVE_SETUP_ENV_KEY = "fixture-launcher-value";
  mkdirSync(join(root, "user"));
  writeFileSync(join(root, "user", ".env.local"), "CAVE_SETUP_FILE_KEY=fixture-env-file-value\n");
  loadVaultMap(true);
  assert.equal(resolveSecret("CAVE_SETUP_ENV_KEY"), "fixture-launcher-value");
  assert.equal(resolveSecret("CAVE_SETUP_FILE_KEY"), "fixture-env-file-value");
  assert.deepEqual(loadVaultMapForMutation(), {});
  assert.deepEqual(calls, []);
});

test("manual encrypted values save and reload without changing the bundle", () => {
  writeFileSync(join(bundle, "vault.yaml"), "{}\n");
  setLocalEncryptedSecret("CAVE_SETUP_TEST_KEY", "fixture-manual-value");
  saveVaultMap({ CAVE_SETUP_TEST_KEY: { storage: "encrypted" } });
  assert.deepEqual(loadVaultMap(true), { CAVE_SETUP_TEST_KEY: { storage: "encrypted" } });
  assert.equal(getVaultMetadataStatuses()[0].status, "encrypted");
  assert.equal(resolveSecret("CAVE_SETUP_TEST_KEY"), "fixture-manual-value");
  assert.doesNotMatch(readFileSync(writable, "utf8"), /fixture-manual-value/);
  assert.equal(readFileSync(join(bundle, "vault.yaml"), "utf8"), "{}\n");
  assert.deepEqual(calls, []);
});

test("removing the final variable leaves a valid empty map after reload", () => {
  saveVaultMap({ CAVE_SETUP_TEST_KEY: { storage: "environment" } });
  saveVaultMap({});
  assert.deepEqual(loadVaultMap(true), {});
  assert.deepEqual(loadVaultMapForMutation(), {});
  assert.deepEqual(getVaultMetadataStatuses(), []);
  assert.deepEqual(calls, []);
});

test("legacy shipped references need review before any resolver may use them", () => {
  mkdirSync(join(root, "user"));
  const legacy = 'CAVE_SETUP_TEST_KEY:\n  ref: "op://Development/OpenAI API Key 2/credential"\n';
  writeFileSync(writable, legacy);
  const map = loadVaultMap(true);
  assert.equal(resolveSecret("CAVE_SETUP_TEST_KEY"), undefined);
  assert.equal(resolveVaultManagedSecret("CAVE_SETUP_TEST_KEY"), undefined);
  assert.equal(resolveCachedVaultManagedSecret("CAVE_SETUP_TEST_KEY"), undefined);
  assert.equal(hasConfiguredSecretMetadata("CAVE_SETUP_TEST_KEY"), false);
  for (const status of [
    getSecretStatus("CAVE_SETUP_TEST_KEY"),
    getVaultMetadataStatuses()[0],
    getVaultStatuses()[0],
  ]) {
    assert.equal(status.status, "unresolved");
    assert.equal(status.hasValue, false);
    assert.match(status.error ?? "", /old Cave default/);
  }
  assert.deepEqual(calls, [], "legacy defaults must never invoke a provider before review");
  assert.equal(readFileSync(writable, "utf8"), legacy, "review does not delete or rewrite existing settings");

  saveVaultMap({ CAVE_SETUP_TEST_KEY: { ...map.CAVE_SETUP_TEST_KEY, providerAccessConfirmed: true } });
  loadVaultMap(true);
  assert.equal(getVaultMetadataStatuses()[0].status, "configured");
  assert.equal(resolveSecret("CAVE_SETUP_TEST_KEY"), "fixture-provider-value");
  assert.equal(calls.length, 1, "saving a reviewed reference opts in to its provider");
});

test("explicit environment values take precedence over a legacy reference needing review", () => {
  mkdirSync(join(root, "user"));
  writeFileSync(writable, 'CAVE_SETUP_TEST_KEY:\n  ref: "op://Development/ElevenLabs API Key/credential"\n');
  process.env.CAVE_SETUP_TEST_KEY = "fixture-launcher-value";
  loadVaultMap(true);
  assert.equal(resolveSecret("CAVE_SETUP_TEST_KEY"), "fixture-launcher-value");
  assert.equal(getSecretStatus("CAVE_SETUP_TEST_KEY").status, "env-only");
  assert.deepEqual(calls, []);
});

test("an explicitly selected map can use a reference matching a former default", () => {
  process.env.COVEN_VAULT_FILE = join(root, "chosen.yaml");
  writeFileSync(process.env.COVEN_VAULT_FILE, 'CAVE_SETUP_TEST_KEY:\n  ref: "op://Development/GitHub PAT/username"\n');
  loadVaultMap(true);
  assert.equal(getVaultMetadataStatuses()[0].status, "configured");
  assert.deepEqual(calls, []);
  assert.equal(resolveSecret("CAVE_SETUP_TEST_KEY"), "fixture-provider-value");
  assert.equal(calls.length, 1);
});

test("a Vault-owned cache cannot bypass review of an unconfirmed legacy reference", () => {
  saveVaultMap({ CAVE_SETUP_TEST_KEY: { ref: "op://Development/GitHub PAT/username" } });
  mirrorVaultSecretToProcessEnv("CAVE_SETUP_TEST_KEY", "fixture-cached-value", { source: "vault", storage: "1password" });
  assert.equal(resolveSecret("CAVE_SETUP_TEST_KEY"), undefined);
  assert.equal(resolveCachedVaultManagedSecret("CAVE_SETUP_TEST_KEY"), undefined);
  assert.equal(hasConfiguredSecretMetadata("CAVE_SETUP_TEST_KEY"), false);
  assert.equal(getVaultMetadataStatuses()[0].status, "unresolved");
  assert.equal(getVaultStatuses()[0].status, "unresolved");
  mkdirSync(join(root, "user"), { recursive: true });
  writeFileSync(join(root, "user", ".env.local"), "CAVE_SETUP_TEST_KEY=fixture-file-value\n");
  assert.equal(getVaultStatuses()[0].status, "env-only");
  assert.equal(resolveSecret("CAVE_SETUP_TEST_KEY"), "fixture-file-value");
  assert.deepEqual(calls, []);
});
