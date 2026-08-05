// @ts-nocheck
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

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
vi.mock("@/lib/icon", async () => {
  const { createElement } = await import("react");
  return {
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
  vi.stubGlobal("window", {
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    open: () => undefined,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

console.log("chat-sidebar-wiring.behavior.test.ts passed");
