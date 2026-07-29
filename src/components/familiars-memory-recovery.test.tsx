// @ts-nocheck
import { useCallback, useMemo, useRef, useState } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { FamiliarsMemoryView, type MemoryFeed } from "./familiars-memory-view";
import type { CanonicalMemorySummary } from "@/lib/canonical-memory";
import { CanonicalMemoryRequestError } from "@/lib/canonical-memory-client";
import type { CanonicalMemoryListLoad } from "@/lib/canonical-memory-resources";

const resourceMocks = vi.hoisted(() => ({
  loadList: vi.fn(),
  loadOverview: vi.fn(),
  refresh: vi.fn(),
  readSurface: vi.fn(),
}));
const pollMock = vi.hoisted(() => ({
  callback: null as null | (() => void),
}));

vi.mock("@/lib/canonical-memory-resources", () => ({
  loadCanonicalMemoryList: resourceMocks.loadList,
  loadCanonicalMemoryOverview: resourceMocks.loadOverview,
  refreshCanonicalMemory: resourceMocks.refresh,
}));

vi.mock("@/lib/surface-warmup-registry", () => ({
  readSurfaceResource: resourceMocks.readSurface,
}));

vi.mock("@/lib/use-pausable-poll", () => ({
  usePausablePoll: (
    callback: () => void,
    _intervalMs: number,
    options?: { enabled?: boolean },
  ) => {
    if (options?.enabled !== false) pollMock.callback = callback;
  },
}));

