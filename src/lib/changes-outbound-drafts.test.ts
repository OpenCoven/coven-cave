// @ts-nocheck
import assert from "node:assert/strict";

const { createChangesOutboundStore, EMPTY_CHANGES_OUTBOUND } = await import("./changes-outbound-drafts.ts");

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

console.log("changes-outbound-drafts: ok");
