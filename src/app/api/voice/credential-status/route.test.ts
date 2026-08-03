// @ts-nocheck
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, beforeEach, test } from "node:test";

const routeUrl = new URL("./route.ts", import.meta.url);
assert.equal(existsSync(routeUrl), true, "voice credentials route must exist");

const temp = mkdtempSync(join(tmpdir(), "voice-credential-status-"));
const fakeBin = join(temp, "bin");
const opLog = join(temp, "op.log");
const vaultFile = join(temp, "vault.yaml");
const envFile = join(temp, ".env.local");
const localVaultFile = join(temp, "local-vault.enc.json");
const localVaultKeyFile = join(temp, "local-vault.key");

mkdirSync(fakeBin, { recursive: true });
const opPath = join(fakeBin, "op");
writeFileSync(opPath, `#!/bin/sh\nprintf '%s\\n' "$2" >> "${opLog}"\nprintf 'resolved-secret\\n'\n`);
chmodSync(opPath, 0o755);

process.env.COVEN_VAULT_FILE = vaultFile;
process.env.COVEN_CAVE_ENV_FILE = envFile;
process.env.COVEN_CAVE_LOCAL_VAULT_FILE = localVaultFile;
process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE = localVaultKeyFile;
process.env.PATH = `${fakeBin}${delimiter}${process.env.PATH ?? ""}`;

const { setLocalEncryptedSecret } = await import("../../../../lib/local-encrypted-vault.ts");
const { GET } = await import("./route.ts");

function resetFiles(vaultEntries = "") {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  rmSync(opLog, { force: true });
  rmSync(localVaultFile, { force: true });
  rmSync(`${localVaultFile}.coord.sqlite`, { force: true });
  rmSync(localVaultKeyFile, { force: true });
  writeFileSync(envFile, "");
  writeFileSync(vaultFile, [
    "UNRELATED_API_KEY:",
    '  ref: "op://Private/Unrelated/password"',
    vaultEntries,
    "",
  ].filter(Boolean).join("\n"));
}

async function statuses() {
  const response = await GET();
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.credentials.map((entry) => entry.key).sort(), [
    "ELEVENLABS_API_KEY",
    "OPENAI_API_KEY",
  ]);
  assert.equal(existsSync(opLog), false, "the Voice status route never resolves unrelated Vault refs");
  return payload.credentials;
}

beforeEach(() => resetFiles());
after(() => rmSync(temp, { recursive: true, force: true }));

test("reports process environment precedence without exposing values", async () => {
  resetFiles('OPENAI_API_KEY:\n  ref: "op://Private/OpenAI/password"');
  process.env.OPENAI_API_KEY = "process-secret";
  writeFileSync(envFile, "OPENAI_API_KEY=dotenv-secret\n");

  const result = await statuses();
  assert.deepEqual(result.find((entry) => entry.key === "OPENAI_API_KEY"), {
    key: "OPENAI_API_KEY",
    status: "env-only",
    hasValue: true,
    storage: null,
    source: "process-env",
  });
  assert.doesNotMatch(JSON.stringify(result), /process-secret|dotenv-secret|resolved-secret/);
});

test("reports a dotenv-only key as externally owned", async () => {
  writeFileSync(envFile, "ELEVENLABS_API_KEY=dotenv-only-secret\n");
  const result = await statuses();
  assert.deepEqual(result.find((entry) => entry.key === "ELEVENLABS_API_KEY"), {
    key: "ELEVENLABS_API_KEY",
    status: "env-only",
    hasValue: true,
    storage: null,
    source: "env-local",
  });
  assert.doesNotMatch(JSON.stringify(result), /dotenv-only-secret/);
});

test("reports encrypted, missing, and encrypted-read errors independently", async () => {
  resetFiles("OPENAI_API_KEY:\n  storage: encrypted");
  setLocalEncryptedSecret("OPENAI_API_KEY", "encrypted-secret");
  let result = await statuses();
  assert.deepEqual(result.find((entry) => entry.key === "OPENAI_API_KEY"), {
    key: "OPENAI_API_KEY",
    status: "encrypted",
    hasValue: true,
    storage: "encrypted",
    source: "vault",
  });
  assert.deepEqual(result.find((entry) => entry.key === "ELEVENLABS_API_KEY"), {
    key: "ELEVENLABS_API_KEY",
    status: "no-ref",
    hasValue: false,
    storage: null,
    source: null,
  });
  assert.doesNotMatch(JSON.stringify(result), /encrypted-secret/);

  delete process.env.OPENAI_API_KEY;
  writeFileSync(localVaultKeyFile, "not-a-valid-key\n");
  result = await statuses();
  const failed = result.find((entry) => entry.key === "OPENAI_API_KEY");
  assert.equal(failed.status, "error");
  assert.equal(failed.hasValue, false);
  assert.equal(failed.storage, "encrypted");
  assert.equal(failed.source, "vault");
  assert.equal(typeof failed.error, "string");
  assert.doesNotMatch(JSON.stringify(failed), /encrypted-secret/);
});
