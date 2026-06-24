import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateTurnUsage,
  buildChatUsagePlanSnapshot,
  formatChatUsagePlanSummary,
  makeUsageWindow,
} from "./chat-usage-plan.ts";

test("makeUsageWindow clamps used percent and preserves reset metadata", () => {
  const window = makeUsageWindow({
    id: "monthly",
    title: "Monthly",
    used: 1250,
    limit: 1000,
    unit: "tokens",
    resetsAt: "2026-07-01T05:00:00.000Z",
  });

  assert.deepEqual(window, {
    id: "monthly",
    title: "Monthly",
    used: 1000,
    limit: 1000,
    unit: "tokens",
    usedPercent: 100,
    remainingPercent: 0,
    resetsAt: "2026-07-01T05:00:00.000Z",
    usageKnown: true,
    limitKnown: true,
  });
});

test("makeUsageWindow exposes active usage without fabricating a quota percent", () => {
  const window = makeUsageWindow({
    id: "monthly",
    title: "Monthly",
    used: 42_000,
    limit: undefined,
    unit: "tokens",
    resetDescription: "resets monthly",
  });

  assert.equal(window.used, 42_000);
  assert.equal(window.limit, undefined);
  assert.equal(window.usedPercent, undefined);
  assert.equal(window.remainingPercent, undefined);
  assert.equal(window.usageKnown, true);
  assert.equal(window.limitKnown, false);
  assert.equal(window.resetDescription, "resets monthly");
});

test("aggregateTurnUsage sums all reported token counters and cost", () => {
  const totals = aggregateTurnUsage([
    {
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 25,
        cacheCreationTokens: 5,
      },
      costUsd: 0.02,
    },
    {
      usage: {
        inputTokens: 10,
        outputTokens: 5,
      },
      costUsd: 0.005,
    },
    {},
  ]);

  assert.deepEqual(totals, {
    inputTokens: 110,
    outputTokens: 55,
    cacheReadTokens: 25,
    cacheCreationTokens: 5,
    totalTokens: 195,
    costUsd: 0.025,
  });
});

test("buildChatUsagePlanSnapshot renders configured plan consumption", () => {
  const snapshot = buildChatUsagePlanSnapshot({
    model: "openai/gpt-5.5",
    planName: "Team",
    availability: "estimated",
    source: "local-conversations",
    updatedAt: "2026-06-24T12:00:00.000Z",
    period: {
      id: "monthly",
      label: "Monthly",
      startsAt: "2026-06-01T00:00:00.000Z",
      endsAt: "2026-07-01T00:00:00.000Z",
    },
    totals: {
      inputTokens: 600,
      outputTokens: 300,
      cacheReadTokens: 100,
      cacheCreationTokens: 0,
      totalTokens: 1000,
      costUsd: 4.2,
    },
    tokenLimit: 2000,
    costLimitUsd: 20,
  });

  assert.equal(snapshot.windows.tokens?.usedPercent, 50);
  assert.equal(snapshot.windows.cost?.usedPercent, 21);
  assert.equal(formatChatUsagePlanSummary(snapshot), "Team 50% · 1k/2k tok");
});

test("buildChatUsagePlanSnapshot is honest when plan limits are unconfigured", () => {
  const snapshot = buildChatUsagePlanSnapshot({
    model: "anthropic/claude-sonnet-4-6",
    availability: "unconfigured",
    source: "local-conversations",
    updatedAt: "2026-06-24T12:00:00.000Z",
    period: {
      id: "monthly",
      label: "Monthly",
      startsAt: "2026-06-01T00:00:00.000Z",
      endsAt: "2026-07-01T00:00:00.000Z",
    },
    totals: {
      inputTokens: 400,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 500,
      costUsd: 0,
    },
  });

  assert.equal(snapshot.windows.tokens?.limitKnown, false);
  assert.equal(snapshot.windows.tokens?.usedPercent, undefined);
  assert.equal(formatChatUsagePlanSummary(snapshot), "Usage 500 tok used");
});

console.log("chat-usage-plan.test.ts: ok");
