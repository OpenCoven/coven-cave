// @ts-nocheck
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { FamiliarsView } from "./familiars-view";
import { CanonicalMemoryRequestError } from "@/lib/canonical-memory-client";

const resources = vi.hoisted(() => ({
  readFiles: vi.fn(),
  loadList: vi.fn(),
  loadOverview: vi.fn(),
  refresh: vi.fn(),
}));
const polls = vi.hoisted(() => ({
  invocations: 0,
  callbacks: [] as Array<() => void>,
}));
const captured = vi.hoisted(() => ({
  feed: null as null | {
    canonical: unknown;
    overview: unknown;
    files: unknown;
    lastLoadedAt: string | null;
    reload(): Promise<unknown>;
  },
}));
const preferenceSetter = vi.hoisted(() => vi.fn());

vi.mock("@/lib/canonical-memory-resources", () => ({
  loadCanonicalMemoryList: resources.loadList,
  loadCanonicalMemoryOverview: resources.loadOverview,
  refreshCanonicalMemory: resources.refresh,
}));

vi.mock("@/lib/surface-warmup-registry", () => ({
  readSurfaceResource: resources.readFiles,
}));

vi.mock("@/lib/use-pausable-poll", () => ({
  usePausablePoll: (callback: () => void) => {
    const slot = polls.invocations % 2;
    polls.invocations += 1;
    polls.callbacks[slot] = callback;
  },
}));

vi.mock("@/lib/datetime-format", () => ({
  useDateTimePrefs: () => {},
}));

vi.mock("@/lib/familiar-resolve", () => ({
  useResolvedFamiliars: (familiars: unknown[]) => familiars,
}));

vi.mock("@/lib/surface-preferences", () => ({
  useSurfacePreference: (spec: { key: string; defaultValue: unknown }) => {
    if (spec.key === "familiars.selectedId") {
      return ["salem", preferenceSetter, true];
    }
    if (spec.key === "familiars.viewMode") {
      return ["detail", preferenceSetter, true];
    }
    return [spec.defaultValue, preferenceSetter, true];
  },
}));

vi.mock("@/lib/summon-events", () => ({
  SUMMON_FAMILIAR_EVENT: "test:summon",
  hasSummonPending: () => false,
  consumeSummonPending: () => false,
}));

vi.mock("@/lib/icon", () => ({
  Icon: () => null,
}));

vi.mock("@/components/familiar-summoning-circle", () => ({
  FamiliarSummoningCircle: () => null,
}));

vi.mock("@/components/familiars-view-stats", () => ({
  buildFamiliarCardStats: () => new Map(),
}));

