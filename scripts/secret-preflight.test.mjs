import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "secret-preflight.mjs");

function run(args, input) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    input,
  });
}

{
  const token = "sk-" + "or-v1-" + "a".repeat(64);
  const result = run(["--stdin", "--label", "github issue comment"], `progress update ${token}\n`);
  assert.notEqual(result.status, 0, "OpenRouter key-shaped strings should fail outbound preflight");
  assert.match(result.stderr, /OpenRouter API key/i);
  assert.doesNotMatch(result.stderr, new RegExp(token), "secret value should not be echoed");
}

{
  const token = "ghp_" + "a".repeat(36);
  const dir = mkdtempSync(path.join(tmpdir(), "coven-cave-secret-preflight-"));
  const file = path.join(dir, "comment.md");
  writeFileSync(file, `ship note ${token}\n`);
  const result = run([file]);
  assert.notEqual(result.status, 0, "file preflight should catch GitHub PAT-shaped strings");
  assert.match(result.stderr, /GitHub PAT/i);
  assert.doesNotMatch(result.stderr, new RegExp(token), "secret value should not be echoed");
}

{
  const result = run(["--stdin", "--label", "safe comment"], "Final Phase 1C slice landed in #2122.\n");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /ok/i);
}

console.log("secret-preflight.test.mjs: ok");
