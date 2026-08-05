// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const workspaceSidebar = await readFile(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const chatAttentionEvents = await readFile(new URL("../lib/chat-attention-events.ts", import.meta.url), "utf8");

// ── Chat-mode shell wiring: Chats replaces the global nav in the primary shell
//    nav slot, including the mobile nav drawer. ────────────────────────────────
assert.match(
  workspace,
  /const chatSidebar =\s*\(\s*<WorkspaceSidebar/,
  "workspace should define the chatSidebar element",
);
assert.match(
  workspace,
  /const contextualNav = mode === "chat" \? chatSidebar : sidebar;/,
  "workspace should select Chats as the primary nav only in chat mode",
);
assert.doesNotMatch(workspace, /const list = mode === "chat" \? chatSidebar : undefined;/);
assert.match(
  workspace,
  /navPolicy=\{mode === "chat" \? "chat-contextual" : "remembered"\}/,
  "chat mode should activate the contextual nav policy",
);
assert.doesNotMatch(
  workspace,
  /listPolicy=\{mode === "chat" \? "persistent" : "collapsible"\}/,
  "chat mode should not reserve a persistent list pane",
);
assert.match(
  workspace,
  /nav=\{contextualNav\}\s*list=\{undefined\}/,
  "workspace should pass contextual navigation and no list content",
);
assert.match(workspace, /topBar=\{\(\{ navDrawerOpen \}\) =>/, "top bar should only receive nav drawer state");
assert.match(workspace, /onToggleList=\{undefined\}/, "top bar should expose no list drawer toggle");
assert.match(workspace, /listDrawerOpen=\{false\}/, "top bar should report no list drawer");
const chatSidebarBlock = workspace.match(/const chatSidebar =[\s\S]*?const contextualNav =/)?.[0] ?? "";
assert.ok(chatSidebarBlock, "workspace should keep a distinct chatSidebar block");
assert.doesNotMatch(chatSidebarBlock, /dismissListMobile/, "chat sidebar callbacks should not dismiss the list drawer");
assert.ok(
  (chatSidebarBlock.match(/dismissNavMobile/g) ?? []).length >= 6,
  "chat sidebar actions should dismiss the mobile nav drawer",
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
//    because the contextual WorkspaceSidebar already owns the grouped threads. ─
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

// ── Attention projection: a human reply clears stale sidebar attention
//    immediately, but ordinary read/open paths never fabricate that clear. ─────
assert.match(
  chatAttentionEvents,
  /export const CHAT_ATTENTION_CLEAR_EVENT = "cave:chat-attention-clear";/,
  "the chat attention event module should expose the stable browser event name",
);
assert.match(
  chatView,
  /import \{ emitChatAttentionClear \} from "@\/lib\/chat-attention-events";/,
  "chat-view should emit the shared attention-clear event",
);
assert.match(
  chatView,
  /if \(liveGeneration\.sessionId\) \{\s*emitChatAttentionClear\(liveGeneration\.sessionId\);[\s\S]{0,240}const res = await fetch\("\/api\/chat\/send"/,
  "chat-view should clear attention immediately once the target session id is known, before /api/chat/send begins",
);
assert.match(
  chatView,
  /case "session": \{[\s\S]*?emitChatAttentionClear\(ev\.sessionId\);/,
  "chat-view should clear attention when a live generation first gains a stable session id",
);
assert.match(
  chatView,
  /return subscribeLiveChatGeneration\(sessionId, \(live\) => \{[\s\S]*?if \(live && isLiveSnapshotActive\(live, Date\.now\(\)\)\) \{[\s\S]*?emitChatAttentionClear\(sessionId\);/,
  "chat-view should clear attention when it adopts an existing live generation from the registry subscription",
);
assert.match(
  chatView,
  /const live = readLiveChatGeneration\(sessionId\);[\s\S]*?if \(live && isLiveSnapshotActive\(live, Date\.now\(\)\)\) \{[\s\S]*?emitChatAttentionClear\(sessionId\);/,
  "chat-view should clear attention when the initial load adopts an existing live generation",
);
const applyConversationPayloadBlock = chatView.match(/const applyConversationPayload = \(json: ConversationHistoryPayload\) => \{[\s\S]*?\n    \};/)?.[0] ?? "";
assert.ok(applyConversationPayloadBlock, "chat-view should define the conversation payload apply helper");
assert.doesNotMatch(
  applyConversationPayloadBlock,
  /emitChatAttentionClear/,
  "chat-view should not clear attention while merely loading persisted conversation history",
);
assert.match(
  chatView,
  /import \{ createChatAttentionSettlementTracker \} from "@\/lib\/chat-attention-settlement";/,
  "chat-view should use the shared attention-settlement tracker",
);
assert.match(
  chatView,
  /const attentionSettlement = createChatAttentionSettlementTracker\(\(\) => onSessionsChanged\?\.\(\)\);/,
  "chat-view should centralize sidebar-attention reconciliation through one tracker",
);
assert.match(
  chatView,
  /if \(liveGeneration\.sessionId\) \{\s*emitChatAttentionClear\(liveGeneration\.sessionId\);\s*attentionSettlement\.markAttentionCleared\(\);/,
  "chat-view should track pre-send attention clears on existing sessions",
);
assert.match(
  chatView,
  /case "session": \{[\s\S]*?emitChatAttentionClear\(ev\.sessionId\);\s*liveGeneration\.markAttentionCleared\(\);/,
  "session events should remain id acquisition plus attention-clear bookkeeping, not persistence confirmation",
);
assert.match(
  chatView,
  /case "done": \{[\s\S]*?if \(ev\.isError\) \{[\s\S]*?\} else \{[\s\S]*?liveGeneration\.markPersistenceConfirmed\(\);[\s\S]*?stampFirstReplyOnce\(\);/,
  "only a successful terminal done event should confirm persistence",
);
assert.match(
  chatView,
  /finally \{[\s\S]*?attentionSettlement\.reconcileIfNeeded\(\);[\s\S]*?clearLiveChatGeneration\(liveGeneration\.sessionId, runId\)/,
  "chat-view should reconcile canonical sessions exactly once at settlement before retiring the live snapshot",
);
assert.match(
  workspace,
  /import \{ CHAT_ATTENTION_CLEAR_EVENT, attentionClearedSessionId \} from "@\/lib\/chat-attention-events";/,
  "workspace should subscribe to the shared attention-clear event",
);
assert.match(
  workspace,
  /const clearSessionAttention = \(row: SessionRow\): SessionRow =>\s*row\.attention\.state === "none"\s*\?\s*row\s*:\s*\{ \.\.\.row, attention: NO_CHAT_ATTENTION \};/,
  "workspace should reset attention with a NO_CHAT_ATTENTION-only patch that preserves every other field",
);
assert.match(
  workspace,
  /baseSessionsRef\.current = clearSessionAttentionRows\(baseSessionsRef\.current, sessionId\);[\s\S]*?setSessions\(\(currentSessions\) => clearSessionAttentionRows\(currentSessions, sessionId\)\);/,
  "workspace should patch both the canonical base rows and the rendered enriched rows for the matching session only",
);
assert.match(
  workspace,
  /window\.addEventListener\(CHAT_ATTENTION_CLEAR_EVENT, onChatAttentionClear\);[\s\S]*?return \(\) => \{\s*window\.removeEventListener\(CHAT_ATTENTION_CLEAR_EVENT, onChatAttentionClear\);[\s\S]*?\};/,
  "workspace should subscribe once to chat attention clears and clean up the listener",
);

// ── Visible grouping tabs: recency view (default) + by-project. ───────────────
assert.match(
  workspaceSidebar,
  /deriveChatRecencyBuckets\(/,
  "ChatSidebar should derive time buckets for the Recent view",
);
assert.match(
  workspaceSidebar,
  /<Tabs<ChatSidebarView>/,
  "ChatSidebar should use the shared accessible tabs primitive",
);
assert.match(
  workspaceSidebar,
  /idPrefix="chat-sidebar-group"/,
  "Grouping tabs should emit stable ids and aria-controls",
);
assert.match(
  workspaceSidebar,
  /id="chat-sidebar-group-panel"[\s\S]*?role="tabpanel"[\s\S]*?aria-labelledby=\{`chat-sidebar-group-tab-\$\{view\}`\}[\s\S]*?<nav aria-label="Chat threads">/,
  "The active thread list should be associated with its selected grouping tab",
);
const chatSidebarPanelOpenTag = workspaceSidebar.match(
  /<div\s*\n\s*id="chat-sidebar-group-panel"[\s\S]*?>/,
)?.[0] ?? "";
assert.ok(chatSidebarPanelOpenTag, "ChatSidebar should render the active grouping panel");
assert.doesNotMatch(
  chatSidebarPanelOpenTag,
  /tabIndex=/,
  "the tabpanel should not add a redundant keyboard stop before its interactive rows",
);
assert.match(
  workspaceSidebar,
  /id: "recent",[\s\S]*?label: "Recent",[\s\S]*?icon: "ph:clock-counter-clockwise",[\s\S]*?controlsId: "chat-sidebar-group-panel"/,
  "ChatSidebar should expose the Recent grouping tab",
);
assert.match(
  workspaceSidebar,
  /id: "projects",[\s\S]*?label: "Projects",[\s\S]*?icon: "ph:folders-bold",[\s\S]*?controlsId: "chat-sidebar-group-panel"/,
  "ChatSidebar should expose the Projects grouping tab",
);
assert.match(
  workspaceSidebar,
  /<PopoverLabel>Chat visibility<\/PopoverLabel>/,
  "Sidebar overflow should retain archive visibility without duplicating grouping",
);
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
