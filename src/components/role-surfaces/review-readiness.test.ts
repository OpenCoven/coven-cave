import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createElement, type ReactElement } from "react";
import type { SessionRow } from "@/lib/types";

import {
  checksMeta,
  countedTotal,
  DECK_BUCKETS,
  deckCaption,
  deckSummary,
  draftChangeRequest,
  evidenceItems,
  failingCheckNames,
  isReadyToMerge,
  isTerminalPr,
  mergeChecklist,
  mergeChecklistScore,
  prBlockers,
  readinessBanner,
  reviewBucket,
  reviewStateMeta,
  type PrFacts,
} from "./review-readiness.ts";
import { matchesReviewQuery, prKey, reviewQueue } from "./review-deck.ts";
import { BUCKET_READ_CAP, createDeckBucketStore } from "./review-deck-store.ts";
import { parseReviewItem, readReviewJson } from "./review-github-read.ts";
import { parseReadinessChecks, parseReadinessComments, usePrReadiness, type PrReadiness } from "./use-pr-readiness.ts";
import { useReviewDeckModel, type ReviewDeckModel } from "./use-review-deck-model.ts";
import { useReviewSource, type ReviewSource } from "./use-review-source.ts";
import { reviewActionsAvailable } from "./review-workbench-model.ts";
import type { ReviewSourceFilter } from "./review-queue";

const { act, create }: {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: ReactElement) => { update: (element: ReactElement) => void; unmount: () => void };
} = createRequire(import.meta.url)("react-test-renderer");

/** A pull request GitHub reports as clean, approved, and safe to land. */
function facts(overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    repo: "o/r",
    number: 7,
    state: "open",
    draft: false,
    merged: false,
    headRef: "feat/x",
    baseRef: "main",
    headSha: "abcdef1234".repeat(4),
    baseSha: "b".repeat(40),
    commits: 2,
    additions: 10,
    deletions: 3,
    changedFiles: 2,
    mergeable: true,
    mergeableState: "clean",
    reviews: { approved: 1, changesRequested: 0, commented: 0 },
    latestReview: { state: "APPROVED", author: "reviewer", submittedAt: "2026-07-30T10:00:00Z" },
    checks: { rollup: "passing", runs: [] },
    threads: { unresolved: 0, total: 0, canResolve: true, items: [] },
    ...overrides,
  };
}

function run(name: string, conclusion: string | null, status = "completed") {
  return { name, status, conclusion, detailsUrl: null };
}

function queueSession(id: string, overrides: Partial<{
  pullRequest: { repo: string; number: number } | null;
  diff: { additions: number; deletions: number } | null;
  updated_at: string;
}> = {}) {
  return {
    id, title: "Raw session prompt", archived_at: null,
    harness: "copilot", status: "completed", exit_code: 0,
    created_at: "2026-09-13T10:00:00Z",
    attention: { state: "none", since: null, reason: null },
    git: { branch: "fix/queue" }, workBranch: null,
    project_root: "/work/repository",
    pullRequest: null, diff: null, updated_at: "2026-09-13T10:00:00Z",
    ...overrides,
  } satisfies SessionRow;
}

function itemWire() {
  return {
    ok: true, isPull: true, state: "open", merged: false, draft: false,
    title: "Actual GitHub change title", pull: { ...facts() },
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

for (const transition of ["selection", "refresh"] as const) {
  test(`a batched A completion and ${transition} cannot attach cached patch A to revision B`, async (t) => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
    t.after(() => { Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); });
    const pending: Array<(response: Response) => void> = [];
    let headSha = "a".repeat(40);
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/diff?")) return new Promise<Response>((resolve) => { pending.push(resolve); });
      if (url.includes("/item?")) return Response.json({ ...itemWire(), pull: { ...facts(), headSha } });
      if (url.includes("/checks?")) return Response.json({ ok: true, sha: headSha, runs: [run("build", "success")], statuses: [] });
      if (url.includes("/comments?")) return Response.json({ ok: true, reviewEvidenceComplete: true, reviews: [], reviewThreads: [] });
      throw new Error(`Unexpected read: ${url}`);
    });
    const response = (number: number, sha: string, patch: string) => Response.json({
      ok: true, revision: { repo: "o/r", number, headSha: sha, baseSha: facts().baseSha, baseRef: "main", mergeBaseSha: "c".repeat(40) },
      files: [{ filename: "shared.ts", patch }],
    });
    let source!: ReviewSource;
    let readiness!: PrReadiness;
    const displayed: Array<{ selected: number; revision: string | undefined; patch: string | null; filePatch: string | null | undefined; canAct: boolean }> = [];
    function Probe({ number }: { number: number }) {
      source = useReviewSource({ pr: { repo: "o/r", number }, projectRoot: null, scope: "same-session" });
      readiness = usePrReadiness({ repo: "o/r", number });
      displayed.push({
        selected: number, revision: source.revision?.headSha, patch: source.openPatch.text,
        filePatch: source.files.find((file) => file.path === source.openPath)?.patch,
        canAct: reviewActionsAvailable({
          sourceKind: source.kind,
          sourcePhase: source.files.length === 0 || source.openPatch.phase === "ready" ? source.phase : "loading",
          displayedRevision: source.revision, currentRevision: readiness.facts,
          readinessPhase: readiness.phase, state: readiness.facts?.state, draft: readiness.facts?.draft,
        }),
      });
      return null;
    }
    let root!: ReturnType<typeof create>;
    try {
      await act(async () => { root = create(createElement(Probe, { number: 7 })); });
      const retry = source.retry;
      await act(async () => {
        pending[0](response(7, headSha, "+patch A"));
        // Let real Response.json queue A's state updates, but retain React's
        // batch while changing selection / starting the next generation.
        await settle();
        headSha = "d".repeat(40);
        if (transition === "selection") root.update(createElement(Probe, { number: 8 }));
        else { retry(); readiness.refresh(); }
      });
      assert.equal(source.phase, "loading");
      const loadingPatch = source.openPatch.text;
      await act(async () => { pending[1](response(transition === "selection" ? 8 : 7, headSha, "+patch B")); });
      assert.equal(source.revision?.headSha, headSha);
      assert.equal(source.files[0].patch, "+patch B");
      assert.equal(readiness.phase, "ready");
      assert.equal(isReadyToMerge(readiness.facts), true);
      assert.equal(displayed.at(-1)?.canAct, true);
      assert.equal(source.openPatch.text, "+patch B", "rendered patch must belong to the displayed revision's file list");
      assert.equal(loadingPatch, null, "loading B must not expose a cached A patch");
      for (const render of displayed.filter((render) => render.canAct)) {
        assert.equal(render.patch, render.filePatch, "an enabled verdict must never authorize a different cached patch");
      }
    } finally {
      if (root) await act(async () => { root.unmount(); });
    }
  });
}

