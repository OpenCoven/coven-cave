// Tests for the surface-claim PreToolUse hook (scripts/surface-claim-guard.mjs).
// The hook must: record a session's claim on edited shared-checkout files, warn
// on cross-session collisions, prune expired claims, skip worktree paths, and —
// above all — NEVER block or fail a tool (always exit 0, even on garbage input).

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "surface-claim-guard.mjs");

/** Run the hook with a synthetic PreToolUse payload in an isolated project dir. */
function runHook({ projectDir, sessionId, filePath, tool = "Edit" }) {
  const payload = JSON.stringify({
    session_id: sessionId,
    cwd: projectDir,
    tool_name: tool,
    tool_input: { file_path: filePath },
  });
  const res = spawnSync("node", [script], {
    input: payload,
    cwd: projectDir,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
  return res;
}

function freshProject() {
  const dir = mkdtempSync(path.join(tmpdir(), "claim-guard-"));
  mkdirSync(path.join(dir, ".claude"), { recursive: true });
  mkdirSync(path.join(dir, "src"), { recursive: true });
  return dir;
}

function readClaims(dir) {
  const p = path.join(dir, ".claude", "claims.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

// ── 1. Records a claim silently when there's no collision ─────────────────────
{
  const dir = freshProject();
  const res = runHook({ projectDir: dir, sessionId: "sessionAAAA", filePath: path.join(dir, "src/foo.ts") });
  assert.equal(res.status, 0, "hook exits 0");
  assert.equal(res.stdout.trim(), "", "no output when there's no collision");
  const claims = readClaims(dir);
  assert.ok(claims.sessionAAAA, "this session's claim is recorded");
  assert.deepEqual(claims.sessionAAAA.surfaces, ["src/foo.ts"], "the edited surface is recorded (repo-relative, /-joined)");
}

// ── 2. Warns when a DIFFERENT live session already claimed the same surface ────
{
  const dir = freshProject();
  runHook({ projectDir: dir, sessionId: "sessionAAAA", filePath: path.join(dir, "src/foo.ts") });
  const res = runHook({ projectDir: dir, sessionId: "sessionBBBB", filePath: path.join(dir, "src/foo.ts") });
  assert.equal(res.status, 0, "hook still exits 0 on collision (advisory, never blocks)");
  const out = JSON.parse(res.stdout);
  assert.match(out.systemMessage, /Multi-session collision/, "surfaces a collision warning to the user");
  assert.match(out.systemMessage, /src\/foo\.ts/, "names the colliding surface");
  assert.match(out.systemMessage, /sessionA/, "names the other session");
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse", "uses the PreToolUse hookSpecificOutput shape");
  assert.ok(out.hookSpecificOutput.additionalContext, "injects context to the model too");
  assert.ok(!("permissionDecision" in out.hookSpecificOutput), "does NOT set a permission decision — the edit proceeds normally");
}

// ── 3. Same session re-editing its own file does not self-collide ─────────────
{
  const dir = freshProject();
  runHook({ projectDir: dir, sessionId: "sessionAAAA", filePath: path.join(dir, "src/foo.ts") });
  const res = runHook({ projectDir: dir, sessionId: "sessionAAAA", filePath: path.join(dir, "src/foo.ts") });
  assert.equal(res.stdout.trim(), "", "no warning when the same session re-edits its own claimed file");
}

// ── 4. Expired claims (>2h) are pruned and don't trigger a false collision ────
{
  const dir = freshProject();
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  writeFileSync(
    path.join(dir, ".claude", "claims.json"),
    JSON.stringify({ deadSession: { started: old, updated: old, surfaces: ["src/foo.ts"] }, _protocol: "x" }),
  );
  const res = runHook({ projectDir: dir, sessionId: "liveSession", filePath: path.join(dir, "src/foo.ts") });
  assert.equal(res.stdout.trim(), "", "an expired claim does not count as a collision");
  const claims = readClaims(dir);
  assert.ok(!claims.deadSession, "the expired claim is pruned");
  assert.ok(claims.liveSession, "the live session's claim replaces it");
}

// ── 5. Edits inside .worktrees/ are skipped (already isolated) ────────────────
{
  const dir = freshProject();
  const res = runHook({ projectDir: dir, sessionId: "wtSession", filePath: path.join(dir, ".worktrees/x/src/bar.ts") });
  assert.equal(res.status, 0, "hook exits 0 for worktree paths");
  assert.equal(res.stdout.trim(), "", "no output for worktree edits");
  assert.equal(readClaims(dir), null, "no claim recorded for an isolated worktree edit");
}

// ── 6. Edits under .claude/ and node_modules/ are not tracked ─────────────────
{
  const dir = freshProject();
  runHook({ projectDir: dir, sessionId: "s1", filePath: path.join(dir, ".claude/claims.json") });
  runHook({ projectDir: dir, sessionId: "s1", filePath: path.join(dir, "node_modules/pkg/index.js") });
  assert.equal(readClaims(dir), null, "coordination plumbing and deps are not claimed");
}

// ── 7. Garbage / empty stdin never fails the tool ─────────────────────────────
{
  const dir = freshProject();
  for (const input of ["not json", "", "{}", '{"tool_input":{}}']) {
    const res = spawnSync("node", [script], {
      input,
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    assert.equal(res.status, 0, `exits 0 on input ${JSON.stringify(input)}`);
    assert.equal(res.stdout.trim(), "", `no output on input ${JSON.stringify(input)}`);
  }
}

console.log("surface-claim-guard.test.mjs passed");
