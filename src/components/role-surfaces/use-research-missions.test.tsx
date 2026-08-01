// @ts-nocheck
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, test, vi } from "vitest";

const listResearchMissions = vi.hoisted(() => vi.fn());

vi.mock("@/lib/research-mission-client", async () => {
  const actual = await vi.importActual("@/lib/research-mission-client");
  return {
    ...actual,
    listResearchMissions,
  };
});
vi.mock("@/lib/use-pausable-poll", () => ({
  usePausablePoll: () => undefined,
}));

import { useResearchMissions } from "./use-research-missions";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mission(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    id: "mission-1",
    familiarId: "familiar-a",
    title: "Mission",
    intent: "Investigate the evidence",
    mode: "brief",
    modeSource: "user",
    deliverable: "Brief",
    constraints: [],
    bounds: {
      wallClockMinutes: 30,
      maxIterations: 3,
      sourceTarget: 5,
      checkpointEvery: 1,
      stopWhenCostUnavailable: true,
    },
    status: "running",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    iterations: [],
    artifacts: [],
    sources: [],
    ...overrides,
  };
}

describe("useResearchMissions authoritative mission application", () => {
  beforeEach(() => {
    listResearchMissions.mockReset();
  });

  test("applyMission merges a fresh mission without changing selection unless requested", async () => {
    const initial = mission();
    const second = mission({
      id: "mission-2",
      title: "Second mission",
      updatedAt: "2026-08-01T00:00:30.000Z",
    });
    const attached = mission({
      updatedAt: "2026-08-01T00:01:00.000Z",
      sources: [{
        id: "x-123",
        title: "X post",
        url: "https://x.com/cave/status/123",
        sourceType: "x",
        status: "candidate",
      }],
    });
    listResearchMissions.mockResolvedValue({ ok: true, missions: [initial, second] });
    let latest: ReturnType<typeof useResearchMissions> | null = null;
    function Harness() {
      latest = useResearchMissions("familiar-a");
      return createElement("div");
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(listResearchMissions).toHaveBeenCalledTimes(1);

    act(() => {
      latest!.select("mission-2");
      latest!.applyMission(attached);
    });

    expect(latest!.selected?.id).toBe("mission-2");
    expect(latest!.missions[0]).toEqual(attached);
    expect(listResearchMissions).toHaveBeenCalledTimes(1);

    act(() => {
      latest!.applyMission(attached, { select: true });
    });
    expect(latest!.selected?.id).toBe("mission-1");
    await act(async () => renderer.unmount());
  });

  test("applyMission cannot roll back a newer authoritative mission", async () => {
    const authoritative = mission({
      updatedAt: "2026-08-01T00:02:00.000Z",
      status: "checkpoint",
      iterations: [
        { number: 1, status: "completed" },
        { number: 2, status: "checkpoint" },
      ],
      sources: [{ id: "newer", title: "Newer", sourceType: "web", status: "used" }],
    });
    const staleAttach = mission({
      updatedAt: "2026-08-01T00:01:00.000Z",
      status: "running",
      iterations: [{ number: 1, status: "running" }],
      sources: [{ id: "stale", title: "Stale", sourceType: "x", status: "candidate" }],
    });
    listResearchMissions.mockResolvedValue({ ok: true, missions: [authoritative] });
    let latest: ReturnType<typeof useResearchMissions> | null = null;
    function Harness() {
      latest = useResearchMissions("familiar-a");
      return createElement("div");
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      latest!.applyMission(staleAttach, { select: true });
    });

    expect(latest!.missions[0]).toEqual(authoritative);
    expect(latest!.selected).toEqual(authoritative);
    await act(async () => renderer.unmount());
  });
});