test("batched local list completion cannot open an old file under the replacement project", async (t) => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
  t.after(() => { Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); });
  const pending: Array<{ project: string; path: string | null; resolve: (response: Response) => void }> = [];
  t.mock.method(globalThis, "fetch", (input: string | URL | Request) => new Promise<Response>((resolve) => {
    const url = new URL(String(input), "http://localhost");
    assert.equal(url.pathname, "/api/changes");
    pending.push({ project: url.searchParams.get("projectRoot")!, path: url.searchParams.get("path"), resolve });
  }));
  let source!: ReviewSource;
  function Probe({ project }: { project: string }) {
    source = useReviewSource({ pr: null, projectRoot: project, scope: "same-session" });
    return null;
  }
  const list = (project: string, path: string) => Response.json({
    ok: true, repo: true, repoRoot: project, branch: "main", worktree: null,
    files: [{ path, status: "modified", insertions: 1, deletions: 0 }],
  });
  let root!: ReturnType<typeof create>;
  try {
    await act(async () => { root = create(createElement(Probe, { project: "/A" })); });
    await act(async () => {
      pending[0].resolve(list("/A", "old.ts"));
      await settle();
      root.update(createElement(Probe, { project: "/B" }));
    });
    assert.deepEqual(pending.map(({ project, path }) => ({ project, path })), [
      { project: "/A", path: null }, { project: "/B", path: null },
    ], "a stale auto-open must not read old.ts under project B");
    await act(async () => { pending[1].resolve(list("/B", "current.ts")); });
    assert.equal(pending[2].path, "current.ts");
    await act(async () => { source.retry(); });
    await act(async () => { pending[3].resolve(list("/B", "current.ts")); });
    await act(async () => { pending[4].resolve(Response.json({ ok: true, diff: "+current local B" })); });
    await act(async () => { pending[2].resolve(Response.json({ ok: true, diff: "+outdated local B" })); });
    assert.equal(source.openPatch.text, "+current local B");
    assert.equal(source.localBranch, "main");
    assert.equal(source.kind, "local");
    assert.equal(source.revision, null);
  } finally {
    if (root) await act(async () => { root.unmount(); });
  }
});

test("production source A plus readiness B cannot enable a verdict; matching revisions can", async (t) => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
  t.after(() => { Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); });
  const revision = {
    repo: "o/r", number: 7, headSha: facts().headSha,
    baseSha: "b".repeat(40), baseRef: "main", mergeBaseSha: "c".repeat(40),
  };
  const newer = { ...facts(), headSha: "d".repeat(40) };
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/item?")) return Response.json({ ...itemWire(), pull: newer });
    if (url.includes("/checks?")) return Response.json({ ok: true, sha: newer.headSha, runs: [], statuses: [] });
    if (url.includes("/comments?")) return Response.json({ ok: true, reviewEvidenceComplete: true, reviews: [], reviewThreads: [] });
    return Response.json({ ok: true, revision, files: [{ filename: "a.ts", patch: "+revision A" }] });
  });
  let source!: ReviewSource;
  let readiness!: PrReadiness;
  function Probe() {
    source = useReviewSource({ pr: { repo: "o/r", number: 7 }, projectRoot: null, scope: "session" });
    readiness = usePrReadiness({ repo: "o/r", number: 7 });
    return null;
  }
  let root!: ReturnType<typeof create>;
  try {
    await act(async () => { root = create(createElement(Probe)); });
    assert.equal(source.openPatch.text, "+revision A");
    const input = {
      sourceKind: source.kind, sourcePhase: source.phase,
      displayedRevision: source.revision,
      currentRevision: readiness.facts,
      readinessPhase: readiness.phase, state: readiness.facts?.state, draft: readiness.facts?.draft,
    };
    assert.equal(reviewActionsAvailable(input), false, "diff A / facts B must not enable approval");
    assert.equal(reviewActionsAvailable({ ...input, currentRevision: revision }), true);
    for (const currentRevision of [
      { ...revision, baseSha: "e".repeat(40) },
      { ...revision, baseRef: "release" },
      { ...revision, repo: "other/repo" },
      { ...revision, number: 8 },
      null,
    ]) assert.equal(reviewActionsAvailable({ ...input, currentRevision }), false);
    assert.equal(reviewActionsAvailable({ ...input, currentRevision: revision, sourcePhase: "loading" }), false);
    assert.equal(reviewActionsAvailable({ ...input, currentRevision: revision, displayedRevision: null }), false);
  } finally {
    if (root) await act(async () => { root.unmount(); });
  }
});

test("unidentified diffs and wrong-PR responses are errors, never actionable sources", async (t) => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
  t.after(() => { Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); });
  let revision: unknown;
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true, revision, files: [] }));
  let source!: ReviewSource;
  function Probe() {
    source = useReviewSource({ pr: { repo: "o/r", number: 7 }, projectRoot: null, scope: "session" });
    return null;
  }
  let root!: ReturnType<typeof create>;
  try {
    await act(async () => { root = create(createElement(Probe)); });
    assert.equal(source.phase, "error");
    assert.match(source.error!, /revision/i);
    revision = { repo: "o/r", number: 8, headSha: facts().headSha, baseSha: "b".repeat(40), baseRef: "main", mergeBaseSha: "c".repeat(40) };
    await act(async () => { source.retry(); });
    assert.equal(source.phase, "error");
    assert.equal(source.revision, null);
  } finally {
    if (root) await act(async () => { root.unmount(); });
  }
});

test("a retained source retry refreshes the current selection after a late mutation", async (t) => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
  t.after(() => { Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); });
  const reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const number = new URL(String(input), "http://localhost").searchParams.get("number")!;
    reads.push(number);
    return Response.json({ ok: true, total: 1, revision: {
      repo: "o/r", number: Number(number), headSha: facts().headSha,
      baseSha: facts().baseSha, baseRef: "main", mergeBaseSha: "c".repeat(40),
    }, files: [{
      filename: `${number}.ts`, status: "modified", additions: 1, deletions: 0,
      patch: "@@ -0,0 +1 @@\n+export const ready = true;",
    }] });
  });

  let source!: ReviewSource;
  function Probe({ number }: { number: number }) {
    source = useReviewSource({ pr: { repo: "o/r", number }, projectRoot: null, scope: `session-${number}` });
    return null;
  }
  let root!: ReturnType<typeof create>;
  try {
    await act(async () => { root = create(createElement(Probe, { number: 7 })); });
    const lateRetry = source.retry;
    await act(async () => { root.update(createElement(Probe, { number: 8 })); });
    assert.equal(source.phase, "ready");
    await act(async () => { lateRetry(); });
    assert.deepEqual(reads, ["7", "8", "8"]);
    assert.equal(source.phase, "ready");
    assert.equal(source.openPath, "8.ts");
    assert.equal(source.retry, lateRetry);
  } finally {
    if (root) await act(async () => { root.unmount(); });
  }
});

