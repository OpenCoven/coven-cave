import assert from "node:assert/strict";
import test from "node:test";
import {
  FEED_STALE_AFTER_MS,
  INITIAL_FEED_STATE,
  applyFeedRead,
  feedFreshness,
  feedStatusText,
  markFeedPass,
  parseFeedRead,
  retainFeedStreams,
  type AutomationFeedEvent,
  type AutomationFeedRead,
  type AutomationFeedStream,
} from "./feed.ts";

const automation: AutomationFeedStream = { kind: "automation", id: "nightly" };
const run: AutomationFeedStream = { kind: "run", id: "run-1" };
const id = (n: number) => `evt${String(n).padStart(32, "0")}`;
const event = (n: number, topic: AutomationFeedEvent["topic"] = "definition", label = "Definition revised"): AutomationFeedEvent => ({
  id: id(n), sequence: n, recordedAt: new Date(Date.UTC(2026, 9, 18, 8, 0, n)).toISOString(), topic, label, detail: `Revision ${n}`,
});
const read = (events: AutomationFeedEvent[], extra: Partial<Extract<AutomationFeedRead, { kind: "available" }>> = {}): AutomationFeedRead => ({
  kind: "available", readAt: "2026-10-18T08:00:00.000Z", checkpoint: `cp-${events.at(-1)?.sequence ?? "none"}`, caughtUp: true,
  events, omitted: 0, throughSequence: events.at(-1)?.sequence ?? null, ...extra,
});

test("a stream's first read is a baseline: it positions the cursor and announces nothing", () => {
  const { state, changed, reset } = applyFeedRead(INITIAL_FEED_STATE, automation, read([event(0), event(1)]), 1_000);
  assert.deepEqual(changed, []);
  assert.equal(reset, false);
  assert.deepEqual(state.cursors["automation:nightly"], { checkpoint: "cp-1", lastSequence: 1, seen: [id(0), id(1)] });
  assert.equal(state.lastEvent, null);
});

test("new events announce what they invalidate, once each", () => {
  const baseline = applyFeedRead(INITIAL_FEED_STATE, run, read([event(0, "run", "Run changed")]), 1_000).state;
  const next = applyFeedRead(baseline, run, read([event(1, "run", "Attempt changed"), event(2, "occurrence", "Occurrence changed")]), 2_000);
  assert.deepEqual(next.changed.sort(), ["occurrence", "run"]);
  assert.equal(next.state.cursors["run:run-1"].checkpoint, "cp-2");
  assert.equal(next.state.lastEvent?.id, id(2));
  assert.deepEqual(next.state.recent.map((entry) => entry.id), [id(2), id(1)], "newest first");
});

test("a replayed window is duplicate-safe: nothing is applied twice", () => {
  let state = applyFeedRead(INITIAL_FEED_STATE, automation, read([event(0)]), 1_000).state;
  state = applyFeedRead(state, automation, read([event(1), event(2)]), 2_000).state;
  // Coven answers the same window again (for example after its own restart).
  const again = applyFeedRead(state, automation, read([event(1), event(2)]), 3_000);
  assert.deepEqual(again.changed, []);
  assert.equal(again.reset, false);
  assert.deepEqual(again.state.recent.map((entry) => entry.id), [id(2), id(1)]);
});

test("an unseen event below an applied sequence resets the stream instead of regressing state", () => {
  let state = applyFeedRead(INITIAL_FEED_STATE, automation, read([event(0)]), 1_000).state;
  state = applyFeedRead(state, automation, read([event(5)]), 2_000).state;
  const regressed = applyFeedRead(state, automation, read([event(3)]), 3_000);
  assert.equal(regressed.reset, true);
  assert.deepEqual(regressed.changed.sort(), ["definition", "occurrence", "run"]);
  assert.equal(regressed.state.cursors["automation:nightly"], undefined, "the next read starts from the beginning");
  assert.deepEqual(regressed.state.lastReset, { at: 3_000, reason: "out_of_order" });
});

