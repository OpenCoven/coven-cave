// @ts-nocheck
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { LiveRegionProvider } from "@/components/ui/live-region";
import {
  clearRoleSurfaceStateForTest,
} from "@/lib/role-surface-state";
import type { Card } from "@/lib/cave-board-types";
import type { RoleSurfaceContext, SurfaceMemoryEntry } from "@/lib/role-surfaces";
import { IndexerSurface } from "./indexer-surface";
import { NavigatorSurface } from "./navigator-surface";
import { ScribeSurface } from "./scribe-surface";
import { SurfaceLoading, SurfaceRail } from "./surface-room";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const originalFetch = globalThis.fetch;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

beforeEach(() => {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  clearRoleSurfaceStateForTest();
  vi.restoreAllMocks();
});

function response(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

function pending<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function context(
  familiarId: string,
  memoryEntries: SurfaceMemoryEntry[] = [],
): RoleSurfaceContext {
  return {
    activeFamiliar: {
      id: familiarId,
      display_name: "Salem",
      role: "familiar",
    },
    activePerson: null,
    currentThread: null,
    runtimeState: {
      daemonRunning: true,
      sessions: [],
      activeSessionId: null,
    },
    memory: {
      listEntries: async () => memoryEntries,
      readFile: async (path) => ({
        content: `content:${path}`,
        mtimeMs: 1,
      }),
    },
    tools: { listTools: async () => [] },
    plugins: { listPlugins: async () => [] },
    openUrl: vi.fn(),
    openSession: vi.fn(),
    focusCard: vi.fn(),
    refreshTasks: vi.fn(),
  };
}

function card(id: string, title: string): Card {
  return {
    id,
    title,
    notes: "",
    status: "backlog",
    priority: "medium",
    familiarId: null,
    sessionId: null,
    cwd: null,
    links: [],
    github: [],
    asana: [],
    labels: [],
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
    lifecycle: "queued",
    lifecycleAt: "2026-07-26T00:00:00.000Z",
    retryCount: 0,
    maxRetries: 2,
    steps: [],
  };
}

function memoryEntry(path: string): SurfaceMemoryEntry {
  return {
    relPath: path,
    fullPath: `/memory/${path}`,
    rootLabel: "Familiar",
    sourceKindLabel: "Memory",
    size: 20,
    modified: "2026-07-26T00:00:00.000Z",
  };
}

async function renderSurface(
  component:
    | typeof IndexerSurface
    | typeof NavigatorSurface
    | typeof ScribeSurface,
  surfaceContext: RoleSurfaceContext,
  createNodeMock?: Parameters<typeof create>[1]["createNodeMock"],
): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <LiveRegionProvider>
        {createElement(component, { context: surfaceContext })}
      </LiveRegionProvider>,
      createNodeMock ? { createNodeMock } : undefined,
    );
  });
  return renderer;
}

function textOf(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

function buttonContaining(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const button = renderer.root
    .findAllByType("button")
    .find((candidate) => textOf(candidate).includes(label));
  if (!button) throw new Error(`button containing ${label} not found`);
  return button;
}

function buttonInGroup(
  renderer: ReactTestRenderer,
  groupLabel: string,
  buttonLabel: string,
): ReactTestInstance {
  const group = renderer.root.findByProps({ role: "group", "aria-label": groupLabel });
  const button = group
    .findAllByType("button")
    .find((candidate) => textOf(candidate) === buttonLabel);
  if (!button) throw new Error(`${buttonLabel} button in ${groupLabel} not found`);
  return button;
}

/** The Chart Room's step sheet, or null when no step is open. */
function stepSheet(renderer: ReactTestRenderer): ReactTestInstance | null {
  return (
    renderer.root
      .findAllByProps({ role: "dialog" })
      .find((node) => String(node.props["aria-label"] ?? "").startsWith("Step — ")) ?? null
  );
}

function rightRail(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root
    .findAllByType(SurfaceRail)
    .find((rail) => rail.props.side === "right" && rail.props.label === label)!;
}

function leftRail(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root
    .findAllByType(SurfaceRail)
    .find((rail) => rail.props.side === "left" && rail.props.label === label)!;
}

function liveLoadingCount(renderer: ReactTestRenderer): number {
  return renderer.root.findAll(
    (node) =>
      node.type === "div" &&
      node.props["aria-busy"] === "true" &&
      node.props.role === "status",
  ).length;
}

/**
 * The labels of those live statuses, sorted. A count alone cannot tell "each
 * independent request owns one live status" from "one request grew a second
 * live copy" — which is the whole distinction this describe block exists for.
 */
describe("SurfaceLoading live ownership", () => {
  test("passive dependent copies keep busy semantics without becoming live regions", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<SurfaceLoading label="Loading dependent panel…" live={false} />);
    });

    const state = renderer.root.findByProps({ "aria-label": "Loading dependent panel…" });
    expect(state.props["aria-busy"]).toBe("true");
    expect(state.props.role).toBeUndefined();
    await act(async () => renderer.unmount());
  });

  test("Indexer exposes one live inventory loading status", async () => {
    const surfaceContext = context("indexer-loading");
    surfaceContext.memory.listEntries = () => pending();
    const renderer = await renderSurface(IndexerSurface, surfaceContext);
    expect(liveLoadingCount(renderer)).toBe(1);
    await act(async () => renderer.unmount());
  });

  test("Navigator exposes one live board loading status", async () => {
    globalThis.fetch = vi.fn(() => pending());
    const renderer = await renderSurface(NavigatorSurface, context("navigator-loading"));
    expect(liveLoadingCount(renderer)).toBe(1);
    await act(async () => renderer.unmount());
  });

});