vi.mock("@/components/ui/modal", async () => {
  const { createElement } = await import("react");
  return {
    Modal: ({ open, children }: { open: boolean; children: unknown }) =>
      open
        ? createElement("div", { "data-testid": "memory-reader-modal" }, children)
        : null,
  };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const originalFetch = globalThis.fetch;
const missingTitle = "Stale canonical memory";
const familiar = {
  id: "salem",
  display_name: "Salem",
  role: "familiar",
};
const missingEntry: CanonicalMemorySummary = {
  id: "mem-stale",
  familiarId: familiar.id,
  title: missingTitle,
  updatedAt: "2026-07-27T12:00:00.000Z",
  relativeUpdatedAt: "today",
  excerpt: "This entry disappears after its detail endpoint returns 404.",
  source: { kind: "canonical", label: "Coven" },
  privacy: { classification: "private", revealRequired: false },
  verification: { state: "verified" },
};
const freshEntry: CanonicalMemorySummary = {
  ...missingEntry,
  id: "mem-fresh",
  title: "Fresh forced result",
  excerpt: "This row came from the explicit refresh.",
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

function unavailableOverview() {
  return {
    state: "error" as const,
    error: new CanonicalMemoryRequestError(
      "canonical_memory_unavailable",
      503,
    ),
  };
}

function textOf(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

function buttonsContaining(
  renderer: ReactTestRenderer,
  label: string,
): ReactTestInstance[] {
  return renderer.root
    .findAllByType("button")
    .filter((candidate) => textOf(candidate).includes(label));
}

function refreshButton(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.find(
    (node) =>
      node.type === "button" &&
      node.props["aria-label"] === "Refresh memory",
  );
}

function refreshButtonCount(renderer: ReactTestRenderer): number {
  return renderer.root.findAll(
    (node) =>
      node.type === "button" &&
      node.props["aria-label"] === "Refresh memory",
  ).length;
}

function renderedText(renderer: ReactTestRenderer): string {
  return textOf(renderer.root);
}

function RecoveryHarness({ compact }: { compact: boolean }) {
  const [canonical, setCanonical] = useState<MemoryFeed["canonical"]>({
    state: "ready",
    entries: [missingEntry],
  });
  const outcomes = useRef<CanonicalMemoryListLoad[]>([
    {
      state: "error",
      error: new CanonicalMemoryRequestError(
        "canonical_memory_unavailable",
        503,
      ),
    },
    { state: "ready", entries: [missingEntry] },
    { state: "ready", entries: [] },
  ]);
  const reload = useCallback(async (): Promise<CanonicalMemoryListLoad> => {
    const next = outcomes.current.shift();
    if (!next) throw new Error("unexpected extra refresh");
    setCanonical(
      next.state === "ready"
        ? { state: "ready", entries: next.entries }
        : { state: "error", entries: [missingEntry], error: next.error },
    );
    return next;
  }, []);
  const feed = useMemo<MemoryFeed>(
    () => ({
      canonical,
      overview: {
        state: "error",
        value: null,
        error: new CanonicalMemoryRequestError(
          "canonical_memory_unavailable",
          503,
        ),
      },
      files: { state: "ready", entries: [] },
      lastLoadedAt: null,
      reload,
    }),
    [canonical, reload],
  );

  return (
    <FamiliarsMemoryView
      familiars={[familiar]}
      activeFamiliar={familiar}
      localDaemonReady
      lockToFamiliar
      compact={compact}
      feed={feed}
    />
  );
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  resourceMocks.loadList.mockReset();
  resourceMocks.loadOverview.mockReset();
  resourceMocks.refresh.mockReset();
  resourceMocks.readSurface.mockReset();
  pollMock.callback = null;
  globalThis.fetch = vi.fn(async (input) => {
    const url = String(input);
    if (url === "/api/coven-memory/mem-stale") {
      return {
        ok: false,
        status: 404,
        json: async () => ({ ok: false, code: "memory_not_found" }),
      } as Response;
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe.each([
  ["master-detail", false],
  ["compact", true],
])("canonical 404 recovery in %s memory view", (_label, compact) => {
  test("removes the stale row, preserves the notice after failure, and clears it after successful reconciliation", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RecoveryHarness compact={compact} />);
    });

    expect(buttonsContaining(renderer, missingTitle)).not.toHaveLength(0);

    await act(async () => {
      buttonsContaining(renderer, missingTitle)[0].props.onClick();
      await flush();
    });

    expect(buttonsContaining(renderer, missingTitle)).toHaveLength(0);
    expect(renderedText(renderer)).toContain("Memory not found.");
    expect(refreshButtonCount(renderer)).toBe(1);

    await act(async () => {
      refreshButton(renderer).props.onClick();
      await flush();
    });

    expect(renderedText(renderer)).toContain("Memory not found.");
    expect(buttonsContaining(renderer, missingTitle)).toHaveLength(0);

    await act(async () => {
      refreshButton(renderer).props.onClick();
      await flush();
    });

    expect(renderedText(renderer)).toContain("Memory not found.");
    expect(buttonsContaining(renderer, missingTitle)).toHaveLength(0);

    await act(async () => {
      refreshButton(renderer).props.onClick();
      await flush();
    });

    expect(renderedText(renderer)).not.toContain("Memory not found.");
    expect(buttonsContaining(renderer, missingTitle)).toHaveLength(0);

    await act(async () => renderer.unmount());
  });
});

describe("standalone explicit refresh precedence", () => {
  test("a background load started during Refresh cannot suppress the forced result", async () => {
    const events: string[] = [];
    const background = deferred<CanonicalMemoryListLoad>();
    const forced = deferred<{
      list: CanonicalMemoryListLoad;
      overview: ReturnType<typeof unavailableOverview>;
    }>();
    resourceMocks.readSurface.mockResolvedValue({
      data: { ok: true, entries: [] },
    });
    resourceMocks.loadOverview.mockResolvedValue(unavailableOverview());
    resourceMocks.loadList
      .mockResolvedValueOnce({ state: "ready", entries: [missingEntry] })
      .mockImplementationOnce(async () => {
        events.push("background:start");
        const result = await background.promise;
        events.push("background:settle");
        return result;
      });
    resourceMocks.refresh.mockImplementationOnce(async () => {
      events.push("forced:start");
      const result = await forced.promise;
      events.push("forced:settle");
      return result;
    });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <FamiliarsMemoryView
          familiars={[familiar]}
          activeFamiliar={familiar}
          localDaemonReady
          lockToFamiliar
        />,
      );
      await flush();
    });

    await act(async () => {
      buttonsContaining(renderer, missingTitle)[0].props.onClick();
      await flush();
    });
    expect(renderedText(renderer)).toContain("Memory not found.");

    await act(async () => {
      refreshButton(renderer).props.onClick();
      await flush();
    });
    expect(events).toEqual(["forced:start"]);

    await act(async () => {
      pollMock.callback?.();
      await flush();
    });
    expect(events).toEqual(["forced:start", "background:start"]);

    await act(async () => {
      background.resolve({ state: "ready", entries: [missingEntry] });
      await flush();
    });
    expect(events).toEqual([
      "forced:start",
      "background:start",
      "background:settle",
    ]);
    expect(renderedText(renderer)).toContain("Memory not found.");

    await act(async () => {
      forced.resolve({
        list: { state: "ready", entries: [freshEntry] },
        overview: unavailableOverview(),
      });
      await flush();
    });

    expect(events).toEqual([
      "forced:start",
      "background:start",
      "background:settle",
      "forced:settle",
    ]);
    expect(renderedText(renderer)).not.toContain("Memory not found.");
    expect(buttonsContaining(renderer, freshEntry.title)).not.toHaveLength(0);
    expect(buttonsContaining(renderer, missingTitle)).toHaveLength(0);

    await act(async () => renderer.unmount());
  });

  test("a newer explicit Refresh supersedes an older forced result", async () => {
    const older = deferred<{
      list: CanonicalMemoryListLoad;
      overview: ReturnType<typeof unavailableOverview>;
    }>();
    const newer = deferred<{
      list: CanonicalMemoryListLoad;
      overview: ReturnType<typeof unavailableOverview>;
    }>();
    const olderEntry = {
      ...freshEntry,
      id: "mem-older-forced",
      title: "Older forced result",
    };
    const newerEntry = {
      ...freshEntry,
      id: "mem-newer-forced",
      title: "Newer forced result",
    };
    resourceMocks.readSurface.mockResolvedValue({
      data: { ok: true, entries: [] },
    });
    resourceMocks.loadList.mockResolvedValue({
      state: "ready",
      entries: [],
    });
    resourceMocks.loadOverview.mockResolvedValue(unavailableOverview());
    resourceMocks.refresh
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <FamiliarsMemoryView
          familiars={[familiar]}
          activeFamiliar={familiar}
          localDaemonReady
          lockToFamiliar
        />,
      );
      await flush();
    });

    await act(async () => {
      refreshButton(renderer).props.onClick();
      refreshButton(renderer).props.onClick();
      await flush();
    });
    expect(resourceMocks.refresh).toHaveBeenCalledTimes(2);

    await act(async () => {
      newer.resolve({
        list: { state: "ready", entries: [newerEntry] },
        overview: unavailableOverview(),
      });
      await flush();
    });
    expect(buttonsContaining(renderer, newerEntry.title)).not.toHaveLength(0);

    await act(async () => {
      older.resolve({
        list: { state: "ready", entries: [olderEntry] },
        overview: unavailableOverview(),
      });
      await flush();
    });
    expect(buttonsContaining(renderer, newerEntry.title)).not.toHaveLength(0);
    expect(buttonsContaining(renderer, olderEntry.title)).toHaveLength(0);

    await act(async () => renderer.unmount());
  });

  test("a settled newer Refresh releases polling while an older Refresh remains pending", async () => {
    const older = deferred<{
      list: CanonicalMemoryListLoad;
      overview: ReturnType<typeof unavailableOverview>;
    }>();
    const newer = deferred<{
      list: CanonicalMemoryListLoad;
      overview: ReturnType<typeof unavailableOverview>;
    }>();
    const background = deferred<CanonicalMemoryListLoad>();
    const olderEntry = {
      ...freshEntry,
      id: "mem-older-pending",
      title: "Older pending result",
    };
    const newerEntry = {
      ...freshEntry,
      id: "mem-newer-settled",
      title: "Newer settled result",
    };
    const backgroundEntry = {
      ...freshEntry,
      id: "mem-background-after-newer",
      title: "Background after newer settled",
    };
    resourceMocks.readSurface.mockResolvedValue({
      data: { ok: true, entries: [] },
    });
    resourceMocks.loadList
      .mockResolvedValueOnce({ state: "ready", entries: [missingEntry] })
      .mockReturnValueOnce(background.promise);
    resourceMocks.loadOverview.mockResolvedValue(unavailableOverview());
    resourceMocks.refresh
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <FamiliarsMemoryView
          familiars={[familiar]}
          activeFamiliar={familiar}
          localDaemonReady
          lockToFamiliar
        />,
      );
      await flush();
    });

    await act(async () => {
      refreshButton(renderer).props.onClick();
      refreshButton(renderer).props.onClick();
      await flush();
    });

    await act(async () => {
      newer.resolve({
        list: { state: "ready", entries: [newerEntry] },
        overview: unavailableOverview(),
      });
      await flush();
    });
    expect(buttonsContaining(renderer, newerEntry.title)).not.toHaveLength(0);

    await act(async () => {
      pollMock.callback?.();
      await flush();
    });
    await act(async () => {
      background.resolve({
        state: "ready",
        entries: [backgroundEntry],
      });
      await flush();
    });
    expect(
      buttonsContaining(renderer, backgroundEntry.title),
    ).not.toHaveLength(0);
    expect(buttonsContaining(renderer, newerEntry.title)).toHaveLength(0);

    await act(async () => {
      older.resolve({
        list: { state: "ready", entries: [olderEntry] },
        overview: unavailableOverview(),
      });
      await flush();
    });
    expect(
      buttonsContaining(renderer, backgroundEntry.title),
    ).not.toHaveLength(0);
    expect(buttonsContaining(renderer, olderEntry.title)).toHaveLength(0);

    await act(async () => renderer.unmount());
  });
});
