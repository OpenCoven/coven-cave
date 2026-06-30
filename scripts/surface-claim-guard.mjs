#!/usr/bin/env node
/**
 * surface-claim-guard.mjs — PreToolUse hook that operationalizes the
 * surface-claim coordination protocol (docs/multi-session-coordination.md §1).
 *
 * The protocol says sessions *should* record what surfaces they're touching in
 * `.claude/claims.json` and check for collisions before editing — but nothing
 * enforced it, so in practice nobody did (a 12-day-stale claim and clobbered
 * edits across 7 concurrent sessions is what prompted this). This hook makes the
 * protocol automatic and zero-discipline:
 *
 *   • On every Edit/Write/NotebookEdit to the SHARED primary checkout, it
 *     records this session's claim on the target file (keyed by session id).
 *   • If another live (non-expired) session already claimed that same file, it
 *     surfaces a collision warning to the user AND the model — so the second
 *     session can coordinate or move to a worktree instead of silently
 *     clobbering the first session's work.
 *
 * It is ADVISORY ONLY. It never blocks or fails a tool: on any error, or for any
 * path it doesn't care about, it exits 0 silently. Edits inside `.worktrees/`
 * are skipped — those sessions are already isolated, and their divergence
 * surfaces at PR/merge time (per the doc), which is the whole point of worktrees.
 *
 * Hook wiring lives in .claude/settings.json (PreToolUse, matcher
 * Edit|Write|NotebookEdit). claims.json stays gitignored — never committed.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

/** Claims older than this (no edit activity) are treated as dead and pruned. */
const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — matches the protocol doc.
/** Cap stored surfaces per session so the file can't grow without bound. */
const MAX_SURFACES = 60;

/** Read all of stdin. Returns "" if nothing arrives promptly. */
function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** Exit 0 silently — the only non-warning exit path. NEVER throw past here. */
function done(output) {
  if (output) process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

function shortId(id) {
  return typeof id === "string" && id.length > 8 ? id.slice(0, 8) : id || "unknown";
}

function relAge(ms, now) {
  const mins = Math.max(0, Math.round((now - ms) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    return done(); // No/garbled payload → nothing to do.
  }
  if (!input || typeof input !== "object") return done();

  const sessionId = typeof input.session_id === "string" ? input.session_id : "unknown";
  const toolInput = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const rawTarget =
    (typeof toolInput.file_path === "string" && toolInput.file_path) ||
    (typeof toolInput.notebook_path === "string" && toolInput.notebook_path) ||
    "";
  if (!rawTarget) return done();

  const projectRoot = process.env.CLAUDE_PROJECT_DIR || (typeof input.cwd === "string" ? input.cwd : process.cwd());
  const absTarget = path.resolve(projectRoot, rawTarget);

  // Edits inside a worktree are already isolated — skip. (Catches both a primary
  // session reaching into .worktrees/ and a session whose own root is one.)
  if (absTarget.split(path.sep).includes(".worktrees")) return done();

  const relPath = path.relative(projectRoot, absTarget);
  // Outside the project, or coordination plumbing itself — don't track.
  if (!relPath || relPath.startsWith("..") || relPath.startsWith(".claude" + path.sep) || relPath.startsWith("node_modules" + path.sep)) {
    return done();
  }
  const surface = relPath.split(path.sep).join("/");

  const claimsDir = path.join(projectRoot, ".claude");
  const claimsPath = path.join(claimsDir, "claims.json");
  const now = Date.now();

  // ── Load + prune ────────────────────────────────────────────────────────────
  let claims = {};
  if (existsSync(claimsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(claimsPath, "utf8"));
      if (parsed && typeof parsed === "object") claims = parsed;
    } catch {
      claims = {}; // Corrupt file — start fresh rather than break the edit.
    }
  }

  const isMeta = (k) => k.startsWith("_");
  const liveAt = (entry) => {
    const t = Date.parse(entry?.updated || entry?.started || "");
    return Number.isFinite(t) ? t : 0;
  };
  for (const key of Object.keys(claims)) {
    if (isMeta(key)) continue;
    if (now - liveAt(claims[key]) > TTL_MS) delete claims[key];
  }

  // ── Collision check (other live sessions claiming this exact surface) ─────────
  const collisions = [];
  for (const [key, entry] of Object.entries(claims)) {
    if (isMeta(key) || key === sessionId) continue;
    const surfaces = Array.isArray(entry?.surfaces) ? entry.surfaces : [];
    if (surfaces.includes(surface)) {
      collisions.push({ session: shortId(key), age: relAge(liveAt(entry), now), intent: entry?.intent });
    }
  }

  // ── Record / refresh this session's claim ─────────────────────────────────────
  const mine = claims[sessionId] && typeof claims[sessionId] === "object" ? claims[sessionId] : null;
  const surfaces = mine && Array.isArray(mine.surfaces) ? mine.surfaces : [];
  if (!surfaces.includes(surface)) surfaces.push(surface);
  claims[sessionId] = {
    started: mine?.started || new Date(now).toISOString(),
    updated: new Date(now).toISOString(),
    surfaces: surfaces.slice(-MAX_SURFACES),
    ...(mine?.intent ? { intent: mine.intent } : {}),
  };
  claims._protocol =
    "Surface-claim coordination (docs/multi-session-coordination.md §1), auto-maintained by scripts/surface-claim-guard.mjs. Gitignored — never committed. Entries expire after ~2h of inactivity.";
  claims._updated = new Date(now).toISOString();

  // Atomic write with a unique tmp name (concurrent writers must not collide on a
  // fixed tmp path — see the /api/theme write-race incident). Best-effort: any
  // failure is swallowed so a write hiccup never blocks the edit.
  try {
    if (!existsSync(claimsDir)) mkdirSync(claimsDir, { recursive: true });
    const tmp = path.join(claimsDir, `.claims.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
    writeFileSync(tmp, JSON.stringify(claims, null, 2));
    renameSync(tmp, claimsPath);
  } catch {
    /* best effort — never break the edit over a claims write */
  }

  if (collisions.length === 0) return done(); // Silent in the common case.

  const lines = collisions.map(
    (c) => `  • session ${c.session} claimed it ${c.age}${c.intent ? ` (intent: ${c.intent})` : ""}`,
  );
  const msg =
    `⚠️ Multi-session collision on \`${surface}\`:\n${lines.join("\n")}\n` +
    `Another Claude session may be editing this file on the shared checkout. Before continuing, ` +
    `confirm you won't clobber its work — coordinate with the user, or isolate in a worktree ` +
    `(git worktree add -b <branch> .worktrees/<branch> origin/main).`;

  return done({
    systemMessage: msg,
    hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: msg },
  });
}

try {
  main();
} catch {
  done(); // Absolute backstop: never fail the tool.
}
