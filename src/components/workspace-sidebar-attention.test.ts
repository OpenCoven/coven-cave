// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { relativeTime } from "@/lib/relative-time";

const sidebar = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/globals/shell-navigation.css", import.meta.url), "utf8");

const editorialCss = readFileSync(new URL("../styles/workspace-sidebar.css", import.meta.url), "utf8");
assert.match(sidebar, /truncate="end"/, "chat rail titles use one end truncation");
assert.match(editorialCss, /section\[aria-label="Awaiting you"\] \.cnav__thread\[data-attention-kind="awaiting"\] \.cnav__attention \{ display: none; \}/,
  "only generic waiting labels are suppressed within their named section");
assert.match(editorialCss, /\.cnav__runtime-state\[data-status="failed"\].*var\(--color-danger\)/,
  "actual failures retain an explicit semantic label");

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

// Controllable per-test prefs: which sessions are pinned, and which organize
// view ("recent" | "projects") the sidebar should hydrate on mount — mirrors
// the real localStorage-backed hooks (chat-session-prefs.ts) without touching
// jsdom's localStorage.
const sidebarPrefs = vi.hoisted(() => ({
  pinnedIds: [] as string[],
}));

vi.mock("@/lib/use-focus-trap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/use-focus-trap")>()),
  useFocusTrap: () => undefined,
}));
vi.mock("@/lib/use-minute-tick", () => ({ useMinuteTick: () => 0 }));
vi.mock("@/lib/use-projects", () => ({ useProjects: () => mockProjects.state }));
vi.mock("@/lib/use-project-overrides", () => ({ useProjectOverrides: () => ({}) }));
vi.mock("@/lib/use-pinned-sessions", () => ({ usePinnedSessions: () => sidebarPrefs.pinnedIds }));
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
    Icon: ({ name, className }) => createElement("span", { "aria-hidden": "true", "data-icon-name": name, className }),
  };
});
vi.mock("@/components/ui/popover", async () => {
  const { Fragment, createElement } = await import("react");
  return {
    Popover: ({ children }) => createElement(Fragment, null, children),
    PopoverBody: ({ children, ...props }) => createElement("div", props, children),
    PopoverItem: ({ children, ...props }) => createElement("div", props, children),
    PopoverLabel: ({ children }) => createElement("div", null, children),
    PopoverSeparator: () => createElement("hr"),
  };
});
vi.mock("@/components/ui/tabs", async () => {
  const { createElement } = await import("react");
  return {
    Tabs: () => createElement("div", { "data-testid": "tabs" }),
  };
});

// Renamed in cave-fh9so: the component is the embedded chat list now, mounted
// inside SidebarMinimal's Chats section and docked in the chat surface.
import { SidebarChatsSection } from "./workspace-sidebar";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textContent((node as { children: unknown }).children);
  }
  return "";
}

function makeSession(overrides = {}) {
  const attention = {
    state: "awaiting-human",
    since: "2026-08-05T19:00:00.000Z",
    reason: "approval",
    ...(overrides.attention ?? {}),
  };
  return {
    id: "session-attention",
    project_root: "/repo",
    harness: "claude",
    title: "Approve release",
    status: "idle",
    exit_code: null,
    archived_at: null,
    created_at: "2026-08-05T18:30:00.000Z",
    updated_at: "2026-08-05T19:30:00.000Z",
    ...overrides,
    attention,
  };
}

function mainThreadButton(renderer: ReactTestRenderer) {
  return renderer.root.find(
    (node) => node.type === "button" && node.props.className === "cnav__thread-main focus-ring" && typeof node.props["aria-describedby"] === "string",
  );
}

function sectionByLabel(renderer: ReactTestRenderer, label: string) {
  return renderer.root.find(
    (node) => node.type === "section" && node.props["aria-label"] === label,
  );
}

/** Non-throwing sibling of `sectionByLabel` — lets a test assert a section is
 *  ABSENT (e.g. "Awaiting you" during search) without `.find` throwing first. */
