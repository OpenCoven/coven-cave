// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const home = await mkdtemp(path.join(tmpdir(), "cave-local-vault-"));
process.env.COVEN_HOME = home;
delete process.env.GITHUB_PAT;

const {
  deleteLocalEncryptedSecret,
  getLocalEncryptedSecret,
  hasLocalEncryptedSecret,
  setLocalEncryptedSecret,
} = await import("./local-encrypted-vault.ts");

await setLocalEncryptedSecret("GITHUB_PAT", "ghp_super_secret_token");

assert.equal(
  await getLocalEncryptedSecret("GITHUB_PAT"),
  "ghp_super_secret_token",
  "encrypted local vault returns the original secret",
);
assert.equal(await hasLocalEncryptedSecret("GITHUB_PAT"), true, "encrypted local vault reports stored keys");

const encryptedFile = path.join(home, "cave", "local-vault.enc.json");
const rawFile = await readFile(encryptedFile, "utf8");
assert.doesNotMatch(rawFile, /ghp_super_secret_token/, "ciphertext file never stores the plaintext secret");
assert.match(rawFile, /"alg":\s*"aes-256-gcm"/, "ciphertext records the encryption algorithm");

await deleteLocalEncryptedSecret("GITHUB_PAT");
assert.equal(await getLocalEncryptedSecret("GITHUB_PAT"), null, "delete removes the encrypted secret");
assert.equal(await hasLocalEncryptedSecret("GITHUB_PAT"), false, "delete clears stored status");

await rm(home, { recursive: true, force: true });

console.log("local-encrypted-vault.test.ts: ok");
