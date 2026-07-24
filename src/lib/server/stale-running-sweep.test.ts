// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyStaleRunningPresentation,
  ghostVerdictFromEventsResponse,
  resetStaleRunningSweepCache,
  staleRunningCandidates,
  sweepStaleRunningGhosts,
  STALE_RUNNING_PRESENTED_STATUS,
  STALE_RUNNING_THRESHOLD_MS,
} from "./stale-running-sweep.ts";

const NOW = Date.parse("2026-07-24T12:00:00Z");
const STALE_AT = new Date(NOW - STALE_RUNNING_THRESHOLD_MS - 60_000).toISOString();
const FRESH_AT = new Date(NOW - 60_000).toISOString();
const noActiveRun = () => false;

const row = (over = {}) => ({
  id: "aaaaaaaa-1111-2222-3333-444444444444",
  status: "running",
  created_at: STALE_AT,
  updated_at: STALE_AT,
  ...over,
});

// --- candidates: only running-tone rows old enough on BOTH timestamps, with
// no in-process chat run, qualify for the probe.
{
  const opts = { nowMs: NOW, hasActiveChatRun: noActiveRun };
  assert.deepEqual(
    staleRunningCandidates([row()], opts),
    [row().id],
    "stale running row qualifies",
  );
  assert.deepEqual(
    staleRunningCandidates([row({ status: "starting" }), row({ id: "b", status: "working" })], opts),
    [row().id, "b"],
    "the whole running-tone vocabulary qualifies (starting/working)",
  );
  for (const status of ["completed", "failed", "orphaned", "killed", "idle", "created"]) {
    assert.deepEqual(
      staleRunningCandidates([row({ status })], opts),
      [],
      `${status} rows never qualify`,
    );
  }
  assert.deepEqual(
    staleRunningCandidates([row({ created_at: FRESH_AT, updated_at: FRESH_AT })], opts),
    [],
    "fresh rows never qualify — a just-started run is not a ghost",
  );
  assert.deepEqual(
    staleRunningCandidates([row({ updated_at: FRESH_AT })], opts),
    [],
    "a recently-updated row never qualifies even when created long ago",
  );
  assert.deepEqual(
    staleRunningCandidates([row({ created_at: "garbage" })], opts),
    [],
    "unparsable created_at is skipped, not swept",
  );
  assert.deepEqual(
    staleRunningCandidates([row({ updated_at: "garbage" })], opts),
    [],
    "unparsable updated_at is skipped, not swept",
  );
  assert.deepEqual(
    staleRunningCandidates([row()], { nowMs: NOW, hasActiveChatRun: () => true }),
    [],
    "an in-flight chat run in this server process is never a candidate",
  );
}

// --- verdict parser: process I/O proves a live daemon child; a metadata-only
// log is still a ghost (the real-world "codex patch_metadata" leak); an
// incomplete or malformed page is unrulable and must fail open.
{
  const page = (events, hasMore = false) => ({ events, nextCursor: null, hasMore });
  assert.equal(ghostVerdictFromEventsResponse(page([])), true, "empty event log = ghost");
  assert.equal(
    ghostVerdictFromEventsResponse(page([{ kind: "patch_metadata" }])),
    true,
    "metadata-only log is still a ghost — no process ever produced I/O",
  );
  assert.equal(
    ghostVerdictFromEventsResponse(page([{ kind: "output" }])),
    false,
    "PTY output proves a live daemon child",
  );
  assert.equal(
    ghostVerdictFromEventsResponse(page([{ kind: "patch_metadata" }, { kind: "input" }])),
    false,
    "input events also prove process wiring",
  );
  assert.equal(
    ghostVerdictFromEventsResponse(page([{ kind: "patch_metadata" }], true)),
    null,
    "metadata with more pages behind it is unrulable — fail open",
  );
  assert.equal(ghostVerdictFromEventsResponse(null), null, "missing body fails open");
  assert.equal(ghostVerdictFromEventsResponse({ events: "nope" }), null, "malformed body fails open");
}

