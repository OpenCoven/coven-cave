import assert from "node:assert/strict";
import test from "node:test";
import {
  IN_FLIGHT_VIEWS,
  foldInFlight,
  inFlightDescription,
  inFlightLabel,
  inFlightNote,
  inFlightRowText,
  inFlightView,
  parseInFlightOverview,
  type InFlightCache,
} from "./in-flight.ts";

// Shaped like Coven 0.4.10's occurrence.list.v1 rows; the free text must never survive.
const occurrence = (automationId: string, scheduledFor: string, kind = "scheduled") => ({
  id: `occ-${automationId}-${scheduledFor}`, automationId, automationRevision: 2, scheduledFor, kind, state: "claimed",
  failureReason: "failed to spawn harness `coven-code`", leaseOwner: "scheduler-7", definitionDigest: "abc", fenceGeneration: 1,
  createdAt: scheduledFor, updatedAt: scheduledFor, leaseExpiresAt: null, schedulerGeneration: null,
});
const empty = { recovery_required: [], running: [], claimed: [], due: [] };

test("each automation keeps only its most urgent state, with a count, its oldest slot and whether Run now started it", () => {
  const folded = foldInFlight({
    ...empty,
    recovery_required: [occurrence("nightly", "2026-10-18T09:00:00.000Z")],
    running: [occurrence("nightly", "2026-10-18T10:00:00.000Z"), occurrence("weekly", "2026-10-18T11:00:00.000Z", "manual")],
    claimed: [occurrence("report", "2026-10-18T12:00:00.000Z", "manual"), occurrence("report", "2026-10-18T11:30:00.000Z", "manual")],
    due: [occurrence("weekly", "2026-10-18T08:00:00.000Z")],
  });
  assert.deepEqual(folded, {
    byAutomation: {
      nightly: { state: "recovery_required", count: 1, since: "2026-10-18T09:00:00.000Z", manual: false },
      weekly: { state: "running", count: 1, since: "2026-10-18T11:00:00.000Z", manual: true },
      report: { state: "claimed", count: 2, since: "2026-10-18T11:30:00.000Z", manual: true },
    },
    truncated: [],
  });
  assert.doesNotMatch(JSON.stringify(folded), /spawn|scheduler-7|abc/);
});

test("a view at Coven's bound is reported as truncated, and a malformed row fails the read", () => {
  const full = Array.from({ length: 100 }, (_, index) => occurrence(`a${index}`, "2026-10-18T09:00:00.000Z"));
  assert.deepEqual(foldInFlight({ ...empty, due: full })?.truncated, ["due"]);
  assert.equal(foldInFlight({ ...empty, running: [{ ...occurrence("x", "2026-10-18T09:00:00.000Z"), automationId: "has space" }] }), undefined);
  assert.equal(foldInFlight({ ...empty, running: [{ ...occurrence("x", "soon") }] }), undefined);
});

test("labels keep each state distinct and name counts", () => {
  const labels = IN_FLIGHT_VIEWS.map((state) => inFlightLabel({ state, count: 1, since: "2026-10-18T09:00:00.000Z", manual: false }));
  assert.deepEqual(labels, ["Recovery required", "Running", "Claimed", "Due"]);
  assert.equal(inFlightLabel({ state: "due", count: 3, since: "2026-10-18T09:00:00.000Z", manual: false }), "Due · 3");
  assert.equal(inFlightDescription({ state: "claimed", count: 1, since: "2026-10-18T09:00:00.000Z", manual: true }, () => "9:00"),
    "A Run now occurrence is claimed in Coven, the oldest for 9:00.");
});

const readAt = "2026-10-18T12:00:00.000Z";
const at = Date.parse(readAt);
const good: InFlightCache = {
  lastGood: { kind: "available", readAt, byAutomation: { nightly: { state: "running", count: 1, since: readAt, manual: false } }, truncated: [] },
  latest: "available",
};

test("a row's state is live only while the read is fresh and the latest attempt succeeded", () => {
  assert.deepEqual(inFlightView(good, "nightly", at + 1_000).freshness, "live");
  assert.equal(inFlightRowText(inFlightView(good, "nightly", at + 1_000)), "Running");
  assert.equal(inFlightRowText(inFlightView(good, "nightly", at + 61_000)), "Running · stale");
  assert.equal(inFlightRowText(inFlightView({ ...good, latest: "unavailable" }, "nightly", at)), "Running · stale");
  assert.equal(inFlightView(good, "weekly", at).entry, null, "nothing in flight");
  assert.equal(inFlightView({ lastGood: null, latest: null }, "nightly", at).freshness, "checking");
  assert.equal(inFlightView({ lastGood: null, latest: "unsupported" }, "nightly", at).freshness, "unsupported");
});

test("the list says when rows cannot be trusted to show what is running", () => {
  const fmt = () => "12:00";
  assert.equal(inFlightNote(good, at + 1_000, fmt), null);
  assert.match(String(inFlightNote({ lastGood: null, latest: "unavailable" }, at, fmt)), /Couldn't read what is running/);
  assert.match(String(inFlightNote({ ...good, latest: "unavailable" }, at, fmt)), /Row states are from 12:00/);
  assert.match(String(inFlightNote(good, at + 61_000, fmt)), /read at 12:00 and may be out of date/);
  assert.match(String(inFlightNote({ ...good, lastGood: { ...good.lastGood!, truncated: ["due"] } }, at, fmt)), /limit of 100 for due occurrences/);
  assert.match(String(inFlightNote({ lastGood: null, latest: "unsupported" }, at, fmt)), /doesn't report occurrences/);
});

test("Cave's own answer is re-validated in the browser", () => {
  const answer = good.lastGood!;
  assert.deepEqual(parseInFlightOverview(answer), answer);
  for (const bad of [
    { ...answer, byAutomation: { "has space": answer.byAutomation.nightly } },
    { ...answer, byAutomation: { nightly: { ...answer.byAutomation.nightly, state: "approving" } } },
    { ...answer, byAutomation: { nightly: { ...answer.byAutomation.nightly, count: 0 } } },
    { ...answer, truncated: ["approving"] },
    { ...answer, readAt: "now" },
    null,
  ]) assert.equal(parseInFlightOverview(bad).kind, "unavailable");
  assert.deepEqual(parseInFlightOverview({ kind: "unsupported" }), { kind: "unsupported" });
});
