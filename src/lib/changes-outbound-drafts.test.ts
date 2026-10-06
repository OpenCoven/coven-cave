// @ts-nocheck
import assert from "node:assert/strict";

const { commitSubject, createChangesOutboundStore, EMPTY_CHANGES_OUTBOUND, timedOutCommitLanded } = await import("./changes-outbound-drafts.ts");

// An unknown key reads as the shared empty entry, so a fresh panel renders
// without allocating anything.
{
  const store = createChangesOutboundStore();
  assert.equal(store.get("s1"), EMPTY_CHANGES_OUTBOUND);
  assert.equal(store.get(null), EMPTY_CHANGES_OUTBOUND);
}

// Patches merge and survive the panel: a typed message and a finished commit
// are still there for the next mount.
{
  const store = createChangesOutboundStore();
  let heard = 0;
  store.subscribe(() => { heard += 1; });
  store.patch("s1", { commitMessage: "Fix the retry" });
  store.patch("s1", { postCommit: { sha: "abc1234", headOid: "a".repeat(40), branch: "feat/x", onDefaultBranch: false } });
  const entry = store.get("s1");
  assert.equal(entry.commitMessage, "Fix the retry");
  assert.equal(entry.postCommit.branch, "feat/x");
  assert.equal(store.get("s1"), entry, "reads are stable between changes");
  assert.equal(heard, 2);
  // Another key is independent.
  assert.equal(store.get("s2"), EMPTY_CHANGES_OUTBOUND);
}

// Clearing every field drops the entry instead of keeping an empty one.
{
  const store = createChangesOutboundStore();
  store.patch("s1", { commitMessage: "x" });
  store.patch("s1", { commitMessage: "" });
  assert.equal(store.get("s1"), EMPTY_CHANGES_OUTBOUND);
}

// Bounded: the least recently touched key goes first.
{
  const store = createChangesOutboundStore(2);
  store.patch("a", { commitMessage: "a" });
  store.patch("b", { commitMessage: "b" });
  store.patch("a", { prTitle: "touch a" });
  store.patch("c", { commitMessage: "c" });
  assert.equal(store.get("b"), EMPTY_CHANGES_OUTBOUND, "b was the least recently touched");
  assert.equal(store.get("a").prTitle, "touch a");
  assert.equal(store.get("c").commitMessage, "c");
}

// A commit or Create PR in flight, and its failure, outlive the panel (#5756).
{
  const store = createChangesOutboundStore(2);
  store.patch("a", { pending: "commit" });
  assert.equal(store.get("a").pending, "commit", "an in-flight request alone keeps the entry");
  store.patch("a", { pending: null, error: { action: "Couldn't commit", message: "signing failed" } });
  assert.deepEqual(store.get("a").error, { action: "Couldn't commit", message: "signing failed" });
  store.patch("a", { error: null });
  assert.equal(store.get("a"), EMPTY_CHANGES_OUTBOUND, "an entry with nothing left in it goes");

  // The oldest entry is evicted first, but never one with a request in flight.
  store.patch("busy", { pending: "create-pr" });
  store.patch("b", { commitMessage: "b" });
  store.patch("c", { commitMessage: "c" });
  assert.equal(store.get("busy").pending, "create-pr", "an in-flight entry isn't evicted");
  assert.equal(store.get("b"), EMPTY_CHANGES_OUTBOUND);
}

// A commit's warning is kept on its own (#5795): the rail used to drop it, so a
// post-commit hook cut off at the time limit read as a plain success.
{
  const store = createChangesOutboundStore();
  store.patch("s1", { commitWarning: "the commit landed, but a hook after it was still running after 60 seconds" });
  assert.equal(store.get("s1").commitWarning, "the commit landed, but a hook after it was still running after 60 seconds", "a warning alone keeps the entry");
  store.patch("s1", { commitWarning: null });
  assert.equal(store.get("s1"), EMPTY_CHANGES_OUTBOUND);
  assert.equal(EMPTY_CHANGES_OUTBOUND.commitWarning, null);
}

