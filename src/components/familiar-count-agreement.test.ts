import assert from "node:assert/strict";
import test from "node:test";

import { buildFamiliarAnalyticsModel, type FamiliarAnalyticsData } from "./familiar-analytics-data.ts";
import { buildFamiliarCardStats } from "./familiars-view-stats.ts";
import { buildProfileCardModel } from "../lib/profile-card.ts";
import {
  COUNT_LABELS,
  allTimeSessionCount,
  memoryCountDisplay,
  recentSessionCount,
} from "../lib/familiar-counts.ts";
import { EMPTY_FEEDBACK_ROLLUP } from "../lib/message-feedback-rollup.ts";
import { NO_CHAT_ATTENTION } from "../lib/chat-attention.ts";
import type { SessionRow } from "../lib/types.ts";

// #6357: the roster, the share card and the analytics dock each counted
// "sessions" from a different list. These tests pin one rule per label.

const NOW = Date.parse("2026-10-31T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60_000).toISOString();
const familiar = { id: "cody", display_name: "Cody", role: "Coding familiar" };

function row(id: string, overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id,
    familiarId: "cody",
    updated_at: overrides.updated_at ?? daysAgo(1),
    created_at: overrides.updated_at ?? daysAgo(1),
    project_root: "/repo",
    harness: "claude",
    title: id,
    status: "stopped",
    exit_code: 0,
    archived_at: null,
    attention: NO_CHAT_ATTENTION,
    ...overrides,
  } as SessionRow;
}

// Every kind of row that used to tip one surface's count away from another's.
const everything: SessionRow[] = [
  row("recent-1"),
  row("recent-2", { updated_at: daysAgo(29) }),
  row("recent-3", { updated_at: daysAgo(89) }),
  row("old", { updated_at: daysAgo(200), created_at: daysAgo(200) }),
  row("archived-recent", { archived_at: daysAgo(2) }),
  row("archived-old", { updated_at: daysAgo(300), archived_at: daysAgo(250) }),
  row("workspace-journal", { familiarWorkspace: true }),
  row("someone-else", { familiarId: "nova" }),
];
// The roster and the share card load the list without archived rows.
const unarchived = everything.filter((session) => !session.archived_at);

test("recent and all-time session counts follow their written definitions", () => {
  assert.equal(recentSessionCount(everything, "cody", NOW), 3);
  assert.equal(allTimeSessionCount(everything, "cody"), 6);
  assert.equal(COUNT_LABELS.recentSessions, "Coven sessions · 90d");
});

test("roster, share card and dock show the same Coven sessions · 90d number", () => {
  const roster = buildFamiliarCardStats({
    familiars: [familiar],
    sessions: unarchived,
    memoryAvailability: "ready",
    fileEntries: [],
    now: NOW,
  }).get("cody");
  const card = buildProfileCardModel({
    kind: "familiar",
    familiarId: "cody",
    sessions: unarchived,
    familiarIds: ["cody", "nova"],
    memoryCount: 0,
    now: NOW,
  });
  const dock = buildFamiliarAnalyticsModel(
    {
      familiarId: "cody",
      familiars: [familiar],
      contractReport: null,
      sessions: everything,
      memoryAvailability: "ready",
      fileEntries: [],
      retroSnapshot: {
        generatedAt: new Date(0).toISOString(),
        summary: {
          totalRuns: 0,
          accepted: 0,
          reverted: 0,
          runningFamiliars: 0,
          familiarsWithData: 0,
          trackCounts: { synthesis: 0, prompt: 0, memory: 0 },
          lastRun: null,
        },
        familiars: [],
        runs: [],
      },
      threadReports: [],
      metricSnapshots: [],
      modelFeedback: EMPTY_FEEDBACK_ROLLUP,
      executionAnalytics: null,
      outcomes: [],
      errors: [],
    } as FamiliarAnalyticsData,
    NOW,
  );

  assert.equal(roster?.sessionsLast90d, 3);
  assert.equal(card.sessionsTotal, 3);
  assert.equal(card.sessionsTotalLabel, COUNT_LABELS.recentSessions.toLowerCase());
  const tile = card.statTiles.find((entry) => entry.label === COUNT_LABELS.recentSessions.toLowerCase());
  assert.equal(tile?.value, "3");
  assert.equal(dock.sessionCounts.recent, 3);
  // The dock's larger number has its own label, and it no longer shares one.
  assert.equal(dock.sessionCounts.allTime, 6);
  // Shorter windows use the same conversation rule, so they never exceed 90d.
  assert.equal(roster?.sessionsLast7d, 1);
  assert.equal(card.statTiles.find((entry) => entry.label === "sessions (30d)")?.value, "2");
});

test("the share card shows the roster's memory count, or says unavailable, never a dash", () => {
  const card = buildProfileCardModel({
    kind: "familiar",
    familiarId: "cody",
    sessions: unarchived,
    familiarIds: ["cody"],
    memoryCount: 260,
    now: NOW,
  });
  assert.equal(card.statTiles.find((entry) => entry.label === "memories")?.value, "260");

  const unknown = buildProfileCardModel({
    kind: "familiar",
    familiarId: "cody",
    sessions: unarchived,
    familiarIds: ["cody"],
    memoryCount: null,
    now: NOW,
  });
  assert.equal(unknown.statTiles.find((entry) => entry.label === "memories")?.value, "unavailable");
  assert.deepEqual(memoryCountDisplay(null), { value: "unavailable", unavailable: true });
});
