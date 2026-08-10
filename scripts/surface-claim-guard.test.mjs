// Tests for the surface-claim PreToolUse hook (scripts/surface-claim-guard.mjs).
// The hook must: record a session's claim on edited shared-checkout files, warn
// on cross-session collisions, prune expired claims, canonicalise worktree paths, and —
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

// ── 5. Edits inside .worktrees/ are CANONICALISED, not skipped (cave-ahc91) ───
// They were skipped, which made every session the hook exists to coordinate
// invisible to it: the convention mandates a worktree per concurrent session.
{
  const dir = freshProject();
  const res = runHook({ projectDir: dir, sessionId: "wtSession", filePath: path.join(dir, ".worktrees/x/src/bar.ts") });
  assert.equal(res.status, 0, "hook still never blocks");
  const claims = readClaims(dir);
  assert.ok(claims, "a worktree edit is recorded");
  assert.deepEqual(claims.wtSession.surfaces, ["src/bar.ts"], "surface is repo-relative, worktree prefix stripped");
  assert.equal(claims.wtSession.worktree, "x", "the claim records which worktree it came from");
}

// ── 5b. The same file in two different worktrees is ONE surface ───────────────
// The whole point: isolation protects the filesystem, not the reasoning.
{
  const dir = freshProject();
  runHook({ projectDir: dir, sessionId: "sessA", filePath: path.join(dir, ".worktrees/alpha/src/shared.ts") });
  const res = runHook({ projectDir: dir, sessionId: "sessB", filePath: path.join(dir, ".worktrees/beta/src/shared.ts") });
  assert.equal(res.status, 0, "still advisory");
  // Parse rather than regex the raw stdout: it is JSON, and matching the
  // envelope would be sensitive to escaping rather than to the message.
  const out = JSON.parse(res.stdout);
  assert.match(out.systemMessage, /Multi-session collision/, "collides across worktrees");
  assert.match(out.systemMessage, /src\/shared\.ts/, "names the canonical surface, not a worktree path");
  assert.match(out.systemMessage, /in worktree alpha/, "names the other session's worktree");
}

// ── 5c. A worktree edit collides with a primary-checkout edit of the same file ─
{
  const dir = freshProject();
  runHook({ projectDir: dir, sessionId: "primarySess", filePath: path.join(dir, "src/shared.ts") });
  const res = runHook({ projectDir: dir, sessionId: "wtSess", filePath: path.join(dir, ".worktrees/gamma/src/shared.ts") });
  const out = JSON.parse(res.stdout);
  assert.match(out.systemMessage, /Multi-session collision/, "primary and worktree edits are the same surface");
  assert.match(out.systemMessage, /src\/shared\.ts/, "names the canonical surface");
  assert.match(out.systemMessage, /on the primary checkout/, "names where the other session is working");
}

// ── 5d. The ledger stays in the primary checkout, never inside a worktree ─────
// Deriving it from the project root would give a worktree-rooted session its own
// claims.json, so no session would ever see another's — inertness by another route.
{
  const dir = freshProject();
  const wtRoot = path.join(dir, ".worktrees", "delta");
  mkdirSync(path.join(wtRoot, "src"), { recursive: true });
  const res = runHook({ projectDir: wtRoot, sessionId: "rootedInWt", filePath: path.join(wtRoot, "src/x.ts") });
  assert.equal(res.status, 0);
  assert.ok(readClaims(dir), "claim landed in the primary checkout's ledger");
  assert.equal(existsSync(path.join(wtRoot, ".claude", "claims.json")), false, "no ledger inside the worktree");
  assert.deepEqual(readClaims(dir).rootedInWt.surfaces, ["src/x.ts"], "surface is repo-relative");
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
