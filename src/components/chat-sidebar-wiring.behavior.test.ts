// @ts-nocheck
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PINNED_SESSIONS_KEY } from "@/lib/chat-session-prefs";
import { sessionRailTitle } from "@/lib/session-rail-title";

const dragSignals = vi.hoisted(() => ({
  start: vi.fn(),
  end: vi.fn(),
}));

const mockProjects = vi.hoisted(() => ({
  state: {
    projects: [],
    loading: false,
    error: null,
    loadedSuccessfully: true,
    reload: () => undefined,
    createProject: async () => null,
    createProjectOrThrow: async () => {
      throw new Error("unexpected createProjectOrThrow call");
    },
    renameProject: async () => false,
    updateRoot: async () => false,
    updateColor: async () => false,
    updateRepoUrl: async () => false,
    deleteProject: async () => false,
  },
}));

vi.mock("@/lib/use-focus-trap", () => ({ useFocusTrap: () => undefined }));
vi.mock("@/lib/use-projects", () => ({ useProjects: () => mockProjects.state }));
vi.mock("@/lib/use-project-overrides", () => ({ useProjectOverrides: () => ({}) }));
vi.mock("@/lib/use-pinned-sessions", () => ({ usePinnedSessions: () => [] }));
vi.mock("@/components/familiar-switcher", async () => {
  const { createElement } = await import("react");
  return { FamiliarSwitcher: () => createElement("div", { "data-testid": "familiar-switcher" }) };
});
vi.mock("@/components/sidebar-footer", async () => {
  const { createElement } = await import("react");
  return { SidebarFooter: () => createElement("div", { "data-testid": "sidebar-footer" }) };
});
vi.mock("@/components/project-avatar", async () => {
  const { createElement } = await import("react");
  return {
    ProjectAvatar: ({ name }) => createElement("span", { "data-project-avatar": name }),
  };
});
vi.mock("@/lib/icon", async (importOriginal) => {
  const { createElement } = await import("react");
  const actual = await importOriginal<typeof import("@/lib/icon")>();
  return {
    ...actual,
    Icon: () => createElement("span", { "aria-hidden": "true" }),
  };
});
vi.mock("@/components/ui/popover", async () => {
  const { Fragment, createElement } = await import("react");
  return {
    Popover: ({ children }) => createElement(Fragment, null, children),
    PopoverBody: ({ children, ...props }) => createElement("div", props, children),
    PopoverItem: ({ children, ...props }) => createElement("div", props, children),
    PopoverLabel: ({ children }) => createElement("div", null, children),
  };
});
vi.mock("@/components/ui/tabs", async () => {
  const { createElement } = await import("react");
  return {
    Tabs: () => createElement("div", { "data-testid": "tabs" }),
  };
});
vi.mock("@/lib/chat-split", () => ({
  CHAT_SESSION_DRAG_MIME: "application/x-cave-chat-session",
  emitChatSessionDragStart: dragSignals.start,
  emitChatSessionDragEnd: dragSignals.end,
}));

import { WorkspaceSidebar } from "./workspace-sidebar";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function makeSession() {
  return {
    id: "session-time",
    project_root: "/repo",
    harness: "claude",
    title: "Fresh chat",
    status: "idle",
    exit_code: null,
    archived_at: null,
    created_at: "2026-08-05T19:59:50.000Z",
    updated_at: "2026-08-05T19:59:50.000Z",
    attention: {
      state: "none",
      since: null,
      reason: null,
    },
  };
}

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textContent((node as { children: unknown }).children);
  }
  return "";
}

function sectionByLabel(renderer: ReactTestRenderer, label: string) {
  return renderer.root.find(
    (node) => node.type === "section" && node.props["aria-label"] === label,
  );
}

function rowContainerFor(scope: ReturnType<typeof sectionByLabel>, title: string) {
  const titleNode = scope.find(
    (node) => typeof node.type === "string" && node.props.className === "cnav__thread-title" && textContent(node.children) === title,
  );
  let node = titleNode;
  while (
    node &&
    !(typeof node.type === "string" && typeof node.props.className === "string" && node.props.className.split(" ").includes("cnav__thread"))
  ) {
    node = node.parent;
  }
  return node;
}

function timeNode(renderer: ReactTestRenderer) {
  return renderer.root.find(
    (node) => typeof node.type === "string" && node.props.className === "cnav__time",
  );
}

function bucketLabels(renderer: ReactTestRenderer) {
  return renderer.root
    .findAll((node) => node.type === "section" && typeof node.props["aria-label"] === "string")
    .map((node) => node.props["aria-label"]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-05T20:00:00.000Z"));
  const storage = new Map<string, string>();
  const localStorage = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
  };
  vi.stubGlobal("window", {
    localStorage,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: vi.fn(() => true),
    open: () => undefined,
  });
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  dragSignals.start.mockReset();
  dragSignals.end.mockReset();
});

