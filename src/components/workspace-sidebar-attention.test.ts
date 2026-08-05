// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const sidebar = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/globals/shell-navigation.css", import.meta.url), "utf8");

assert.match(
  sidebar,
  /const attentionSessions = useMemo\(\s*\(\) =>\s*visibleSessions\s*\.filter\(\(session\) => session\.attention\.state !== "none" && !session\.archived_at\)\s*\.sort\(compareChatAttention\)/,
  "attentionSessions should derive from visible non-archived rows and sort by compareChatAttention",
);
assert.match(
  sidebar,
  /const attentionIds = useMemo\(\(\) => new Set\(attentionSessions\.map\(\(session\) => session\.id\)\), \[attentionSessions\]\);/,
  "attention ids should memoize the promoted rows",
);
assert.match(
  sidebar,
  /const recentSessions = useMemo\(\(\) => \{[\s\S]*?const rows = hasSearch \? visibleSessions : visibleSessions\.filter\(\(session\) => !attentionIds\.has\(session\.id\)\);[\s\S]*?return rows\.filter\(\(s\) => sessionRailTitle\(s\)\.toLowerCase\(\)\.includes\(q\)\);[\s\S]*?\}, \[visibleSessions, query, hasSearch, attentionIds\]\);/,
  "ordinary recent rows should drop promoted attention ids unless search is active",
);
assert.match(
  sidebar,
  /const attentionState = archived \? "none" : session\.attention\.state;[\s\S]*?chatAttentionLabel\(attentionState\)/,
  "ThreadRow should derive the visible attention label from the shared helper",
);
assert.match(
  sidebar,
  /archived \? null : chatAttentionDescription\(session\.attention, now\)/,
  "ThreadRow should derive the detailed attention description from the shared helper",
);
assert.match(
  sidebar,
  /const attentionState = archived \? "none" : session\.attention\.state;[\s\S]*?data-attention=\{attentionState\}/,
  "ThreadRow rows should expose their attention state to CSS",
);
assert.match(
  sidebar,
  /aria-describedby=\{attentionDescription \? attentionDescriptionId : undefined\}/,
  "attention rows should describe the row button only when a dedicated detailed description exists",
);
assert.match(
  sidebar,
  /\{attentionLabel \? \([\s\S]*?<span className="cnav__attention">[\s\S]*?<span className="cnav__attention-dot" aria-hidden \/>[\s\S]*?<span>\{attentionLabel\}<\/span>[\s\S]*?<\/span>[\s\S]*?\) : null\}/,
  "attention rows should keep the visible attention state inside the row button",
);
assert.doesNotMatch(
  sidebar,
  /<span id=\{attentionDescriptionId\} className="cnav__attention">[\s\S]*?<span className="sr-only">/,
  "the described target must no longer be nested in the visible attention label inside the button",
);
assert.match(
  sidebar,
  /<\/button>\s*\{attentionDescription \? \(\s*<span id=\{attentionDescriptionId\} className="sr-only">\{attentionDescription\}<\/span>\s*\) : null\}/,
  "the detailed attention description should render as a sibling after the row button",
);
assert.match(
  sidebar,
  /function groupMeta\(group: ChatProjectGroup, now: number\): string \{[\s\S]*?const awaiting = group\.sessions\.filter\(\(session\) => session\.attention\.state !== "none" && !session\.archived_at\)\.length;[\s\S]*?return awaiting > 0 \? `\$\{awaiting\} awaiting · \$\{meta\}` : meta;/,
  "project group metadata should prefix a nonzero awaiting count",
);
const recentViewBlock = sidebar.match(/\{view === "recent" \? \([\s\S]*?\) : visibleGroups\.length === 0 \?/);
assert.ok(recentViewBlock, "recent view block should exist");
assert.match(
  recentViewBlock[0],
  /!hasSearch && attentionSessions\.length > 0[\s\S]*?<section aria-label="Awaiting you">[\s\S]*?<\/section>[\s\S]*?recentBuckets\.map/,
  "Awaiting you should render as a real labeled section before ordinary recent buckets only when search is inactive",
);
assert.match(
  recentViewBlock[0],
  /!hasSearch && attentionSessions\.length > 0 \? \(/,
  "search results should keep row cues without creating a separate attention section",
);

for (const state of ["left-hanging", "awaiting-human", "overdue-human"]) {
  assert.match(
    css,
    new RegExp(`\\.cnav__thread\\[data-attention="${state}"\\]`),
    `shell navigation should style ${state} rows`,
  );
}
assert.match(css, /\.cnav__attention\s*\{[\s\S]*?color:\s*var\(--color-warning\);/, "attention label should use warning text by default");
assert.match(css, /\.cnav__attention-dot\s*\{[\s\S]*?background:\s*var\(--color-warning\);/, "attention dot should use warning by default");
assert.match(css, /data-attention="left-hanging"[\s\S]*color-mix\(in oklch, var\(--color-warning\) 7%, transparent\)/, "left-hanging should use the subtle warning tint");
assert.match(css, /data-attention="awaiting-human"[\s\S]*color-mix\(in oklch, var\(--color-warning\) 14%, transparent\)/, "awaiting-human should use the warning fill tint");
assert.match(css, /data-attention="awaiting-human"[\s\S]*color-mix\(in oklch, var\(--color-warning\) (3[0-9]|4[0-5])%, var\(--border-hairline\)\)/, "awaiting-human should derive its warning border from color-mix");
assert.match(css, /data-attention="overdue-human"[\s\S]*background:\s*var\(--danger-bg\);/, "overdue-human should use the existing danger background token");
assert.match(css, /data-attention="overdue-human"[\s\S]*border-color:\s*var\(--danger-border\);/, "overdue-human should use the existing danger border token");
assert.match(css, /data-attention="overdue-human"[\s\S]*\.cnav__attention[\s\S]*color:\s*var\(--danger-text\);/, "overdue-human attention copy should use the danger text token");
assert.match(
  sidebar,
  /className="cnav__more cnav__more--flat focus-ring"/,
  "flat recent sections should use the semantic show-more modifier without dropping focus-ring",
);
assert.doesNotMatch(
  sidebar,
  /\[padding-left:13px\]!/,
  "show-more buttons should not keep the arbitrary 13px padding escape hatch",
);

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
vi.mock("@/lib/use-minute-tick", () => ({ useMinuteTick: () => 0 }));
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

function sectionCount(section: ReturnType<typeof sectionByLabel>) {
  return section.find(
    (node) => typeof node.type === "string" && node.props.className === "cnav__label-count",
  );
}

function sectionThreadTitles(section: ReturnType<typeof sectionByLabel>) {
  return section
    .findAll((node) => typeof node.type === "string" && node.props.className === "cnav__thread-title")
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
      createElement(WorkspaceSidebar, {
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
  expect(buttonText).toContain("Awaiting you");
  expect(buttonText).not.toContain("approval");
  expect(buttonText).not.toContain("1 hour ago");
  expect(buttonText.match(/Awaiting you/g) ?? []).toHaveLength(1);
  expect(button.findAll((node) => typeof node.type === "string" && node.props.id === descriptionId)).toHaveLength(0);

  const describedNodes = renderer.root.findAll((node) => typeof node.type === "string" && node.props.id === descriptionId);
  expect(describedNodes).toHaveLength(1);
  expect(textContent(describedNodes[0].children)).toBe("For approval since 1 hour ago.");

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
      createElement(WorkspaceSidebar, {
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
      createElement(WorkspaceSidebar, {
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

const flatThreadBlock = extractBraceBlock(css, ".cnav__thread--flat .cnav__thread-main");
assert.match(flatThreadBlock, /padding-left:\s*var\(--space-3\);/, "flat attention rows should align to the space-3 token");
assert.doesNotMatch(flatThreadBlock, /13px/, "flat row padding should not use 13px");

const flatMoreBlock = extractBraceBlock(css, ".cnav__more--flat");
assert.match(flatMoreBlock, /padding-left:\s*var\(--space-3\);/, "flat show-more buttons should align to the same space-3 token");
assert.doesNotMatch(flatMoreBlock, /13px/, "flat show-more padding should not use 13px");

console.log("workspace-sidebar-attention: ok");
