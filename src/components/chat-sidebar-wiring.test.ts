// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const workspaceSidebar = await readFile(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");

// ── Chat-mode shell wiring: global nav stays in nav; Chats lives in the shell's
//    persistent list pane on desktop (and the list drawer on mobile). ───────────
assert.match(
  workspace,
  /const chatSidebar =\s*\(\s*<WorkspaceSidebar/,
  "workspace should define the chatSidebar element",
);
assert.match(
  workspace,
  /const list = mode === "chat" \? chatSidebar : undefined;/,
  "workspace should mount Chats as the list pane only in chat mode",
);
assert.match(
  workspace,
  /navPolicy=\{mode === "chat" \? "visit-collapsed" : "remembered"\}/,
  "chat visits should start with the global nav collapsed",
);
assert.match(
  workspace,
  /listPolicy=\{mode === "chat" \? "persistent" : "collapsible"\}/,
  "chat mode should keep the Chats list persistent on desktop",
);
assert.match(
  workspace,
  /nav=\{sidebar\}\s*list=\{list\}/,
  "workspace should keep SidebarMinimal in nav and pass Chats separately as list content",
);
assert.match(
  workspaceSidebar,
  /aria-label="Go to Home"/,
  "the chat sidebar header control is explicitly a Go to Home button",
);

// ── Home-first boot: the app opens on Home; chat is one step away. ──
assert.match(
  workspace,
  /const \[mode, setModeRaw\] = useState<CaveMode>\("home"\)/,
  "workspace should boot into home mode",
);
assert.doesNotMatch(workspace, /const exitChatMode = useCallback/, "workspace should not keep the unused prior-surface exit helper");
assert.doesNotMatch(workspace, /lastNonChatMode/, "workspace should not track a stale prior-surface contract");

// ── Subpanel removal: the in-surface thread rail is dropped in chat mode,
//    because the outer WorkspaceSidebar already owns the project-grouped list. ─
assert.match(
  workspace,
  /hideThreadRail/,
  "the chat-mode ChatSurface should set hideThreadRail",
);
assert.match(chatSurface, /hideThreadRail = false/, "ChatSurface should accept a hideThreadRail prop");
assert.match(
  chatSurface,
  /const compactRail = hideThreadRail/,
  "ChatSurface should fold hideThreadRail into the compact rail flag",
);
assert.match(
  chatSurface,
  /hideRail=\{compactRail\}/,
  "ChatRouter should receive the rail-only flag — the outer sidebar owns chats, but the full-width toolbar must stay (hideRail, not compact)",
);

// ── Recreated sidepanel: project-grouped threads + register-as-project. ───────
assert.match(
  workspaceSidebar,
  /deriveChatProjectGroups\(applyProjectOverrides/,
  "ChatSidebar should group threads by project (with local overrides applied)",
);
assert.match(
  workspaceSidebar,
  /handleRegister/,
  "ChatSidebar should offer register-as-project for unregistered roots",
);
assert.match(
  workspaceSidebar,
  /Register \$\{label\} as a project/,
  "ChatSidebar register affordance should be labeled for assistive tech",
);

// ── Easy add-project on failure: a 403 project-access denial surfaces a
//    one-click register + grant + retry. ───────────────────────────────────────
assert.match(chatView, /setProjectAccessRoot/, "chat-view should capture the failing project root on a 403");
assert.match(chatView, /async function handleAddProject/, "chat-view should implement the add-project recovery");
assert.match(
  chatView,
  /onAddProject=\{projectAccessRoot \? handleAddProject : undefined\}/,
  "chat-view should wire the add-project action into the error strip",
);

// ── Organize sidebar: recency view (default) + by-project, via a header menu. ─
assert.match(
  workspaceSidebar,
  /deriveChatRecencyBuckets\(/,
  "ChatSidebar should derive time buckets for the Recent view",
);
assert.match(workspaceSidebar, /Organize sidebar/, "ChatSidebar should expose the Organize sidebar menu");
assert.match(
  workspaceSidebar,
  /readChatSidebarView\(\)/,
  "the organize mode should hydrate from the persisted preference",
);
assert.match(
  workspaceSidebar,
  /relativeTime\(iso, Date\.now\(\), "bare"\)/,
  'sidebar row times should use the bare density (no "ago")',
);
assert.ok(
  (workspaceSidebar.match(/<ThreadRow/g) ?? []).length >= 2,
  "both view branches should render the shared ThreadRow",
);

// Recent rows carry their project's identity tile: the time buckets
// interleave chats from every project, and the mapping comes from the SAME
// override-aware grouping the folder view uses (a dragged chat shows its
// override folder's tile, not its recorded cwd's).
assert.match(
  workspaceSidebar,
  /const sessionProjectById = useMemo\(\(\) => \{[\s\S]*?for \(const group of groups\)/,
  "Recent-row project lookup derives from the override-aware groups",
);
assert.match(
  workspaceSidebar,
  /indent="flat"\s*\n\s*project=\{sessionProjectById\.get\(session\.id\) \?\? null\}/,
  "Recent rows pass the project identity into ThreadRow",
);
assert.match(
  workspaceSidebar,
  /cnav__thread-proj[\s\S]*?<ProjectAvatar name=\{project\.name\} root=\{project\.root\} color=\{project\.color\} size="sm"/,
  "ThreadRow renders the shared ProjectAvatar tile with an accessible project name",
);
assert.match(
  workspaceSidebar,
  /<span className="sr-only">\{project\.name\}<\/span>/,
  "the project name is announced, not just painted",
);
assert.doesNotMatch(workspaceSidebar, /cnav__footer|cnav__user-plan/, "ChatSidebar should not render the user plan footer");

console.log("chat-sidebar-wiring.test.ts passed");