test("workspace sidebar row timestamps update when the shared minute tick fires", async () => {
  const intervalSpy = vi.spyOn(globalThis, "setInterval");
  let renderer!: ReactTestRenderer;

  await act(async () => {
    renderer = create(
      createElement(WorkspaceSidebar, {
        sessions: [makeSession()],
        familiars: [],
        responseNeeded: new Set(),
        onSelectFamiliar: () => undefined,
        onOpenSession: () => undefined,
        onNavigate: () => undefined,
        onNewChat: () => undefined,
        onDeleteSession: async () => undefined,
        onOpenSettings: () => undefined,
      }),
    );
    await Promise.resolve();
  });

  expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
  expect(timeNode(renderer).children.join("")).toBe("just now");

  await act(async () => {
    vi.advanceTimersByTime(60_000);
    await Promise.resolve();
  });

  expect(timeNode(renderer).children.join("")).toBe("1m");

  await act(async () => renderer.unmount());
});

// cave-zs85n Task 6 gap-fix: recentBuckets (day-bucketed) and each row's bare
// time/attention description all read the SAME memoized `now` snapshot
// (derived from minuteTick), not independent Date.now() calls. Regression
// covered: an unrelated re-render must never move the clock, and the shared
// minute tick must move the bucket header and the row's elapsed time
// TOGETHER — including across the local midnight boundary, which only a
// truly shared clock derives consistently (a bucket keyed on calendar day
// and a bare time keyed on elapsed seconds are two different computations,
// so they can only agree if fed the identical instant).
test("recency bucket and row bare time share one clock: an unrelated re-render never moves it, and the minute tick moves both together across local midnight", async () => {
  // Local (not UTC) constructor: the boundary this test crosses is chat-recency's
  // LOCAL calendar day, so anchoring in local time keeps the assertion valid
  // under any CI timezone rather than assuming UTC.
  const anchor = new Date(2026, 7, 5, 23, 59, 0); // Aug 5, 2026, 23:59:00 local
  vi.setSystemTime(anchor);
  const session = {
    id: "session-midnight",
    project_root: "/repo",
    harness: "claude",
    title: "Late-night chat",
    status: "idle",
    exit_code: null,
    archived_at: null,
    created_at: anchor.toISOString(),
    updated_at: anchor.toISOString(),
    attention: { state: "none", since: null, reason: null },
  };

  let renderer!: ReactTestRenderer;
  const props = {
    sessions: [session],
    familiars: [],
    responseNeeded: new Set(),
    onSelectFamiliar: () => undefined,
    onOpenSession: () => undefined,
    onNavigate: () => undefined,
    onNewChat: () => undefined,
    onDeleteSession: async () => undefined,
    onOpenSettings: () => undefined,
  };

  await act(async () => {
    renderer = create(createElement(WorkspaceSidebar, props));
    await Promise.resolve();
  });

  expect(bucketLabels(renderer)).toContain("Today");
  expect(timeNode(renderer).children.join("")).toBe("just now");

  // An unrelated prop change (a fresh onOpenUrl reference) forces a re-render
  // with no time having passed and the minute tick not having fired. Both
  // readings must stay exactly where they were — a per-render Date.now()
  // regression would still read the same frozen instant here, but this
  // pins the "no drift from rendering alone" half of the contract.
  await act(async () => {
    renderer.update(createElement(WorkspaceSidebar, { ...props, onOpenUrl: () => undefined }));
    await Promise.resolve();
  });
  expect(bucketLabels(renderer)).toContain("Today");
  expect(bucketLabels(renderer)).not.toContain("Yesterday");
  expect(timeNode(renderer).children.join("")).toBe("just now");

  // Advance 60s: the shared minute-tick interval fires, crossing local
  // midnight. The bucket (calendar-day keyed) and the bare time (elapsed-
  // seconds keyed) can only agree here if both were derived from the exact
  // same `now` — flip together, in the same update, or the fix regressed.
  await act(async () => {
    vi.advanceTimersByTime(60_000);
    await Promise.resolve();
  });

  expect(bucketLabels(renderer)).toContain("Yesterday");
  expect(bucketLabels(renderer)).not.toContain("Today");
  expect(timeNode(renderer).children.join("")).toBe("1m");

  await act(async () => renderer.unmount());
});

