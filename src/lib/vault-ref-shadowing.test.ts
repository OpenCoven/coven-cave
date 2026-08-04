// @ts-nocheck
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

// Regression (cave-6iee): the vault map's declared backend must win. A stale
// orphaned entry in the local encrypted store used to shadow a newer op://
// reference for the same key — resolveSecret() and the status reporters
// checked hasLocalEncryptedSecret() before entry.ref, so the ref was never
// consulted and the UI kept showing "encrypted" for a mapping the user had
// switched to 1Password.

const home = mkdtempSync(join(tmpdir(), "cave-vault-shadow-home-"));
const fakeBin = mkdtempSync(join(tmpdir(), "cave-vault-shadow-bin-"));
const vaultYaml = join(home, "vault.yaml");
const envLocal = join(home, ".env.local");

// Fake `op` binary so ref resolution is deterministic and never invokes a
// real (possibly interactive) 1Password CLI.
const opPath = join(fakeBin, "op");
writeFileSync(opPath, "#!/bin/sh\necho from-op\n");
chmodSync(opPath, 0o755);

process.env.COVEN_HOME = home;
process.env.COVEN_VAULT_FILE = vaultYaml;
process.env.COVEN_CAVE_ENV_FILE = envLocal;
process.env.PATH = `${fakeBin}${delimiter}${process.env.PATH ?? ""}`;
delete process.env.COVEN_CAVE_BUNDLE;
const KEYS = [
  "SHADOWED_REF_KEY",
  "SHADOWED_STATUS_KEY",
  "DECLARED_ENC_KEY",
  "UNMAPPED_ENC_KEY",
  "EXTERNAL_ENC_KEY",
  "EXTERNAL_REF_KEY",
  "DOTENV_ENC_KEY",
  "DOTENV_REF_KEY",
];
for (const key of KEYS) delete process.env[key];

writeFileSync(vaultYaml, [
  "SHADOWED_REF_KEY:",
  '  ref: "op://Dev/Item/field"',
  "SHADOWED_STATUS_KEY:",
  '  ref: "op://Dev/Item/field"',
  "DECLARED_ENC_KEY:",
  '  storage: "encrypted"',
  "EXTERNAL_ENC_KEY:",
  '  storage: "encrypted"',
  "EXTERNAL_REF_KEY:",
  '  ref: "op://Dev/Item/field"',
  "DOTENV_ENC_KEY:",
  '  storage: "encrypted"',
  "DOTENV_REF_KEY:",
  '  ref: "op://Dev/Item/field"',
  "",
].join("\n"));
writeFileSync(envLocal, [
  "DOTENV_ENC_KEY=dotenv-encrypted-winner",
  "DOTENV_REF_KEY=dotenv-ref-winner",
  "",
].join("\n"));

const { setLocalEncryptedSecret } = await import("./local-encrypted-vault.ts");
const { getSecretStatus, getVaultMetadataStatuses, getVaultStatuses, resolveSecret } = await import("./vault.ts");

// Seed stale/orphaned encrypted values for the ref-mapped keys, a legitimate
// declared-encrypted value, and an unmapped orphan that must keep resolving.
setLocalEncryptedSecret("SHADOWED_REF_KEY", "stale-encrypted");
setLocalEncryptedSecret("SHADOWED_STATUS_KEY", "stale-encrypted");
setLocalEncryptedSecret("DECLARED_ENC_KEY", "declared-encrypted");
setLocalEncryptedSecret("UNMAPPED_ENC_KEY", "unmapped-encrypted");
setLocalEncryptedSecret("EXTERNAL_ENC_KEY", "vault-must-not-win");
setLocalEncryptedSecret("DOTENV_ENC_KEY", "vault-must-not-win");
process.env.EXTERNAL_ENC_KEY = "external-encrypted-winner";
process.env.EXTERNAL_REF_KEY = "external-ref-winner";

// 1. The ref wins over the orphaned encrypted value.
assert.equal(resolveSecret("SHADOWED_REF_KEY"), "from-op", "ref mapping resolves via op, not the stale encrypted orphan");

// 2. Metadata status (no secret reads) reports the ref backend, not "encrypted".
const meta = getVaultMetadataStatuses().find((s) => s.key === "SHADOWED_STATUS_KEY");
assert.equal(meta?.status, "configured", "metadata status for a ref mapping is configured, not encrypted");
assert.equal(meta?.storage, "1password");

// 3. Live status resolves the ref and labels it by its ref backend.
const statuses = getVaultStatuses();
const shadowed = statuses.find((s) => s.key === "SHADOWED_STATUS_KEY");
assert.equal(shadowed?.status, "resolved", "live status for a ref mapping resolves the ref");
assert.equal(shadowed?.storage, "1password");
assert.equal(
  statuses.find((s) => s.key === "SHADOWED_REF_KEY")?.status,
  "resolved",
  "a ref cached by resolveSecret retains its mapped Vault provenance",
);

// External process and .env.local winners keep precedence across broad status.
for (const [key, value] of [
  ["EXTERNAL_ENC_KEY", "external-encrypted-winner"],
  ["EXTERNAL_REF_KEY", "external-ref-winner"],
  ["DOTENV_ENC_KEY", "dotenv-encrypted-winner"],
  ["DOTENV_REF_KEY", "dotenv-ref-winner"],
]) {
  assert.equal(process.env[key], value, `${key} is not overwritten by broad Vault status`);
  assert.equal(statuses.find((s) => s.key === key)?.status, "env-only");
}
assert.equal(getSecretStatus("EXTERNAL_ENC_KEY").source, "process-env");
assert.equal(getSecretStatus("EXTERNAL_REF_KEY").source, "process-env");
assert.equal(getSecretStatus("DOTENV_ENC_KEY").source, "env-local");
assert.equal(getSecretStatus("DOTENV_REF_KEY").source, "env-local");

// 4. A mapping declared encrypted still resolves from the local store.
const declared = statuses.find((s) => s.key === "DECLARED_ENC_KEY");
assert.equal(declared?.status, "encrypted");
assert.equal(resolveSecret("DECLARED_ENC_KEY"), "declared-encrypted");

// 5. An encrypted secret with no vault.yaml mapping at all still resolves.
assert.equal(resolveSecret("UNMAPPED_ENC_KEY"), "unmapped-encrypted");

rmSync(home, { recursive: true, force: true });
rmSync(fakeBin, { recursive: true, force: true });

console.log("vault-ref-shadowing.test.ts: ok");
