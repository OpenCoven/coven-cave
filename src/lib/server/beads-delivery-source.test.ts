// @ts-nocheck
import assert from "node:assert/strict";
import type { BdResult } from "./beads-cli.ts";
import {
  __clearBeadsDeliveryOverviewCacheForTests,
  __getBeadsDeliveryOverviewEpochForTests,
  __setBeadsDeliveryOverviewTestHooksForTests,
  invalidateBeadsDeliveryOverview,
  readBeadsDeliveryOverview,
} from "./beads-delivery-source.ts";

const NOW_MS = Date.parse("2026-08-09T12:00:00.000Z");
const repoA = "/repo/a";
const repoB = "/repo/b";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function okRows(rows: unknown[]): BdResult {
  return { ok: true, stdout: `${JSON.stringify(rows)}\n`, stderr: "" };
}

function assertTotals(
  overview: Awaited<ReturnType<typeof readBeadsDeliveryOverview>>,
  expected: Awaited<ReturnType<typeof readBeadsDeliveryOverview>>["totals"],
) {
  assert.deepEqual(overview.totals, expected);
}

const repoAOldAllRows = [
  {
    id: "a-old-open",
    title: "Repo A old open",
    status: "open",
    priority: 1,
    updated_at: "2026-08-09T11:00:00.000Z",
    labels: ["surface:shared"],
  },
];
const repoAOldReadyRows = [repoAOldAllRows[0]];
const repoANewAllRows = [
  {
    id: "a-new-blocked",
    title: "Repo A new blocked",
    status: "blocked",
    priority: 2,
    updated_at: "2026-08-09T11:30:00.000Z",
    labels: ["surface:desktop"],
  },
];
const repoANewReadyRows: unknown[] = [];
const repoBAllRows = [
  {
    id: "b-open",
    title: "Repo B open",
    status: "open",
    priority: 1,
    updated_at: "2026-08-09T10:00:00.000Z",
    labels: ["surface:ios"],
  },
];
const repoBReadyRows = [repoBAllRows[0]];

const repoAInFlightList = deferred<BdResult>();
const repoAInFlightReady = deferred<BdResult>();
const repoAStarted = deferred<void>();
const repoAStartedKeys = new Set<string>();
const commandCounts = new Map<string, number>();

function bumpCount(repoRoot: string) {
  commandCounts.set(repoRoot, (commandCounts.get(repoRoot) ?? 0) + 1);
}

try {
  __clearBeadsDeliveryOverviewCacheForTests();
  __setBeadsDeliveryOverviewTestHooksForTests({
    now: () => NOW_MS,
    resolveWorkspace: (repoRoot: string) => ({ ok: true, beadsDir: `${repoRoot}/.beads` }),
    runBdCommand: async (repoRoot: string, _beadsDir: string, args: string[]) => {
      const key = args.join(" ");
      bumpCount(repoRoot);

      if (repoRoot === repoA) {
        if (key === "list --all --json" && commandCounts.get(repoRoot) === 1) {
          repoAStartedKeys.add(key);
          if (repoAStartedKeys.size === 2) repoAStarted.resolve();
          return repoAInFlightList.promise;
        }
        if (key === "ready --json" && commandCounts.get(repoRoot) === 2) {
          repoAStartedKeys.add(key);
          if (repoAStartedKeys.size === 2) repoAStarted.resolve();
          return repoAInFlightReady.promise;
        }
        if (key === "list --all --json") return okRows(repoANewAllRows);
        if (key === "ready --json") return okRows(repoANewReadyRows);
      }

      if (repoRoot === repoB) {
        if (key === "list --all --json") return okRows(repoBAllRows);
        if (key === "ready --json") return okRows(repoBReadyRows);
      }

      throw new Error(`Unexpected command: ${repoRoot} ${key}`);
    },
  });

  const repoBOverview = await readBeadsDeliveryOverview(repoB);
  assertTotals(repoBOverview, {
    remaining: 1,
    ready: 1,
    open: 1,
    inProgress: 0,
    blocked: 0,
    deferred: 0,
  });
  await readBeadsDeliveryOverview(repoB);
  assert.equal(commandCounts.get(repoB), 2, "repo B should stay warm after its first read");

  const repoAStaleRead = readBeadsDeliveryOverview(repoA);
  await repoAStarted.promise;

  invalidateBeadsDeliveryOverview(repoA);
  assert.equal(__getBeadsDeliveryOverviewEpochForTests(repoA), 1);

  repoAInFlightList.resolve(okRows(repoAOldAllRows));
  repoAInFlightReady.resolve(okRows(repoAOldReadyRows));

  const staleOverview = await repoAStaleRead;
  assertTotals(staleOverview, {
    remaining: 1,
    ready: 1,
    open: 1,
    inProgress: 0,
    blocked: 0,
    deferred: 0,
  });
  assert.equal(commandCounts.get(repoA), 2, "the in-flight caller still gets its already-computed snapshot");

  const freshOverview = await readBeadsDeliveryOverview(repoA);
  assertTotals(freshOverview, {
    remaining: 1,
    ready: 0,
    open: 0,
    inProgress: 0,
    blocked: 1,
    deferred: 0,
  });
  assert.equal(commandCounts.get(repoA), 4, "next repo A read must execute bd again instead of reusing stale cache");

  await readBeadsDeliveryOverview(repoB);
  assert.equal(commandCounts.get(repoB), 2, "repo B cache remains warm while repo A is invalidated");

  __clearBeadsDeliveryOverviewCacheForTests();
  assert.equal(__getBeadsDeliveryOverviewEpochForTests(repoA), 0, "test reset clears per-root epochs");
} finally {
  __clearBeadsDeliveryOverviewCacheForTests();
}

console.log("beads-delivery-source.test.ts: ok");