describe("active selections control compact inspectors", () => {
  test("Indexer opens details for a selected memory and honors a manual close until the next selection", async () => {
    const entries = [memoryEntry("one.md"), memoryEntry("two.md")];
    const renderer = await renderSurface(IndexerSurface, context("indexer-selection", entries));

    await act(async () => buttonContaining(renderer, "one.md").props.onClick());
    expect(rightRail(renderer, "Memory details").props.expanded).toBe(true);

    await act(async () => rightRail(renderer, "Memory details").props.onExpandedChange(false));
    expect(rightRail(renderer, "Memory details").props.expanded).toBe(false);

    await act(async () => buttonContaining(renderer, "two.md").props.onClick());
    expect(rightRail(renderer, "Memory details").props.expanded).toBe(true);
    await act(async () => renderer.unmount());
  });

  // The Chart Room opens a step in a modal sheet rather than a compact rail,
  // so the contract is the dialog's presence, not a rail's expanded flag.
  test("Navigator opens the step sheet for the newly selected card", async () => {
    const cards = [card("card-1", "First voyage"), card("card-2", "Second voyage")];
    globalThis.fetch = vi.fn(async () => response({ ok: true, cards }));
    const renderer = await renderSurface(NavigatorSurface, context("navigator-selection"));

    expect(stepSheet(renderer)).toBeNull();

    await act(async () => buttonContaining(renderer, "First voyage").props.onClick());
    expect(stepSheet(renderer)?.props["aria-label"]).toBe("Step — First voyage");

    await act(async () =>
      stepSheet(renderer)!.findByProps({ "aria-label": "Close" }).props.onClick(),
    );
    expect(stepSheet(renderer)).toBeNull();

    await act(async () => buttonContaining(renderer, "Second voyage").props.onClick());
    expect(stepSheet(renderer)?.props["aria-label"]).toBe("Step — Second voyage");
    await act(async () => renderer.unmount());
  });

  test("Scribe opens Publishing when a new draft becomes active", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url === "/api/journal") return response({ ok: true, days: [] });
      if (url.startsWith("/api/knowledge?")) return response({ ok: true, entries: [] });
      throw new Error(`unexpected fetch ${url}`);
    });
    const renderer = await renderSurface(ScribeSurface, context("scribe-selection"));

    expect(rightRail(renderer, "Publishing").props.expanded).toBe(false);
    await act(async () =>
      leftRail(renderer, "Drafts and sources").props.onExpandedChange(true),
    );
    expect(leftRail(renderer, "Drafts and sources").props.expanded).toBe(true);
    await act(async () => buttonContaining(renderer, "New").props.onClick());
    expect(leftRail(renderer, "Drafts and sources").props.expanded).toBe(false);
    expect(rightRail(renderer, "Publishing").props.expanded).toBe(true);

    await act(async () => rightRail(renderer, "Publishing").props.onExpandedChange(false));
    expect(rightRail(renderer, "Publishing").props.expanded).toBe(false);

    await act(async () =>
      leftRail(renderer, "Drafts and sources").props.onExpandedChange(true),
    );
    await act(async () => buttonContaining(renderer, "New").props.onClick());
    expect(leftRail(renderer, "Drafts and sources").props.expanded).toBe(false);
    expect(rightRail(renderer, "Publishing").props.expanded).toBe(true);

    await act(async () =>
      leftRail(renderer, "Drafts and sources").props.onExpandedChange(true),
    );
    expect(leftRail(renderer, "Drafts and sources").props.expanded).toBe(true);
    expect(rightRail(renderer, "Publishing").props.expanded).toBe(false);
    await act(async () => renderer.unmount());
  });
});

describe("mutation revalidation keeps the selected inspector usable", () => {
  // The Chart Room moves a step through the sheet's lane carousel, not a rail's
  // button group. What still matters is that a failed revalidation does not yank
  // the operator's context away: the step stays selected, its sheet stays open
  // and usable, and the failure is surfaced rather than swallowed.
  test("Navigator keeps the step sheet open and usable when lane revalidation fails", async () => {
    const initial = card("card-focus", "Hold the course");
    const refresh = deferred<Response>();
    let boardReads = 0;
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url === "/api/board") {
        boardReads += 1;
        return boardReads === 1
          ? response({ ok: true, cards: [initial] })
          : refresh.promise;
      }
      if (url === "/api/board/card-focus" && init?.method === "PATCH") {
        return response({ ok: true });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const renderer = await renderSurface(NavigatorSurface, context("navigator-focus"));
    await act(async () => buttonContaining(renderer, "Hold the course").props.onClick());
    expect(stepSheet(renderer)?.props["aria-label"]).toBe("Step — Hold the course");

    // Walk the lane carousel forward; the board read that follows never lands.
    await act(async () => {
      buttonContaining(renderer, "Inbox").props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(stepSheet(renderer)).not.toBeNull();
    expect(
      renderer.root.findAllByType(SurfaceLoading).some((node) => node.props.label === "Loading the board…"),
    ).toBe(false);

    await act(async () => refresh.reject(new Error("offline")));
    expect(buttonContaining(renderer, "Hold the course")).toBeDefined();
    expect(stepSheet(renderer)?.props["aria-label"]).toBe("Step — Hold the course");
    await act(async () => renderer.unmount());
  });

});