test("an expired checkpoint resets the stream and asks for a fresh read of everything", () => {
  const state = applyFeedRead(INITIAL_FEED_STATE, automation, read([event(0)]), 1_000).state;
  const expired = applyFeedRead(state, automation, { kind: "expired" }, 5_000);
  assert.equal(expired.reset, true);
  assert.equal(expired.state.cursors["automation:nightly"], undefined);
  assert.deepEqual(expired.state.lastReset, { at: 5_000, reason: "expired" });
  assert.match(feedStatusText(markFeedPass(expired.state, 5_000), 6_000, () => "08:00"), /Reset at 08:00: Coven no longer held Cave's position/);
});

test("protected events still move the stream even though Cave cannot show them", () => {
  const state = applyFeedRead(INITIAL_FEED_STATE, run, read([event(0, "run")]), 1_000).state;
  const hidden = applyFeedRead(state, run, read([], { omitted: 2, throughSequence: 2, checkpoint: "cp-2" }), 2_000);
  assert.deepEqual(hidden.changed, ["run"]);
  assert.equal(hidden.state.cursors["run:run-1"].lastSequence, 2);
});

test("an outage is reported from its first failure until a whole pass succeeds", () => {
  let state = markFeedPass(applyFeedRead(INITIAL_FEED_STATE, automation, read([event(0)]), 1_000).state, 1_000);
  assert.deepEqual(feedFreshness(state, 2_000), { kind: "live", lastReadAt: 1_000 });
  state = applyFeedRead(state, automation, { kind: "unavailable" }, 11_000).state;
  state = applyFeedRead(state, automation, { kind: "unavailable" }, 21_000).state;
  assert.deepEqual(feedFreshness(state, 22_000), { kind: "disconnected", since: 11_000, lastReadAt: 1_000 });
  assert.match(feedStatusText(state, 22_000, () => "08:00:11"), /^Changefeed disconnected since 08:00:11/);
  state = markFeedPass(applyFeedRead(state, automation, read([]), 31_000).state, 31_000);
  assert.equal(feedFreshness(state, 31_000).kind, "live");
});

test("a feed not read for longer than the stale threshold says so", () => {
  const state = markFeedPass(INITIAL_FEED_STATE, 1_000);
  assert.equal(feedFreshness(state, 1_000 + FEED_STALE_AFTER_MS).kind, "live");
  assert.deepEqual(feedFreshness(state, 1_001 + FEED_STALE_AFTER_MS), { kind: "stale", lastReadAt: 1_000 });
  assert.match(feedStatusText(state, 46_000, String), /^Changefeed stale: last checked 45 s ago/);
  assert.equal(feedFreshness(INITIAL_FEED_STATE, 0).kind, "connecting");
  const unsupported = applyFeedRead(INITIAL_FEED_STATE, automation, { kind: "unsupported" }, 0).state;
  assert.match(feedStatusText(unsupported, 0, String), /doesn't provide a changefeed/);
});

test("streams the panel stops following are forgotten", () => {
  let state = applyFeedRead(INITIAL_FEED_STATE, automation, read([event(0)]), 1_000).state;
  state = applyFeedRead(state, run, read([event(0, "run")]), 1_000).state;
  assert.deepEqual(Object.keys(retainFeedStreams(state, [automation]).cursors), ["automation:nightly"]);
  assert.equal(retainFeedStreams(state, [automation, run]), state, "unchanged when nothing is dropped");
});

test("Cave's feed answer is validated before the reducer sees it", () => {
  const good = read([event(0), event(1)]);
  assert.deepEqual(parseFeedRead(good), good);
  for (const bad of [
    { ...good, events: [event(1), event(0)] },
    { ...good, events: [event(0), event(0)] },
    { ...good, events: [{ ...event(0), id: "short" }] },
    { ...good, events: [{ ...event(0), topic: "approval" }] },
    { ...good, checkpoint: "" },
    { ...good, throughSequence: 0 },
    { ...good, throughSequence: null },
    { ...good, omitted: -1 },
    { ...good, caughtUp: "yes" },
    null,
  ]) assert.equal(parseFeedRead(bad).kind, "unavailable");
  assert.deepEqual(parseFeedRead({ kind: "expired" }), { kind: "expired" });
});
