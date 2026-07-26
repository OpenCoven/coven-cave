// @ts-nocheck
/**
 * Tests for src/lib/server/chat-work-branch.ts (cave-9q24): per-conversation
 * work-branch capture — the per-session PR-attribution signal that keeps the
 * merged-PR auto-archive sweep from archiving unrelated chats.
 *
 *  1. cwdFromConversationRuntime parses "local:<cwd>" and rejects the rest
 *  2. captureWorkBranch reads the current branch from a real repo
 *  3. detached HEAD, non-repo dirs, and missing cwds all yield null
 *  4. the chat send route records the snapshot on BOTH transcript save paths
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureWorkBranch,
  cwdFromConversationRuntime,
} from "./chat-work-branch.ts";

// ── 1. runtime string parsing ────────────────────────────────────────────────
assert.equal(cwdFromConversationRuntime("local:/Users/dev/repo"), "/Users/dev/repo");
assert.equal(cwdFromConversationRuntime("local:  /Users/dev/repo  "), "/Users/dev/repo");
assert.equal(cwdFromConversationRuntime("local:"), null, "empty cwd is not a cwd");
assert.equal(cwdFromConversationRuntime("ssh:host:/srv/repo"), null, "ssh runtimes have no local cwd");
assert.equal(cwdFromConversationRuntime(undefined), null);
assert.equal(cwdFromConversationRuntime(null), null);

// ── 2–3. branch capture against a real repo ──────────────────────────────────
const scratch = mkdtempSync(path.join(tmpdir(), "chat-work-branch-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

const repo = path.join(scratch, "repo");
function git(...args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}
execFileSync("git", ["init", "-q", "-b", "feat/session-branch", repo], { encoding: "utf8" });
writeFileSync(path.join(repo, "file.txt"), "hello\n");
execFileSync(
  "git",
  ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"],
  { cwd: repo, encoding: "utf8" },
);

assert.equal(
  await captureWorkBranch(repo),
  "feat/session-branch",
  "the repo's current branch is the snapshot",
);

git("checkout", "-q", "--detach", "HEAD");
assert.equal(await captureWorkBranch(repo), null, "detached HEAD has no branch to record");

assert.equal(await captureWorkBranch(scratch), null, "non-repo dirs yield null");
assert.equal(await captureWorkBranch(path.join(scratch, "missing")), null, "missing cwds yield null");
assert.equal(await captureWorkBranch(null), null);

// ── 4. send-route wiring: snapshot recorded at every transcript save ─────────
const sendRoute = readFileSync(
  fileURLToPath(new URL("../../app/api/chat/send/route.ts", import.meta.url)),
  "utf8",
);
const captures = sendRoute.match(
  /const workBranch = await captureWorkBranch\(cwdFromConversationRuntime\(conv\.runtime\)\);\s*\n\s*if \(workBranch\) conv\.branch = workBranch;/g,
);
assert.equal(
  captures?.length,
  2,
  "both saveConversation paths (OpenClaw bridge + coven-run) must record the work branch",
);

console.log("chat-work-branch.test.ts: all assertions passed");
