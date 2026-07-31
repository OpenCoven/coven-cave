// @ts-nocheck
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { InspectorPane } from "./inspector-pane";
import { CanonicalMemoryRequestError } from "@/lib/canonical-memory-client";
import type {
  CanonicalMemoryDetail,
  CanonicalMemorySummary,
} from "@/lib/canonical-memory";

const resourceMocks = vi.hoisted(() => ({
  loadList: vi.fn(),
}));

vi.mock("@/lib/canonical-memory-resources", () => ({
  loadCanonicalMemoryList: resourceMocks.loadList,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const originalFetch = globalThis.fetch;
const familiar = {
  id: "salem",
  display_name: "Salem",
  role: "familiar",
};
const secondFamiliar = {
  id: "charm",
  display_name: "Charm",
  role: "familiar",
};
const canonicalIds = {
  usable: "018f0f77-2f49-7c18-9e52-437b312f8a60",
  missing: "018f0f77-2f49-7c18-9e52-437b312f8a64",
  ready: "018f0f77-2f49-7c18-9e52-437b312f8a65",
  salem: "018f0f77-2f49-7c18-9e52-437b312f8a66",
  charm: "018f0f77-2f49-7c18-9e52-437b312f8a67",
  olderRefresh: "018f0f77-2f49-7c18-9e52-437b312f8a68",
  newerRefresh: "018f0f77-2f49-7c18-9e52-437b312f8a69",
  beforeReadinessLoss: "018f0f77-2f49-7c18-9e52-437b312f8a6a",
  afterReadinessRestore: "018f0f77-2f49-7c18-9e52-437b312f8a6b",
  lateAfterReadinessLoss: "018f0f77-2f49-7c18-9e52-437b312f8a6c",
  retainedError: "018f0f77-2f49-7c18-9e52-437b312f8a6d",
} as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

function summary(
  id: string,
  overrides: Partial<CanonicalMemorySummary> = {},
): CanonicalMemorySummary {
  return {
    id,
    familiarId: familiar.id,
    title: `Memory ${id}`,
    updatedAt: "2026-07-27T12:00:00.000Z",
    relativeUpdatedAt: "today",
    excerpt: `Excerpt ${id}`,
    source: { kind: "canonical", label: "Coven" },
    privacy: { classification: "public", revealRequired: false },
    verification: { state: "verified" },
    ...overrides,
  };
}

function detail(id: string): CanonicalMemoryDetail {
  return {
    id,
    familiarId: familiar.id,
    title: `Memory ${id}`,
    updatedAt: "2026-07-27T12:00:00.000Z",
    source: { kind: "canonical", label: "Coven" },
    content: `SECRET:${id}`,
    contentFormat: "markdown",
    privacy: {
      classification: "public",
      revealRequired: false,
      reason: "Explicit public classification.",
    },
    verification: {
      state: "verified",
      reason: "Signed manifest and index agree.",
    },
    attestationMetadata: { fieldCount: 3 },
    supersession: { supersedes: null, supersededBy: null },
  };
}

function textOf(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

function renderedText(renderer: ReactTestRenderer): string {
  return textOf(renderer.root);
}

function buttonContaining(
  renderer: ReactTestRenderer,
  label: string,
): ReactTestInstance {
  const match = renderer.root
    .findAllByType("button")
    .find((candidate) => textOf(candidate).includes(label));
  expect(match, `expected button containing ${label}`).toBeTruthy();
  return match!;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function mount(
  localDaemonReady = true,
): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <InspectorPane
        familiar={familiar}
        compact
        localDaemonReady={localDaemonReady}
        onOpenFullView={() => {}}
      />,
    );
    await flush();
  });
  return renderer;
}

beforeEach(() => {
  resourceMocks.loadList.mockReset();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Inspector canonical memory", () => {
  test("keeps canonical and file failures independent", async () => {
    resourceMocks.loadList.mockResolvedValue({
      state: "error",
      error: new CanonicalMemoryRequestError(
        "canonical_memory_unavailable",
        503,
      ),
    });
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/memory?familiarId=")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            entries: [{
              root: "/safe",
              rootLabel: "Salem",
              relPath: "notes/today.md",
              fullPath: "/safe/notes/today.md",
              size: 20,
              modified: "2026-07-27T12:00:00.000Z",
              familiarId: familiar.id,
            }],
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const renderer = await mount();
    expect(renderedText(renderer)).toContain("Couldn't load familiar memories");
    expect(renderedText(renderer)).toContain("Start the local daemon");
    expect(renderedText(renderer)).not.toContain(
      "canonical_memory_unavailable",
    );
    expect(renderedText(renderer)).toContain("Open full memory");

    await act(async () => {
      buttonContaining(renderer, "Files").props.onClick();
      await flush();
    });
    expect(renderedText(renderer)).toContain("notes/today.md");
    await act(async () => renderer.unmount());

    resourceMocks.loadList.mockResolvedValue({
      state: "ready",
      entries: [summary(canonicalIds.usable)],
    });
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/memory?familiarId=")) {
        return {
          ok: false,
          json: async () => ({ ok: false, error: "files unavailable" }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const second = await mount();
    expect(renderedText(second)).toContain(`Memory ${canonicalIds.usable}`);
    await act(async () => {
      buttonContaining(second, "Files").props.onClick();
      await flush();
    });
    expect(renderedText(second)).toContain("Couldn't load memory files");
    await act(async () => {
      buttonContaining(second, "Coven").props.onClick();
    });
    expect(renderedText(second)).toContain(`Memory ${canonicalIds.usable}`);
    await act(async () => second.unmount());
  });

  test("keeps a 404ed row hidden until a forced ready list omits its opaque ID", async () => {
    const stale = summary(canonicalIds.missing);
    resourceMocks.loadList
      .mockResolvedValueOnce({ state: "ready", entries: [stale] })
      .mockResolvedValueOnce({ state: "ready", entries: [stale] })
      .mockResolvedValueOnce({ state: "ready", entries: [] });

    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/memory?familiarId=")) {
        return {
          ok: true,
          json: async () => ({ ok: true, entries: [] }),
        } as Response;
      }
      if (
        url ===
          `/api/coven-memory/${canonicalIds.missing}`
      ) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ ok: false, code: "memory_not_found" }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const renderer = await mount();
    await act(async () => {
      buttonContaining(renderer, stale.title).props.onClick();
      await flush();
    });

    expect(renderedText(renderer)).not.toContain(stale.title);
    expect(renderedText(renderer)).toContain("Memory not found");
    expect(renderedText(renderer)).toContain("Refresh");

    await act(async () => {
      buttonContaining(renderer, "Refresh").props.onClick();
      await flush();
    });
    expect(renderedText(renderer)).toContain("Memory not found");
    expect(renderedText(renderer)).toContain("Refresh");
    expect(renderedText(renderer)).not.toContain(stale.title);
    expect(resourceMocks.loadList).toHaveBeenLastCalledWith(true);

    await act(async () => {
      buttonContaining(renderer, "Refresh").props.onClick();
      await flush();
    });
    expect(renderedText(renderer)).not.toContain("Memory not found");
    expect(renderedText(renderer)).not.toContain(stale.title);
    await act(async () => renderer.unmount());
  });

  test("the shared reader withholds selected detail when strict readiness is lost", async () => {
    const entry = summary(canonicalIds.ready);
    resourceMocks.loadList.mockResolvedValue({
      state: "ready",
      entries: [entry],
    });
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/memory?familiarId=")) {
        return {
          ok: true,
          json: async () => ({ ok: true, entries: [] }),
        } as Response;
      }
      if (url === `/api/coven-memory/${canonicalIds.ready}`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, entry: detail(canonicalIds.ready) }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const renderer = await mount();
    await act(async () => {
      buttonContaining(renderer, entry.title).props.onClick();
      await flush();
    });
    expect(renderedText(renderer)).toContain("SourceCoven");
    expect(renderedText(renderer)).toContain("Privacypublic");
    expect(renderedText(renderer)).toContain("Verificationverified");
    expect(renderedText(renderer)).toContain(
      "Updated 2026-07-27T12:00:00.000Z",
    );

    await act(async () => {
      buttonContaining(renderer, "Reveal").props.onClick();
    });
    expect(renderedText(renderer)).toContain(`SECRET:${canonicalIds.ready}`);

    await act(async () => {
      renderer.update(
        <InspectorPane
          familiar={familiar}
          compact
          localDaemonReady={false}
          onOpenFullView={() => {}}
        />,
      );
      await flush();
    });
    expect(renderedText(renderer)).not.toContain(`SECRET:${canonicalIds.ready}`);
    expect(renderedText(renderer)).toContain("Local daemon required");
    await act(async () => renderer.unmount());
  });

  test("switching familiars remounts the rail and withholds the previous canonical detail", async () => {
    const salemEntry = summary(canonicalIds.salem);
    const charmEntry = summary(canonicalIds.charm, {
      familiarId: secondFamiliar.id,
      title: "Charm memory",
    });
    resourceMocks.loadList.mockResolvedValue({
      state: "ready",
      entries: [salemEntry, charmEntry],
    });
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/memory?familiarId=")) {
        return {
          ok: true,
          json: async () => ({ ok: true, entries: [] }),
        } as Response;
      }
      if (url === `/api/coven-memory/${canonicalIds.salem}`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, entry: detail(canonicalIds.salem) }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const renderer = await mount();
    await act(async () => {
      buttonContaining(renderer, salemEntry.title).props.onClick();
      await flush();
    });
    await act(async () => {
      buttonContaining(renderer, "Reveal").props.onClick();
    });
    expect(renderedText(renderer)).toContain(`SECRET:${canonicalIds.salem}`);

    await act(async () => {
      renderer.update(
        <InspectorPane
          familiar={secondFamiliar}
          compact
          localDaemonReady
          onOpenFullView={() => {}}
        />,
      );
      await flush();
    });
    expect(renderedText(renderer)).not.toContain(`SECRET:${canonicalIds.salem}`);
    expect(renderedText(renderer)).not.toContain(salemEntry.title);
    expect(renderedText(renderer)).toContain(charmEntry.title);
    await act(async () => renderer.unmount());
  });

  test("the newest forced canonical refresh owns Inspector publication when requests settle out of order", async () => {
    const older = deferred();
    const newer = deferred();
    let forcedCalls = 0;
    resourceMocks.loadList.mockImplementation((force) => {
      if (!force) {
        return Promise.resolve({
          state: "error",
          error: new CanonicalMemoryRequestError(
            "canonical_memory_unavailable",
            503,
          ),
        });
      }
      forcedCalls += 1;
      return forcedCalls === 1 ? older.promise : newer.promise;
    });
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/memory?familiarId=")) {
        return {
          ok: true,
          json: async () => ({ ok: true, entries: [] }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const renderer = await mount();
    const retry = buttonContaining(renderer, "Retry");
    await act(async () => {
      retry.props.onClick();
      retry.props.onClick();
    });

    await act(async () => {
      newer.resolve({
        state: "ready",
        entries: [summary(canonicalIds.newerRefresh)],
      });
      await flush();
    });
    expect(renderedText(renderer)).toContain(canonicalIds.newerRefresh);

    await act(async () => {
      older.resolve({
        state: "ready",
        entries: [summary(canonicalIds.olderRefresh)],
      });
      await flush();
    });
    expect(renderedText(renderer)).toContain(canonicalIds.newerRefresh);
    expect(renderedText(renderer)).not.toContain(canonicalIds.olderRefresh);
    await act(async () => renderer.unmount());
  });

  test("readiness loss synchronously withholds summaries and restoration reads a fresh list", async () => {
    const restoredList = deferred();
    const beforeLoss = summary(canonicalIds.beforeReadinessLoss, {
      excerpt: "Sensitive summary before readiness loss.",
    });
    const afterRestore = summary(canonicalIds.afterReadinessRestore, {
      title: "Fresh summary after readiness restore",
    });
    resourceMocks.loadList
      .mockResolvedValueOnce({ state: "ready", entries: [beforeLoss] })
      .mockReturnValueOnce(restoredList.promise);
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/memory?familiarId=")) {
        return {
          ok: true,
          json: async () => ({ ok: true, entries: [] }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const renderer = await mount();
    expect(renderedText(renderer)).toContain(beforeLoss.title);
    expect(renderedText(renderer)).toContain(beforeLoss.excerpt);

    act(() => {
      renderer.update(
        <InspectorPane
          familiar={familiar}
          compact
          localDaemonReady={false}
          onOpenFullView={() => {}}
        />,
      );
    });
    expect(renderedText(renderer)).not.toContain(beforeLoss.title);
    expect(renderedText(renderer)).not.toContain(beforeLoss.excerpt);
    expect(renderedText(renderer)).toContain("Local daemon required");

    act(() => {
      renderer.update(
        <InspectorPane
          familiar={familiar}
          compact
          localDaemonReady
          onOpenFullView={() => {}}
        />,
      );
    });
    expect(resourceMocks.loadList).toHaveBeenCalledTimes(2);
    expect(renderedText(renderer)).not.toContain(beforeLoss.title);
    expect(renderedText(renderer)).not.toContain(afterRestore.title);
    expect(renderedText(renderer)).toContain("Loading familiar memories");

    await act(async () => {
      restoredList.resolve({ state: "ready", entries: [afterRestore] });
      await flush();
    });
    expect(renderedText(renderer)).not.toContain(beforeLoss.title);
    expect(renderedText(renderer)).toContain(afterRestore.title);
    await act(async () => renderer.unmount());
  });

  test("a canonical list resolution that arrives after readiness loss cannot repopulate the rail", async () => {
    const pending = deferred();
    const lateEntry = summary(canonicalIds.lateAfterReadinessLoss, {
      excerpt: "This late summary must never cross the readiness boundary.",
    });
    resourceMocks.loadList.mockReturnValue(pending.promise);
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/memory?familiarId=")) {
        return {
          ok: true,
          json: async () => ({ ok: true, entries: [] }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const renderer = await mount();
    act(() => {
      renderer.update(
        <InspectorPane
          familiar={familiar}
          compact
          localDaemonReady={false}
          onOpenFullView={() => {}}
        />,
      );
    });

    await act(async () => {
      pending.resolve({ state: "ready", entries: [lateEntry] });
      await flush();
    });
    expect(renderedText(renderer)).not.toContain(lateEntry.title);
    expect(renderedText(renderer)).not.toContain(lateEntry.excerpt);
    expect(renderedText(renderer)).toContain("Local daemon required");
    await act(async () => renderer.unmount());
  });

  test("Files remain usable while canonical readiness is false and no canonical list read starts", async () => {
    resourceMocks.loadList.mockResolvedValue({
      state: "ready",
      entries: [summary(canonicalIds.beforeReadinessLoss)],
    });
    const filePath = "/safe/notes/local-only.md";
    const fileRequests: string[] = [];
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      fileRequests.push(url);
      if (url.includes("/api/memory?familiarId=")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            entries: [{
              root: "/safe",
              rootLabel: "Salem",
              relPath: "notes/local-only.md",
              fullPath: filePath,
              size: 20,
              modified: "2026-07-27T12:00:00.000Z",
              familiarId: familiar.id,
            }],
          }),
        } as Response;
      }
      if (url.startsWith("/api/memory/file?path=")) {
        const revealed = url.includes("&reveal=1");
        return {
          ok: true,
          json: async () => ({
            ok: true,
            path: filePath,
            revealed,
            text: revealed ? "raw local file" : "redacted local file",
            redactions: revealed ? {} : { token: 1 },
            rawLength: 14,
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const renderer = await mount(false);
    expect(resourceMocks.loadList).not.toHaveBeenCalled();
    expect(renderedText(renderer)).toContain("Local daemon required");

    await act(async () => {
      buttonContaining(renderer, "Files").props.onClick();
      await flush();
    });
    expect(renderedText(renderer)).toContain("notes/local-only.md");

    await act(async () => {
      buttonContaining(renderer, "notes/local-only.md").props.onClick();
      await flush();
    });
    expect(renderedText(renderer)).toContain("redacted local file");
    expect(renderedText(renderer)).toContain("reveal secrets");

    await act(async () => {
      buttonContaining(renderer, "reveal secrets").props.onClick();
      await flush();
    });
    expect(renderedText(renderer)).toContain("raw local file");
    expect(fileRequests.some((url) => url.includes("&reveal=1"))).toBe(true);

    await act(async () => {
      renderer.update(
        <InspectorPane
          familiar={familiar}
          compact
          localDaemonReady
          onOpenFullView={() => {}}
        />,
      );
      await flush();
    });
    expect(resourceMocks.loadList).toHaveBeenCalledTimes(1);
    expect(renderedText(renderer)).toContain("raw local file");
    expect(renderedText(renderer)).toContain("hide secrets");

    act(() => {
      renderer.update(
        <InspectorPane
          familiar={familiar}
          compact
          localDaemonReady={false}
          onOpenFullView={() => {}}
        />,
      );
    });
    expect(resourceMocks.loadList).toHaveBeenCalledTimes(1);
    expect(renderedText(renderer)).toContain("raw local file");
    expect(renderedText(renderer)).toContain("hide secrets");
    await act(async () => renderer.unmount());
  });

  test.each([
    [
      "daemon_update_required",
      "Daemon update required",
      "Update Coven, restart the daemon, then retry.",
    ],
    [
      "local_daemon_required",
      "Local daemon required",
      "Switch Cave to Local daemon to read canonical memory.",
    ],
  ])(
    "retained rows keep typed safe guidance after a %s refresh failure",
    async (code, headline, subtitle) => {
      const entry = summary(canonicalIds.retainedError);
      resourceMocks.loadList
        .mockResolvedValueOnce({ state: "ready", entries: [entry] })
        .mockResolvedValueOnce({
          state: "error",
          error: new CanonicalMemoryRequestError(code, 503),
        });
      globalThis.fetch = vi.fn(async (input) => {
        const url = String(input);
        if (url.includes("/api/memory?familiarId=")) {
          return {
            ok: true,
            json: async () => ({ ok: true, entries: [] }),
          } as Response;
        }
        if (url === `/api/coven-memory/${canonicalIds.retainedError}`) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ ok: false, code }),
          } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      });

      const renderer = await mount();
      await act(async () => {
        buttonContaining(renderer, entry.title).props.onClick();
        await flush();
      });
      await act(async () => {
        buttonContaining(renderer, "Refresh").props.onClick();
        await flush();
      });
      await act(async () => {
        buttonContaining(renderer, "Back to list").props.onClick();
      });

      expect(renderedText(renderer)).toContain(entry.title);
      expect(renderedText(renderer)).toContain(headline);
      expect(renderedText(renderer)).toContain(subtitle);
      expect(renderedText(renderer)).not.toContain(code);
      await act(async () => renderer.unmount());
    },
  );
});
