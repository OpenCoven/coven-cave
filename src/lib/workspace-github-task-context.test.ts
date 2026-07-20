import assert from "node:assert/strict";
import { test } from "node:test";
import { attachGitHubTaskContext } from "./workspace-github-task-context.ts";
import type { SessionRow } from "./types.ts";

test("task context fills only absent PR state and preserves local session data", () => {
  const session = { id: "session-1", familiarId: "nova", git: { branch: "old" }, pullRequest: { repo: "a/b", number: 1, state: "open" } } as SessionRow;
  const [enriched] = attachGitHubTaskContext([session], [{
    id: "task-1", repo: "OpenCoven/coven-cave", issueNumber: 3498, issueTitle: "Phase B",
    status: "review", familiarId: "nova", familiarName: "Nova", sessionId: "session-1",
    branch: "agent/phase-b", prNumber: 12, prUrl: "https://example.test/pr/12", updatedAt: "2026-01-01T00:00:00.000Z",
  }]);
  assert.equal(enriched.git?.branch, "agent/phase-b");
  assert.deepEqual(enriched.pullRequest, session.pullRequest);
});

test("tasks without a session or PR do not allocate replacement rows", () => {
  const sessions = [{ id: "session-1" }] as SessionRow[];
  assert.equal(attachGitHubTaskContext(sessions, []), sessions);
});