function sectionsByLabel(renderer: ReactTestRenderer) {
  return renderer.root.findAll((node) => node.type === "section" && typeof node.props["aria-label"] === "string");
}

function sectionCount(section: ReturnType<typeof sectionByLabel>) {
  return section.find(
    (node) => typeof node.type === "string" && node.props.className === "cnav__label-count",
  );
}

function sectionThreadTitles(section: ReturnType<typeof sectionByLabel>) {
  return section
    .findAll((node) => typeof node.type === "string" && node.props.className?.split(" ").includes("cnav__thread-title"))
    .map((node) => textContent(node.findByProps({ className: "sr-only" }).children));
}

function attentionCueLabels(section: ReturnType<typeof sectionByLabel>) {
  return section
    .findAll((node) => typeof node.type === "string" && node.props.className === "cnav__attention")
    .map((node) => textContent(node.children));
}

/** Extracts a single balanced-brace CSS block starting at `marker` — lets a
 *  source test assert on a container-query rule's *contents* without a fragile
 *  regex trying to guess where the block ends. */
function extractBraceBlock(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  assert.ok(markerIndex !== -1, `expected to find "${marker}" in source`);
  const braceStart = source.indexOf("{", markerIndex);
  let depth = 0;
  let i = braceStart;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(braceStart, i + 1);
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
  mockProjects.state.projects = [];
  sidebarPrefs.pinnedIds = [];
});

