import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Regression: vault.yaml is a reference map (no secrets) that the UI rewrites
// when the user edits it. In the packaged desktop build the cwd is inside the
// read-only, code-signed .app bundle, so writing vault.yaml there breaks the
// signature seal and the in-place auto-updater. In bundle mode it resolves to a
// writable per-user file, seeded once from the bundle's shipped map.

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

const origCwd = process.cwd();
const bundle = await mkdtemp(path.join(tmpdir(), "cave-vault-bundle-"));
const home = await mkdtemp(path.join(tmpdir(), "cave-vault-home-"));

const seedVault = path.join(bundle, "vault.yaml");
await writeFile(seedVault, 'GITHUB_PAT:\n  ref: "op://Dev/GH/credential"\n  description: "tok"\n');

process.chdir(bundle);
process.env.COVEN_CAVE_BUNDLE = "1";
process.env.COVEN_HOME = home;
delete process.env.COVEN_VAULT_FILE;

const { loadVaultMap, saveVaultMap } = await import("./vault.ts");

// 1. Loading seeds the writable vault from the bundle's shipped map.
const map = loadVaultMap(true);
assert.ok(map.GITHUB_PAT, "seeded vault map exposes GITHUB_PAT");
assert.equal(map.GITHUB_PAT.ref, "op://Dev/GH/credential");
const writable = path.join(home, "cave", "vault.yaml");
assert.ok(await exists(writable), "writable vault.yaml seeded from the bundle");

// 2. Saving rewrites the writable file, never the bundle's copy.
const seedBefore = await readFile(seedVault, "utf8");
saveVaultMap({ FOO: { ref: "op://a/b/c" } });
assert.equal(await readFile(seedVault, "utf8"), seedBefore, "bundle vault.yaml not mutated by save");
assert.match(await readFile(writable, "utf8"), /FOO:/, "save wrote to the writable vault.yaml");

// cleanup
process.chdir(origCwd);
await rm(bundle, { recursive: true, force: true });
await rm(home, { recursive: true, force: true });

console.log("ok - vault bundle mode seeds + writes the writable file, never the bundle");