// --- sweep: the events probe is the ghost/alive discriminator.
// `coven run`-registered rows never produce daemon events; daemon-spawned PTY
// sessions always do. Probe failures fail open (row keeps its status).
{
  resetStaleRunningSweepCache();
  const probes = [];
  const probe = async (id) => {
    probes.push(id);
    if (id === "ghost") return true; // zero events
    if (id === "pty") return false; // has events — a live daemon child
    return null; // probe failed — unknown
  };
  const rows = [
    row({ id: "ghost" }),
    row({ id: "pty" }),
    row({ id: "unknown" }),
    row({ id: "fresh", created_at: FRESH_AT, updated_at: FRESH_AT }),
  ];
  const ghosts = await sweepStaleRunningGhosts(rows, {
    nowMs: NOW,
    hasActiveChatRun: noActiveRun,
    probe,
  });
  assert.deepEqual([...ghosts], ["ghost"], "only the zero-events row is a ghost");
  assert.deepEqual(
    probes.sort(),
    ["ghost", "pty", "unknown"],
    "every stale candidate is probed; fresh rows are not",
  );
}

// --- verdict cache: definite verdicts stick per (id, updated_at); probe
// failures retry; a daemon-side transition (new updated_at) re-evaluates.
{
  resetStaleRunningSweepCache();
  let calls = 0;
  const probe = async (id) => {
    calls += 1;
    return id === "ghost" ? true : id === "pty" ? false : null;
  };
  const rows = [row({ id: "ghost" }), row({ id: "pty" }), row({ id: "unknown" })];
  const opts = { nowMs: NOW, hasActiveChatRun: noActiveRun, probe };

  const first = await sweepStaleRunningGhosts(rows, opts);
  assert.deepEqual([...first], ["ghost"]);
  assert.equal(calls, 3, "first sweep probes all three");

  const second = await sweepStaleRunningGhosts(rows, opts);
  assert.deepEqual([...second], ["ghost"], "cached ghost verdict still presents");
  assert.equal(calls, 4, "second sweep re-probes only the failed verdict");

  const bumped = row({ id: "ghost", updated_at: new Date(NOW - STALE_RUNNING_THRESHOLD_MS - 30_000).toISOString() });
  await sweepStaleRunningGhosts([bumped], opts);
  assert.equal(calls, 5, "a changed updated_at invalidates the cached verdict");
}

// --- a throwing probe never breaks the sweep (best-effort contract).
{
  resetStaleRunningSweepCache();
  const ghosts = await sweepStaleRunningGhosts([row()], {
    nowMs: NOW,
    hasActiveChatRun: noActiveRun,
    probe: async () => {
      throw new Error("daemon exploded");
    },
  });
  assert.deepEqual([...ghosts], [], "probe throw fails open");
}

// --- presentation: ghosts are rewritten to the daemon's own restart verdict
// ("orphaned"); everything else passes through untouched.
{
  const rows = [row({ id: "ghost" }), row({ id: "live" })];
  const out = applyStaleRunningPresentation(rows, new Set(["ghost"]));
  assert.equal(out[0].status, STALE_RUNNING_PRESENTED_STATUS, "ghost presents as orphaned");
  assert.equal(out[1].status, "running", "non-ghost keeps its daemon status");
  assert.equal(
    applyStaleRunningPresentation(rows, new Set()),
    rows,
    "empty ghost set returns the same array (no churn for the common case)",
  );
}

// --- wiring pins: the sessions/list route must classify BEFORE the merge so
// every downstream surface (Running popover, badges, archive sweeps) sees the
// presented status; the probe must stay read-only.
{
  const route = readFileSync(
    new URL("../../app/api/sessions/list/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    route,
    /sweepStaleRunningGhosts\(res\.data\)/,
    "list route sweeps the daemon rows",
  );
  assert.match(
    route,
    /daemonSessions: applyStaleRunningPresentation\(res\.data, staleRunningGhosts\)/,
    "presentation applies to the daemon rows fed into mergeSessionRows",
  );
  const sweep = readFileSync(new URL("./stale-running-sweep.ts", import.meta.url), "utf8");
  assert.match(
    sweep,
    /\/events\?limit=\$\{EVENTS_PROBE_LIMIT\}/,
    "liveness probe is the read-only events endpoint",
  );
  assert.doesNotMatch(
    sweep,
    /method:\s*"(POST|DELETE|PUT)"/,
    "sweep never mutates the daemon",
  );
}

console.log("stale-running-sweep tests passed");
