import assert from "node:assert/strict";
import { test } from "node:test";
import {
  afsSessionForCovenSession,
  buildChangeTree,
  changeTotal,
  commitAvailability,
  defaultCommitBranch,
  groupTimelineByTurn,
  isSelectableFileChange,
  mergeTimelinePages,
  mountAvailability,
  readAfsCapabilities,
  readAfsCommitPreview,
  readAfsCommitResult,
  readAfsFileDiff,
  unattributedPaths,
  type AfsCapabilities,
  type AfsChange,
  type AfsSession,
  type AfsTimelineEntry,
} from "./afs.ts";

const CAPS: AfsCapabilities = {
  afs: true,
  afsMount: false,
  afsCommit: true,
  afsCommitDryRun: true,
};

function session(overrides: Partial<AfsSession> = {}): AfsSession {
  return {
    id: "afs-1",
    name: null,
    state: "open",
    base: { fingerprint: "fp", commit: "abc", files: 2, skipped: 0 },
    binding: { sessionId: "sess-1", familiarId: null, beadId: null },
    changes: { added: 1, modified: 0, deleted: 0, bytes: 10 },
    ...overrides,
  };
}

function change(overrides: Partial<AfsChange> = {}): AfsChange {
  return { path: "/src/a.rs", change: "added", bytes: 1, attribution: "recorded", ...overrides };
}

test("capabilities read false against a daemon with no AFS support", () => {
  // Cave and the daemon ship decoupled, so an older daemon reports nothing.
  const unsupported = { afs: false, afsMount: false, afsCommit: false, afsCommitDryRun: false };
  assert.deepEqual(readAfsCapabilities({}), unsupported);
  assert.deepEqual(readAfsCapabilities(null), unsupported);
  assert.deepEqual(
    readAfsCapabilities({
      capabilities: {
        afs: true,
        afsMount: false,
        afsCommit: true,
        afsCommitDryRun: true,
      },
    }),
    { afs: true, afsMount: false, afsCommit: true, afsCommitDryRun: true },
  );
  assert.equal(
    readAfsCapabilities({ capabilities: { afsCommit: true } }).afsCommitDryRun,
    false,
    "older commit-capable daemons do not implicitly support dry runs",
  );
});

test("file diff payloads fail closed when an older daemon returns the change list", () => {
  assert.deepEqual(
    readAfsFileDiff({ path: "/a", patch: "@@", truncated: false, binary: false }),
    { path: "/a", patch: "@@", truncated: false, binary: false },
  );
  assert.equal(
    readAfsFileDiff({
      changes: [],
      counts: { added: 0, modified: 0, deleted: 0, bytes: 0 },
      truncated: false,
    }),
    null,
  );
});

test("commit previews require the daemon dry-run envelope", () => {
  const preview = {
    id: "afs-1",
    branch: "afs/afs-1",
    worktreePath: "/repo/.worktrees/afs-afs-1",
    provenanceHighWater: 42,
    counts: { added: 1, modified: 2, deleted: 3, bytes: 99 },
    files: 6,
    dryRun: true,
    wouldCommit: true,
  };
  assert.deepEqual(readAfsCommitPreview(preview), preview);
  assert.equal(readAfsCommitPreview({ ...preview, dryRun: false }), null);
  assert.equal(readAfsCommitPreview({ branch: "unexpected real commit response", commit: "abc" }), null);
});

test("real commit results require an attributable materialization envelope", () => {
  const result = {
    id: "afs-1",
    branch: "afs/afs-1",
    commit: "abc123",
    worktreePath: "/repo/.worktrees/afs-afs-1",
    provenanceHighWater: 43,
    state: "committed",
    counts: { added: 1, modified: 0, deleted: 0, bytes: 10 },
  };
  assert.deepEqual(readAfsCommitResult(result), result);
  assert.equal(readAfsCommitResult({ ...result, commit: "" }), null);
  assert.equal(readAfsCommitResult({ branch: result.branch }), null);
});

test("a mount backend name is carried through, false stays false", () => {
  assert.deepEqual(readAfsCapabilities({ capabilities: { afsMount: "nfs" } }).afsMount, "nfs");
  // An empty string is not a backend.
  assert.equal(readAfsCapabilities({ capabilities: { afsMount: "" } }).afsMount, false);
  assert.equal(mountAvailability(CAPS).enabled, false);
  assert.deepEqual(mountAvailability({ ...CAPS, afsMount: "nfs" }), { enabled: true, backend: "nfs" });
});

test("a session with no delta is absence, not failure", () => {
  assert.equal(afsSessionForCovenSession([], "sess-1"), null);
  assert.equal(afsSessionForCovenSession([session()], "other"), null);
  assert.equal(afsSessionForCovenSession([session()], ""), null);
});

