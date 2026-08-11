import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hookSource = path.join(root, "scripts", "git-hooks", "commit-msg");
const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
const bashCommand = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";

function runHook(message) {
  const dir = mkdtempSync(path.join(tmpdir(), "coven-cave-commit-msg-test-"));
  const hooksDir = path.join(dir, "scripts", "git-hooks");
  mkdirSync(hooksDir, { recursive: true });
  const hook = path.join(hooksDir, "commit-msg");
  cpSync(hookSource, hook);
  chmodSync(hook, 0o755);
  const messageFile = path.join(dir, "message");
  writeFileSync(messageFile, message);
  return spawnSync(bashCommand, [hook, messageFile], { cwd: dir, encoding: "utf8" });
}

{
  const result = runHook("fix: preserve human credit\n\nCo-authored-by: Val Alexander <68980965+BunsDev@users.noreply.github.com>\n");
  assert.equal(result.status, 0, result.stderr);
}

{
  const result = runHook("fix: reject vendor attribution\n\nCo-authored-by: Claude Fable 5 <noreply@anthropic.com>\n");
  assert.notEqual(result.status, 0, "AI/vendor co-author trailers must be blocked");
  assert.match(result.stderr, /numeric no-reply identity/i);
}

{
  const result = runHook("fix: reject machine address\n\nCo-authored-by: Jane Doe <jane@Someones-Mac.local>\n");
  assert.notEqual(result.status, 0, "machine-local co-author trailers must be blocked");
  assert.match(result.stderr, /users\.noreply\.github\.com/i);
}

console.log("git-hooks-commit-msg.test.mjs: ok");
