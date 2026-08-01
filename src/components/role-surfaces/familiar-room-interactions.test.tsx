// @ts-nocheck
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { LiveRegionProvider } from "@/components/ui/live-region";
import {
  clearRoleSurfaceStateForTest,
  writeRoleSurfaceState,
} from "@/lib/role-surface-state";
import type { Card } from "@/lib/cave-board-types";
import type { Escalation } from "@/lib/escalations-types";
import type { RoleSurfaceContext, SurfaceMemoryEntry } from "@/lib/role-surfaces";
import { IndexerSurface } from "./indexer-surface";
import {
  MESSENGER_INITIAL_STATE,
  MessengerSurface,
} from "./messenger-surface";
import { NavigatorSurface } from "./navigator-surface";
import { ScribeSurface } from "./scribe-surface";
import { SentinelSurface } from "./sentinel-surface";
import { MESSENGER_SURFACE_ID } from "./ids";
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

function alert(id: string, title: string): Escalation {
  return {
    id,
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
    origin: "heartbeat",
    title,
    severity: "warn",
    state: "new",
    decisionRequired: false,
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
    | typeof MessengerSurface
    | typeof NavigatorSurface
    | typeof ScribeSurface
    | typeof SentinelSurface,
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

  test("Sentinel exposes one live status per independent request", async () => {
    globalThis.fetch = vi.fn(() => pending());
    const renderer = await renderSurface(SentinelSurface, context("sentinel-loading"));
    expect(liveLoadingCount(renderer)).toBe(2);
    await act(async () => renderer.unmount());
  });

  test("Messenger gives its shared inbox request one live loading owner", async () => {
    const familiarId = "messenger-loading";
    writeRoleSurfaceState(familiarId, MESSENGER_SURFACE_ID, {
      ...MESSENGER_INITIAL_STATE,
      drawerOpen: true,
    });
    globalThis.fetch = vi.fn(() => pending());
    const renderer = await renderSurface(MessengerSurface, context(familiarId));
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

    await act(async () => buttonContaining(renderer, "Close").props.onClick());
    expect(stepSheet(renderer)).toBeNull();

    await act(async () => buttonContaining(renderer, "Second voyage").props.onClick());
    expect(stepSheet(renderer)?.props["aria-label"]).toBe("Step — Second voyage");
    await act(async () => renderer.unmount());
  });

  test("Sentinel opens alert details for the newly selected alert", async () => {
    const alerts = [alert("alert-1", "First watch"), alert("alert-2", "Second watch")];
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url === "/api/escalations") return response({ ok: true, items: alerts });
      if (url === "/api/hosts") return response({ ok: true, hosts: [] });
      throw new Error(`unexpected fetch ${url}`);
    });
    const renderer = await renderSurface(SentinelSurface, context("sentinel-selection"));

    await act(async () => buttonContaining(renderer, "First watch").props.onClick());
    expect(rightRail(renderer, "Alert details").props.expanded).toBe(true);

    await act(async () => rightRail(renderer, "Alert details").props.onExpandedChange(false));
    expect(rightRail(renderer, "Alert details").props.expanded).toBe(false);

    await act(async () => buttonContaining(renderer, "Second watch").props.onClick());
    expect(rightRail(renderer, "Alert details").props.expanded).toBe(true);
    await act(async () => renderer.unmount());
  });

  test("Messenger opens Dispatch when a new draft becomes active", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      if (String(input) === "/api/inbox") return response({ items: [] });
      throw new Error(`unexpected fetch ${String(input)}`);
    });
    const renderer = await renderSurface(MessengerSurface, context("messenger-selection"));

    expect(rightRail(renderer, "Dispatch").props.expanded).toBe(false);
    await act(async () => leftRail(renderer, "Traffic").props.onExpandedChange(true));
    expect(leftRail(renderer, "Traffic").props.expanded).toBe(true);
    await act(async () => buttonContaining(renderer, "New").props.onClick());
    expect(leftRail(renderer, "Traffic").props.expanded).toBe(false);
    expect(rightRail(renderer, "Dispatch").props.expanded).toBe(true);

    await act(async () => rightRail(renderer, "Dispatch").props.onExpandedChange(false));
    expect(rightRail(renderer, "Dispatch").props.expanded).toBe(false);

    await act(async () => leftRail(renderer, "Traffic").props.onExpandedChange(true));
    await act(async () => buttonContaining(renderer, "New").props.onClick());
    expect(leftRail(renderer, "Traffic").props.expanded).toBe(false);
    expect(rightRail(renderer, "Dispatch").props.expanded).toBe(true);

    await act(async () => leftRail(renderer, "Traffic").props.onExpandedChange(true));
    expect(leftRail(renderer, "Traffic").props.expanded).toBe(true);
    expect(rightRail(renderer, "Dispatch").props.expanded).toBe(false);
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
  test("Navigator retains the card and restores focus when lane revalidation fails", async () => {
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

    const focused: string[] = [];
    const renderer = await renderSurface(
      NavigatorSurface,
      context("navigator-focus"),
      (element) => {
        if (element.type === "p" && element.props.className?.includes("role-surface-memory-path")) {
          return {
            focus: () => focused.push(String(element.props.children)),
          };
        }
        return null;
      },
    );
    await act(async () => buttonContaining(renderer, "Hold the course").props.onClick());

    await act(async () => {
      buttonInGroup(renderer, "Move card to lane", "Underway").props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(buttonContaining(renderer, "Hold the course")).toBeDefined();
    expect(rightRail(renderer, "Card details").props.expanded).toBe(true);
    expect(buttonInGroup(renderer, "Move card to lane", "Underway").props.disabled).toBe(true);
    expect(
      renderer.root.findAllByType(SurfaceLoading).some((node) => node.props.label === "Loading card details…"),
    ).toBe(false);

    await act(async () => refresh.reject(new Error("offline")));
    expect(buttonContaining(renderer, "Hold the course")).toBeDefined();
    const focusTarget = renderer.root
      .findAllByType("p")
      .find((node) => node.props.className?.includes("role-surface-memory-path"))!;
    expect(focusTarget.props.tabIndex).toBe(-1);
    expect(focusTarget.props.className).toContain("focus-ring");
    expect(focused).toEqual(["Hold the course"]);
    await act(async () => renderer.unmount());
  });

  test("Sentinel retains the alert during triage refresh and restores focus to its inspector", async () => {
    const initial = alert("alert-focus", "Keep watch");
    const refreshed = { ...initial, state: "resolved" as const };
    const refresh = deferred<Response>();
    let escalationReads = 0;
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url === "/api/escalations") {
        escalationReads += 1;
        return escalationReads === 1
          ? response({ ok: true, items: [initial] })
          : refresh.promise;
      }
      if (url === "/api/hosts") return response({ ok: true, hosts: [] });
      if (url === "/api/escalations/alert-focus" && init?.method === "PATCH") {
        return response({ ok: true });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const focused: string[] = [];
    const renderer = await renderSurface(
      SentinelSurface,
      context("sentinel-focus"),
      (element) => {
        if (element.type === "p" && element.props.className?.includes("role-surface-memory-path")) {
          return {
            focus: () => focused.push(String(element.props.children)),
          };
        }
        return null;
      },
    );
    await act(async () => buttonContaining(renderer, "Keep watch").props.onClick());

    await act(async () => {
      buttonContaining(renderer, "Resolve").props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(buttonContaining(renderer, "Keep watch")).toBeDefined();
    expect(rightRail(renderer, "Alert details").props.expanded).toBe(true);
    expect(buttonContaining(renderer, "Resolve").props.disabled).toBe(true);
    expect(
      renderer.root.findAllByType(SurfaceLoading).some((node) => node.props.label === "Loading alert details…"),
    ).toBe(false);

    await act(async () => refresh.resolve(response({ ok: true, items: [refreshed] })));
    const focusTarget = renderer.root
      .findAllByType("p")
      .find((node) => node.props.className?.includes("role-surface-memory-path"))!;
    expect(focusTarget.props.tabIndex).toBe(-1);
    expect(focusTarget.props.className).toContain("focus-ring");
    expect(focused).toEqual(["Keep watch"]);
    await act(async () => renderer.unmount());
  });

  test("Sentinel retains the alert and restores focus after a custom RPC action", async () => {
    const initial = {
      ...alert("alert-rpc", "Inspect source"),
      actions: [
        {
          id: "recheck",
          label: "Re-check source",
          kind: "rpc" as const,
          target: "/api/escalation-actions/recheck",
        },
      ],
    };
    const refresh = deferred<Response>();
    let escalationReads = 0;
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url === "/api/escalations") {
        escalationReads += 1;
        return escalationReads === 1
          ? response({ ok: true, items: [initial] })
          : refresh.promise;
      }
      if (url === "/api/hosts") return response({ ok: true, hosts: [] });
      if (url === "/api/escalation-actions/recheck" && init?.method === "POST") {
        return response({ ok: true });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const focused: string[] = [];
    const renderer = await renderSurface(
      SentinelSurface,
      context("sentinel-rpc-focus"),
      (element) => {
        if (element.type === "p" && element.props.className?.includes("role-surface-memory-path")) {
          return {
            focus: () => focused.push(String(element.props.children)),
          };
        }
        return null;
      },
    );
    await act(async () => buttonContaining(renderer, "Inspect source").props.onClick());

    await act(async () => {
      buttonContaining(renderer, "Re-check source").props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(buttonContaining(renderer, "Inspect source")).toBeDefined();
    expect(rightRail(renderer, "Alert details").props.expanded).toBe(true);
    expect(buttonContaining(renderer, "Re-check source").props.disabled).toBe(true);
    expect(
      renderer.root.findAllByType(SurfaceLoading).some((node) => node.props.label === "Loading alert details…"),
    ).toBe(false);

    await act(async () => refresh.resolve(response({ ok: true, items: [initial] })));
    expect(focused).toEqual(["Inspect source"]);
    await act(async () => renderer.unmount());
  });
});