test("PR changes within one session mask ready data before effects and discard late reads", async (t) => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
    t.after(() => { Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); });
    const pending: Array<{ number: number; resolve: (value: Response) => void }> = [];
    t.mock.method(globalThis, "fetch", (input: string | URL | Request) => new Promise<Response>((resolve) => {
      pending.push({ number: Number(new URL(String(input), "http://localhost").searchParams.get("number")), resolve });
    }));
    let source!: ReviewSource;
    const renders: Array<{ number: number; phase: string; files: number; revision: unknown }> = [];
    function Probe({ number }: { number: number }) {
      source = useReviewSource({ pr: { repo: "o/r", number }, projectRoot: null, scope: "same-session" });
      renders.push({ number, phase: source.phase, files: source.files.length, revision: source.revision });
      return null;
    }
    const response = (number: number, headSha = facts().headSha) => Response.json({
      ok: true, revision: { repo: "o/r", number, headSha, baseSha: facts().baseSha, baseRef: "main", mergeBaseSha: "c".repeat(40) },
      files: [{ filename: `${number}.ts`, patch: `+PR ${number}` }],
    });
    let root!: ReturnType<typeof create>;
    try {
      await act(async () => { root = create(createElement(Probe, { number: 7 })); });
      await act(async () => { pending[0].resolve(response(7)); });
      assert.equal(source.phase, "ready");
      await act(async () => { root.update(createElement(Probe, { number: 8 })); });
      const first = renders.find((render) => render.number === 8)!;
      assert.deepEqual(first, { number: 8, phase: "loading", files: 0, revision: null });
      await act(async () => { root.update(createElement(Probe, { number: 9 })); });
      await act(async () => { pending[2].resolve(response(9)); });
      await act(async () => { pending[1].resolve(response(8, "d".repeat(40))); });
      assert.equal(source.revision?.number, 9);
      assert.equal(source.openPatch.text, "+PR 9");
      await act(async () => { source.retry(); source.retry(); });
      await act(async () => { pending[4].resolve(response(9, "e".repeat(40))); });
      await act(async () => { pending[3].resolve(response(9, "f".repeat(40))); });
      assert.equal(source.revision?.headSha, "e".repeat(40), "older refresh must not overwrite the displayed revision");
    } finally {
      if (root) await act(async () => { root.unmount(); });
    }
});

test("279 clean branch sessions never inflate the actionable queue; browsing preserves them", () => {
  const branches = Array.from({ length: 279 }, (_, i) => queueSession(`branch-${i}`));
  const prs = Array.from({ length: 6 }, (_, i) =>
    queueSession(`pr-${i}`, { pullRequest: { repo: "o/r", number: i + 1 } }));
  const sessions = [...branches, ...prs];
  assert.equal(reviewQueue(sessions).length, 6);
  assert.equal(reviewQueue(sessions, { includeBranches: true }).length, 285);
  const terminal = new Map(prs.map((session) => [
    prKey(session.pullRequest!), facts({ state: "closed", merged: true }),
  ]));
  const active = reviewQueue(sessions).filter((item) => {
    const pr = item.session.pullRequest;
    return !pr || !isTerminalPr(terminal.get(prKey(pr)));
  });
  assert.equal(active.length, 0);
  assert.deepEqual(deckSummary(prs.map(() => reviewBucket(facts({ state: "closed" }), true))), {
    awaiting: 0, changes: 0, blocked: 0, ready: 0,
  });
});

test("PR identity deduplicates case-insensitively with stable session selection", () => {
  const a = queueSession("a", { pullRequest: { repo: "O/R", number: 7 } });
  const b = queueSession("b", { pullRequest: { repo: "o/r", number: 7 } });
  const other = queueSession("c", { pullRequest: { repo: "else/r", number: 7 } });
  assert.deepEqual(reviewQueue([b, other, a]).map(({ session }) => session.id), ["a", "c"]);
  b.updated_at = "2026-09-14T10:00:00Z";
  assert.deepEqual(reviewQueue([a, b, other]).map(({ session }) => session.id), ["a", "c"]);
  assert.equal(reviewQueue([queueSession("local", { diff: { additions: 3, deletions: 0 } })]).length, 1);
  assert.equal(reviewQueue([a])[0].session, a, "the representative is the real session, not a synthesized copy");
});

test("queue search matches GitHub title, PR reference, repository and branch", () => {
  const session = queueSession("a", { pullRequest: { repo: "OpenCoven/coven-cave", number: 123 } });
  for (const query of ["real change", "  #123  ", "OPENCOVEN", "fix/queue", "repository", "coven-cave change"]) {
    assert.equal(matchesReviewQuery(session, query, "Real change title"), true, query);
  }
  assert.equal(matchesReviewQuery(session, "missing title", "Real change title"), false);
  assert.equal(matchesReviewQuery(session, "", "Real change title"), true);
});

test("item reads use GitHub title and stats, never malformed-open or missing-zero facts", () => {
  const parsed = parseReviewItem(itemWire());
  assert.equal(parsed.title, "Actual GitHub change title");
  assert.equal(parsed.additions, 10);
  assert.equal(parsed.deletions, 3);
  assert.equal(parsed.statsKnown, true);
  for (const state of [undefined, null, "", "unknown", 42]) {
    assert.throws(() => parseReviewItem({ ...itemWire(), state }), /incomplete/);
  }
  assert.throws(() => parseReviewItem({ ...itemWire(), pull: null }), /unavailable/);
  assert.throws(() => parseReviewItem({ ...itemWire(), pull: { ...facts(), reviews: {} } }), /unavailable/);
  assert.equal(isTerminalPr(parseReviewItem({ ...itemWire(), state: "closed", pull: null })), true);
  const missingStats = parseReviewItem({ ...itemWire(), pull: { ...facts(), additions: undefined } });
  assert.equal(missingStats.additions, undefined);
  assert.equal(missingStats.statsKnown, false);
});

