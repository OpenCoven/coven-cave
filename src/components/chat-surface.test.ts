// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
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

assert.doesNotMatch(
  chatSurface,
  /import.*CovenFloor/,
  "ChatSurface should not import CovenFloor — Floor is now an ambient widget in HomeComposer",
);

assert.match(
  chatSurface,
  /const scopedFamiliars = useMemo\(\(\) => activeFamiliar \? \[activeFamiliar\] : familiars, \[activeFamiliar, familiars\]\)/,
  "ChatSurface should derive all familiars when the generic Familiars scope is selected",
);

assert.match(
  chatSurface,
  /<FamiliarsMemoryView[\s\S]*familiars=\{scopedFamiliars\}[\s\S]*activeFamiliar=\{activeFamiliar\}[\s\S]*lockToFamiliar/,
  "ChatSurface memory should stay locked to the selected familiar",
);

assert.doesNotMatch(
  chatSurface,
  /SessionsView/,
  "ChatSurface should not render SessionsView — the dossier ChatList from ChatRouter is the single chat list",
);

assert.match(
  chatSurface,
  /\{\s*id:\s*"memory",\s*label:\s*"Memory"\s*\}/,
  "ChatSurface should label the secondary primary tab Memory instead of Traces",
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

assert.doesNotMatch(
  chatSurface,
  /fetch\("\/api\/coven-calls"|buildDelegationGraph|loadDelegations/,
  "ChatSurface should not load trace graph data just to render the primary chat surface",
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

// Code surface ("code" mode): the chat pane is transcript-only — the comux pane
// owns project/file navigation. ChatSurface takes a `surface` prop, derives
// isCodeSurface, drops the in-chat project sidebar by passing compact, and tags
// the transcript wrapper so the reading-width cap applies.
assert.match(
  chatSurface,
  /surface\s*=\s*"chat"/,
  "ChatSurface should accept a surface prop defaulting to standalone chat",
);
assert.match(
  chatSurface,
  /const isCodeSurface = surface === "code"/,
  "ChatSurface should derive isCodeSurface from the surface prop",
);
assert.match(
  chatSurface,
  /<ChatRouter[\s\S]*?compact=\{isCodeSurface\}/,
  "ChatSurface should suppress the in-chat project sidebar in Code mode via compact",
);
assert.match(
  chatSurface,
  /data-surface=\{surface\}/,
  "ChatSurface should tag the transcript wrapper with the surface for the reading-width cap",
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
  /<aside role="region" aria-label="Session panels" className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col border-l border-\[var\(--border-hairline\)\]">/,
  "ChatSurface right side panel should be height-bounded so its body can scroll vertically (and read as a named region, not a nested complementary landmark — CHAT-D13-05)",
);

assert.match(
  chatSurface,
  /<div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">\s*\{primaryPanel === "inspector" &&/,
  "ChatSurface right side panel should put tab content in a min-height-zero scroll boundary",
);

assert.match(
  chatSurface,
  /scope === "memory" \? \([\s\S]*?\) : \(\s*<Group\s+className="flex min-h-0 min-w-0 flex-1"\s+orientation="horizontal"/,
  "ChatSurface non-memory branch (conversation) should use remaining height below the tab bar instead of h-full",
);

assert.match(
  workspace,
  /mode === "chat"[\s\S]*<ChatSurface/,
  "Workspace should mount ChatSurface for the internal chat mode",
);

assert.match(
  workspace,
  /onOpenInboxItem=\{\(item\) => \{[\s\S]*openFamiliarSession\(item\.sessionId, item\.familiarId\)[\s\S]*setMode\("inbox"\)/,
  "Workspace should keep notification-bell inbox routing intact for session and non-session items",
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
  /newChat\(d\?\.projectRoot \?\? undefined, d\?\.initialPrompt \?\? undefined, d\?\.familiarId\)/,
  "ChatSurface should forward the seeded initialPrompt into newChat",
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
