// #5930 part 2: the pure trigger behind "Review my pull requests
// automatically when they're marked ready". The watcher that would call it
// does not ship yet (Cave has no supported way to start a read-only background
// familiar session from the server; see the issue), so these tests pin the
// rules it must follow when it lands.
import assert from "node:assert/strict";
import test from "node:test";

import {
  OWN_PR_POLL_MIN_MS,
  emptyOwnPrWatchState,
  nextOwnPrPollDelayMs,
  planOwnPrAutoReviews,
  type OwnPrObservation,
  type OwnPrWatchState,
} from "./own-pr-auto-review.ts";

const T0 = "2026-10-11T12:00:00.000Z";
const T1 = "2026-10-11T12:03:00.000Z";
const T2 = "2026-10-11T12:06:00.000Z";
const T3 = "2026-10-11T12:09:00.000Z";

const URL_A = "https://github.com/OpenCoven/coven-cave/pull/1";
const URL_B = "https://github.com/OpenCoven/coven-cave/pull/2";
const URL_C = "https://github.com/OpenCoven/coven-cave/pull/3";

const seen = (prs: OwnPrObservation["prs"], complete = true): OwnPrObservation => ({ prs, complete });
const pr = (url: string, draft: boolean, headSha: string | null = null) => ({ url, draft, headSha });

function baseline(prs: OwnPrObservation["prs"]): OwnPrWatchState {
  const { state, fire } = planOwnPrAutoReviews(emptyOwnPrWatchState(), seen(prs), { enabled: true, now: T0 });
  assert.deepEqual(fire, [], "the baseline never fires");
  return state;
}

test("turning it on records a baseline: PRs already ready do not fire", () => {
  const { state, fire } = planOwnPrAutoReviews(
    emptyOwnPrWatchState(),
    seen([pr(URL_A, false), pr(URL_B, true)]),
    { enabled: true, now: T0 },
  );
  assert.deepEqual(fire, []);
  assert.equal(state.baselineAt, T0);
  assert.deepEqual(Object.keys(state.prs).sort(), [URL_A, URL_B]);
  assert.equal(state.prs[URL_A].lastDraft, false);
  assert.equal(state.prs[URL_B].lastDraft, true);
  assert.equal(state.prs[URL_A].reviewedAt, null);
});

test("a draft seen going ready fires once, and records what was reviewed", () => {
  const start = baseline([pr(URL_A, true)]);
  const { state, fire } = planOwnPrAutoReviews(start, seen([pr(URL_A, false, "abc123")]), {
    enabled: true,
    now: T1,
  });
  assert.deepEqual(fire, [URL_A]);
  assert.equal(state.prs[URL_A].lastDraft, false);
  assert.equal(state.prs[URL_A].reviewedAt, T1);
  assert.equal(state.prs[URL_A].reviewedHeadSha, "abc123");
  assert.equal(state.prs[URL_A].sessionId, null, "the caller records the session it starts");
});

test("a new PR first seen already ready fires (opened ready after the baseline)", () => {
  const start = baseline([pr(URL_A, false)]);
  const { fire } = planOwnPrAutoReviews(start, seen([pr(URL_A, false), pr(URL_B, false)]), {
    enabled: true,
    now: T1,
  });
  assert.deepEqual(fire, [URL_B]);
});

test("a new PR first seen as a draft waits, then fires when it goes ready", () => {
  const start = baseline([]);
  const first = planOwnPrAutoReviews(start, seen([pr(URL_C, true)]), { enabled: true, now: T1 });
  assert.deepEqual(first.fire, []);
  const second = planOwnPrAutoReviews(first.state, seen([pr(URL_C, false)]), { enabled: true, now: T2 });
  assert.deepEqual(second.fire, [URL_C]);
});

test("once per PR: later pushes, and going back to draft and ready again, do not re-fire", () => {
  const start = baseline([pr(URL_A, true)]);
  const fired = planOwnPrAutoReviews(start, seen([pr(URL_A, false, "sha1")]), { enabled: true, now: T1 });
  assert.deepEqual(fired.fire, [URL_A]);
  const pushed = planOwnPrAutoReviews(fired.state, seen([pr(URL_A, false, "sha2")]), { enabled: true, now: T2 });
  assert.deepEqual(pushed.fire, [], "a push does not re-fire");
  assert.equal(pushed.state.prs[URL_A].reviewedHeadSha, "sha1", "the reviewed head stays the one reviewed");
  const redraft = planOwnPrAutoReviews(pushed.state, seen([pr(URL_A, true)]), { enabled: true, now: T2 });
  const ready = planOwnPrAutoReviews(redraft.state, seen([pr(URL_A, false)]), { enabled: true, now: T3 });
  assert.deepEqual(ready.fire, [], "draft → ready a second time does not re-fire");
});

