// @ts-nocheck
import assert from "node:assert/strict";
import { blankChatProjectRoot, chatBrowseEmptyMessage, effectiveChatBrowseScope, retainOpenChatSession, scopeChatBrowseSessions } from "./chat-browse-scope.ts";
import { selectionKey } from "./chat-project-selection.ts";

const projects = [
  { id: "alpha", name: "Alpha", root: "/work/alpha/" },
  { id: "beta", name: "Beta", root: "/work/beta" },
];
const alpha = { id: "a", project_root: " /work\\alpha ", familiarId: "cody" };
const beta = { id: "b", project_root: "/work/beta", familiarId: "sage" };
const remote = {
  id: "remote",
  project_root: "/work/alpha",
  familiarId: "cody",
  runtime: "ssh:builder:/work/alpha",
};
const otherRemote = { ...remote, id: "other-remote", runtime: "ssh:other:/work/alpha" };
const sessions = [beta, alpha, remote, otherRemote];
const scope = { selection: "alpha", ready: true };

assert.deepEqual(scopeChatBrowseSessions(sessions, projects, {}, scope), [alpha],
  "Alpha cannot browse Beta or the same root on a remote runtime host; root normalization is shared");
assert.deepEqual(scopeChatBrowseSessions(sessions, projects, {}, {
  selection: selectionKey(null, "/work/alpha", "builder"), ready: true,
}), [remote], "remote selection is exact-host, not just same cwd");
assert.deepEqual(scopeChatBrowseSessions(sessions, projects, {}, { selection: "missing", ready: true }), [],
  "an unknown project never widens to all projects");
assert.deepEqual(scopeChatBrowseSessions(sessions, projects, {}, { ...scope, ready: false }), [],
  "retained registry results are masked while project context is loading or failed");
assert.deepEqual(scopeChatBrowseSessions(sessions, [projects[1]], {}, scope), [],
  "a revoked project is hidden even if old session rows remain");
assert.equal(scopeChatBrowseSessions(sessions, projects, {}, { selection: "all", ready: true }), sessions,
  "explicit All projects retains the unchanged input");
assert.deepEqual(scopeChatBrowseSessions(sessions, projects, {}, { selection: "all", ready: false }), [],
  "pre-hydration All is not an explicit project choice");
assert.equal(scopeChatBrowseSessions(sessions, projects, {}), sessions,
  "companion mounts without workspace browse scope retain existing behavior");
const moved = scopeChatBrowseSessions([beta], projects, { b: "/work/alpha" }, scope);
assert.deepEqual(moved, [beta], "organizational overrides participate in browsing");
assert.equal(moved[0], beta, "opening a rebucketed row preserves its original identity and cwd");
assert.equal(moved[0].project_root, "/work/beta");
assert.equal(retainOpenChatSession(beta, [alpha], "b"), beta,
  "an open Beta chat survives Alpha browse changes and familiar-scoped polls");
assert.equal(retainOpenChatSession(beta, [], "another"), null,
  "a previous chat's snapshot cannot supply context for another session");
assert.equal(retainOpenChatSession(beta, sessions, null), null,
  "a fresh compose drops the retained conversation");
const refreshed = { ...beta, title: "Updated" };
assert.equal(retainOpenChatSession(beta, [refreshed], "b"), refreshed,
  "fresh session metadata supersedes the retained snapshot");
assert.equal(blankChatProjectRoot(undefined, undefined, "alpha", "/work/alpha"), "/work/alpha",
  "a blank compose follows a newly hydrated workspace project without navigation");
assert.equal(blankChatProjectRoot("/work/alpha/.worktrees/task", "alpha", "alpha", "/work/alpha"), "/work/alpha/.worktrees/task",
  "the same global project never erases an explicit task/worktree launch cwd");
assert.equal(blankChatProjectRoot("/work/alpha/.worktrees/task", "alpha", "beta", "/work/beta"), "/work/beta",
  "a deliberate global project switch updates even an opener-bound blank compose");
assert.equal(blankChatProjectRoot("/work/alpha", "alpha", "all", null), undefined,
  "clearing the project does not keep the prior project's explicit blank-compose root");
assert.equal(blankChatProjectRoot("/work/task", undefined, undefined, "/ignored"), "/work/task",
  "companion routers without workspace scope retain their opener root");
console.log("chat-browse-scope.test.ts: ok");

// #5585: loading is not an error, and every surface shares one readiness rule.
{
  const loaded = { loaded: true, loading: false, error: null };
  const fetching = { loaded: false, loading: true, error: null };
  const failed = { loaded: false, loading: false, error: "boom" };
  const alphaScope = { selection: "alpha", ready: true };

  assert.deepEqual(effectiveChatBrowseScope(alphaScope, loaded), { ...alphaScope, ready: true, loading: false });
  assert.deepEqual(effectiveChatBrowseScope(alphaScope, fetching), { ...alphaScope, ready: false, loading: true },
    "a familiar switch refetching projects is loading, not unavailable");
  assert.deepEqual(effectiveChatBrowseScope(alphaScope, failed), { ...alphaScope, ready: false, loading: false },
    "a failed project fetch is unavailable");
  assert.deepEqual(effectiveChatBrowseScope({ selection: "all", ready: true }, fetching), { selection: "all", ready: true, loading: false },
    "All needs no project fetch");
  assert.equal(effectiveChatBrowseScope({ selection: "alpha", ready: false, loading: true }, loaded).loading, true,
    "a workspace still hydrating stays loading");
  assert.equal(effectiveChatBrowseScope({ selection: "alpha", ready: false }, loaded).loading, false,
    "a workspace that is not ready for another reason is unavailable");
  assert.equal(effectiveChatBrowseScope(undefined, loaded), undefined);

  assert.equal(chatBrowseEmptyMessage({ selection: "alpha", ready: false, loading: true }), "Loading this project's chats…");
  assert.equal(chatBrowseEmptyMessage({ selection: "alpha", ready: false, loading: false }), "Project context is unavailable. Choose another project or retry.");
  assert.equal(chatBrowseEmptyMessage({ selection: "alpha", ready: true }), "No chats in this project. Start a chat or choose another project.");
  assert.equal(chatBrowseEmptyMessage({ selection: "all", ready: true }), "No conversations yet.");
  assert.equal(chatBrowseEmptyMessage(undefined), "No conversations yet.");
  assert.equal(chatBrowseEmptyMessage({ selection: "alpha", ready: false }, true), "No threads match your search.");
}

