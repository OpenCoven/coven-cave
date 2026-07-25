import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hookSource = path.join(root, "scripts", "git-hooks", "pre-commit");
// On Windows `bash` may resolve to the WSL launcher, which is not a usable
// shell when WSL is uninstalled or partially configured. Prefer Git Bash when
// available; the hook itself still executes under the same Bash implementation
// used by Git for Windows and GitHub's Windows runners.
const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
const bashCommand = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return result;
}

function stagedRepo({ filePath, content }) {
  const dir = mkdtempSync(path.join(tmpdir(), "coven-cave-hook-test-"));
  run("git", ["init", "-q"], dir);
  run("git", ["config", "user.email", "test@example.invalid"], dir);
  run("git", ["config", "user.name", "Hook Test"], dir);
  mkdirSync(path.dirname(path.join(dir, filePath)), { recursive: true });
  writeFileSync(path.join(dir, filePath), content);
  run("git", ["add", filePath], dir);

  const hooksDir = path.join(dir, "scripts", "git-hooks");
  mkdirSync(hooksDir, { recursive: true });
  const hookDest = path.join(hooksDir, "pre-commit");
  cpSync(hookSource, hookDest);
  chmodSync(hookDest, 0o755);

  return dir;
}

function runHook(repo) {
  return run(bashCommand, ["scripts/git-hooks/pre-commit"], repo);
}

{
  const repo = stagedRepo({
    filePath: "src/lib/mobile-handoff.test.ts",
    content: 'const url = "https://workstation.private-tailnet.ts.net/";\n',
  });
  const result = runHook(repo);
  assert.notEqual(result.status, 0, "real Tailscale Serve host literals should be blocked");
  assert.match(result.stderr, /Tailscale Serve host/i);
}

{
  const repo = stagedRepo({
    filePath: "src/lib/mobile-handoff.test.ts",
    content: 'const url = "https://cave.tailnet.example.ts.net/";\n',
  });
  const result = runHook(repo);
  assert.equal(result.status, 0, result.stderr);
}

{
  const repo = stagedRepo({
    filePath: "src/lib/secrets.test.ts",
    content: 'const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";\n',
  });
  const result = runHook(repo);
  assert.notEqual(result.status, 0, "GitHub PAT-shaped strings should be blocked");
  assert.match(result.stderr, /GitHub PAT/i);
}

{
  const token = "sk-" + "or-v1-" + "a".repeat(64);
  const repo = stagedRepo({
    filePath: "src/lib/secrets.test.ts",
    content: `const token = "${token}";\n`,
  });
  const result = runHook(repo);
  assert.notEqual(result.status, 0, "OpenRouter key-shaped strings should be blocked");
  assert.match(result.stderr, /OpenRouter/i);
}

console.log("git-hooks-pre-commit.test.mjs: ok");