test("an already-ready PR from the baseline fires if it goes draft and then ready", () => {
  const start = baseline([pr(URL_A, false)]);
  const redraft = planOwnPrAutoReviews(start, seen([pr(URL_A, true)]), { enabled: true, now: T1 });
  assert.deepEqual(redraft.fire, []);
  const ready = planOwnPrAutoReviews(redraft.state, seen([pr(URL_A, false)]), { enabled: true, now: T2 });
  assert.deepEqual(ready.fire, [URL_A]);
});

test("closed and merged PRs drop out of state", () => {
  const start = baseline([pr(URL_A, false), pr(URL_B, true)]);
  // The search is is:open, so a closed or merged PR is simply absent from a
  // complete observation.
  const { state, fire } = planOwnPrAutoReviews(start, seen([pr(URL_B, true)]), { enabled: true, now: T1 });
  assert.deepEqual(fire, []);
  assert.deepEqual(Object.keys(state.prs), [URL_B]);
});

test("a truncated observation prunes nothing: absent may just mean past the first page", () => {
  const start = baseline([pr(URL_A, false), pr(URL_B, true)]);
  const { state } = planOwnPrAutoReviews(start, seen([pr(URL_B, true)], false), { enabled: true, now: T1 });
  assert.deepEqual(Object.keys(state.prs).sort(), [URL_A, URL_B]);
});

test("a PR reported closed or merged is pruned even from a truncated observation, and never fires", () => {
  const start = baseline([pr(URL_A, true)]);
  const { state, fire } = planOwnPrAutoReviews(
    start,
    seen([{ url: URL_A, draft: false, headSha: null, state: "merged" }], false),
    { enabled: true, now: T1 },
  );
  assert.deepEqual(fire, []);
  assert.deepEqual(Object.keys(state.prs), []);
});

test("turning it off forgets everything, so turning it on again records a new baseline", () => {
  const start = baseline([pr(URL_A, true)]);
  const off = planOwnPrAutoReviews(start, seen([pr(URL_A, false)]), { enabled: false, now: T1 });
  assert.deepEqual(off.fire, [], "off never fires");
  assert.equal(off.state.baselineAt, null);
  assert.deepEqual(off.state.prs, {});
  const on = planOwnPrAutoReviews(off.state, seen([pr(URL_A, false)]), { enabled: true, now: T2 });
  assert.deepEqual(on.fire, [], "the ready PR is part of the new baseline");
});

test("the plan never mutates the state it was given", () => {
  const start = baseline([pr(URL_A, true)]);
  const snapshot = JSON.stringify(start);
  planOwnPrAutoReviews(start, seen([pr(URL_A, false)]), { enabled: true, now: T1 });
  assert.equal(JSON.stringify(start), snapshot);
});

// ── polling cadence and rate-limit backoff ────────────────────────────────────

const NOW_MS = Date.parse(T0);

test("a healthy poll waits the 3-minute floor", () => {
  assert.equal(OWN_PR_POLL_MIN_MS, 3 * 60_000);
  assert.equal(nextOwnPrPollDelayMs({ status: 200, nowMs: NOW_MS, consecutiveFailures: 0 }), OWN_PR_POLL_MIN_MS);
});

test("an exhausted rate limit waits for its reset", () => {
  const resetSec = Math.floor(NOW_MS / 1000) + 20 * 60;
  const delay = nextOwnPrPollDelayMs({
    status: 403,
    rateLimitRemaining: 0,
    rateLimitResetSec: resetSec,
    nowMs: NOW_MS,
    consecutiveFailures: 1,
  });
  assert.equal(delay, 20 * 60_000);
});

test("Retry-After wins when GitHub sends it, but never below the floor", () => {
  assert.equal(
    nextOwnPrPollDelayMs({ status: 429, retryAfterSec: 600, nowMs: NOW_MS, consecutiveFailures: 1 }),
    600_000,
  );
  assert.equal(
    nextOwnPrPollDelayMs({ status: 429, retryAfterSec: 5, nowMs: NOW_MS, consecutiveFailures: 1 }),
    OWN_PR_POLL_MIN_MS,
  );
});

test("other failures back off exponentially, capped at an hour", () => {
  const at = (n: number) => nextOwnPrPollDelayMs({ status: 502, nowMs: NOW_MS, consecutiveFailures: n });
  assert.equal(at(1), 6 * 60_000);
  assert.equal(at(2), 12 * 60_000);
  assert.equal(at(3), 24 * 60_000);
  assert.equal(at(10), 60 * 60_000);
});

test("a reset already in the past falls back to the floor, not zero", () => {
  const delay = nextOwnPrPollDelayMs({
    status: 403,
    rateLimitRemaining: 0,
    rateLimitResetSec: Math.floor(NOW_MS / 1000) - 60,
    nowMs: NOW_MS,
    consecutiveFailures: 1,
  });
  assert.equal(delay, OWN_PR_POLL_MIN_MS);
});
