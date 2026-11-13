// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Source pins for the detached Chat window (#6477): the right Chat panel
// popped out into a window of its own. These are the contracts that are easy
// to lose in a refactor and expensive to notice: independence from the main
// window, reuse of the real Chat panel, and the window's keyboard and
// accessibility behavior.

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const source = await read("./detached-chat-window.tsx");
const css = await read("../styles/detached-chat-window.css");
const page = await read("../app/quick-chat/page.tsx");
const lib = await read("../lib/chat-window.ts");
const sessionList = await read("../lib/use-chat-session-list.ts");
const openExternal = await read("../lib/open-external.ts");
const globalsCss = await read("../app/globals.css");

// ── The notch is gone; the route hosts the tray and the Chat window ────────
assert.doesNotMatch(page, /notch/i, "the /quick-chat route no longer has a notch presentation");
assert.match(
  page,
  /if \(params\.view === "window"\) return <DetachedChatWindow \/>;/,
  "?view=window selects the detached Chat window server-side, with no client flash",
);
assert.match(page, /<FirstUseProvider><TrayQuickChat \/><\/FirstUseProvider>/, "the tray quick chat is unchanged");

// ── It is the Chat panel, not a second chat implementation ─────────────────
assert.match(source, /<RightChatPanel\b/, "the window hosts the shared Chat panel");
assert.doesNotMatch(
  source,
  /chat-router|chat-view|useQuickChat|\/api\/chat\//,
  "transcript, streaming, composer and sends stay in the shared panel, never reimplemented here",
);
assert.match(
  css,
  /\.chat-window__chat \.right-chat__rail \{\s*display: none;/,
  "the docked panel's control rail steps aside: the window's own chrome does those jobs",
);

// ── Independent of the main window ─────────────────────────────────────────
assert.doesNotMatch(
  source,
  /@\/components\/workspace|@\/components\/shell\b|cave:active-familiar|useWorkspace/,
  "the window never reads workspace state",
);
assert.match(source, /function useFamiliarRoster\(\)[\s\S]{0,900}fetch\("\/api\/familiars"/, "it loads its own familiar roster");
assert.match(
  source,
  /const chats = useChatSessionList\(familiarId, \{ enabled: active \}\);/,
  "each familiar's chats are this window's own scoped read",
);
assert.match(
  source,
  /sessions=\{chats\.sessions\}[\s\S]{0,160}sessionsScopeFamiliarId=\{familiarId\}/,
  "the panel is told its sessions are scoped to exactly its familiar",
);
assert.match(
  source,
  /composerDraftKeyPrefix=\{CHAT_WINDOW_DRAFT_KEY_PREFIX\}/,
  "drafts typed here never overwrite the docked panel's",
);
assert.match(
  source,
  /onSetActiveFamiliar=\{noop\}/,
  "a pane is bound to its familiar: the router cannot move the window to another one",
);
assert.match(
  source,
  /url\.searchParams\.delete\("familiar"\);\s*url\.searchParams\.delete\("session"\);\s*replaceHistoryUrl\(/,
  "a pop-out target is consumed once, so a reload restores the window's own selection",
);
assert.match(
  source,
  /setLanding\(\(current\) => \(current\.read \? current : \{ \.\.\.target, read: true \}\)\);/,
  "a re-run of the mount effect cannot replace the pop-out target with the cleaned URL's empty one",
);
assert.match(
  source,
  /const stored = readStored\(CHAT_WINDOW_FAMILIAR_KEY\);\s*const next = resolveChatWindowFamiliarId\(visibleIds, fromLanding \? \[landing\.familiarId, stored\] : \[stored\]\);/,
  "the first familiar comes from the pop-out, then this window's own memory",
);

// ── Across sessions: every visited familiar stays live ─────────────────────
assert.match(
  source,
  /setMountedIds\(\(current\) => \(current\.includes\(familiarId\) \? current : \[\.\.\.current, familiarId\]\)\);/,
  "a visited familiar's pane is mounted once and kept",
);
assert.match(
  source,
  /role="tabpanel"[\s\S]{0,220}hidden=\{!active\}/,
  "a pane behind another is hidden, not unmounted, so its reply keeps streaming",
);
assert.match(source, /<RightChatPanel\s+open=\{active\}/, "a hidden pane's panel is inert and out of the accessibility tree");
assert.match(
  source,
  /useChatSessionList\(null, \{ enabled: true, intervalMs: 8_000 \}\)[\s\S]{0,200}summarizeChatWindowActivity\(everyone\.sessions\)/,
  "one unscoped read feeds every familiar's activity badge",
);

// ── Familiar rail ──────────────────────────────────────────────────────────
assert.match(
  source,
  /role="tablist"\s+aria-label="Familiars"\s+aria-orientation="vertical"/,
  "familiars are a vertical tab list",
);
assert.match(
  source,
  /role="tab"[\s\S]{0,200}aria-selected=\{active\}[\s\S]{0,120}aria-controls=\{`chat-window-pane-\$\{familiar\.id\}`\}/,
  "each familiar tab names the pane it controls",
);
assert.match(
  source,
  /aria-label=\{stateLabel \? `\$\{familiar\.display_name\}, \$\{stateLabel\}` : familiar\.display_name\}/,
  "a familiar's activity is in its accessible name, not only a colored dot",
);
assert.match(
  source,
  /tabIndex=\{active \|\| \(activeId === null && familiar === familiars\[0\]\) \? 0 : -1\}/,
  "the rail is one Tab stop; arrow keys move within it",
);
assert.match(source, /className="focus-ring chat-window__familiar"/, "familiar tabs show a focus ring");

// ── Chat list per familiar ─────────────────────────────────────────────────
assert.match(
  source,
  /aria-label=\{`Chats with \$\{resolvedFamiliar\.display_name\}`\}/,
  "each familiar's chat list is a named region",
);
assert.match(
  source,
  /onClick=\{\(\) => pick\(\(\) => controllerRef\.current\?\.newChat\(\)\)\}[\s\S]{0,120}<span>New chat<\/span>/,
  "New chat starts a chat with this familiar through the panel's own action",
);
assert.match(
  source,
  /onOpen=\{\(\) => pick\(\(\) => controllerRef\.current\?\.openSession\(session\.id\)\)\}/,
  "choosing a chat opens it through the panel's own action",
);
assert.match(source, /aria-current=\{selected \? "true" : undefined\}/, "the open chat is marked current");
assert.match(source, /placeholder="Filter chats…"/, "the filter uses the canonical placeholder for narrowing a visible list");
assert.match(source, /headline="Couldn't load chats"[\s\S]{0,200}Retry/, "a failed list says so and offers Retry, never an empty list");
assert.match(source, /No chats match “\{query\.trim\(\)\}”\.[\s\S]{0,160}Clear filter/, "a filtered-empty list names the query and clears it");
assert.match(source, /Loading chats…/, "the list names its load");
assert.match(
  source,
  /data-tone=\{state\} aria-hidden \/>\s*<span className="chat-window__chat-state">\{sessionLifecycleLabel\(state\)\}<\/span>/,
  "live state is the app's lifecycle word beside the dot, never a dot alone",
);
assert.match(
  lib,
  /if \(state !== "awaiting-human" && state !== "overdue-human"\) return null;/,
  "a chat that was merely left unanswered gets no marker",
);

// ── Window chrome ──────────────────────────────────────────────────────────
assert.match(
  source,
  /<header className="chat-window__titlebar" data-tauri-drag-region="deep">/,
  "the title bar is a deep drag region for the overlay-titlebar window",
);
assert.equal(
  (source.match(/<IconButton\b/g) ?? []).length,
  3,
  "the title bar stays within the chrome budget: three always-visible actions",
);
assert.match(
  source,
  /aria-label=\{listToggleLabel\}\s+aria-expanded=\{listShown\}/,
  "the chat-list toggle names its next action and exposes its state",
);
assert.match(
  source,
  /event\.key\.toLowerCase\(\) !== "n"[\s\S]{0,120}startNewChat\(\);/,
  "⌘/Ctrl+N starts a chat with the familiar in front",
);
assert.match(
  source,
  /useFocusTrap\(drawer, listRef, \{ onEscape: onCloseDrawer \}\);/,
  "the narrow-width chat list drawer traps focus and closes on Escape",
);
assert.match(
  source,
  /inert=\{!listShown\}\s+aria-hidden=\{!listShown\}/,
  "a hidden chat list is out of the tab order and the accessibility tree",
);
assert.match(
  source,
  /announce\("Chat opened in the main window"\)/,
  "handing a chat back to the main window is announced",
);

// ── Links and main-window-only features ────────────────────────────────────
assert.match(
  source,
  /routeExternalUrlsToSystemBrowser\(\);/,
  "the window declares it has no Browser surface",
);
assert.match(
  openExternal,
  /if \(externalUrlsUseSystemBrowser\) \{\s*void openSystemBrowserUrl\(url, \{ fallback: \(\) => \{\} \}\);\s*return;/,
  "an in-app-browser request from the Chat window opens the system browser instead of navigating the window to the main app",
);

// ── Hand-off library ───────────────────────────────────────────────────────
assert.match(
  lib,
  /invoke\("open_chat_window", \{ familiarId: clean\.familiarId, sessionId: clean\.sessionId \}\)/,
  "the desktop pop-out goes through the shell's single-purpose command",
);
assert.match(
  lib,
  /if \(browserPopup && !browserPopup\.closed\) \{[\s\S]{0,360}dispatchEvent\(new PopupEvent\(CHAT_WINDOW_TARGET_EVENT/,
  "a browser pop-out reuses the open popup rather than reloading it",
);
assert.doesNotMatch(lib, /noopener/.source === "noopener" ? /window\.open\([^)]*noopener/ : /$^/, "the popup keeps the opener's session storage");
assert.match(
  sessionList,
  /AbortSignal\.timeout\(15_000\)[\s\S]{0,200}"If-None-Match"/,
  "the window's session reads are bounded and conditional",
);
assert.match(sessionList, /usePausablePoll\(refresh, intervalMs, \{ enabled, serialize: true \}\)/, "polls are serialized and pause while hidden");

// ── Styles ─────────────────────────────────────────────────────────────────
assert.match(source, /import "@\/styles\/detached-chat-window\.css";/, "the surface imports its own stylesheet");
assert.doesNotMatch(globalsCss, /detached-chat-window/, "the stylesheet stays out of the global bundle");
assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "no hardcoded colors");
assert.match(
  css,
  /calc\(var\(--titlebar-lights-inset, 0px\) \+ var\(--space-3\)\)/,
  "the title bar clears the macOS traffic lights",
);
assert.match(
  css,
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*transition: none;[\s\S]*animation: none;/,
  "transitions and the reply pulse stop under reduced motion",
);
assert.match(css, /@media \(max-width: 759px\)/, "the chat list becomes a drawer at narrow widths");
assert.match(source, /const NARROW_QUERY = "\(max-width: 759px\)";/, "the component and stylesheet agree on the narrow breakpoint");

// Review of #6480: familiar settings open in the main window. Navigating this
// window to Chat would discard every mounted conversation and reply in flight.
assert.match(
  source,
  /<FamiliarStudioProvider redirectToChat openSettings=\{openFamiliarSettingsInMainWindow\}>/,
  "familiar settings are handed to the main window, never opened by navigating this one",
);
assert.match(
  source,
  /await emit\("quick-chat:open-session", \{ familiarSettings \}\);/,
  "the desktop hand-off rides the event the main window already listens to",
);
assert.doesNotMatch(source, /location\.assign\(/, "this window never navigates itself away");

// The pop-out's landing target counts once; recovery uses the window's own
// last familiar and no stale chat.
assert.match(
  source,
  /const fromLanding = !landingUsedRef\.current;[\s\S]{0,200}fromLanding \? \[landing\.familiarId, stored\] : \[stored\][\s\S]{0,120}landingUsedRef\.current = true;/,
  "a recovery after the first selection never replays the pop-out's familiar or chat",
);

// A new-chat pop-out opens a new chat, and the panel's unsent draft comes along.
assert.match(
  source,
  /adoptPoppedOutDraft\(familiarId, sessionId\);[\s\S]{0,240}else if \(sessionId === CHAT_WINDOW_NEW_CHAT\) controller\.newChat\(\);/,
  "a popped-out target carries its draft before the chat opens, and a new-chat target starts one",
);
assert.match(
  source,
  /startWithNewChat=\{initialSessionId === CHAT_WINDOW_NEW_CHAT\}/,
  "a not-yet-mounted familiar starts on a new chat when the pop-out asked for one",
);
assert.match(
  source,
  /settle = window\.setTimeout\(\(\) => \{[\s\S]*\}, POP_OUT_DRAFT_SETTLE_MS\);/,
  "a later pop-out waits out the panel's draft debounce before carrying the draft",
);