test("promoted Awaiting you rows keep open, split, row actions, PR badge, active state, and drag behavior", async () => {
  let renderer!: ReactTestRenderer;
  const session = {
    ...makeSession(),
    id: "session-awaiting-actions",
    title: "Approve release checklist",
    attention: {
      state: "awaiting-human",
      since: "2026-08-05T13:00:00.000Z",
      reason: "approval",
    },
    pullRequest: { repo: "o/r", number: 7, state: "open" },
  };
  const railTitle = sessionRailTitle(session);
  const onOpenSession = vi.fn();
  const onOpenSessionInSplit = vi.fn();
  const onDeleteSession = vi.fn(async () => undefined);
  const onSessionsChanged = vi.fn();
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true }),
  } as Response);

  await act(async () => {
    renderer = create(
      createElement(WorkspaceSidebar, {
        sessions: [session],
        familiars: [],
        responseNeeded: new Set(),
        activeSessionId: session.id,
        onSelectFamiliar: () => undefined,
        onOpenSession,
        onOpenSessionInSplit,
        onNavigate: () => undefined,
        onNewChat: () => undefined,
        onDeleteSession,
        onSessionsChanged,
        onOpenUrl: () => undefined,
        onOpenSettings: () => undefined,
      }),
    );
    await Promise.resolve();
  });

  const row = rowContainerFor(sectionByLabel(renderer, "Awaiting you"), railTitle);
  expect(row.props.className).toContain("is-active");
  expect(row.props["data-attention"]).toBe("awaiting-human");

  const mainButton = row.find(
    (node) => node.type === "button" && node.props.className === "cnav__thread-main focus-ring",
  );
  expect(mainButton.props.type).toBe("button");
  expect(mainButton.props["aria-current"]).toBe("page");
  expect(mainButton.props.draggable).toBe(true);

  await act(async () => {
    mainButton.props.onClick({ altKey: false });
    await Promise.resolve();
  });
  expect(onOpenSession).toHaveBeenCalledWith(session);
  expect(onOpenSessionInSplit).not.toHaveBeenCalled();

  await act(async () => {
    mainButton.props.onClick({ altKey: true });
    await Promise.resolve();
  });
  expect(onOpenSessionInSplit).toHaveBeenCalledWith(session);

  const preventDefault = vi.fn();
  await act(async () => {
    mainButton.props.onKeyDown({ key: "Enter", altKey: true, preventDefault });
    await Promise.resolve();
  });
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(onOpenSessionInSplit).toHaveBeenCalledTimes(2);

  const pinButton = row.find(
    (node) => node.type === "button" && node.props["aria-label"] === `Pin ${railTitle}`,
  );
  await act(async () => {
    pinButton.props.onClick();
    await Promise.resolve();
  });
  expect(window.localStorage.setItem).toHaveBeenCalledWith(PINNED_SESSIONS_KEY, JSON.stringify([session.id]));

  const archiveButton = row.find(
    (node) => node.type === "button" && node.props["aria-label"] === `Archive chat ${railTitle}`,
  );
  await act(async () => {
    archiveButton.props.onClick();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(fetch).toHaveBeenCalledWith(`/api/sessions/${encodeURIComponent(session.id)}`, expect.objectContaining({
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived: true }),
  }));
  expect(onSessionsChanged).toHaveBeenCalledTimes(1);

  const deleteButton = row.find(
    (node) => node.type === "button" && node.props["aria-label"] === `Delete thread ${railTitle}`,
  );
  await act(async () => {
    deleteButton.props.onClick();
    await Promise.resolve();
  });
  const confirmDelete = row.find(
    (node) => node.type === "button" && textContent(node.children) === "Delete",
  );
  await act(async () => {
    confirmDelete.props.onClick();
    await Promise.resolve();
  });
  expect(onDeleteSession).toHaveBeenCalledWith(session);

  const prBadge = row.find(
    (node) => node.type === "button" && node.props["aria-label"] === "Open pull request (PR #7 · open)",
  );
  expect(prBadge.props["data-pr-state"]).toBe("open");

  const dataTransfer = {
    setData: vi.fn(),
    effectAllowed: "",
  };
  await act(async () => {
    mainButton.props.onDragStart({ dataTransfer });
    mainButton.props.onDragEnd();
    await Promise.resolve();
  });
  expect(dataTransfer.setData).toHaveBeenNthCalledWith(1, "application/x-cave-chat-session", session.id);
  expect(dataTransfer.setData).toHaveBeenNthCalledWith(2, "text/plain", railTitle);
  expect(dataTransfer.effectAllowed).toBe("copyMove");
  expect(dragSignals.start).toHaveBeenCalledWith({ sessionId: session.id, title: railTitle });
  expect(dragSignals.end).toHaveBeenCalledTimes(1);

  await act(async () => renderer.unmount());
});

console.log("chat-sidebar-wiring.behavior.test.ts passed");
