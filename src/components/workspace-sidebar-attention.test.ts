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

function makeSession() {
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
    attention: {
      state: "awaiting-human",
      since: "2026-08-05T19:00:00.000Z",
      reason: "approval",
    },
  };
}

function mainThreadButton(renderer: ReactTestRenderer) {
  return renderer.root.find(
    (node) => node.type === "button" && node.props.className === "cnav__thread-main focus-ring" && typeof node.props["aria-describedby"] === "string",
  );
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

console.log("workspace-sidebar-attention: ok");
