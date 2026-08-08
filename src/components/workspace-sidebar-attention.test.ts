// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CHAT_SIDEBAR_VIEW_KEY } from "@/lib/chat-session-prefs";
import { relativeTime } from "@/lib/relative-time";

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
// Attention derivation is centralized in one helper (resolveThreadAttention)
// and one cue component (ThreadAttentionCue) so ThreadRow's full row and the
// compact Pinned rail can never drift into divergent state/label/description
// or markup for the same session — see cave-zs85n Task 6 gap-fix notes.
assert.match(
  sidebar,
  /function statusDotClass\(status: string\): string \{\s*if \(status === "running"\) return "cnav__dot--running";\s*if \(status === "failed"\) return "cnav__dot--failed";\s*if \(status === "queued"\) return "cnav__dot--queued";\s*if \(status === "paused"\) return "cnav__dot--paused";\s*return "";\s*\}/,
  "statusDotClass should emit the shared semantic runtime modifier classes instead of raw utility colours",
);
assert.match(
  sidebar,
  /function resolveThreadAttention\([\s\S]*?const state: ChatAttentionState = archived \? "none" : session\.attention\.state;[\s\S]*?label: chatAttentionLabel\(state\),[\s\S]*?description: archived \? null : chatAttentionDescription\(session\.attention, now\),/,
  "resolveThreadAttention should centralize the archived-suppression rule and derive label/description from the shared chat-attention helpers",
);
const resolveThreadAttentionCallSites = sidebar.match(
  /const \{ state: attentionState, label: attentionLabel, description: attentionDescription \} = resolveThreadAttention\(\s*session,\s*archived,\s*now,\s*\);/g,
) ?? [];
assert.equal(
  resolveThreadAttentionCallSites.length,
  2,
  "both ThreadRow and PinnedThreadRow should derive attention through the shared resolveThreadAttention helper (not a re-derived copy)",
);
const dataAttentionSites = sidebar.match(/data-attention=\{attentionState\}/g) ?? [];
assert.equal(
  dataAttentionSites.length,
  2,
  "both ThreadRow's row and the Pinned rail's row should expose their resolved attention state to CSS",
);
assert.match(
  sidebar,
  /aria-describedby=\{attentionDescription \? attentionDescriptionId : undefined\}/,
  "attention rows should describe the row button only when a dedicated detailed description exists",
);
assert.match(
  sidebar,
  /function ThreadAttentionCue\(\{ label \}: \{ label: string \| null \}\) \{\s*if \(!label\) return null;\s*return \(\s*<span className="cnav__attention">\s*<span className="cnav__attention-dot" aria-hidden \/>\s*<span>\{label\}<\/span>\s*<\/span>\s*\);\s*\}/,
  "the shared ThreadAttentionCue component should render the dot + label exactly once",
);
assert.match(
  sidebar,
  /\{project \? \(\s*<span className="cnav__thread-proj" title=\{project\.name\}>\s*<ProjectAvatar name=\{project\.name\} root=\{project\.root\} color=\{project\.color\} size="sm" \/>\s*<\/span>\s*\) : null\}\s*\{project \? <span className="sr-only">\{`Project \$\{project\.name\} `\}<\/span> : null\}/,
  "flat ThreadRow rows should keep one persistent sr-only project context outside the collapsible project tile",
);
const threadAttentionCueCallSites = sidebar.match(/<ThreadAttentionCue label=\{attentionLabel\} \/>/g) ?? [];
assert.equal(
  threadAttentionCueCallSites.length,
  2,
  "both ThreadRow and PinnedThreadRow should render the visible attention cue through the shared ThreadAttentionCue component",
);
assert.doesNotMatch(
  sidebar,
  /<span id=\{attentionDescriptionId\} className="cnav__attention">[\s\S]*?<span className="sr-only">/,
  "the described target must no longer be nested in the visible attention label inside the button",
);
const descriptionSiblingSites = sidebar.match(
  /<\/button>\s*\{attentionDescription \? \(\s*<span id=\{attentionDescriptionId\} className="sr-only">\{attentionDescription\}<\/span>\s*\) : null\}/g,
) ?? [];
assert.equal(
  descriptionSiblingSites.length,
  2,
  "the detailed attention description should render as a sibling after the row button in both row shapes",
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
// cave-zs85n Task 6 gap-fix: attention must never repaint the RUNTIME tick.
// Previously `.cnav__thread[data-attention="…"] .cnav__tick` selectors won
// the cascade over the tick's own status colour (failed/paused/running/
// queued), silently erasing runtime state on any attention-bearing row —
// including PR-badge/branch-glyph rows where .cnav__dot never renders at
// all, so the tick was the only runtime signal left. Attention gets its own
// structural channel (.cnav__attention-tick) instead of recolouring the
// shared one.
assert.doesNotMatch(
  css,
  /\.cnav__thread\[data-attention="[^"]+"\]\s*\.cnav__tick/,
  "attention selectors must not recolor the runtime .cnav__tick — use .cnav__attention-tick instead",
);
assert.match(
  css,
  /\.cnav__attention-tick\s*\{[\s\S]*?background:\s*var\(--color-warning\);/,
  "the attention tick should default to warning (left-hanging/awaiting-human)",
);
assert.match(
  css,
  /\.cnav__thread\.is-active\s+\.cnav__tick\s*\{[\s\S]*?left:\s*var\(--space-3\);[\s\S]*?opacity:\s*1;/,
  "active rows should keep the runtime tick visible by shifting it inboard of the active accent",
);
const prRowClassSites = sidebar.match(/\$\{prStatus \? " cnav__thread--pr" : ""\}/g) ?? [];
assert.equal(
  prRowClassSites.length,
  2,
  "full and pinned rows should expose the semantic PR modifier used by the active-row gutter",
);
assert.match(
  css,
  /\.cnav__thread\.is-active\.cnav__thread--pr::before\s*\{[\s\S]*?left:\s*0;/,
  "an active PR row should move selection to the outer gutter without changing non-PR rows",
);
assert.match(
  css,
  /\.cnav__thread\.is-active\.cnav__thread--pr\s+\.cnav__tick\s*\{[\s\S]*?left:\s*var\(--space-1\);/,
  "an active PR row should keep runtime in a token-aligned gutter before its badge",
);
assert.match(
  css,
  /\.cnav__thread\.is-active\.cnav__thread--pr:not\(\[data-attention="none"\]\)\s+\.cnav__tick\s*\{[\s\S]*?left:\s*var\(--space-2\);/,
  "an active PR attention row should move runtime one grid step past attention",
);
assert.match(
  css,
  /\.cnav__thread--flat\.is-active\.cnav__thread--pr:not\(\[data-attention="none"\]\)\s+\.cnav__pr-badge\s*\{[\s\S]*?margin-left:\s*var\(--space-3\);/,
  "an active flat PR attention row should reserve three token-aligned cue gutters before its badge",
);
assert.match(
  css,
  /\.cnav__thread\.is-active::before\s*\{[\s\S]*?background:\s*var\(--accent-presence\);/,
  "active rows should retain their separate accent marker",
);
assert.match(
  css,
  /data-attention="overdue-human"[\s\S]*\.cnav__attention-tick[\s\S]*background:\s*var\(--danger-text\);/,
  "overdue-human should escalate the attention tick to danger",
);
const attentionTickBlock = extractBraceBlock(css, ".cnav__attention-tick {");
assert.doesNotMatch(attentionTickBlock, /animation|@keyframes|pulse/i, "the attention tick must never animate");
assert.match(attentionTickBlock, /left:\s*var\(--space-1\);/, "the attention tick should position off a spacing token, not a hardcoded off-grid pixel value");
assert.match(attentionTickBlock, /top:\s*var\(--space-2\);/, "the attention tick's vertical inset should use a spacing token");
assert.match(attentionTickBlock, /bottom:\s*var\(--space-2\);/, "the attention tick's vertical inset should use a spacing token");
assert.match(
  sidebar,
  /\{attentionState !== "none" \? <span className="cnav__attention-tick" aria-hidden \/> : null\}/,
  "the attention tick should render as its own conditional element, absent (not just hidden) for none/archived rows",
);
const attentionTickCallSites = sidebar.match(/<span className="cnav__attention-tick" aria-hidden \/>/g) ?? [];
assert.equal(
  attentionTickCallSites.length,
  2,
  "both ThreadRow and PinnedThreadRow should render the shared attention-tick channel",
);

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

// Controllable per-test prefs: which sessions are pinned, and which organize
// view ("recent" | "projects") the sidebar should hydrate on mount — mirrors
// the real localStorage-backed hooks (chat-session-prefs.ts) without touching
// jsdom's localStorage.
const sidebarPrefs = vi.hoisted(() => ({
  pinnedIds: [] as string[],
  view: null as string | null,
}));

vi.mock("@/lib/use-focus-trap", () => ({ useFocusTrap: () => undefined }));
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
    .findAll((node) => typeof node.type === "string" && node.props.className === "cnav__thread-title")
    .map((node) => textContent(node.children));
}

function attentionCueLabels(section: ReturnType<typeof sectionByLabel>) {
  return section
    .findAll((node) => typeof node.type === "string" && node.props.className === "cnav__attention")
    .map((node) => textContent(node.children));
}

function groupNameNodes(renderer: ReactTestRenderer) {
  return renderer.root.findAll((node) => typeof node.type === "string" && node.props.className === "cnav__group-name");
}

function groupMetaText(renderer: ReactTestRenderer, index: number) {
  const nodes = renderer.root.findAll(
    (node) => typeof node.type === "string" && node.props.className === "cnav__group-meta",
  );
  return textContent(nodes[index]?.children);
}

function searchInput(renderer: ReactTestRenderer) {
  return renderer.root.find(
    (node) => node.type === "input" && node.props["aria-label"] === "Search projects and threads",
  );
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
      getItem: (key: string) => (key === CHAT_SIDEBAR_VIEW_KEY ? sidebarPrefs.view : null),
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
  sidebarPrefs.view = null;
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
  expect(buttonText).toContain(relativeTime(session.updated_at, new Date("2026-08-05T20:00:00.000Z"), "bare"));
  expect(buttonText).toContain("Awaiting you");
  expect(buttonText).not.toContain("approval");
  expect(buttonText).not.toContain("1 hour ago");
  expect(buttonText.match(/Awaiting you/g) ?? []).toHaveLength(1);
  expect(button.findAll((node) => typeof node.type === "string" && node.props.id === descriptionId)).toHaveLength(0);

  const describedNodes = renderer.root.findAll((node) => typeof node.type === "string" && node.props.id === descriptionId);
  expect(describedNodes).toHaveLength(1);
  expect(textContent(describedNodes[0].children)).toBe("Awaiting you for approval since 1 hour ago.");

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
      createElement(WorkspaceSidebar, {
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
    ["Pinned threads", sectionByLabel(renderer, "Pinned threads")],
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
    expect(textContent(button.children)).toContain("Awaiting you");
    expect(textContent(button.children)).not.toContain("for approval");
    expect(textContent(button.children)).not.toContain("1 hour ago");

    const described = renderer.root.findAll(
      (node) => typeof node.type === "string" && node.props.id === descriptionId,
    );
    expect(described).toHaveLength(1);
    expect(textContent(described[0].children)).toBe("Awaiting you for approval since 1 hour ago.");
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

/** Walks up from a `cnav__thread-title` text match to its containing row
 *  (`.cnav__thread`) so a test can assert on the row's data-attention, active,
 *  and PR/runtime cues regardless of which row shape (ThreadRow vs the
 *  compact Pinned rail) rendered it. Scoped to `scope` (a section or the
 *  renderer root) so duplicate titles across sections resolve unambiguously. */
function rowContainerFor(scope: ReturnType<typeof sectionByLabel> | ReactTestRenderer["root"], title: string) {
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

test("Projects view preserves latest-activity folder order and surfaces awaiting counts and row cues", async () => {
  let renderer!: ReactTestRenderer;
  sidebarPrefs.view = "projects";

  const zetaAwaiting = makeSession({
    id: "zeta-awaiting",
    project_root: "/repo/zeta",
    title: "Zeta needs a decision",
    updated_at: "2026-08-05T19:59:00.000Z",
    attention: { state: "awaiting-human", since: "2026-08-05T19:00:00.000Z", reason: "approval" },
  });
  const zetaCalm = makeSession({
    id: "zeta-calm",
    project_root: "/repo/zeta",
    title: "Zeta housekeeping",
    updated_at: "2026-08-05T19:50:00.000Z",
    attention: { state: "none", since: null, reason: null },
  });
  const alphaCalm = makeSession({
    id: "alpha-calm",
    project_root: "/repo/alpha",
    title: "Alpha routine chat",
    updated_at: "2026-08-05T10:00:00.000Z",
    attention: { state: "none", since: null, reason: null },
  });

  await act(async () => {
    renderer = create(
      createElement(WorkspaceSidebar, {
        sessions: [alphaCalm, zetaCalm, zetaAwaiting],
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

  // The project with the most recent activity (zeta) sorts first — folder
  // order is untouched by attention, only by recency (deriveChatProjectGroups).
  const names = groupNameNodes(renderer).map((node) => textContent(node.children));
  expect(names).toEqual(["zeta", "alpha"]);

  expect(groupMetaText(renderer, 0)).toMatch(/^1 awaiting · /);
  expect(groupMetaText(renderer, 1)).not.toMatch(/awaiting/);

  const awaitingRow = rowContainerFor(renderer.root, "Zeta needs a decision");
  expect(awaitingRow.props["data-attention"]).toBe("awaiting-human");
  expect(attentionCueLabels(awaitingRow)).toEqual(["Awaiting you"]);

  const calmRow = rowContainerFor(renderer.root, "Zeta housekeeping");
  expect(calmRow.props["data-attention"]).toBe("none");
  expect(attentionCueLabels(calmRow)).toEqual([]);

  await act(async () => renderer.unmount());
});

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
      createElement(WorkspaceSidebar, {
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

  await act(async () => {
    searchInput(renderer).props.onChange({ target: { value: "search target" } });
    await Promise.resolve();
  });

  const labels = sectionsByLabel(renderer).map((node) => node.props["aria-label"]);
  expect(labels).not.toContain("Awaiting you");

  const row = rowContainerFor(renderer.root, "Overdue search target");
  expect(row.props["data-attention"]).toBe("overdue-human");
  expect(attentionCueLabels(row)).toEqual(["Still waiting"]);

  const descriptionId = row.find(
    (node) => node.type === "button" && node.props.className === "cnav__thread-main focus-ring",
  ).props["aria-describedby"];
  expect(typeof descriptionId).toBe("string");
  const described = renderer.root.findAll((node) => typeof node.type === "string" && node.props.id === descriptionId);
  expect(described).toHaveLength(1);
  expect(textContent(described[0].children)).toContain("approval");

  await act(async () => renderer.unmount());
});

test("a pinned attention session appears in both Pinned and Awaiting you, keeping active state, PR badge, and runtime cues", async () => {
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
      createElement(WorkspaceSidebar, {
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

  const pinnedSection = sectionByLabel(renderer, "Pinned threads");
  const awaitingSection = sectionByLabel(renderer, "Awaiting you");
  expect(sectionThreadTitles(pinnedSection)).toEqual([railTitle]);
  expect(sectionThreadTitles(awaitingSection)).toEqual([railTitle]);

  // The Pinned rail's compact row: active, attention-tinted, PR-badged, AND
  // still carries its distinct one-click unpin control (not ThreadRow's
  // row-actions overlay). Pin these directly against the Pinned section's own
  // row — not just its Awaiting you twin below — so a regression that only
  // strips the tick/runtime cue from PinnedThreadRow can't hide behind the
  // duplicate assertions on the ThreadRow copy (cave-zs85n Task 6 gap-fix).
  const pinnedRow = rowContainerFor(pinnedSection, railTitle);
  expect(pinnedRow.props.className.split(" ")).toEqual(expect.arrayContaining(["cnav__thread", "cnav__thread--flat", "is-active"]));
  expect(pinnedRow.props["data-attention"]).toBe("left-hanging");
  expect(attentionCueLabels(pinnedRow)).toEqual(["Left hanging"]);
  expect(
    pinnedRow.findAll(
      (node) =>
        typeof node.type === "string"
        && typeof node.props.className === "string"
        && node.props.className.split(" ").includes("cnav__tick")
        && node.props.className.split(" ").includes("cnav__dot--running"),
    ),
  ).toHaveLength(1);
  expect(
    pinnedRow.findAll((node) => typeof node.type === "string" && typeof node.props.className === "string" && node.props.className.split(" ").includes("cnav__pr-badge") && node.props["data-pr-state"] === "open"),
  ).toHaveLength(1);
  expect(pinnedRow.findAll((node) => typeof node.type === "string" && node.props.className === "cnav__attention-tick")).toHaveLength(1);
  const unpinButton = pinnedRow.find((node) => node.type === "button" && node.props["aria-label"] === `Unpin ${railTitle}`);
  expect(unpinButton.props["aria-pressed"]).toBe(true);

  // The full ThreadRow in Awaiting you keeps its own runtime tick and PR badge
  // alongside the same attention cue — the two row shapes render the same
  // attention state without diverging.
  const awaitingRow = rowContainerFor(awaitingSection, railTitle);
  expect(awaitingRow.props.className.split(" ")).toEqual(expect.arrayContaining(["cnav__thread", "cnav__thread--flat", "is-active"]));
  expect(awaitingRow.props["data-attention"]).toBe("left-hanging");
  expect(attentionCueLabels(awaitingRow)).toEqual(["Left hanging"]);
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
      createElement(WorkspaceSidebar, {
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
  expect(attentionCueLabels(row)).toEqual(["Left hanging"]);

  await act(async () => renderer.unmount());
});

test("a paused run with a branch glyph keeps its runtime tick alongside a separate danger attention tick when overdue", async () => {
  let renderer!: ReactTestRenderer;
  const session = makeSession({
    id: "session-paused-branch",
    title: "Rebase feature branch",
    status: "paused",
    attention: { state: "overdue-human", since: "2026-08-03T19:00:00.000Z", reason: "approval" },
  });

  await act(async () => {
    renderer = create(
      createElement(WorkspaceSidebar, {
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
  expect(attentionCueLabels(row)).toEqual(["Still waiting"]);

  await act(async () => renderer.unmount());
});

test("a pinned archived session mutes to is-archived in the Pinned rail and drops its attention cue", async () => {
  let renderer!: ReactTestRenderer;
  const session = makeSession({
    id: "session-pinned-archived",
    title: "Archived but pinned",
    status: "idle",
    archived_at: "2026-08-05T18:00:00.000Z",
    updated_at: "2026-08-05T18:00:00.000Z",
    attention: { state: "awaiting-human", since: "2026-08-05T17:00:00.000Z", reason: "approval" },
  });
  sidebarPrefs.pinnedIds = [session.id];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, sessions: [session] }) })),
  );

  await act(async () => {
    renderer = create(
      createElement(WorkspaceSidebar, {
        sessions: [],
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

  // Flip the sidepanel's own "Show archived" option (the Popover mocks render
  // their children unconditionally, so the menu item is reachable without
  // simulating the trigger click first) — this is what makes an archived
  // pinned row's visibility possible at all: pinnedSessions only ever derives
  // from visibleSessions, which drops archived_at rows unless this is on.
  const showArchivedItem = renderer.root.find(
    (node) => typeof node.type === "string" && node.props.onSelect && textContent(node.children) === "Show archived",
  );
  await act(async () => {
    showArchivedItem.props.onSelect();
    await Promise.resolve();
    await Promise.resolve();
  });

  const pinnedSection = sectionByLabel(renderer, "Pinned threads");
  expect(sectionThreadTitles(pinnedSection)).toEqual(["Archived but pinned"]);

  // Same regression guard as the pinned-attention test above: pin the
  // archive class and cue-suppression directly against the Pinned section's
  // own row, not a ThreadRow stand-in — a pinned session reaching "Show
  // archived" must read exactly as muted/settled as its full ThreadRow twin
  // does (cave-zs85n Task 6 gap-fix).
  const pinnedRow = rowContainerFor(pinnedSection, "Archived but pinned");
  expect(pinnedRow.props.className.split(" ")).toEqual(
    expect.arrayContaining(["cnav__thread", "cnav__thread--flat", "is-archived"]),
  );
  expect(pinnedRow.props["data-attention"]).toBe("none");
  expect(attentionCueLabels(pinnedRow)).toEqual([]);
  expect(
    pinnedRow.findAll(
      (node) => typeof node.type === "string" && typeof node.props.className === "string" && node.props.className.includes("cnav__tick"),
    ),
  ).toHaveLength(1);

  await act(async () => renderer.unmount());
});

test("an archived PR session shows archive semantics instead of a live PR badge in both pinned and full rows", async () => {
  let renderer!: ReactTestRenderer;
  const session = makeSession({
    id: "session-archived-pr",
    title: "Archived PR thread",
    status: "idle",
    project_root: "/repo/alpha",
    archived_at: "2026-08-05T18:00:00.000Z",
    updated_at: "2026-08-05T18:00:00.000Z",
    pullRequest: { repo: "o/r", number: 42, state: "open" },
    attention: { state: "awaiting-human", since: "2026-08-05T17:00:00.000Z", reason: "approval" },
  });
  sidebarPrefs.pinnedIds = [session.id];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, sessions: [session] }) })),
  );

  await act(async () => {
    renderer = create(
      createElement(WorkspaceSidebar, {
        sessions: [],
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

  const showArchivedItem = renderer.root.find(
    (node) => typeof node.type === "string" && node.props.onSelect && textContent(node.children) === "Show archived",
  );
  await act(async () => {
    showArchivedItem.props.onSelect();
    await Promise.resolve();
    await Promise.resolve();
  });

  const pinnedSection = sectionByLabel(renderer, "Pinned threads");
  const todaySection = sectionByLabel(renderer, "Today");
  expect(sectionThreadTitles(pinnedSection)).toEqual(["Archived PR thread"]);
  expect(sectionThreadTitles(todaySection)).toEqual(["Archived PR thread"]);

  for (const row of [
    rowContainerFor(pinnedSection, "Archived PR thread"),
    rowContainerFor(todaySection, "Archived PR thread"),
  ]) {
    expect(row.props.className.split(" ")).toEqual(expect.arrayContaining(["cnav__thread", "is-archived"]));
    expect(row.props["data-attention"]).toBe("none");
    expect(attentionCueLabels(row)).toEqual([]);
    expect(
      row.findAll(
        (node) => typeof node.type === "string" && typeof node.props.className === "string" && node.props.className.split(" ").includes("cnav__pr-badge"),
      ),
    ).toHaveLength(0);
    expect(
      row.findAll(
        (node) =>
          typeof node.type === "string" &&
          typeof node.props.className === "string" &&
          node.props.className.split(" ").includes("cnav__lead") &&
          node.props["data-icon-name"] === "ph:archive",
      ),
    ).toHaveLength(1);
  }

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
