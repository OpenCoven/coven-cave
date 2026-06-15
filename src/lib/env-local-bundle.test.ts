import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Regression: the in-app GitHub PAT form wrote .env.local to process.cwd(),
// which in packaged builds is the read-only, code-signed .app bundle — breaking
// the signature seal and the auto-updater. The file now resolves to a writable
// per-user path in bundle mode, and resolveSecret() reads it back directly
// (Next only auto-loads .env.local from cwd, which the bundle file no longer is).

const dir = await mkdtemp(path.join(tmpdir(), "cave-envlocal-"));
const envFile = path.join(dir, ".env.local");

delete process.env.COVEN_CAVE_ENV_FILE;
delete process.env.COVEN_CAVE_BUNDLE;
process.env.COVEN_HOME = path.join(dir, "covenhome");

const { envLocalPath, readEnvLocalValue } = await import("./env-file.ts");

// 1. Path resolution: dev → cwd; bundle → writable covenHome; override wins.
assert.equal(envLocalPath(), path.join(process.cwd(), ".env.local"), "dev → cwd/.env.local");
process.env.COVEN_CAVE_BUNDLE = "1";
assert.equal(
  envLocalPath(),
  path.join(dir, "covenhome", "cave", ".env.local"),
  "bundle → writable per-user path (never the bundle/cwd)",
);
process.env.COVEN_CAVE_ENV_FILE = envFile;
assert.equal(envLocalPath(), envFile, "explicit override wins");

// 2. readEnvLocalValue: unquoted + quoted values, blanks/comments/missing.
await writeFile(envFile, '# note\nGITHUB_PAT=ghp_abc123\nGITHUB_USERNAME="octocat"\nEMPTY=\n');
assert.equal(readEnvLocalValue("GITHUB_PAT"), "ghp_abc123", "reads unquoted value");
assert.equal(readEnvLocalValue("GITHUB_USERNAME"), "octocat", "strips surrounding quotes");
assert.equal(readEnvLocalValue("EMPTY"), undefined, "empty value → undefined");
assert.equal(readEnvLocalValue("MISSING"), undefined, "absent key → undefined");

process.env.COVEN_CAVE_ENV_FILE = path.join(dir, "does-not-exist.env");
assert.equal(readEnvLocalValue("GITHUB_PAT"), undefined, "missing file → undefined");

// 3. resolveSecret falls back to the writable file when not in process.env.
process.env.COVEN_CAVE_ENV_FILE = envFile;
delete process.env.GITHUB_PAT;
const { resolveSecret } = await import("./vault.ts");
assert.equal(resolveSecret("GITHUB_PAT"), "ghp_abc123", "resolveSecret reads the writable .env.local");
assert.equal(process.env.GITHUB_PAT, "ghp_abc123", "resolved value is cached into process.env");

await rm(dir, { recursive: true, force: true });

console.log("ok - .env.local writable path + readback + resolveSecret fallback");