test("discarded deltas are ignored and an open delta wins over a committed one", () => {
  const discarded = session({ id: "afs-old", state: "discarded" });
  assert.equal(afsSessionForCovenSession([discarded], "sess-1"), null);

  const committed = session({ id: "afs-done", state: "committed" });
  const open = session({ id: "afs-live", state: "open" });
  assert.equal(afsSessionForCovenSession([committed, open], "sess-1")?.id, "afs-live");
  // With no open delta, a committed one still surfaces as the audit record.
  assert.equal(afsSessionForCovenSession([committed], "sess-1")?.id, "afs-done");
});

test("commit is disabled with a reason for every blocking state", () => {
  const noCapability = commitAvailability({ ...CAPS, afsCommit: false }, session());
  assert.equal(noCapability.enabled, false);
  assert.match(noCapability.enabled ? "" : noCapability.reason, /afsCommit: false/);

  const noDelta = commitAvailability(CAPS, null);
  assert.equal(noDelta.enabled, false);

  const notOpen = commitAvailability(CAPS, session({ state: "committed" }));
  assert.equal(notOpen.enabled, false);
  assert.match(notOpen.enabled ? "" : notOpen.reason, /committed/);

  const empty = commitAvailability(CAPS, session({ changes: { added: 0, modified: 0, deleted: 0, bytes: 0 } }));
  assert.equal(empty.enabled, false);

  assert.deepEqual(commitAvailability(CAPS, session()), { enabled: true });
});

test("the default branch mirrors the daemon's own rule", () => {
  assert.equal(defaultCommitBranch({ id: "afs-1", name: null }), "afs/afs-1");
  assert.equal(defaultCommitBranch({ id: "afs-1", name: "tidy" }), "afs/tidy");
});

test("unattributed changes are reported so they can be marked", () => {
  const changes = [change(), change({ path: "/src/b.rs", attribution: "unknown" })];
  assert.deepEqual(unattributedPaths({ changes }), ["/src/b.rs"]);
});

test("known directories and symlinks are not selectable as file diffs", () => {
  assert.equal(isSelectableFileChange(change({ mode: 0o100644 })), true);
  assert.equal(isSelectableFileChange(change({ mode: 0o040755 })), false);
  assert.equal(isSelectableFileChange(change({ mode: 0o120777 })), false);
  assert.equal(
    isSelectableFileChange(change({ change: "deleted", ino: null, mode: null })),
    true,
    "deleted rows have no mode, so the daemon decides whether the path was a file",
  );
});

test("change total counts files, not bytes", () => {
  assert.equal(changeTotal({ added: 1, modified: 2, deleted: 3, bytes: 999 }), 6);
});

test("timeline groups by turn and keeps unbound entries last", () => {
  const entry = (seq: number, turn: number | null): AfsTimelineEntry => ({
    seq,
    op: "write",
    path: `/f${seq}`,
    bytes: 1,
    at: seq,
    turn,
    toolCall: null,
  });
  const groups = groupTimelineByTurn([entry(1, 2), entry(2, null), entry(3, 1), entry(4, 2)]);
  assert.deepEqual(
    groups.map((group) => group.turn),
    [1, 2, null],
  );
  // Order within a turn is the daemon's order, not re-sorted.
  assert.deepEqual(
    groups[1].entries.map((e) => e.seq),
    [1, 4],
  );
  // An operation nobody can account for is kept, never dropped.
  assert.equal(groups[2].entries.length, 1);
});

test("timeline pages merge by daemon sequence and replace duplicate rows", () => {
  const entry = (seq: number, op: string): AfsTimelineEntry => ({
    seq,
    op,
    path: `/f${seq}`,
    bytes: 1,
    at: seq,
    toolCall: null,
  });
  const merged = mergeTimelinePages(
    { entries: [entry(1, "write"), entry(2, "write")], nextCursor: 2, hasMore: true },
    { entries: [entry(2, "rename"), entry(3, "delete")], nextCursor: 3, hasMore: false },
  );
  assert.deepEqual(
    merged.entries.map(({ seq, op }) => ({ seq, op })),
    [
      { seq: 1, op: "write" },
      { seq: 2, op: "rename" },
      { seq: 3, op: "delete" },
    ],
  );
  assert.equal(merged.nextCursor, 3);
  assert.equal(merged.hasMore, false);
});

test("the change tree nests paths with directories before files", () => {
  const tree = buildChangeTree([
    change({ path: "/README.md" }),
    change({ path: "/src/b.rs" }),
    change({ path: "/src/a.rs" }),
  ]);
  assert.deepEqual(
    tree.map((node) => node.name),
    ["src", "README.md"],
  );
  const src = tree[0];
  assert.equal(src.change, null, "a synthesized directory carries no change");
  assert.deepEqual(
    src.children.map((node) => node.name),
    ["a.rs", "b.rs"],
  );
  assert.equal(src.children[0].path, "/src/a.rs");
  assert.equal(src.children[0].change?.change, "added");
});
