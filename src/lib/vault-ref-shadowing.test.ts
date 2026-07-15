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

// Fake `op` binary so ref resolution is deterministic and never invokes a
// real (possibly interactive) 1Password CLI.
const opPath = join(fakeBin, "op");
writeFileSync(opPath, "#!/bin/sh\necho from-op\n");
chmodSync(opPath, 0o755);

process.env.COVEN_HOME = home;
process.env.COVEN_VAULT_FILE = vaultYaml;
process.env.COVEN_CAVE_ENV_FILE = join(home, ".env.local"); // nonexistent — isolates from the repo's .env.local
process.env.PATH = `${fakeBin}${delimiter}${process.env.PATH ?? ""}`;
delete process.env.COVEN_CAVE_BUNDLE;
const KEYS = ["SHADOWED_REF_KEY", "SHADOWED_STATUS_KEY", "DECLARED_ENC_KEY", "UNMAPPED_ENC_KEY"];
for (const key of KEYS) delete process.env[key];

writeFileSync(vaultYaml, [
  "SHADOWED_REF_KEY:",
  '  ref: "op://Dev/Item/field"',
  "SHADOWED_STATUS_KEY:",
  '  ref: "op://Dev/Item/field"',
  "DECLARED_ENC_KEY:",
  '  storage: "encrypted"',
  "",
].join("\n"));

const { setLocalEncryptedSecret } = await import("./local-encrypted-vault.ts");
const { getVaultMetadataStatuses, getVaultStatuses, resolveSecret } = await import("./vault.ts");

// Seed stale/orphaned encrypted values for the ref-mapped keys, a legitimate
// declared-encrypted value, and an unmapped orphan that must keep resolving.
setLocalEncryptedSecret("SHADOWED_REF_KEY", "stale-encrypted");
setLocalEncryptedSecret("SHADOWED_STATUS_KEY", "stale-encrypted");
setLocalEncryptedSecret("DECLARED_ENC_KEY", "declared-encrypted");
setLocalEncryptedSecret("UNMAPPED_ENC_KEY", "unmapped-encrypted");

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

// 4. A mapping declared encrypted still resolves from the local store.
const declared = statuses.find((s) => s.key === "DECLARED_ENC_KEY");
assert.equal(declared?.status, "encrypted");
assert.equal(resolveSecret("DECLARED_ENC_KEY"), "declared-encrypted");

// 5. An encrypted secret with no vault.yaml mapping at all still resolves.
assert.equal(resolveSecret("UNMAPPED_ENC_KEY"), "unmapped-encrypted");

rmSync(home, { recursive: true, force: true });
rmSync(fakeBin, { recursive: true, force: true });

console.log("vault-ref-shadowing.test.ts: ok");
