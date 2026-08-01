// @ts-nocheck
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, test, vi } from "vitest";

const listResearchMissions = vi.hoisted(() => vi.fn());
const polling = vi.hoisted(() => ({
  callback: null as null | (() => void),
}));

vi.mock("@/lib/research-mission-client", async () => {
  const actual = await vi.importActual("@/lib/research-mission-client");
  return {
    ...actual,
    listResearchMissions,
  };
});
vi.mock("@/lib/use-pausable-poll", () => ({
  usePausablePoll: (callback: () => void) => {
    polling.callback = callback;
  },
}));

import { useResearchMissions } from "./use-research-missions";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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
    polling.callback = null;
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

  test("a deferred stale poll cannot overwrite a freshly attached mission", async () => {
    const initial = mission();
    const stalePoll = deferred<{ ok: true; missions: ReturnType<typeof mission>[] }>();
    const attached = mission({
      updatedAt: "2026-08-01T00:02:00.000Z",
      sources: [{
        id: "x-123",
        title: "X post",
        url: "https://x.com/cave/status/123",
        sourceType: "x",
        status: "candidate",
      }],
    });
    listResearchMissions
      .mockResolvedValueOnce({ ok: true, missions: [initial] })
      .mockReturnValueOnce(stalePoll.promise);
    let latest: ReturnType<typeof useResearchMissions> | null = null;
    function Harness() {
      latest = useResearchMissions("familiar-a");
      return createElement("div");
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(Harness), { unstable_isConcurrent: true });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => polling.callback!());
    expect(listResearchMissions).toHaveBeenCalledTimes(2);

    await act(async () => {
      latest!.applyMission(attached, { select: true });
      stalePoll.resolve({ ok: true, missions: [initial] });
      await stalePoll.promise;
      await Promise.resolve();
    });

    expect(latest!.missions).toEqual([attached]);
    expect(latest!.selected).toEqual(attached);
    await act(async () => renderer.unmount());
  });

  test("a rejected stale applyMission does not suppress a fresher in-flight poll", async () => {
    const authoritative = mission({
      updatedAt: "2026-08-01T00:02:00.000Z",
      sources: [{ id: "current", title: "Current", sourceType: "web", status: "used" }],
    });
    const staleAttach = mission({
      updatedAt: "2026-08-01T00:01:00.000Z",
      sources: [{ id: "stale", title: "Stale", sourceType: "x", status: "candidate" }],
    });
    const fresherPollMission = mission({
      updatedAt: "2026-08-01T00:03:00.000Z",
      sources: [{ id: "fresh", title: "Fresh", sourceType: "web", status: "used" }],
    });
    const poll = deferred<{ ok: true; missions: ReturnType<typeof mission>[] }>();
    listResearchMissions
      .mockResolvedValueOnce({ ok: true, missions: [authoritative] })
      .mockReturnValueOnce(poll.promise);
    let latest: ReturnType<typeof useResearchMissions> | null = null;
    function Harness() {
      latest = useResearchMissions("familiar-a");
      return createElement("div");
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(Harness), { unstable_isConcurrent: true });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => polling.callback!());
    act(() => latest!.applyMission(staleAttach, { select: true }));
    await act(async () => {
      poll.resolve({ ok: true, missions: [fresherPollMission] });
      await poll.promise;
      await Promise.resolve();
    });

    expect(latest!.missions).toEqual([fresherPollMission]);
    expect(latest!.selected).toEqual(fresherPollMission);
    await act(async () => renderer.unmount());
  });

  test("a stale applyMission cannot discard a fresher poll that already queued its update", async () => {
    const authoritative = mission({
      updatedAt: "2026-08-01T00:02:00.000Z",
      sources: [{ id: "current", title: "Current", sourceType: "web", status: "used" }],
    });
    const staleAttach = mission({
      updatedAt: "2026-08-01T00:01:00.000Z",
      sources: [{ id: "stale", title: "Stale", sourceType: "x", status: "candidate" }],
    });
    const fresherPollMission = mission({
      updatedAt: "2026-08-01T00:03:00.000Z",
      sources: [{ id: "fresh", title: "Fresh", sourceType: "web", status: "used" }],
    });
    const poll = deferred<{ ok: true; missions: ReturnType<typeof mission>[] }>();
    listResearchMissions
      .mockResolvedValueOnce({ ok: true, missions: [authoritative] })
      .mockReturnValueOnce(poll.promise);
    let latest: ReturnType<typeof useResearchMissions> | null = null;
    function Harness() {
      latest = useResearchMissions("familiar-a");
      return createElement("div");
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(Harness), { unstable_isConcurrent: true });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => polling.callback!());
    await act(async () => {
      poll.resolve({ ok: true, missions: [fresherPollMission] });
      await poll.promise;
      await Promise.resolve();
      latest!.applyMission(staleAttach, { select: true });
    });

    expect(latest!.missions).toEqual([fresherPollMission]);
    expect(latest!.selected).toEqual(fresherPollMission);
    await act(async () => renderer.unmount());
  });
});
