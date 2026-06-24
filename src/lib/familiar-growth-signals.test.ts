import { describe, expect, it } from "vitest";
import {
  deriveGrowthReport,
  GROWTH_THRESHOLDS,
  type FamiliarGrowthReport,
} from "./familiar-growth-signals";
import type { FamiliarCardStats } from "@/components/familiars-view-stats";
import type { RetroFamiliarState, RetroRun, RetroTrack } from "@/lib/retro-runs";
import type { Familiar } from "@/lib/types";

const NOW = Date.parse("2026-06-24T12:00:00.000Z");

const familiar: Familiar = {
  id: "cody",
  display_name: "Cody",
  role: "Coding familiar",
};

function daysAgo(days: number): string {
  return new Date(NOW - days * 24 * 60 * 60_000).toISOString();
}

function stats(overrides: Partial<FamiliarCardStats> = {}): FamiliarCardStats {
  return {
    memoryCount: 3,
    latestMemory: { title: "Recent memory", updatedAt: daysAgo(1) },
    lastSessionAt: daysAgo(1),
    sessionsLast7d: 4,
    hasActiveSession: true,
    ...overrides,
  };
}

function run(track: RetroTrack, outcome: "ACCEPT" | "REVERT", index: number, delta = 0.2): RetroRun {
  return {
    id: `run-${track}-${index}`,
    familiarId: familiar.id,
    familiarName: familiar.display_name,
    familiarRole: familiar.role,
    iterationId: `${index}`,
    iteration: index,
    timestamp: daysAgo(index),
    track,
    outcome,
    changeSummary: `${track} iteration ${index}`,
    metricBefore: 0.4,
    metricAfter: 0.4 + delta,
    delta,
    raw: { index },
  };
}

function retro(runs: RetroRun[]): RetroFamiliarState {
  return {
    familiarId: familiar.id,
    familiarName: familiar.display_name,
    familiarRole: familiar.role,
    lastRun: runs[0]?.timestamp ?? null,
    running: false,
    trackCounts: {
      synthesis: runs.filter((item) => item.track === "synthesis").length,
      prompt: runs.filter((item) => item.track === "prompt").length,
      memory: runs.filter((item) => item.track === "memory").length,
    },
    totalAccepted: runs.filter((item) => item.outcome === "ACCEPT").length,
    totalReverted: runs.filter((item) => item.outcome === "REVERT").length,
    runs,
    raw: {},
  };
}

function kinds(report: FamiliarGrowthReport) {
  return report.signals.map((signal) => signal.kind);
}

describe("deriveGrowthReport", () => {
  it("marks an active familiar with enough accepted retro data as healthy", () => {
    const report = deriveGrowthReport({
      familiar,
      stats: stats(),
      retroState: retro([
        run("synthesis", "ACCEPT", 1),
        run("prompt", "ACCEPT", 2),
        run("memory", "ACCEPT", 3),
      ]),
      now: NOW,
    });

    expect(report.healthLabel).toBe("active");
    expect(report.retroAcceptRate).toBe(1);
    expect(kinds(report)).toEqual(["healthy"]);
  });

  it("flags low accept rate for a track with enough samples", () => {
    const report = deriveGrowthReport({
      familiar,
      stats: stats({ hasActiveSession: false, sessionsLast7d: 2 }),
      retroState: retro([
        run("prompt", "REVERT", 1, -0.2),
        run("prompt", "REVERT", 2, -0.1),
        run("prompt", "ACCEPT", 3, 0.3),
        run("synthesis", "ACCEPT", 4),
      ]),
      now: NOW,
    });

    const signal = report.signals.find((item) => item.kind === "low-accept-rate");
    expect(report.healthLabel).toBe("steady");
    expect(signal?.track).toBe("prompt");
    expect(signal?.label).toContain("Prompt");
    expect(signal?.detail).toContain("prompt refinement");
  });

  it("escalates a two-week session gap and stale memory", () => {
    const report = deriveGrowthReport({
      familiar,
      stats: stats({
        lastSessionAt: daysAgo(GROWTH_THRESHOLDS.sessionGapCriticalDays + 1),
        sessionsLast7d: 0,
        hasActiveSession: false,
        latestMemory: { title: "Old note", updatedAt: daysAgo(GROWTH_THRESHOLDS.staleMemoryDays + 2) },
      }),
      retroState: null,
      now: NOW,
    });

    expect(report.healthLabel).toBe("stalled");
    expect(report.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "session-gap", severity: "crit" }),
        expect.objectContaining({ kind: "stale-memory", severity: "warn" }),
        expect.objectContaining({ kind: "low-retro-volume", severity: "info" }),
      ]),
    );
  });

  it("flags missing memory and keeps the last five retro runs newest-first", () => {
    const runs = Array.from({ length: 6 }, (_, index) => run("memory", "ACCEPT", index + 1));
    const report = deriveGrowthReport({
      familiar,
      stats: stats({ memoryCount: 0, latestMemory: null }),
      retroState: retro(runs),
      now: NOW,
    });

    expect(kinds(report)).toContain("no-memory");
    expect(report.recentRuns).toHaveLength(5);
    expect(report.recentRuns.map((item) => item.id)).toEqual([
      "run-memory-1",
      "run-memory-2",
      "run-memory-3",
      "run-memory-4",
      "run-memory-5",
    ]);
  });
});
