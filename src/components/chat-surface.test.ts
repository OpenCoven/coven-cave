// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatRouter = await readFile(new URL("./chat-router.tsx", import.meta.url), "utf8");
const agentsMemoryView = await readFile(new URL("./familiars-memory-view.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(
  chatSurface,
  /export function ChatSurface/,
  "ChatSurface should be the integrated top-level chat surface",
);

assert.doesNotMatch(
  chatSurface,
  /placeholder="Search"|\bActive <span|\bDone <span|\bDate<\/button>|\bStatus<\/button>|\bFlat<\/button>/,
  "ChatSurface should not render a redundant search/status/group command strip above the chat UI",
);

assert.match(
  chatSurface,
  /className="chat-scope-tabs chat-scope-tabs--minimal/,
  "ChatSurface should use the compact tab strip treatment on open chat sessions",
);

// The redundant "+ New" action was removed from the scope-tab strip — the
// chat list rail's "New Session" button is the single new-chat launch point.
assert.doesNotMatch(
  chatSurface,
  /className="chat-scope-tabs__new/,
  "ChatSurface should not render a redundant New action in the scope-tab strip",
);

assert.doesNotMatch(
  chatSurface,
  /ph:plug|Configure plugins|onOpenMode/,
  "ChatSurface should not render the plugin/config icon in the chat interface",
);

assert.match(
  workspace,
  /fetch\("\/api\/daemon\/start", \{ method: "POST" \}\)/,
  "Workspace should make the offline daemon state actionable via the shared banner channel",
);

assert.match(
  workspace,
  /Start daemon/,
  "Workspace should push a start-daemon CTA into the shared banner channel when daemon is offline",
);

assert.doesNotMatch(
  chatSurface,
  /Get started with agents|Give an agent a background task to work on/,
  "ChatSurface should not reintroduce the busy GitHub-style hero/composer cards",
);

// The chat surface no longer hosts a memory scope — familiar memory lives in
// the Familiars surface and the Grimoire editor, and the inspector's Memory
// tab remains only on the companion RailInspector (cave-liut).
assert.match(
  chatSurface,
  /type FamiliarsScope = "conversation" \| "projects" \| "coven"/,
  "ChatSurface scope union should not include the dead memory scope",
);
assert.doesNotMatch(
  chatSurface,
  /FamiliarsMemoryView/,
  "ChatSurface should not mount FamiliarsMemoryView — memory is not a chat scope",
);

assert.doesNotMatch(
  chatSurface,
  /SessionsView/,
  "ChatSurface should not render SessionsView — the dossier ChatList from ChatRouter is the single chat list",
);

assert.match(
  chatSurface,
  /\{\s*id:\s*"projects",\s*label:\s*"Projects"\s*\}/,
  "ChatSurface should label the secondary primary tab Projects instead of Traces",
);

// Group Chat ("coven") is demoted from a co-equal tab (cave-xsq.5): it's a quiet
// icon-button on the right of the scope-tab row that switches to the coven scope,
// not a third tab — so the default surface reads as Sessions / Projects.
assert.doesNotMatch(
  chatSurface,
  /\{\s*id:\s*"coven",\s*label:\s*"Group"/,
  "Group is no longer a co-equal scope tab",
);
assert.match(
  chatSurface,
  /className=\{`chat-scope-group-btn[\s\S]*onClick=\{\(\) => setScope\("coven"\)\}/,
  "ChatSurface exposes Group as a demoted icon-button that switches to the coven scope",
);
assert.match(
  chatSurface,
  /scope === "coven" \?[\s\S]*<GroupChatView[\s\S]*familiars=\{resolvedFamiliars\}/,
  "ChatSurface should render GroupChatView for the coven scope",
);
// Familiar selection now lives in the global top menu bar (and the sidebar /
// mobile top-bar switcher), so the chat header carries only its scope tabs —
// no duplicate switcher here.
assert.doesNotMatch(
  chatSurface,
  /<FamiliarSwitcher/,
  "ChatSurface should not duplicate the global familiar switcher in its header",
);
assert.match(
  chatSurface,
  /\{\s*id:\s*"conversation",\s*label:\s*"Sessions"\s*\}/,
  "ChatSurface should name the primary history tab Sessions inside the Familiars page",
);

assert.match(
  chatSurface,
  /useState<FamiliarsScope>\("conversation"\)/,
  "ChatSurface should default the scope to conversation so the ChatList shows when Chat is selected",
);

assert.doesNotMatch(
  chatSurface,
  /groupBy|setGroupBy|filteredSessions|groupedSessions|showClosed|setShowClosed|const \[query, setQuery\]/,
  "ChatSurface should not keep unused command-strip filtering state",
);

assert.doesNotMatch(
  chatSurface,
  /Traces/,
  "ChatSurface should not foreground trace terminology in the primary tabs",
);

assert.match(
  agentsMemoryView,
  /fetch\("\/api\/coven-memory"/,
  "Agents memory view should load daemon-backed Coven memory",
);

assert.match(
  agentsMemoryView,
  /fetch\("\/api\/memory"/,
  "Agents memory view should load filesystem memory indexes",
);

assert.match(
  agentsMemoryView,
  /Familiar memories[\s\S]*Coven origin[\s\S]*External runtimes[\s\S]*Runtime memory/,
  "Agents memory view should summarize native Coven, external runtime, and runtime memory sources",
);

assert.match(
  agentsMemoryView,
  /familiarFilter/,
  "Agents memory view should support familiar-scoped memory filtering",
);

assert.doesNotMatch(
  chatSurface,
  /Left nav|w-\[44px\]/,
  "ChatSurface should not render a second persistent left navigation rail inside the app shell",
);

assert.match(
  chatSurface,
  /<ChatRouter/,
  "ChatSurface should keep live chat available inside the Chat tab",
);

// Retired Code mode: ChatSurface is now the only chat surface. The left
// WorkspaceSidebar owns project/thread navigation in chat mode, so ChatSurface
// only needs the explicit hideThreadRail compact flag.
assert.doesNotMatch(
  chatSurface,
  /surface\s*=\s*"chat"|surface === "code"|isCodeSurface|CodeInlineToolbar/,
  "ChatSurface should not keep the retired code-surface switch",
);
assert.match(
  chatSurface,
  /const compactRail = hideThreadRail/,
  "ChatSurface should fold chat mode's hideThreadRail into the compact rail flag",
);
assert.match(
  chatSurface,
  /<ChatRouter[\s\S]*?compact=\{compactRail\}/,
  "ChatSurface should suppress the in-chat project sidebar via compact when chat-mode ChatSidebar owns threads",
);

assert.match(
  chatSurface,
  /onOpenUrl\?: \(url: string\) => void/,
  "ChatSurface should accept a URL opener for chat transcript links",
);

assert.match(
  chatSurface,
  /<ChatRouter[\s\S]*onOpenUrl=\{onOpenUrl\}/,
  "ChatSurface should route ChatRouter link opens to Workspace instead of the default anchor target",
);

assert.doesNotMatch(
  chatSurface,
  /right-panel-tab[\s\S]*ph:chats[\s\S]*Chat[\s\S]*onSetPanel\("chat"\)/,
  "ChatSurface right sidebar should not show a redundant Chat tab while the main page is Chats",
);

assert.doesNotMatch(
  chatSurface,
  /panel === "chat"/,
  "ChatSurface right sidebar should not render a second chat panel on the Chats page",
);

assert.match(
  chatSurface,
  /<InspectorPane\s+familiar=\{activeFamiliar\}\s+inboxItems=\{inboxItems\}\s+onOpenInbox=\{onOpenInbox\}/,
  "ChatSurface should preserve the inbox-backed inspector entry point",
);

assert.match(
  chatSurface,
  /<aside role="region" aria-label="Session panels" className="chat-right-aside relative flex h-full min-h-0 min-w-0 flex-1 flex-col">/,
  "ChatSurface right side panel should be height-bounded so its body can scroll vertically (and read as a named region, not a nested complementary landmark — CHAT-D13-05)",
);

assert.match(
  chatSurface,
  /className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"\s*>\s*\{primaryPanel === "inspector" &&/,
  "ChatSurface right side panel should put tab content in a min-height-zero scroll boundary (the div also carries the cave-t7uz tabpanel wiring)",
);

assert.match(
  chatSurface,
  /scope === "coven" \? \([\s\S]*?\) : \(\s*<Group\s+className="flex min-h-0 min-w-0 flex-1"\s+orientation="horizontal"/,
  "ChatSurface conversation branch should use remaining height below the tab bar instead of h-full",
);

// cave-liut regression guards — the inspector-into-chat-tabs migration contract:
// 1) rightPanel is the single channel; the legacy inspectorOpen boolean fallback
//    is gone from both sides of the ChatSurface prop seam.
assert.doesNotMatch(
  chatSurface,
  /inspectorOpen|onSetInspectorOpen/,
  "ChatSurface must not keep the legacy inspectorOpen fallback — rightPanel is the only right-panel channel",
);
assert.match(
  chatSurface,
  /rightPanel: RightPanelKind \| null;/,
  "ChatSurface should require the rightPanel prop (no optional legacy fallback)",
);
// 2) The inspector's active section is owned by ChatSurface, not RightPanel, so
//    it survives panel close/reopen and the desktop-sidebar ↔ mobile-sheet
//    remount (only one RightPanel mounts at a time).
assert.match(
  chatSurface,
  /const \[inspectorSection, setInspectorSection\] =\s*\n?\s*useState<Exclude<InspectorSection, "memory">>\("familiar"\)/,
  "ChatSurface owns the inspector section so it persists across panel close/reopen",
);
assert.doesNotMatch(
  chatSurface,
  /const \[section, setSection\] = useState/,
  "RightPanel must not re-own section state — a breakpoint remount would reset it",
);
const rightPanelMounts = chatSurface.match(/<RightPanel\b/g) ?? [];
const sectionWired = chatSurface.match(/section=\{inspectorSection\}/g) ?? [];
const sectionSetterWired = chatSurface.match(/onSetSection=\{setInspectorSection\}/g) ?? [];
assert.equal(rightPanelMounts.length, 2, "RightPanel mounts exactly twice (desktop sidebar + narrow sheet)");
assert.equal(sectionWired.length, 2, "both RightPanel mounts receive the lifted inspector section");
assert.equal(sectionSetterWired.length, 2, "both RightPanel mounts receive the section setter");

assert.match(
  workspace,
  /mode === "chat"[\s\S]*<ChatSurface/,
  "Workspace should mount ChatSurface for the internal chat mode",
);

assert.match(
  workspace,
  /onOpenInboxItem=\{\(item\) => \{\s*markInboxItemRead\(item\.id\);\s*if \(item\.familiarId\) setActiveId\(item\.familiarId\);\s*setMode\("inbox"\);/,
  "Workspace should route notification-bell Open to the Inbox view (cave-ipze), never straight into a session",
);

// The agents-new-chat bridge forwards an optional initialPrompt so callers
// (e.g. the Contract tab's rehabilitation button) can seed the first message.
assert.match(
  chatSurface,
  /onNewChat[\s\S]*initialPrompt\?: string \| null/,
  "ChatSurface new-chat handler should accept an initialPrompt in the event detail",
);
assert.match(
  chatSurface,
  /newChat\([\s\S]*d\?\.projectRoot \?\? undefined,[\s\S]*d\?\.initialPrompt \?\? undefined,[\s\S]*d\?\.familiarId,[\s\S]*d\?\.origin,[\s\S]*d\?\.initialControls \?\? undefined/,
  "ChatSurface should forward the seeded initialPrompt into newChat",
);

assert.match(
  chatRouter,
  /newChat: \([\s\S]*?initialControls\?: InitialCommandControls[\s\S]*?\) => void/,
  "ChatRouterHandle.newChat should accept initial command controls",
);

assert.match(
  chatRouter,
  /<ChatView[\s\S]*initialControls=\{view\.kind === "chat" \? view\.initialControls : undefined\}/,
  "ChatRouter should pass initial command controls into ChatView",
);

// ChatSurface only mounts in chat mode, so the Workspace must bridge
// cave:agents-new-chat dispatched from non-chat surfaces (e.g. the Contract
// tab in the Familiar Studio drawer) into the chat surface — and skip when
// already in chat so the new chat isn't opened twice.
assert.match(
  workspace,
  /addEventListener\("cave:agents-new-chat"[\s\S]*startFamiliarChat\(/,
  "Workspace bridges cave:agents-new-chat into the chat surface from non-chat modes",
);
assert.match(
  workspace,
  /onAgentsNewChat[\s\S]*modeRef\.current === "chat"[\s\S]*return/,
  "Workspace skips the bridge when already in chat (ChatSurface owns it) to avoid double-open",
);

// cave-b63 (2): the change-count fetch dedupe is per effect-run (local), not a
// cross-run ref — so a quick root switch's new fetch isn't blocked by the old
// root's still-in-flight fetch (which left the badge showing a stale count), and
// the count resets on a real root change.
assert.match(
  chatSurface,
  /let inFlight = false;[\s\S]*?const load = async \(\) => \{\s*\n\s*if \(inFlight\) return;/,
  "change-count fetch dedupe is scoped per effect-run, not a cross-run ref",
);
assert.match(
  chatSurface,
  /if \(changeCountRootRef\.current !== root\) \{\s*\n\s*setChangeCount\(null\);/,
  "changeCount drops to null (unknown) on a real root change — clears the stale badge AND keeps first-load dirt from faking a fresh-batch reveal (cave-xsq.7)",
);