test("missing checks/head and malformed threads fail explicitly rather than empty-green", () => {
  assert.throws(() => parseReadinessChecks({ ok: true, runs: [], statuses: [] }), /incomplete/);
  assert.throws(() => parseReadinessChecks({ ok: true, sha: "head", runs: [null], statuses: [] }), /incomplete/);
  assert.throws(() => parseReadinessComments({ ok: true }), /incomplete/);
  assert.throws(() => parseReadinessComments({ ok: true, reviews: [], reviewThreads: [] }), /incomplete/);
  assert.throws(() => parseReadinessComments({ ok: true, reviewEvidenceComplete: true, reviews: [], reviewThreads: [null] }), /incomplete/);
  assert.deepEqual(parseReadinessComments({ ok: true, reviewEvidenceComplete: true, reviews: [], reviewThreads: [] }).reviewThreads, []);
});

test("open PR item reads require the same exact head SHA as verdict mutations", () => {
  for (const headSha of [undefined, null, "", "abcdef1234567890", "g".repeat(40), "a".repeat(41)]) {
    assert.throws(() => parseReviewItem({ ...itemWire(), pull: { ...facts(), headSha } }), /head SHA/);
  }
  assert.equal(parseReviewItem({
    ...itemWire(), pull: { ...facts(), headSha: ` ${"A".repeat(40)} ` },
  }).headSha, "a".repeat(40));
  assert.equal(isTerminalPr(parseReviewItem({ ...itemWire(), state: "closed", pull: null })), true);
});

test("queue reads cap unique PRs at twelve and run at most three concurrently", async () => {
  let active = 0;
  let peak = 0;
  const reads: number[] = [];
  const store = createDeckBucketStore(async (pr) => {
    reads.push(pr.number);
    peak = Math.max(peak, ++active);
    await settle();
    active -= 1;
    return facts({ number: pr.number });
  });
  const prs = Array.from({ length: 14 }, (_, i) => ({ repo: "o/r", number: i + 1 }));
  store.setPullRequests(prs.flatMap((pr) => [pr, { ...pr, repo: "O/R" }]));
  while (store.getSnapshot().loading) await settle();
  assert.equal(reads.length, BUCKET_READ_CAP);
  assert.equal(new Set(reads).size, BUCKET_READ_CAP);
  assert.equal(peak, 3);
  assert.equal(store.getSnapshot().skipped, 2);
  store.setPullRequests([...prs].reverse());
  while (store.getSnapshot().loading) await settle();
  assert.equal(reads.length, 14, "only newly admitted unread identities need a read");
  store.cancel();
});

test("selected terminal facts supersede an older queue response without replacing other facts", async () => {
  let resolve!: (value: ReturnType<typeof facts>) => void;
  const store = createDeckBucketStore(async (pr) => pr.number === 7
    ? new Promise<ReturnType<typeof facts>>((done) => { resolve = done; })
    : facts({ number: pr.number }));
  store.setPullRequests([{ repo: "o/r", number: 7 }, { repo: "o/r", number: 8 }]);
  await settle();
  store.recordFacts(facts({ state: "closed", merged: true }));
  resolve(facts());
  await settle();
  assert.equal(isTerminalPr(store.getSnapshot().facts.get("o/r#7")), true);
  assert.equal(store.getSnapshot().facts.has("o/r#8"), true);
  assert.equal(store.getSnapshot().loading, false);
  store.cancel();
});

test("refresh aborts the old generation, exposes errors, and does not resurrect terminal PRs", async () => {
  let oldSignal!: AbortSignal;
  let resolve!: (value: ReturnType<typeof facts>) => void;
  let reads = 0;
  const store = createDeckBucketStore(async (_pr, signal) => {
    reads += 1;
    if (reads === 1) {
      oldSignal = signal;
      return new Promise<ReturnType<typeof facts>>((done) => { resolve = done; });
    }
    throw new Error("offline");
  });
  store.setPullRequests([{ repo: "o/r", number: 7 }]);
  store.recordFacts(facts({ state: "closed", merged: true }));
  store.refresh();
  assert.equal(oldSignal.aborted, true);
  await settle();
  resolve(facts());
  await settle();
  assert.equal(isTerminalPr(store.getSnapshot().facts.get("o/r#7")), true);
  assert.match(store.getSnapshot().error!, /o\/r#7: offline/);
  assert.equal(store.getSnapshot().loading, false);
  store.cancel();
});

test("failed refresh removes stale green and can recover on an explicit retry", async () => {
  let fail = false;
  const store = createDeckBucketStore(async () => {
    if (fail) throw new Error("denied");
    return facts();
  });
  store.setPullRequests([{ repo: "o/r", number: 7 }]);
  await settle();
  fail = true;
  store.refresh();
  assert.equal(store.getSnapshot().facts.size, 0);
  await settle();
  assert.match(store.getSnapshot().error!, /denied/);
  fail = false;
  store.refresh();
  await settle();
  assert.equal(store.getSnapshot().facts.size, 1);
  assert.equal(store.getSnapshot().error, null);
  store.cancel();
});

test("GitHub reads bound hung transports and report HTTP/JSON failures", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => new Promise<Response>(() => {}));
  await assert.rejects(readReviewJson("/item", controller.signal, 5), /timed out/);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true }, { status: 403 }));
  await assert.rejects(readReviewJson("/item", controller.signal), /HTTP 403/);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => new Response("not JSON"));
  await assert.rejects(readReviewJson("/item", controller.signal), SyntaxError);
  controller.abort();
  await assert.rejects(readReviewJson("/item", controller.signal), /abort/i);
});

