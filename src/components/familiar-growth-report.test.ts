import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { FamiliarGrowthReport } from "./familiar-growth-report";
import type { FamiliarGrowthReport as FamiliarGrowthReportModel } from "@/lib/familiar-growth-signals";
import type { Familiar, SessionRow } from "@/lib/types";

const familiar: Familiar = {
  id: "echo",
  display_name: "Echo",
  role: "Design familiar",
};

const report: FamiliarGrowthReportModel = {
  familiarId: "echo",
  healthLabel: "quiet",
  sessionsLast7d: 1,
  retroAcceptRate: 0.42,
  lastActiveAt: "2026-06-20T12:00:00.000Z",
  signals: [
    {
      kind: "low-accept-rate",
      track: "prompt",
      label: "Prompt track is reverting often",
      detail: "Prompt track shows a 58% revert rate and may need prompt refinement.",
      severity: "warn",
    },
    {
      kind: "session-gap",
      label: "Session gap",
      detail: "No active sessions in 8 days.",
      severity: "warn",
    },
    {
      kind: "no-memory",
      label: "No memory recorded",
      detail: "No memory recorded for this familiar.",
      severity: "warn",
    },
    {
      kind: "stale-memory",
      label: "Memory is stale",
      detail: "Latest memory update is 22 days old.",
      severity: "warn",
    },
    {
      kind: "low-retro-volume",
      label: "Low retro volume",
      detail: "Fewer than 3 retro runs are available.",
      severity: "info",
    },
    {
      kind: "healthy",
      label: "No current growth flags",
      detail: "This familiar has healthy recent activity.",
      severity: "info",
    },
  ],
  recentRuns: [
    {
      id: "run-1",
      familiarId: "echo",
      familiarName: "Echo",
      familiarRole: "Design familiar",
      iterationId: "1",
      iteration: 1,
      timestamp: "2026-06-23T12:00:00.000Z",
      track: "prompt",
      outcome: "REVERT",
      changeSummary: "Prompt rewrite reverted",
      metricBefore: 0.6,
      metricAfter: 0.4,
      delta: -0.2,
      notes: "Too broad",
      raw: {},
    },
  ],
  trackStats: {
    synthesis: { total: 2, accepted: 2 },
    prompt: { total: 3, accepted: 1 },
    memory: { total: 0, accepted: 0 },
  },
};

const sessions: SessionRow[] = [
  {
    id: "session-1",
    project_root: "/tmp",
    harness: "codex",
    title: "Review layout",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-06-23T10:00:00.000Z",
    updated_at: "2026-06-23T12:00:00.000Z",
    familiarId: "echo",
  },
];

describe("FamiliarGrowthReport", () => {
  it("renders the summary, activity trends, eval performance, and all signal kinds", () => {
    const html = renderToStaticMarkup(
      createElement(FamiliarGrowthReport, { familiar, report, sessions }),
    );

    expect(html).toContain("Growth report for Echo");
    expect(html).toContain("Activity Trends");
    expect(html).toContain("Eval Performance");
    expect(html).toContain("Growth Opportunities");
    expect(html).toContain("Prompt track is reverting often");
    expect(html).toContain("Session gap");
    expect(html).toContain("No memory recorded");
    expect(html).toContain("Memory is stale");
    expect(html).toContain("Low retro volume");
    expect(html).toContain("No current growth flags");
    expect(html).toContain("Prompt rewrite reverted");
  });

  it("renders an empty run feed when there are no retro runs", () => {
    const html = renderToStaticMarkup(
      createElement(FamiliarGrowthReport, { familiar, report: { ...report, recentRuns: [] }, sessions: [] }),
    );

    expect(html).toContain("No recent retro runs");
  });
});