// A commit the client gave up on is watched for (#5795): behind the
// repository lock it can land after the answer was given up on.
{
  const store = createChangesOutboundStore();
  const sent = { message: "Wire it", branch: "main", files: [{ path: "a.ts", changeVersion: "1:1:1" }], at: 1 };
  store.patch("s1", { timedOutCommit: sent });
  assert.equal(store.get("s1").timedOutCommit, sent, "the watch alone keeps the entry");
  store.patch("s1", { timedOutCommit: null });
  assert.equal(store.get("s1"), EMPTY_CHANGES_OUTBOUND);
  assert.equal(EMPTY_CHANGES_OUTBOUND.timedOutCommit, null);
  assert.equal(EMPTY_CHANGES_OUTBOUND.prExisted, false);
}

// Did it land? Only the change list can say.
{
  const sent = {
    message: "Wire it",
    branch: "main",
    files: [{ path: "a.ts", changeVersion: "1:1:1" }, { path: "b.ts", changeVersion: "2:2:2" }],
    at: 1,
  };
  const unchanged = [{ path: "a.ts", changeVersion: "1:1:1" }, { path: "b.ts", changeVersion: "2:2:2" }];
  assert.equal(timedOutCommitLanded(sent, { branch: "main", files: unchanged }), null, "still changed as reviewed: not yet");
  assert.equal(
    timedOutCommitLanded(sent, { branch: "cave/wire-it-abc", files: [{ path: "b.ts", changeVersion: "2:2:2" }] }),
    null,
    "one file still as it was: not this commit",
  );
  assert.deepEqual(
    timedOutCommitLanded(sent, { branch: "cave/wire-it-abc", files: [] }),
    { branch: "cave/wire-it-abc", newBranch: true, headOid: "" },
    "from the default branch it lands on a new cave/ branch",
  );
  assert.deepEqual(
    timedOutCommitLanded({ ...sent, branch: "feat/x" }, { branch: "feat/x", files: [{ path: "a.ts", changeVersion: "9:9:9" }] }),
    { branch: "feat/x", newBranch: false, headOid: "" },
    "on a feature branch it stays; a file written again since is a new change",
  );
  assert.equal(timedOutCommitLanded(sent, { branch: "release/2", files: [] }), null, "another branch altogether: something else happened");
  assert.equal(timedOutCommitLanded(sent, { branch: "HEAD", files: [] }), null, "a detached head names no branch");
  assert.equal(timedOutCommitLanded(sent, { branch: null, files: [] }), null);
  assert.equal(timedOutCommitLanded({ ...sent, files: [] }, { branch: "cave/x", files: [] }), null, "nothing was sent");

  // Pinned to its commit when the list's HEAD is it (#5807).
  const oid = "a".repeat(40);
  assert.equal(
    timedOutCommitLanded(sent, { branch: "cave/wire-it-abc", files: [], head: oid, headSubject: "Wire it" })?.headOid,
    oid,
    "HEAD carries the subject it was sent with: Create PR is pinned to it",
  );
  assert.equal(
    timedOutCommitLanded(sent, { branch: "cave/wire-it-abc", files: [], head: oid, headSubject: "Agent follow-up" })?.headOid,
    "",
    "another commit on top: the branch alone, as before",
  );
  assert.equal(
    timedOutCommitLanded(sent, { branch: "cave/wire-it-abc", files: [], head: "not-an-oid", headSubject: "Wire it" })?.headOid,
    "",
    "a malformed head is never sent as a pin",
  );
}

{
  assert.equal(commitSubject("Wire it"), "Wire it");
  assert.equal(commitSubject("  Wire it\n\nThe body explains.\n"), "Wire it", "the body is not the subject");
  assert.equal(commitSubject("Wire it\nacross two lines\n\nBody"), "Wire it across two lines", "git joins the first paragraph");
}

console.log("changes-outbound-drafts: ok");