test("queue hook derives unique actionable counts, filters, search, and selected reconciliation", async (t) => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
  t.after(() => { Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); });
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const number = Number(new URL(String(input), "http://localhost").searchParams.get("number"));
    if (number === 9) return Response.json({ ok: false }, { status: 403 });
    return Response.json({
      ...itemWire(), draft: number === 8, state: number === 7 ? "closed" : "open", merged: number === 7,
    });
  });
  const sessions = [
    ...[7, 8, 9, 10].map((number) => queueSession(`pr-${number}`, { pullRequest: { repo: "o/r", number } })),
    queueSession("z-duplicate", { pullRequest: { repo: "O/R", number: 10 } }),
    queueSession("local", { diff: { additions: 4, deletions: 2 } }),
    queueSession("branch"),
  ];
  let model!: ReviewDeckModel;
  function Probe({ filter = "all", query = "", bucket = null }: {
    filter?: ReviewSourceFilter; query?: string; bucket?: "awaiting" | null;
  }) {
    model = useReviewDeckModel({ sessions, sourceFilter: filter, query, bucketFilter: bucket, sort: "attention" });
    return null;
  }
  let root!: ReturnType<typeof create>;
  try {
    await act(async () => { root = create(createElement(Probe)); });
    assert.equal(model.counts.queue, 4);
    assert.equal(model.counts.pullRequests, 3);
    assert.equal(model.all.length, 5);
    assert.equal(model.ordered.length, 4);
    assert.deepEqual(model.summary, { awaiting: 0, changes: 0, blocked: 0, ready: 1 });
    assert.match(model.error!, /HTTP 403/);
    const refresh = model.refresh;
    const recordFacts = model.recordFacts;
    await act(async () => { root.update(createElement(Probe, { query: "actual title #10" })); });
    assert.deepEqual(model.ordered.map(({ id }) => id), ["pr-10"]);
    const row = model.groups[0].items[0];
    assert.equal(row.title, "Actual GitHub change title");
    assert.equal(row.additions, 10);
    assert.equal(row.deletions, 3);
    await act(async () => { root.update(createElement(Probe, { filter: "local" })); });
    assert.deepEqual(model.ordered.map(({ id }) => id), ["local"]);
    await act(async () => { root.update(createElement(Probe, { filter: "branches" })); });
    assert.deepEqual(model.ordered.map(({ id }) => id), ["branch"]);
    await act(async () => { root.update(createElement(Probe, { bucket: "awaiting" })); });
    assert.deepEqual(model.ordered, []);
    assert.equal(model.refresh, refresh);
    assert.equal(model.recordFacts, recordFacts);
    await act(async () => { model.recordFacts(facts({ number: 10, state: "closed", merged: true })); });
    assert.equal(model.all.some(({ session }) => session.id === "pr-10"), false);
    assert.equal(model.counts.queue, 3);
    assert.equal(model.all.some(({ session }) => session.id === "local"), true);
  } finally {
    if (root) await act(async () => { root.unmount(); });
  }
});

test("title search exposes unread coverage without exceeding the bounded PR read budget", async (t) => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
  t.after(() => { Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); });
  let reads = 0;
  t.mock.method(globalThis, "fetch", async () => {
    reads += 1;
    return Response.json(itemWire());
  });
  const sessions = Array.from({ length: BUCKET_READ_CAP + 1 }, (_, index) =>
    queueSession(`pr-${String(index + 1).padStart(2, "0")}`, {
      pullRequest: { repo: "o/r", number: index + 1 },
    }));
  let model!: ReviewDeckModel;
  function Probe({ query = "", filter = "all" }: { query?: string; filter?: ReviewSourceFilter }) {
    model = useReviewDeckModel({ sessions, sourceFilter: filter, query, bucketFilter: null, sort: "attention" });
    return null;
  }
  let root!: ReturnType<typeof create>;
  try {
    await act(async () => { root = create(createElement(Probe)); });
    assert.equal(model.unreadSearchTitles, 0);
    await act(async () => { root.update(createElement(Probe, { query: "unread-title-needle" })); });
    assert.equal(model.ordered.length, 0);
    assert.equal(model.unreadSearchTitles, 1, "zero known matches is not a complete search result");
    assert.equal(reads, BUCKET_READ_CAP);
    await act(async () => { root.update(createElement(Probe, { query: "unread-title-needle", filter: "local" })); });
    assert.equal(model.unreadSearchTitles, 0, "PR titles do not affect local-only search");
    await act(async () => { root.update(createElement(Probe, { query: "unread-title-needle" })); });
    await act(async () => { model.recordFacts(facts({ number: BUCKET_READ_CAP + 1, title: "unread-title-needle" })); });
    assert.equal(model.unreadSearchTitles, 0);
    assert.deepEqual(model.ordered.map(({ id }) => id), ["pr-13"]);
    assert.equal(reads, BUCKET_READ_CAP);
  } finally {
    if (root) await act(async () => { root.unmount(); });
  }
});

test("selected readiness rejects mismatched check heads and refreshes without stale authority", async (t) => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
  t.after(() => { Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); });
  let sha = "old-head";
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/checks?")) return Response.json({
      ok: true, sha, runs: [run("build", "success")], statuses: [],
    });
    if (url.includes("/comments?")) return Response.json({ ok: true, reviewEvidenceComplete: true, reviews: [], reviewThreads: [] });
    return Response.json(itemWire());
  });
  let readiness!: PrReadiness;
  function Probe() {
    readiness = usePrReadiness({ repo: "o/r", number: 7 });
    return null;
  }
  let root!: ReturnType<typeof create>;
  try {
    await act(async () => { root = create(createElement(Probe)); });
    assert.equal(readiness.phase, "error");
    assert.match(readiness.error!, /different or unknown.*head/);
    assert.equal(isReadyToMerge(readiness.facts), false);
    assert.equal(readiness.facts?.title, "Actual GitHub change title");
    const refresh = readiness.refresh;
    sha = facts().headSha;
    await act(async () => { readiness.refresh(); });
    assert.equal(readiness.phase, "ready");
    assert.equal(readiness.error, null);
    assert.equal(isReadyToMerge(readiness.facts), true);
    assert.equal(readiness.refresh, refresh);
  } finally {
    if (root) await act(async () => { root.unmount(); });
  }
});

test("terminal item facts reconcile promptly and old selection reads are aborted", async (t) => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
  t.after(() => { Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); });
  const oldSignals: AbortSignal[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (url.searchParams.get("number") === "7") {
      if (init?.signal) oldSignals.push(init.signal);
      if (url.pathname.endsWith("/item")) return Response.json({ ...itemWire(), state: "closed", merged: true });
      return new Promise<Response>(() => {});
    }
    if (url.pathname.endsWith("/checks")) return Response.json({
      ok: true, sha: facts().headSha, runs: [run("build", "success")], statuses: [],
    });
    if (url.pathname.endsWith("/comments")) return Response.json({ ok: true, reviewEvidenceComplete: true, reviews: [], reviewThreads: [] });
    return Response.json(itemWire());
  });
  let readiness!: PrReadiness;
  function Probe({ number }: { number: number }) {
    readiness = usePrReadiness({ repo: "o/r", number });
    return null;
  }
  let root!: ReturnType<typeof create>;
  try {
    await act(async () => { root = create(createElement(Probe, { number: 7 })); });
    assert.equal(readiness.phase, "loading", "auxiliary reads are still pending");
    assert.equal(isTerminalPr(readiness.facts), true, "terminal queue reconciliation need not wait for them");
    await act(async () => { root.update(createElement(Probe, { number: 8 })); });
    assert.equal(oldSignals.length, 3);
    assert.equal(oldSignals.every((signal) => signal.aborted), true);
    assert.equal(readiness.phase, "ready");
    assert.equal(readiness.facts?.number, 8);
    assert.equal(readiness.facts?.merged, false);
  } finally {
    if (root) await act(async () => { root.unmount(); });
  }
});

