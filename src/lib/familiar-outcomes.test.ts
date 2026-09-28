import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Card, CardGitHubLink } from "./cave-board-types.ts";
import {
  calibrate,
  outcomeFromCard,
  outcomesFromFeedback,
  summarizeFamiliarOutcomes,
  type FamiliarOutcome,
  type FeedbackVoteRecord,
} from "./familiar-outcomes.ts";
import type { ThreadSelfReport } from "./thread-self-report.ts";

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    title: "Fix the thing",
    notes: "",
    status: "done",
    priority: "medium",
    familiarId: "cody",
    sessionId: "session-1",
    cwd: null,
    links: [],
    github: [],
    asana: [],
    labels: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    lifecycle: "completed",
    lifecycleAt: "2026-09-02T00:00:00.000Z",
    retryCount: 0,
    maxRetries: 0,
    steps: [],
    ...overrides,
  };
}

function pr(number: number, state: string | undefined, updatedAt?: string): CardGitHubLink {
  return {
    id: `github:pr:opencoven/coven-cave:${number}`,
    kind: "pr",
    repo: "OpenCoven/coven-cave",
    number,
    title: `PR ${number}`,
    url: `https://github.com/OpenCoven/coven-cave/pull/${number}`,
    labels: [],
    ...(state ? { state } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function report(sessionId: string, overallConfidence: number, reportedAt = "2026-09-02T00:00:00.000Z"): ThreadSelfReport {
  return { id: `r-${sessionId}-${reportedAt}`, familiarId: "cody", sessionId, reportedAt, overallConfidence } as ThreadSelfReport;
}

describe("outcomeFromCard", () => {
  it("a completed card with a merged PR is a strong acceptance citing the PR", () => {
    const outcome = outcomeFromCard(card({ github: [pr(1, "merged"), pr(2, "open")] }));
    assert.equal(outcome?.kind, "accepted");
    assert.equal(outcome?.evidence, "strong");
    assert.equal(outcome?.source, "github-pr");
    assert.deepEqual(outcome?.refs, ["https://github.com/OpenCoven/coven-cave/pull/1"]);
    assert.equal(outcome?.sessionId, "session-1");
  });

  it("a completed card without PR evidence is a weak acceptance", () => {
    const outcome = outcomeFromCard(card());
    assert.equal(outcome?.kind, "accepted");
    assert.equal(outcome?.evidence, "weak");
    assert.deepEqual(outcome?.refs, []);
  });

  it("an unfinished card whose PR closed unmerged is a rejection dated by the PR", () => {
    const outcome = outcomeFromCard(card({
      status: "blocked",
      lifecycle: "cancelled",
      github: [pr(3, "closed", "2026-09-05T00:00:00.000Z"), pr(4, "closed", "2026-09-04T00:00:00.000Z")],
    }));
    assert.equal(outcome?.kind, "rejected");
    assert.equal(outcome?.evidence, "strong");
    assert.equal(outcome?.at, "2026-09-05T00:00:00.000Z");
    assert.equal(outcome?.refs.length, 2);
  });

  it("records no outcome for cancelled work without PR evidence, open work, or unowned cards", () => {
    assert.equal(outcomeFromCard(card({ lifecycle: "cancelled", status: "blocked" })), null);
    assert.equal(outcomeFromCard(card({ lifecycle: "queued", status: "backlog" })), null);
    assert.equal(outcomeFromCard(card({ lifecycle: "running", status: "running", github: [pr(5, "open")] })), null);
    assert.equal(outcomeFromCard(card({ familiarId: null })), null);
  });

  it("a merged PR outweighs a closed one on unfinished work", () => {
    assert.equal(outcomeFromCard(card({ lifecycle: "queued", github: [pr(6, "merged"), pr(7, "closed")] })), null);
  });

  it("never reads the familiar-written lifecycle reason to decide", () => {
    const claimed = card({ lifecycle: "cancelled", status: "blocked", lifecycleReason: "GitHub PR merged: OpenCoven/coven-cave #9" });
    assert.equal(outcomeFromCard(claimed), null, "prose claiming a merge is not evidence of one");
    const kept = outcomeFromCard(card({ lifecycleReason: "Delivered" }));
    assert.equal(kept?.detail, "Delivered", "the reason is still carried for display");
  });
});

describe("calibrate", () => {
  const accepted = outcomeFromCard(card({ id: "a", sessionId: "s-accepted" })) as FamiliarOutcome;
  const rejected = outcomeFromCard(card({
    id: "b",
    sessionId: "s-rejected",
    lifecycle: "cancelled",
    github: [pr(8, "closed")],
  })) as FamiliarOutcome;

  it("scores confidence against outcomes: Brier and signed gap", () => {
    const result = calibrate([accepted, rejected], [report("s-accepted", 80), report("s-rejected", 30)]);
    assert.equal(result?.samples, 2);
    // ((0.8 - 1)^2 + (0.3 - 0)^2) / 2
    assert.ok(Math.abs((result?.brier ?? NaN) - 0.065) < 1e-9);
    // ((0.8 - 1) + (0.3 - 0)) / 2
    assert.ok(Math.abs((result?.meanGap ?? NaN) - 0.05) < 1e-9);
  });

  it("uses the newest report when a thread was reflected more than once", () => {
    const result = calibrate([accepted], [
      report("s-accepted", 20, "2026-09-01T00:00:00.000Z"),
      report("s-accepted", 90, "2026-09-03T00:00:00.000Z"),
    ]);
    assert.equal(result?.samples, 1);
    assert.ok(Math.abs((result?.meanGap ?? NaN) - -0.1) < 1e-9);
  });

  it("orders reports by instant, not text, when timestamps carry offsets", () => {
    // 01:00+02:00 on the 2nd is 23:00Z on the 1st: earlier than 23:30Z, but it
    // sorts later as text. The 23:30Z report is the newest.
    const result = calibrate([accepted], [
      report("s-accepted", 20, "2026-09-02T01:00:00+02:00"),
      report("s-accepted", 90, "2026-09-01T23:30:00Z"),
    ]);
    assert.ok(Math.abs((result?.meanGap ?? NaN) - -0.1) < 1e-9);
  });

  it("ignores outcomes without a linked report, including redacted legacy ids", () => {
    assert.equal(calibrate([accepted], [report("[redacted]", 80)]), null);
    assert.equal(calibrate([{ ...accepted, sessionId: null }], [report("s-accepted", 80)]), null);
    assert.equal(calibrate([], []), null);
  });
});

describe("summarizeFamiliarOutcomes", () => {
  it("scopes to one familiar, counts outcomes, and lists newest first", () => {
    const cards = [
      card({ id: "old", sessionId: "s1", lifecycleAt: "2026-09-01T00:00:00.000Z", github: [pr(1, "merged")] }),
      card({ id: "new", sessionId: "s2", lifecycleAt: "2026-09-03T00:00:00.000Z" }),
      card({ id: "bad", sessionId: "s3", lifecycle: "cancelled", status: "blocked", github: [pr(2, "closed", "2026-09-02T00:00:00.000Z")] }),
      card({ id: "open", sessionId: "s4", lifecycle: "queued", status: "backlog" }),
      card({ id: "nova", familiarId: "nova", sessionId: "s5" }),
    ];
    const summary = summarizeFamiliarOutcomes("cody", cards, [
      report("s1", 90),
      { ...report("s5", 10), familiarId: "nova" },
    ]);
    assert.deepEqual(summary.outcomes.map((outcome) => outcome.cardId), ["new", "bad", "old"]);
    assert.deepEqual(summary.counts, {
      accepted: 2,
      acceptedStrong: 1,
      rejected: 1,
      acceptRate: 2 / 3,
      bySource: {
        board: { accepted: 1, rejected: 0 },
        "github-pr": { accepted: 1, rejected: 1 },
        "chat-feedback": { accepted: 0, rejected: 0 },
      },
    });
    assert.equal(summary.calibration?.samples, 1, "another familiar's report never calibrates this one");
  });

  it("orders outcomes and dates rejections by instant when timestamps carry offsets", () => {
    const cards = [
      // 23:00Z on the 1st, written with an offset: text sorts it after "2026-09-01T23:30:00Z".
      card({ id: "offset", lifecycleAt: "2026-09-02T01:00:00+02:00" }),
      card({ id: "zulu", lifecycleAt: "2026-09-01T23:30:00Z" }),
      card({
        id: "bad",
        lifecycle: "cancelled",
        status: "blocked",
        github: [pr(1, "closed", "2026-09-02T01:00:00+02:00"), pr(2, "closed", "2026-09-01T23:30:00Z"), pr(3, "closed", "not a date")],
      }),
    ];
    const summary = summarizeFamiliarOutcomes("cody", cards, []);
    assert.deepEqual(summary.outcomes.map((outcome) => outcome.cardId), ["bad", "zulu", "offset"]);
    assert.equal(summary.outcomes[0].at, "2026-09-01T23:30:00Z", "the latest closure by instant dates the rejection");
  });

  it("reports no rate and no calibration when there is no evidence yet", () => {
    const summary = summarizeFamiliarOutcomes("cody", [], []);
    assert.equal(summary.counts.acceptRate, null);
    assert.equal(summary.calibration, null);
  });
});

function vote(overrides: Partial<FeedbackVoteRecord> = {}): FeedbackVoteRecord {
  return { messageId: "msg-1", vote: "down", cleared: false, familiarId: "cody", sessionId: "s-vote", at: "2026-09-10T00:00:00.000Z", ...overrides };
}

describe("outcomesFromFeedback", () => {
  it("turns a thumbs vote into an explicit outcome on its thread", () => {
    const [down] = outcomesFromFeedback([vote()]);
    assert.equal(down.kind, "rejected");
    assert.equal(down.evidence, "strong");
    assert.equal(down.source, "chat-feedback");
    assert.equal(down.sessionId, "s-vote");
    assert.equal(down.messageId, "msg-1");
    assert.equal(down.id, "feedback:msg-1");
    assert.equal(outcomesFromFeedback([vote({ vote: "up" })])[0].kind, "accepted");
  });

  it("uses each message's latest vote, by instant", () => {
    const [latest] = outcomesFromFeedback([
      vote({ vote: "down", at: "2026-09-10T02:00:00+02:00" }), // 00:00Z
      vote({ vote: "up", at: "2026-09-10T01:00:00Z" }),
    ]);
    assert.equal(latest.kind, "accepted", "the later vote (01:00Z) wins even though its text sorts first");
  });

  it("shows a thumbs-down's one-tap reason as the outcome detail", () => {
    const [latest] = outcomesFromFeedback([
      vote({ at: "2026-09-10T00:00:00Z" }),
      vote({ at: "2026-09-10T00:00:05Z", reason: "misunderstood" }),
    ]);
    assert.equal(latest.kind, "rejected", "the reason follow-up is still the same down vote");
    assert.equal(latest.detail, "Misunderstood me");
    assert.equal(outcomesFromFeedback([vote({ reason: "not-a-reason" })])[0].detail, undefined);
    assert.equal(outcomesFromFeedback([vote({ vote: "up", reason: "incorrect" })])[0].detail, undefined);
  });

  it("drops a vote that was toggled off, and votes without a familiar", () => {
    assert.deepEqual(outcomesFromFeedback([vote({ at: "2026-09-10T00:00:00Z" }), vote({ cleared: true, at: "2026-09-10T00:01:00Z" })]), []);
    assert.deepEqual(outcomesFromFeedback([vote({ familiarId: undefined })]), []);
  });

  it("keeps a legacy vote without a thread id as an outcome that cannot calibrate", () => {
    const [legacy] = outcomesFromFeedback([vote({ sessionId: undefined })]);
    assert.equal(legacy.sessionId, null);
    assert.equal(calibrate([legacy], [report("s-vote", 80)]), null);
  });
});

describe("calibration with chat feedback", () => {
  it("scores each thread once, by the share of its outcomes accepted", () => {
    const completed = outcomeFromCard(card({ id: "c", sessionId: "s-mixed" })) as FamiliarOutcome;
    const [down] = outcomesFromFeedback([vote({ sessionId: "s-mixed" })]);
    const result = calibrate([completed, down], [report("s-mixed", 70)]);
    assert.equal(result?.samples, 1, "one thread, one sample");
    // actual = 1 of 2 accepted = 0.5; gap = 0.7 - 0.5
    assert.ok(Math.abs((result?.meanGap ?? NaN) - 0.2) < 1e-9);
  });

  it("does not let many upvoted messages in one thread count as many samples", () => {
    const ups = outcomesFromFeedback(["a", "b", "c"].map((messageId) => vote({ messageId, vote: "up", sessionId: "s-busy" })));
    assert.equal(calibrate(ups, [report("s-busy", 40)])?.samples, 1);
  });

  it("folds votes into the familiar's summary and splits counts by source", () => {
    const summary = summarizeFamiliarOutcomes(
      "cody",
      [card({ id: "done", sessionId: "s1" })],
      [],
      [vote({ messageId: "m1", vote: "down" }), vote({ messageId: "m2", vote: "up" }), vote({ messageId: "m3", familiarId: "nova" })],
    );
    assert.equal(summary.outcomes.length, 3, "another familiar's vote is excluded");
    assert.deepEqual(summary.counts.bySource["chat-feedback"], { accepted: 1, rejected: 1 });
    assert.deepEqual(summary.counts.bySource.board, { accepted: 1, rejected: 0 });
    assert.equal(summary.counts.rejected, 1);
  });
});