test("legacy sessions without attention render as neutral rows", async () => {
  let renderer!: ReactTestRenderer;
  const session = makeSession({ title: "Legacy chat" });
  delete session.attention;

  await act(async () => {
    renderer = create(
      createElement(SidebarChatsSection, {
        sessions: [session],
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

  expect(
    renderer.root.findAll(
      (node) => typeof node.type === "string" && node.props.className?.split(" ").includes("cnav__thread-title") && node.props.title === "Legacy chat",
    ),
  ).toHaveLength(1);
  expect(sectionsByLabel(renderer).some((section) => section.props["aria-label"] === "Awaiting you")).toBe(false);

  await act(async () => renderer.unmount());
});

test("attention rows keep the visible state in the button name and move the detailed description outside the button subtree", async () => {
  let renderer!: ReactTestRenderer;
  const session = makeSession();
  const onSelectFamiliar = vi.fn();
  const onOpenSession = vi.fn();
  const onNavigate = vi.fn();
  const onNewChat = vi.fn();
  const onDeleteSession = vi.fn(async () => undefined);
  const onOpenSettings = vi.fn();

  await act(async () => {
    renderer = create(
      createElement(SidebarChatsSection, {
        sessions: [session],
        familiars: [],
        responseNeeded: new Set(),
        onSelectFamiliar,
        onOpenSession,
        onNavigate,
        onNewChat,
        onDeleteSession,
        onOpenSettings,
      }),
    );
    await Promise.resolve();
  });

  const button = mainThreadButton(renderer);
  const descriptionId = button.props["aria-describedby"];
  expect(typeof descriptionId).toBe("string");

  const buttonText = textContent(button.children);
  expect(buttonText).toContain("Approve release");
  expect(buttonText).toContain(relativeTime(session.updated_at, new Date("2026-08-05T20:00:00.000Z"), "bare"));
  // The fixture's attention reason is `approval` — a gate the run cannot pass
  // without this person — so the visible state is Blocked, the stronger of the
  // two waiting words. The section heading is a different thing and stays
  // "Awaiting you": it groups what needs you, it does not name each state.
  expect(buttonText).toContain("Blocked");
  expect(buttonText).not.toContain("approval");
  expect(buttonText).not.toContain("1 hour ago");
  expect(buttonText.match(/Blocked/g) ?? []).toHaveLength(1);
  expect(button.findAll((node) => typeof node.type === "string" && node.props.id === descriptionId)).toHaveLength(0);

  const describedNodes = renderer.root.findAll((node) => typeof node.type === "string" && node.props.id === descriptionId);
  expect(describedNodes).toHaveLength(1);
  expect(textContent(describedNodes[0].children)).toBe("Blocked for approval since 1 hour ago.");

  await act(async () => renderer.unmount());
});

test("pinned and full attention rows keep the same accessible description while the visible label stays separate", async () => {
  let renderer!: ReactTestRenderer;
  const session = makeSession({
    id: "session-pinned-description",
    title: "Pinned request",
    attention: {
      state: "awaiting-human",
      since: "2026-08-05T19:00:00.000Z",
      reason: "approval",
    },
  });
  const railTitle = "Pinned request";
  sidebarPrefs.pinnedIds = [session.id];

  await act(async () => {
    renderer = create(
      createElement(SidebarChatsSection, {
        sessions: [session],
        familiars: [],
        responseNeeded: new Set(),
        activeSessionId: session.id,
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

  for (const [label, scope] of [

    ["Awaiting you", sectionByLabel(renderer, "Awaiting you")],
  ] as const) {
    const row = rowContainerFor(scope, railTitle);
    const button = row.find(
      (node) => node.type === "button" && node.props.className === "cnav__thread-main focus-ring",
    );
    const descriptionId = button.props["aria-describedby"];
    expect(typeof descriptionId).toBe("string");
    if (label === "Awaiting you") {
      expect(textContent(button.children)).toContain(relativeTime(session.updated_at, new Date("2026-08-05T20:00:00.000Z"), "bare"));
    }
    // Same approval gate, so both row shapes must say Blocked identically.
    expect(textContent(button.children)).toContain("Blocked");
    expect(textContent(button.children)).not.toContain("for approval");
    expect(textContent(button.children)).not.toContain("1 hour ago");

    const described = renderer.root.findAll(
      (node) => typeof node.type === "string" && node.props.id === descriptionId,
    );
    expect(described).toHaveLength(1);
    expect(textContent(described[0].children)).toBe("Blocked for approval since 1 hour ago.");
  }

  await act(async () => renderer.unmount());
});

test("recent view shows the visible Awaiting you count and keeps promoted rows out of recency buckets", async () => {
  let renderer!: ReactTestRenderer;
  const overdue = makeSession({
    id: "session-overdue",
    title: "Overdue approval",
    updated_at: "2026-08-05T19:59:00.000Z",
    attention: {
      state: "overdue-human",
      since: "2026-08-03T20:00:00.000Z",
      reason: "approval",
    },
  });
  const awaiting = makeSession({
    id: "session-awaiting",
    title: "Needs reply",
    updated_at: "2026-08-05T19:58:00.000Z",
    attention: {
      state: "awaiting-human",
      since: "2026-08-05T19:00:00.000Z",
      reason: "reply",
    },
  });
  const leftHanging = makeSession({
    id: "session-left-hanging",
    title: "Follow up on branch",
    updated_at: "2026-08-05T19:57:00.000Z",
    attention: {
      state: "left-hanging",
      since: "2026-08-04T19:00:00.000Z",
      reason: "follow_up",
    },
  });
  const ordinary = makeSession({
    id: "session-none",
    title: "Low priority note",
    updated_at: "2026-08-05T19:56:00.000Z",
    attention: {
      state: "none",
      since: null,
      reason: null,
    },
  });
  const archivedAttention = makeSession({
    id: "session-archived-attention",
    title: "Archived escalation",
    archived_at: "2026-08-05T19:55:00.000Z",
    updated_at: "2026-08-05T19:55:00.000Z",
    attention: {
      state: "awaiting-human",
      since: "2026-08-05T18:00:00.000Z",
      reason: "approval",
    },
  });

  await act(async () => {
    renderer = create(
      createElement(SidebarChatsSection, {
        sessions: [ordinary, leftHanging, archivedAttention, awaiting, overdue],
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

  const awaitingSection = sectionByLabel(renderer, "Awaiting you");
  expect(textContent(sectionCount(awaitingSection).children)).toBe("3");
  expect(sectionThreadTitles(awaitingSection)).toEqual([
    "Overdue approval",
    "Needs reply",
    "Follow up on branch",
  ]);
  expect(
    awaitingSection.findAll(
      (node) =>
        typeof node.type === "string"
        && typeof node.props.className === "string"
        && node.props.className.includes("cnav__thread--flat"),
    ),
  ).toHaveLength(3);

  const recencyTitles = renderer.root
    .findAll(
      (node) =>
        node.type === "section"
        && typeof node.props["aria-label"] === "string"
        && node.props["aria-label"] !== "Awaiting you"
        && node.props["aria-label"] !== "Pinned threads",
    )
    .flatMap(sectionThreadTitles);

  expect(recencyTitles).toContain("Low priority note");
  expect(recencyTitles).not.toContain("Overdue approval");
  expect(recencyTitles).not.toContain("Needs reply");
  expect(recencyTitles).not.toContain("Follow up on branch");
  expect(recencyTitles).not.toContain("Archived escalation");
  expect(recencyTitles.filter((title) => title === "Low priority note")).toHaveLength(1);

  await act(async () => renderer.unmount());
});

test("attention show-more keeps the flat modifier, focus ring, and click handler", async () => {
  let renderer!: ReactTestRenderer;
  const sessions = Array.from({ length: 7 }, (_, index) =>
    makeSession({
      id: `session-${index}`,
      title: `Needs reply ${index + 1}`,
      updated_at: `2026-08-05T19:5${index}:00.000Z`,
      attention: {
        state: "awaiting-human",
        since: "2026-08-05T19:00:00.000Z",
        reason: "reply",
      },
    }),
  );

  await act(async () => {
    renderer = create(
      createElement(SidebarChatsSection, {
        sessions,
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

  const awaitingSection = sectionByLabel(renderer, "Awaiting you");
  const showMore = awaitingSection.find(
    (node) => node.type === "button" && textContent(node.children) === "Show 1 more",
  );
  expect(showMore.props.className).toBe("cnav__more cnav__more--flat focus-ring");

  await act(async () => {
    showMore.props.onClick();
    await Promise.resolve();
  });

  expect(sectionThreadTitles(sectionByLabel(renderer, "Awaiting you"))).toHaveLength(7);

  await act(async () => renderer.unmount());
});

/** Walks up from a `cnav__thread-title` text match to its containing row
 *  (`.cnav__thread`) so a test can assert on the row's data-attention, active,
 *  and PR/runtime cues regardless of which row shape (ThreadRow vs the
 *  compact Pinned rail) rendered it. Scoped to `scope` (a section or the
 *  renderer root) so duplicate titles across sections resolve unambiguously. */
function rowContainerFor(scope: ReturnType<typeof sectionByLabel> | ReactTestRenderer["root"], title: string) {
  const titleNode = scope.find(
    (node) => typeof node.type === "string" && node.props.className?.split(" ").includes("cnav__thread-title") && node.props.title === title,
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

test("search drops the Awaiting you section but rows keep their visible label and accessible description", async () => {
  let renderer!: ReactTestRenderer;
  const overdue = makeSession({
    id: "session-overdue",
    title: "Overdue search target",
    updated_at: "2026-08-05T19:59:00.000Z",
    attention: { state: "overdue-human", since: "2026-08-03T20:00:00.000Z", reason: "approval" },
  });
  const ordinary = makeSession({
    id: "session-none",
    title: "Unrelated calm chat",
    updated_at: "2026-08-05T19:56:00.000Z",
    attention: { state: "none", since: null, reason: null },
  });

  await act(async () => {
    renderer = create(
      createElement(SidebarChatsSection, {
        sessions: [ordinary, overdue],
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

  // The search field went with the old search row (cave-fh9so), so there is no
  // longer a way to collapse the grouping from the UI. What this test is really
  // about is the attention data on the row, which is asserted below and is
  // unaffected — so the grouping expectation simply flips: "Awaiting you" is
  // always present now.
  const labels = sectionsByLabel(renderer).map((node) => node.props["aria-label"]);
  expect(labels).toContain("Awaiting you");

  const row = rowContainerFor(renderer.root, "Overdue search target");
  expect(row.props["data-attention"]).toBe("overdue-human");
  // Overdue AND gated on approval: the elapsed time does not change the word,
  // the gate does. data-attention still reports the underlying evidence.
  expect(row.props["data-attention-kind"]).toBe("blocked");
  expect(attentionCueLabels(row)).toEqual(["Blocked"]);

  const descriptionId = row.find(
    (node) => node.type === "button" && node.props.className === "cnav__thread-main focus-ring",
  ).props["aria-describedby"];
  expect(typeof descriptionId).toBe("string");
  const described = renderer.root.findAll((node) => typeof node.type === "string" && node.props.id === descriptionId);
  expect(described).toHaveLength(1);
  expect(textContent(described[0].children)).toContain("approval");

  await act(async () => renderer.unmount());
});

test("a pinned attention session appears once in Awaiting you, keeping active state, PR badge, and runtime cues", async () => {
  let renderer!: ReactTestRenderer;
  const session = makeSession({
    id: "session-pinned-attention",
    title: "Pinned and awaiting",
    status: "running",
    pullRequest: { repo: "o/r", number: 7, state: "open" },
    updated_at: "2026-08-05T19:59:00.000Z",
    attention: { state: "left-hanging", since: "2026-08-04T19:00:00.000Z", reason: "decision" },
  });
  sidebarPrefs.pinnedIds = [session.id];

  const railTitle = "Pinned and awaiting - PR #7 open";
  await act(async () => {
    renderer = create(
      createElement(SidebarChatsSection, {
        sessions: [session],
        familiars: [],
        responseNeeded: new Set(),
        activeSessionId: session.id,
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

  expect(sectionsByLabel(renderer).some((section) => section.props["aria-label"] === "Pinned threads")).toBe(false);
  const awaitingSection = sectionByLabel(renderer, "Awaiting you");
  expect(sectionThreadTitles(awaitingSection)).toEqual([railTitle]);

  const awaitingRow = rowContainerFor(awaitingSection, railTitle);
  expect(awaitingRow.props.className.split(" ")).toEqual(expect.arrayContaining(["cnav__thread", "cnav__thread--flat", "is-active"]));
  expect(awaitingRow.props["data-attention"]).toBe("left-hanging");
  expect(attentionCueLabels(awaitingRow)).toEqual(["Awaiting you"]);
  expect(
    awaitingRow.findAll(
      (node) =>
        typeof node.type === "string"
        && typeof node.props.className === "string"
        && node.props.className.split(" ").includes("cnav__tick")
        && node.props.className.split(" ").includes("cnav__dot--running"),
    ),
  ).toHaveLength(1);
  expect(
    awaitingRow.findAll((node) => typeof node.type === "string" && typeof node.props.className === "string" && node.props.className.split(" ").includes("cnav__pr-badge")),
  ).toHaveLength(1);
  expect(awaitingRow.findAll((node) => typeof node.type === "string" && node.props.className === "cnav__attention-tick")).toHaveLength(1);

  await act(async () => renderer.unmount());
});

// cave-zs85n Task 6 gap-fix: the runtime tick (failed/paused/running/queued)
// and the attention cue must remain SEPARATE, simultaneously-readable signals
// even on rows where .cnav__dot never renders (PR badge / branch glyph rows
// swap it out for the badge or the leading icon) — recoloring .cnav__tick
// from attention state used to erase the runtime signal entirely on exactly
// these rows.
test("a failed run with a PR badge keeps its danger runtime tick alongside a separate warning attention tick", async () => {
  let renderer!: ReactTestRenderer;
  const session = makeSession({
    id: "session-failed-pr",
    title: "Resolve PR #42",
    status: "failed",
    pullRequest: { repo: "o/r", number: 42, state: "open" },
    attention: { state: "left-hanging", since: "2026-08-04T19:00:00.000Z", reason: "decision" },
  });

  await act(async () => {
    renderer = create(
      createElement(SidebarChatsSection, {
        sessions: [session],
        familiars: [],
        responseNeeded: new Set(),
        activeSessionId: session.id,
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

  const awaitingRow = sectionByLabel(renderer, "Awaiting you");
  const row = rowContainerFor(awaitingRow, "Resolve PR #42 - PR #42 open");
  expect(row.props.className.split(" ")).toEqual(expect.arrayContaining(["cnav__thread", "cnav__thread--flat", "is-active"]));
  expect(row.props["data-attention"]).toBe("left-hanging");

  // The PR badge occupies .cnav__dot's slot — confirm it is actually present,
  // so the runtime tick assertion below is exercising the "dot absent" case
  // the bug report called out, not accidentally falling back to the dot.
  expect(
    row.findAll((node) => typeof node.type === "string" && typeof node.props.className === "string" && node.props.className.split(" ").includes("cnav__dot")),
  ).toHaveLength(0);
  expect(
    row.findAll((node) => typeof node.type === "string" && typeof node.props.className === "string" && node.props.className.split(" ").includes("cnav__pr-badge")),
  ).toHaveLength(1);

  // Runtime tick: still carries the failed/danger class, untouched by attention.
  const runtimeTick = row.find(
    (node) => typeof node.type === "string" && typeof node.props.className === "string" && node.props.className.split(" ")[0] === "cnav__tick",
  );
  expect(runtimeTick.props.className.split(" ")).toEqual(expect.arrayContaining(["cnav__tick", "cnav__dot--failed"]));

  // Attention tick: a distinct element/class, never merged onto the runtime tick.
  const attentionTicks = row.findAll(
    (node) => typeof node.type === "string" && node.props.className === "cnav__attention-tick",
  );
  expect(attentionTicks).toHaveLength(1);
  expect(attentionCueLabels(row)).toEqual(["Awaiting you"]);

  await act(async () => renderer.unmount());
});

test("a paused run with a branch glyph keeps its runtime tick alongside a separate attention tick when overdue", async () => {
  let renderer!: ReactTestRenderer;
  const session = makeSession({
    id: "session-paused-branch",
    title: "Rebase feature branch",
    status: "paused",
    attention: { state: "overdue-human", since: "2026-08-03T19:00:00.000Z", reason: "approval" },
  });

  await act(async () => {
    renderer = create(
      createElement(SidebarChatsSection, {
        sessions: [session],
        familiars: [],
        responseNeeded: new Set(),
        activeSessionId: session.id,
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

  const awaitingRow = sectionByLabel(renderer, "Awaiting you");
  const row = rowContainerFor(awaitingRow, "Rebase feature branch");
  expect(row.props.className.split(" ")).toEqual(expect.arrayContaining(["cnav__thread", "cnav__thread--flat", "is-active"]));
  expect(row.props["data-attention"]).toBe("overdue-human");

  // The title-heuristic branch glyph occupies .cnav__dot's slot too — same
  // "dot absent" shape as the PR-badge row above, via a different leading
  // element (threadLeadingIcon's icon rather than ThreadPrBadge). With no PR
  // badge on this session, `prStatus ? null : leadGlyph ? <Icon/> : <dot/>`
  // only has one path left to explain a missing dot: the branch glyph fired.
  expect(
    row.findAll((node) => typeof node.type === "string" && typeof node.props.className === "string" && node.props.className.split(" ").includes("cnav__dot")),
  ).toHaveLength(0);

  const runtimeTick = row.find(
    (node) => typeof node.type === "string" && typeof node.props.className === "string" && node.props.className.split(" ")[0] === "cnav__tick",
  );
  expect(runtimeTick.props.className.split(" ")).toEqual(expect.arrayContaining(["cnav__tick", "cnav__dot--paused"]));

  const attentionTicks = row.findAll(
    (node) => typeof node.type === "string" && node.props.className === "cnav__attention-tick",
  );
  expect(attentionTicks).toHaveLength(1);
  // overdue-human + an `approval` gate: Blocked. The tick stays a separate
  // structural channel from the runtime tick either way — that separation is
  // what this test guards, and it is unchanged.
  expect(attentionCueLabels(row)).toEqual(["Blocked"]);

  await act(async () => renderer.unmount());
});

test("the embedded chat list never surfaces archived sessions", async () => {
  // These two tests used to flip the rail's own "Show archived" option and then
  // assert how an archived-but-pinned row renders. That option went with the
  // search row (cave-fh9so), and `showArchived` is a constant `false` here now,
  // so the opt-in state is unreachable in this component. The contract it
  // replaces is stronger and worth pinning: the embedded list never shows an
  // archived session at all.
  //
  // Archived chats stay reachable — ChatList keeps its own showArchived state
  // and includeArchived fetch on the Sessions list view. What was removed was
  // the rail's duplicate of that control, not the capability.
  const archivedPinned = makeSession({
    id: "archived-pinned",
    title: "Archived but pinned",
    archived_at: new Date().toISOString(),
    attention: { state: "none", since: null, reason: null },
  });

  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      createElement(SidebarChatsSection, {
        sessions: [archivedPinned],
        onOpenSession: () => undefined,
        onDeleteSession: async () => undefined,
      }),
    );
    await Promise.resolve();
  });

  expect(
    renderer.root.findAll(
      (node) => typeof node.type === "string" && node.props.onSelect && textContent(node.children) === "Show archived",
    ),
  ).toHaveLength(0);

  const titles = renderer.root
    .findAll((node) => typeof node.type === "string" && node.props.className?.split(" ").includes("cnav__thread-title"))
    .map((node) => textContent(node.findByProps({ className: "sr-only" }).children));
  expect(titles).not.toContain("Archived but pinned");

  await act(async () => renderer.unmount());
});

test("narrow sidebar width never hides the attention label (only the project tile collapses)", () => {
  const narrowBlock = extractBraceBlock(css, "@container cnav (max-width: 212px)");
  assert.match(
    narrowBlock,
    /\.cnav__thread-proj\s*\{[\s\S]*?display:\s*none;/,
    "narrow width still collapses the project tile",
  );
  assert.match(narrowBlock, /\.cnav__attention\s*\{/, "narrow width rule still touches .cnav__attention");
  assert.doesNotMatch(
    narrowBlock,
    /\.cnav__attention\s*\{[^}]*display:\s*none/,
    "the attention label must stay visible (never display:none) at narrow widths",
  );
});

const flatThreadBlock = extractBraceBlock(css, ".cnav__thread--flat .cnav__thread-main");
assert.match(flatThreadBlock, /padding-left:\s*var\(--space-3\);/, "flat attention rows should align to the space-3 token");
assert.doesNotMatch(flatThreadBlock, /13px/, "flat row padding should not use 13px");

const flatMoreBlock = extractBraceBlock(css, ".cnav__more--flat");
assert.match(flatMoreBlock, /padding-left:\s*var\(--space-3\);/, "flat show-more buttons should align to the same space-3 token");
assert.doesNotMatch(flatMoreBlock, /13px/, "flat show-more padding should not use 13px");

console.log("workspace-sidebar-attention: ok");


test("pinned settled chats appear once and remain individually selectable", async () => {
  const session = makeSession({ id: "pinned-settled", title: "Pinned settled", attention: { state: "none", since: null, reason: null } });
  const other = makeSession({ id: "other", title: "Another chat", attention: { state: "none", since: null, reason: null } });
  sidebarPrefs.pinnedIds = [session.id];
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(SidebarChatsSection, {
    sessions: [session, other], onOpenSession: vi.fn(), onDeleteSession: async () => undefined,
  })); });
  const buttons = () => renderer.root.findAll((n) => n.type === "button" && n.props.className === "cnav__thread-main focus-ring");
  expect(buttons()).toHaveLength(2);
  await act(async () => renderer.root.find((n) => n.type === "button" && n.props.className === "cnav__select-enter focus-ring").props.onClick());
  const pinned = buttons().find((n) => textContent(n.children).includes("Pinned settled"));
  expect(pinned.props.role).toBe("checkbox");
  await act(async () => pinned.props.onClick({}));
  expect(buttons().find((n) => textContent(n.children).includes("Pinned settled")).props["aria-checked"]).toBe(true);
  await act(async () => renderer.unmount());
});