// ── Blockers ─────────────────────────────────────────────────────────────────

test("a clean, approved pull request has no blockers", () => {
  assert.deepEqual(prBlockers(facts()), []);
  assert.deepEqual(prBlockers(null), []);
});

test("blockers name who clears each one, most structural first", () => {
  const blockers = prBlockers(
    facts({
      draft: true,
      state: "closed",
      checks: { rollup: "failing", runs: [run("Rust check", "failure"), run("Frontend build", "success")] },
      threads: { unresolved: 2, total: 3, canResolve: true, items: [] },
      reviews: { approved: 0, changesRequested: 1, commented: 0 },
      mergeableState: "dirty",
    }),
  );
  assert.deepEqual(
    blockers.map((blocker) => blocker.id),
    ["draft", "state", "checks", "threads", "reviews", "conflict"],
  );
  // Every blocker says who clears it, and none of them is an action the deck takes.
  for (const blocker of blockers) assert.ok(blocker.fix.length > 0, `${blocker.id} has no fix line`);
  const checks = blockers.find((blocker) => blocker.id === "checks");
  assert.match(checks!.title, /^1 required check is failing$/);
  // The evidence and the remedy are separate fields: `detail` names which
  // check, `fix` says who pushes the fix. A reader scanning for the check
  // should never have to read past a sentence about ownership to find it.
  assert.match(checks!.detail, /Rust check/);
  assert.doesNotMatch(checks!.detail, /Frontend build/);
  assert.doesNotMatch(checks!.fix, /Rust check/);
  assert.equal(checks!.reveal, "checks");
});

test("a thread blocker's detail is the thread itself, not a count restated", () => {
  const blockers = prBlockers(
    facts({
      threads: {
        unresolved: 2,
        total: 2,
        canResolve: true,
        items: [
          {
            id: "t1",
            where: "src/api/roster-route.ts:42",
            author: "val",
            excerpt: "Who authorizes roster writes?",
          },
        ],
      },
    }),
  );
  const threads = blockers.find((blocker) => blocker.id === "threads");
  assert.equal(
    threads!.detail,
    "src/api/roster-route.ts:42 — Who authorizes roster writes?",
  );
});

test("a blocker with nothing more to say carries an empty detail, never a filler line", () => {
  const blockers = prBlockers(facts({ mergeableState: "behind" }));
  assert.equal(blockers.find((blocker) => blocker.id === "behind")!.detail, "");
});

test("more than one failing check pluralises the noun, not just the verb", () => {
  const blockers = prBlockers(
    facts({
      checks: {
        rollup: "failing",
        runs: [run("Rust check", "failure"), run("Frontend build", "failure")],
      },
    }),
  );
  assert.equal(
    blockers.find((blocker) => blocker.id === "checks")!.title,
    "2 required checks are failing",
  );
});

test("a running check is not a failing one", () => {
  const runs = [run("E2E", null, "in_progress"), run("CodeQL", "success")];
  assert.deepEqual(failingCheckNames(runs), []);
  assert.deepEqual(
    prBlockers(facts({ checks: { rollup: "pending", runs } })).map((blocker) => blocker.id),
    [],
  );
});

test("neutral and skipped conclusions do not block, real failures do", () => {
  const runs = [run("skipped-job", "skipped"), run("neutral-job", "neutral"), run("flaky", "timed_out")];
  assert.deepEqual(failingCheckNames(runs), ["flaky"]);
});

test("behind and dirty are distinct blockers with distinct fixes", () => {
  const behind = prBlockers(facts({ mergeableState: "behind" }));
  assert.deepEqual(
    behind.map((blocker) => blocker.id),
    ["behind"],
  );
  assert.match(behind[0].title, /behind main/);
  const dirty = prBlockers(facts({ mergeableState: "dirty" }));
  assert.match(dirty[0].title, /conflicts with main/i);
  assert.match(dirty[0].fix, /never edits a working tree/);
});

test("thread blocker copy admits when resolving needs a token the deck lacks", () => {
  const readOnly = prBlockers(facts({ threads: { unresolved: 1, total: 1, canResolve: false, items: [] } }));
  assert.match(readOnly[0].fix, /read-only here/);
  assert.match(readOnly[0].title, /1 unresolved review thread$/);
  const writable = prBlockers(facts({ threads: { unresolved: 2, total: 2, canResolve: true, items: [] } }));
  assert.match(writable[0].title, /2 unresolved review threads$/);
  assert.match(writable[0].fix, /Resolve them on GitHub/);
});

// ── Readiness ────────────────────────────────────────────────────────────────

test("ready to merge needs open, approved, green, mergeable, and no open threads", () => {
  assert.equal(isReadyToMerge(facts()), true);
  assert.equal(isReadyToMerge(null), false);
  assert.equal(isReadyToMerge(facts({ draft: true })), false);
  assert.equal(isReadyToMerge(facts({ state: "closed" })), false);
  assert.equal(isReadyToMerge(facts({ checks: { rollup: "failing", runs: [] } })), false);
  assert.equal(isReadyToMerge(facts({ reviews: { approved: 0, changesRequested: 0, commented: 1 } })), false);
  assert.equal(isReadyToMerge(facts({ reviews: { approved: 1, changesRequested: 1, commented: 0 } })), false);
  assert.equal(isReadyToMerge(facts({ threads: { unresolved: 1, total: 1, canResolve: true, items: [] } })), false);
});

test("mergeable: null is unknown, and an unknown never reads as ready", () => {
  const unknown = facts({ mergeable: null, mergeableState: "unknown" });
  assert.equal(isReadyToMerge(unknown), false);
  // Unknown is not a blocker either — nothing is wrong yet, GitHub is still computing.
  assert.deepEqual(prBlockers(unknown), []);
  const banner = readinessBanner(unknown, []);
  assert.equal(banner.headline, "Waiting on GitHub");
  assert.match(banner.sub, /still computing/);
});

