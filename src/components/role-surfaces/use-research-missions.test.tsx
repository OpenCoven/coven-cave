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
      maxIterations: 1,
      maxSearchQueries: 1,
      maxSourceFetches: 1,
      maxRuntimeMinutes: 1,
      maxCostUsd: 1,
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

  test("applyMission replaces the shared mission immediately without fetching", async () => {
    const initial = mission();
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
    listResearchMissions.mockResolvedValue({ ok: true, missions: [initial] });
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
      latest!.applyMission(attached);
    });

    expect(latest!.selected?.sources).toEqual(attached.sources);
    expect(latest!.missions[0]).toEqual(attached);
    expect(listResearchMissions).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });
});