vi.mock("@/components/familiars-view-sections", () => ({
  emptyStats: () => ({}),
  FamiliarsEmptyState: () => null,
  FamiliarRosterCard: () => null,
  FamiliarMemoryOverlay: () => null,
  FamiliarDetailRail: () => null,
  FamiliarDetailPanel: (props: { memoryFeed: typeof captured.feed }) => {
    captured.feed = props.memoryFeed;
    return null;
  },
  FamiliarAvatarPreviewOverlay: () => null,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const familiar = {
  id: "salem",
  display_name: "Salem",
  role: "familiar",
};

function summary(id: string) {
  return {
    id,
    familiarId: familiar.id,
    title: id,
    updatedAt: "2026-07-27T12:00:00.000Z",
    relativeUpdatedAt: "today",
    excerpt: id,
    source: { kind: "canonical", label: "Coven" },
    privacy: { classification: "private", revealRequired: false },
    verification: { state: "verified" },
  };
}

function overview(entries: number) {
  return {
    generatedAt: "2026-07-27T12:00:00.000Z",
    totals: {
      entries,
      familiars: entries > 0 ? 1 : 0,
      verified: entries,
      needsReview: 0,
      unknown: 0,
    },
    lastUpdatedAt: entries > 0 ? "2026-07-27T12:00:00.000Z" : null,
    capabilities: {
      detail: true,
      verification: true,
      attestationMetadata: false,
      supersessionHistory: false,
      mutations: false,
    },
    verification: {
      state: "verified",
      checkedAt: "2026-07-27T12:00:00.000Z",
      manifest: null,
      index: null,
      issues: [],
    },
  };
}

function file(id: string) {
  return {
    fullPath: `/memory/${id}.md`,
    relPath: `${id}.md`,
    modified: "2026-07-27T12:00:00.000Z",
    size: 10,
    sourceKind: "runtime",
    sourceKindLabel: "Runtime memory",
    rootLabel: "Familiar",
    familiarId: familiar.id,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function unavailable() {
  return new CanonicalMemoryRequestError(
    "canonical_memory_unavailable",
    503,
  );
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function renderParent(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <FamiliarsView
        familiars={[familiar]}
        sessions={[]}
        activeFamiliar={familiar}
        daemonRunning
        localDaemonReady
        pendingRosterSettledSuccessfully={false}
        responseNeeded={new Set()}
        onStartChat={() => {}}
        onOpenSession={() => {}}
        onOpenMemoryFile={() => {}}
        onOpenOnboarding={() => {}}
        onOpenUrl={() => {}}
      />,
    );
    await flush();
  });
  expect(captured.feed).not.toBeNull();
  expect(polls.callbacks).toHaveLength(2);
  return renderer;
}

function feed() {
  if (!captured.feed) throw new Error("memory feed was not captured");
  return captured.feed;
}

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

beforeEach(() => {
  polls.invocations = 0;
  polls.callbacks = [];
  captured.feed = null;
  resources.readFiles.mockReset().mockResolvedValue({
    data: { ok: true, entries: [file("initial")] },
  });
  resources.loadList.mockReset().mockResolvedValue({
    state: "ready",
    entries: [summary("initial")],
  });
  resources.loadOverview.mockReset().mockResolvedValue({
    state: "ready",
    overview: overview(1),
  });
  resources.refresh.mockReset();
  globalThis.window = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as Window & typeof globalThis;
  globalThis.document = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as Document;
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  vi.restoreAllMocks();
});

describe("FamiliarsView memory feed request ownership", () => {
  test("a late canonical background completion cannot overwrite a forced result", async () => {
    const renderer = await renderParent();
    const backgroundList = deferred();
    const backgroundOverview = deferred();
    const forcedCanonical = deferred();
    resources.loadList.mockReset().mockReturnValueOnce(backgroundList.promise);
    resources.loadOverview
      .mockReset()
      .mockReturnValueOnce(backgroundOverview.promise);
    resources.refresh.mockReturnValueOnce(forcedCanonical.promise);

    await act(async () => {
      polls.callbacks[1]();
      await flush();
    });
    let forcedPromise!: Promise<unknown>;
    await act(async () => {
      forcedPromise = feed().reload();
      await flush();
    });

    await act(async () => {
      forcedCanonical.resolve({
        list: { state: "ready", entries: [summary("forced")] },
        overview: { state: "ready", overview: overview(2) },
      });
      await forcedPromise;
      await flush();
    });
    expect(feed().canonical.entries[0].id).toBe("forced");

    await act(async () => {
      backgroundList.resolve({
        state: "ready",
        entries: [summary("background-late")],
      });
      backgroundOverview.resolve({
        state: "ready",
        overview: overview(3),
      });
      await flush();
    });
    expect(feed().canonical.entries[0].id).toBe("forced");
    expect(feed().overview.value.totals.entries).toBe(2);

    await act(async () => renderer.unmount());
  });

  test("a file poll started during Refresh cannot overwrite forced files or timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T12:00:00.000Z"));
    const renderer = await renderParent();
    const forcedFiles = deferred();
    const backgroundFiles = deferred();
    resources.readFiles.mockReset().mockImplementation(
      (_key: string, force: boolean) =>
        force ? forcedFiles.promise : backgroundFiles.promise,
    );
    resources.refresh.mockResolvedValue({
      list: { state: "ready", entries: [summary("forced")] },
      overview: { state: "ready", overview: overview(2) },
    });

    let forcedPromise!: Promise<unknown>;
    await act(async () => {
      forcedPromise = feed().reload();
      polls.callbacks[0]();
      await flush();
    });

    await act(async () => {
      forcedFiles.resolve({
        data: { ok: true, entries: [file("forced")] },
      });
      await forcedPromise;
      await flush();
    });
    expect(feed().files.entries[0].relPath).toBe("forced.md");
    expect(feed().lastLoadedAt).toBe("2026-07-27T12:00:00.000Z");

    vi.setSystemTime(new Date("2026-07-27T12:00:30.000Z"));
    await act(async () => {
      backgroundFiles.resolve({
        data: { ok: true, entries: [file("background-late")] },
      });
      await flush();
    });
    expect(feed().files.entries[0].relPath).toBe("forced.md");
    expect(feed().lastLoadedAt).toBe("2026-07-27T12:00:00.000Z");

    await act(async () => renderer.unmount());
  });

  test("a newer explicit refresh supersedes every older forced outcome while each call returns its own list", async () => {
    const renderer = await renderParent();
    const olderFiles = deferred();
    const newerFiles = deferred();
    const olderCanonical = deferred();
    const newerCanonical = deferred();
    resources.readFiles
      .mockReset()
      .mockReturnValueOnce(olderFiles.promise)
      .mockReturnValueOnce(newerFiles.promise);
    resources.refresh
      .mockReturnValueOnce(olderCanonical.promise)
      .mockReturnValueOnce(newerCanonical.promise);

    let olderPromise!: Promise<unknown>;
    let newerPromise!: Promise<unknown>;
    await act(async () => {
      olderPromise = feed().reload();
      newerPromise = feed().reload();
      await flush();
    });

    await act(async () => {
      newerCanonical.resolve({
        list: { state: "ready", entries: [summary("newer")] },
        overview: { state: "ready", overview: overview(2) },
      });
      newerFiles.resolve({
        data: { ok: true, entries: [file("newer")] },
      });
      expect(await newerPromise).toEqual({
        state: "ready",
        entries: [summary("newer")],
      });
      await flush();
    });

    await act(async () => {
      olderCanonical.resolve({
        list: { state: "ready", entries: [summary("older")] },
        overview: { state: "ready", overview: overview(3) },
      });
      olderFiles.resolve({
        data: { ok: true, entries: [file("older")] },
      });
      expect(await olderPromise).toEqual({
        state: "ready",
        entries: [summary("older")],
      });
      await flush();
    });

    expect(feed().canonical.entries[0].id).toBe("newer");
    expect(feed().overview.value.totals.entries).toBe(2);
    expect(feed().files.entries[0].relPath).toBe("newer.md");

    await act(async () => renderer.unmount());
  });

  test("a settled newer force releases backgrounds while an older force remains pending", async () => {
    const renderer = await renderParent();
    const olderFiles = deferred();
    const newerFiles = deferred();
    const backgroundFiles = deferred();
    const olderCanonical = deferred();
    const newerCanonical = deferred();
    const backgroundList = deferred();
    const backgroundOverview = deferred();
    resources.readFiles
      .mockReset()
      .mockReturnValueOnce(olderFiles.promise)
      .mockReturnValueOnce(newerFiles.promise)
      .mockReturnValueOnce(backgroundFiles.promise);
    resources.refresh
      .mockReturnValueOnce(olderCanonical.promise)
      .mockReturnValueOnce(newerCanonical.promise);
    resources.loadList.mockReset().mockReturnValueOnce(backgroundList.promise);
    resources.loadOverview
      .mockReset()
      .mockReturnValueOnce(backgroundOverview.promise);

    let olderPromise!: Promise<unknown>;
    let newerPromise!: Promise<unknown>;
    await act(async () => {
      olderPromise = feed().reload();
      newerPromise = feed().reload();
      await flush();
    });

    await act(async () => {
      newerCanonical.resolve({
        list: { state: "ready", entries: [summary("newer")] },
        overview: { state: "ready", overview: overview(2) },
      });
      newerFiles.resolve({
        data: { ok: true, entries: [file("newer")] },
      });
      await newerPromise;
      await flush();
    });

    await act(async () => {
      polls.callbacks[0]();
      polls.callbacks[1]();
      await flush();
    });
    await act(async () => {
      backgroundFiles.resolve({
        data: { ok: true, entries: [file("background-after-newer")] },
      });
      backgroundList.resolve({
        state: "ready",
        entries: [summary("background-after-newer")],
      });
      backgroundOverview.resolve({
        state: "ready",
        overview: overview(4),
      });
      await flush();
    });

    expect(feed().files.entries[0].relPath).toBe(
      "background-after-newer.md",
    );
    expect(feed().canonical.entries[0].id).toBe("background-after-newer");
    expect(feed().overview.value.totals.entries).toBe(4);

    await act(async () => {
      olderCanonical.resolve({
        list: { state: "ready", entries: [summary("older-late")] },
        overview: { state: "ready", overview: overview(5) },
      });
      olderFiles.resolve({
        data: { ok: true, entries: [file("older-late")] },
      });
      await olderPromise;
      await flush();
    });

    expect(feed().files.entries[0].relPath).toBe(
      "background-after-newer.md",
    );
    expect(feed().canonical.entries[0].id).toBe("background-after-newer");
    expect(feed().overview.value.totals.entries).toBe(4);

    await act(async () => renderer.unmount());
  });

  test("file failure does not poison independently settled canonical outcomes", async () => {
    const renderer = await renderParent();
    resources.readFiles.mockReset().mockRejectedValueOnce(new Error("files down"));
    resources.refresh.mockResolvedValueOnce({
      list: { state: "ready", entries: [summary("canonical-ready")] },
      overview: { state: "error", error: unavailable() },
    });

    let result!: unknown;
    await act(async () => {
      result = await feed().reload();
      await flush();
    });

    expect(result).toEqual({
      state: "ready",
      entries: [summary("canonical-ready")],
    });
    expect(feed().canonical.state).toBe("ready");
    expect(feed().overview.state).toBe("error");
    expect(feed().files.state).toBe("error");

    await act(async () => renderer.unmount());
  });
});