test("the readiness banner answers can-this-land before any detail opens", () => {
  assert.match(readinessBanner(null, []).headline, /No pull request/);
  assert.match(readinessBanner(facts({ draft: true }), []).headline, /^Draft/);
  assert.equal(readinessBanner(facts(), []).headline, "Ready to merge");
  assert.equal(readinessBanner(facts(), []).tone, "success");

  const blocked = readinessBanner(facts({ mergeableState: "dirty" }), prBlockers(facts({ mergeableState: "dirty" })));
  assert.equal(blocked.headline, "Not safe to merge — 1 blocker");
  assert.equal(blocked.tone, "danger");

  const noApproval = facts({ reviews: { approved: 0, changesRequested: 0, commented: 0 } });
  assert.match(readinessBanner(noApproval, []).sub, /No approving review/);
});

test("a draft banner outranks its own blockers so the verdict copy stays honest", () => {
  const draft = facts({ draft: true, mergeableState: "dirty" });
  assert.match(readinessBanner(draft, prBlockers(draft)).headline, /^Draft/);
});

// ── Buckets ──────────────────────────────────────────────────────────────────

test("local sessions and unread PRs are outside GitHub attention counts", () => {
  assert.equal(reviewBucket(null, false), "unread");
  assert.equal(reviewBucket(null, true), "unread");
  assert.equal(reviewBucket(undefined, true), "unread");
});

test("buckets are exclusive and follow GitHub's own verdict", () => {
  const base = facts();
  assert.equal(reviewBucket(base, true), "ready");
  assert.equal(reviewBucket({ ...base, draft: true }, true), "draft");
  assert.equal(reviewBucket({ ...base, state: "closed" }, true), "unread");
  assert.equal(
    reviewBucket({ ...base, reviews: { approved: 1, changesRequested: 1, commented: 0 } }, true),
    "changes",
  );
  assert.equal(reviewBucket({ ...base, mergeable: false, mergeableState: "dirty" }, true), "blocked");
  assert.equal(reviewBucket({ ...base, mergeableState: "blocked" }, true), "blocked");
  assert.equal(reviewBucket({ ...base, mergeableState: "behind" }, true), "blocked");
  // Mergeable but unapproved, or still computing: awaiting, never ready.
  assert.equal(reviewBucket({ ...base, reviews: { approved: 0, changesRequested: 0, commented: 0 } }, true), "awaiting");
  assert.equal(reviewBucket({ ...base, mergeable: null, mergeableState: "unknown" }, true), "unread");
});

test("changes-requested outranks blocked so a row lands in exactly one bucket", () => {
  const both = { ...facts(), reviews: { approved: 0, changesRequested: 1, commented: 0 }, mergeableState: "dirty" };
  assert.equal(reviewBucket(both, true), "changes");
});

test("the reveal control names the row it sends the reader to", () => {
  // The "checks" disclosure is the whole PR detail panel, so a review-state
  // blocker that opens it must not offer "show the checks".
  const blockers = prBlockers(
    facts({
      checks: { rollup: "failing", runs: [run("Rust check", "failure")] },
      reviews: { approved: 0, changesRequested: 1, commented: 0 },
      threads: { unresolved: 1, total: 1, canResolve: true, items: [] },
    }),
  );
  const by = new Map(blockers.map((blocker) => [blocker.id, blocker]));
  assert.equal(by.get("checks")!.revealLabel, "show the checks");
  assert.equal(by.get("reviews")!.revealLabel, "show the reviews");
  assert.equal(by.get("threads")!.revealLabel, "show the threads");
  // A blocker with nothing to reveal offers no control at all.
  for (const blocker of prBlockers(facts({ mergeableState: "dirty" }))) {
    assert.equal(blocker.reveal, null);
    assert.equal(blocker.revealLabel, null);
  }
});

test("the caption never claims coverage the strip does not have", () => {
  // Nothing outside the counts: the plain claim is allowed.
  assert.equal(
    deckCaption({ counted: 4, local: 0, drafts: 0, unread: 0, skipped: 0 }),
    "4 counted from live GitHub review state",
  );
  // Local sessions have review material but cannot count as GitHub readiness.
  assert.equal(
    deckCaption({ counted: 3, local: 1, drafts: 0, unread: 0, skipped: 0 }),
    "3 counted from live GitHub review state · outside the counts: 1 local session with no GitHub state",
  );
  // Drafts, unread rows, and rows past the cap are named rather than hidden.
  assert.equal(
    deckCaption({ counted: 5, local: 0, drafts: 2, unread: 1, skipped: 3 }),
    "5 counted from live GitHub review state · outside the counts: 2 drafts, 1 with unconfirmed GitHub state, 3 past the read cap",
  );
  assert.match(deckCaption({ counted: 1, local: 2, drafts: 1, unread: 0, skipped: 0 }), /2 local sessions/);
  assert.match(deckCaption({ counted: 1, local: 0, drafts: 1, unread: 0, skipped: 0 }), /outside the counts: 1 draft$/);
});

test("the counted total is the strip's own denominator, not the deck size", () => {
  const summary = deckSummary(["awaiting", "changes", "draft", "unread", "ready"]);
  // Five items on the deck, three of them bucketed — shares must divide by three.
  assert.equal(countedTotal(summary), 3);
  assert.equal(countedTotal({ awaiting: 0, changes: 0, blocked: 0, ready: 0 }), 0);
});

test("the summary counts add up to the deck, leaving drafts and unreads out", () => {
  const summary = deckSummary(["awaiting", "awaiting", "changes", "blocked", "ready", "draft", "unread"]);
  assert.deepEqual(summary, { awaiting: 2, changes: 1, blocked: 1, ready: 1 });
  // Padding "awaiting" with unread rows would claim knowledge the deck never fetched.
  const total = DECK_BUCKETS.reduce((sum, bucket) => sum + summary[bucket], 0);
  assert.equal(total, 5);
  assert.deepEqual(deckSummary([]), { awaiting: 0, changes: 0, blocked: 0, ready: 0 });
});

test("the queue row's pill reports GitHub's state, and says so while unread", () => {
  const options = { hasPullRequest: true, hasLocalChanges: false };
  assert.equal(reviewStateMeta(null, options).label, "Unknown");
  assert.equal(reviewStateMeta(facts(), options).label, "Ready to merge");
  assert.equal(reviewStateMeta({ ...facts(), draft: true }, options).label, "Draft");

  const closed = reviewStateMeta({ ...facts(), state: "closed", merged: true }, options);
  assert.equal(closed.label, "Merged");
  assert.match(closed.title, /merged/);

  const dirty = reviewStateMeta({ ...facts(), mergeable: false, mergeableState: "dirty" }, options);
  assert.match(dirty.title, /mergeable_state: dirty/);
});

