import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

// Credential-shaped fixtures below are assembled at runtime rather than written
// as literals — the same trick this file already used for the OpenRouter key.
// A test that proves the scanner blocks a shape cannot contain that shape, or
// the scanner blocks the test. That is not a workaround; it is the scanner
// working, on its own test file.
//
// ── Synthetic test fixtures are not secrets ────────────────────────────────
// The two generic shape heuristics (Bearer, password assignment) fired on
// obviously-fake fixture values and blocked real commits, which trains people
// to reach for --no-verify — the worst outcome for a secret scanner. Values
// carrying an explicit synthetic marker INSIDE the value are allowed.

for (const content of [
  'assert.equal(headers.authorization, "Bearer synthetic-access-token");\n',
  '  access_token: "synthetic-access-token",\n',
  '  access_token: "synthetic-refreshed-access-token",\n',
  'const token = "Bearer placeholder-token-value";\n',
  'const password = "example-password-here";\n',
]) {
  const repo = stagedRepo({ filePath: "src/lib/fixtures.test.ts", content });
  const result = runHook(repo);
  assert.equal(result.status, 0, `synthetic fixture should commit cleanly: ${content.trim()}\n${result.stderr}`);
}

// The narrowing must not reach real-shaped values.
{
  const repo = stagedRepo({
    filePath: "src/lib/secrets.test.ts",
    content: `const header = "${"Bearer " + "aZ09kQ7fLm3xY8pW2vR5tN"}";\n`,
  });
  const result = runHook(repo);
  assert.notEqual(result.status, 0, "a real-shaped bearer token is still blocked");
  assert.match(result.stderr, /Bearer token/i);
}
{
  const repo = stagedRepo({
    filePath: "src/lib/secrets.test.ts",
    content: `const ${"pass" + "word"} = "hunter2hunter2";\n`,
  });
  const result = runHook(repo);
  assert.notEqual(result.status, 0, "a real-shaped password assignment is still blocked");
  assert.match(result.stderr, /password assignment/i);
}

// The allowlist is scoped to the generic heuristics ONLY. A vendor-shaped key
// does not become safe by containing the word "synthetic" or "example" — this
// is the assertion that stops the narrowing from being widened carelessly.
{
  const repo = stagedRepo({
    filePath: "src/lib/secrets.test.ts",
    content: `const key = "${"ghp_" + "synthetic1234567890abcdefghijklmnop"}";\n`,
  });
  const result = runHook(repo);
  assert.notEqual(result.status, 0, "vendor patterns ignore the synthetic allowlist");
  assert.match(result.stderr, /GitHub PAT/i);
}
{
  const repo = stagedRepo({
    filePath: "src/lib/secrets.test.ts",
    content: `const key = "${"sk-" + "ant-" + "example1234567890abcdef"}";\n`,
  });
  const result = runHook(repo);
  assert.notEqual(result.status, 0, "an Anthropic-shaped key is blocked even when it says example");
}

// ── The hook exists twice on disk and must not drift ───────────────────────
// .beads/hooks/pre-commit is the beads-managed install target that
// core.hooksPath actually points at; it is this file plus an appended beads
// integration block. Both are tracked, so a scanner change made in one copy
// and not the other silently disables it for whichever hooks path is live.
{
  const canonical = readFileSync(hookSource, "utf8").replace(/\n+$/, "");
  const installed = readFileSync(path.join(root, ".beads", "hooks", "pre-commit"), "utf8");
  assert.ok(
    installed.startsWith(canonical),
    ".beads/hooks/pre-commit must begin with scripts/git-hooks/pre-commit verbatim — " +
      "re-run scripts/install-git-hooks.sh or re-apply the edit to both copies",
  );
  assert.match(
    installed.slice(canonical.length),
    /# --- BEGIN BEADS INTEGRATION/,
    "the installed copy keeps its beads integration block",
  );
}

console.log("git-hooks-pre-commit.test.mjs: ok");