test("a session with no pull request distinguishes local changes from nothing to review", () => {
  const local = reviewStateMeta(null, { hasPullRequest: false, hasLocalChanges: true });
  assert.equal(local.label, "Local changes");
  const empty = reviewStateMeta(null, { hasPullRequest: false, hasLocalChanges: false });
  assert.equal(empty.label, "No changes");
});

// ── Checks pill ──────────────────────────────────────────────────────────────

test("the checks pill leads with the worst state that exists", () => {
  assert.equal(checksMeta(null).label, "no checks");
  assert.equal(checksMeta(facts()).label, "no checks");
  assert.equal(
    checksMeta(facts({ checks: { rollup: "passing", runs: [run("a", "success"), run("b", "success")] } })).label,
    "2 passed",
  );
  assert.equal(
    checksMeta(facts({ checks: { rollup: "pending", runs: [run("a", "success"), run("b", null, "queued")] } })).label,
    "1 running",
  );
  // A failure outranks a still-running run.
  assert.equal(
    checksMeta(
      facts({ checks: { rollup: "failing", runs: [run("a", "failure"), run("b", null, "in_progress")] } }),
    ).label,
    "1 failing",
  );
});

// ── Merge checklist ──────────────────────────────────────────────────────────

test("the pre-merge checklist ticks every gate for a clean pull request", () => {
  const rows = mergeChecklist(facts());
  assert.deepEqual(
    rows.map((row) => row.label),
    ["Checks green", "Approved", "Review threads resolved", "Mergeable", "Not a draft"],
  );
  assert.ok(rows.every((row) => row.ok));
  assert.deepEqual(mergeChecklist(null), []);
});

test("the checklist marks the unmet gates and explains an unknown mergeability", () => {
  const rows = mergeChecklist(
    facts({
      mergeable: null,
      mergeableState: "unknown",
      reviews: { approved: 0, changesRequested: 1, commented: 0 },
      threads: { unresolved: 2, total: 5, canResolve: true, items: [] },
    }),
  );
  const by = new Map(rows.map((row) => [row.label, row]));
  assert.equal(by.get("Approved")!.ok, false);
  assert.match(by.get("Approved")!.detail, /0 approving reviews, 1 requesting changes/);
  assert.equal(by.get("Review threads resolved")!.ok, false);
  assert.match(by.get("Review threads resolved")!.detail, /2 unresolved of 5/);
  assert.equal(by.get("Mergeable")!.ok, false);
  assert.match(by.get("Mergeable")!.detail, /still computing/);
});

test("the reviewer's own pass joins the checklist only when progress is known", () => {
  assert.ok(mergeChecklist(facts()).every((row) => row.label !== "Your pass"));
  const rows = mergeChecklist(facts(), { reviewed: 2, readable: 5 });
  const pass = rows.find((row) => row.label === "Your pass");
  assert.ok(pass);
  assert.equal(pass.ok, false);
  assert.match(pass.detail, /2 of 5 files read — yours to finish, not a merge blocker/);
});

test("an unfinished pass is soft, so it never counts against GitHub's own gates", () => {
  const rows = mergeChecklist(facts(), { reviewed: 0, readable: 4 });
  assert.equal(rows.find((row) => row.label === "Your pass")!.soft, true);
  assert.ok(rows.filter((row) => row.label !== "Your pass").every((row) => !row.soft));
  // Every gate passes on a clean pull request; the unread files do not reduce it.
  assert.deepEqual(mergeChecklistScore(rows), { passed: 5, total: 5 });
});

test("a finished pass drops the not-a-blocker caveat rather than repeating it", () => {
  const rows = mergeChecklist(facts(), { reviewed: 3, readable: 3 });
  const pass = rows.find((row) => row.label === "Your pass")!;
  assert.equal(pass.ok, true);
  assert.equal(pass.detail, "3 of 3 files read");
});

test("a change with no readable files is not scored as a finished pass", () => {
  const rows = mergeChecklist(facts(), { reviewed: 0, readable: 0 });
  assert.equal(rows.find((row) => row.label === "Your pass")!.ok, false);
});

// ── Request-changes evidence ─────────────────────────────────────────────────

test("evidence is only ever facts read from this pull request", () => {
  assert.deepEqual(evidenceItems(null), []);
  assert.deepEqual(evidenceItems(facts()), []);

  const items = evidenceItems(
    facts({
      checks: { rollup: "failing", runs: [run("Rust check", "failure"), run("ok", "success")] },
      threads: {
        unresolved: 3,
        total: 4,
        canResolve: true,
        items: [{ id: "t1", where: "src/app/page.tsx:42", author: "bot", excerpt: "this leaks a handle" }],
      },
      mergeableState: "behind",
    }),
  );
  assert.deepEqual(
    items.map((item) => item.key),
    ["check:Rust check", "thread:t1", "threads:rest", "behind"],
  );
  // The failing check cites the head it failed on, short-sha'd.
  assert.match(items[0].line, /head abcdef1/);
  // The two threads beyond the fetched one are counted, not invented.
  assert.match(items[2].label, /^2 more threads$/);
  // A thread chip leads with the file and line, not the whole path.
  assert.equal(items[1].label, "page.tsx:42");
  assert.match(items[1].title, /^src\/app\/page\.tsx:42 — this leaks a handle$/);
});

test("a drafted change request cites every kept item and nothing else", () => {
  const items = evidenceItems(
    facts({
      checks: { rollup: "failing", runs: [run("Rust check", "failure")] },
      mergeableState: "dirty",
    }),
  );
  const body = draftChangeRequest("o/r#7", items);
  assert.match(body, /^Holding o\/r#7 for now — 2 things to clear before I can approve:/);
  assert.match(body, /\n1\. Rust check is failing/);
  assert.match(body, /\n2\. The branch conflicts with main/);
  assert.match(body, /Re-request review once that's pushed/);

  // Dropping a chip drops its sentence and renumbers the rest.
  const trimmed = draftChangeRequest("o/r#7", items.slice(1));
  assert.match(trimmed, /1 thing to clear/);
  assert.doesNotMatch(trimmed, /Rust check/);

  // Nothing kept means nothing drafted — the deck never writes a verdict alone.
  assert.equal(draftChangeRequest("o/r#7", []), "");
});
