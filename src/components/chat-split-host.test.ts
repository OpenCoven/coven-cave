// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Multi-pane chat: drag a conversation from the thread rail onto the chat and
// snap it left / right / above / below. Pins the wiring across the three
// surfaces — drag source (chat-project-sidebar), drop host (chat-split-host),
// and layout owner (chat-router) — plus the styles that make it visible.

const host = await readFile(new URL("./chat-split-host.tsx", import.meta.url), "utf8");
const router = await readFile(new URL("./chat-router.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./chat-project-sidebar.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

// ── Drop host ────────────────────────────────────────────────────────────────

// The host coordinates with the drag source over the window-event protocol
// (same idiom as page-drag → DetailSplitHost).
assert.match(host, /CHAT_SESSION_DRAG_START/, "host listens for drag start");
assert.match(host, /CHAT_SESSION_DRAG_END/, "host listens for drag end");
assert.match(
  host,
  /getData\(CHAT_SESSION_DRAG_MIME\)/,
  "drop reads the session id from the chat-session MIME type",
);

// The snap zone is resolved from the live pointer position (closest edge) and
// previewed over the half the pane will occupy.
assert.match(host, /resolveChatDropZone\(/, "zone comes from the closest-edge geometry");
assert.match(host, /chatDropPreviewRect\(/, "the preview rect mirrors the resulting split");
assert.match(host, /onDragOver=\{handleDragOver\}/, "overlay tracks dragover");
assert.match(host, /className="chat-split__preview"/, "live snap preview renders");

// Panes render in a resizable strip whose orientation follows the split axis.
assert.match(
  host,
  /orientation=\{axis === "row" \? "horizontal" : "vertical"\}/,
  "the pane group orientation follows the layout axis",
);
assert.match(
  host,
  /minSize=\{axis === "row" \? "280px" : "160px"\}/,
  "panes keep a pixel floor so a divider can't crush a conversation",
);
// RRP re-layout bug guard (cave-hivd idiom): remount the group per pane set.
assert.match(host, /key=\{`\$\{axis\}\|\$\{panes\.map/, "the group remounts on pane-set changes");

// Secondary panes get chrome: close + open-as-main; the primary keeps its own
// header (no double chrome).
assert.match(host, /aria-label=\{`Close \$\{tile\.title\} pane`\}/, "panes can be closed");
assert.match(host, /aria-label=\{`Open \$\{tile\.title\} as main chat`\}/, "panes can be promoted");
assert.match(
  host,
  /tile\.id === CHAT_SPLIT_PRIMARY[\s\S]{0,220}<div className="chat-split__pane-body">\{tile\.content\}<\/div>/,
  "the primary pane renders without extra chrome",
);

// ── Layout owner (chat-router) ───────────────────────────────────────────────

assert.match(router, /<ChatSplitHost/, "the chat view area renders through the split host");
assert.match(router, /dropSessionIntoChatSplit\(prev, sessionId, zone\)/, "drops feed the pure layout");
assert.match(
  router,
  /if \(sessionId === primarySessionId\) return;/,
  "dropping the already-open conversation is a no-op",
);
assert.match(
  router,
  /setSplit\(\(prev\) => removeChatSplitPane\(prev, primarySessionId\)\)/,
  "a conversation opened as primary leaves the split (no double-streaming)",
);
assert.match(
  router,
  /const enableSplit = enableSplitPanes && !isMobile && !caveChatoutCodex\(\);/,
  "splits are an explicit opt-in: main surface only, never mobile or the Codex surface",
);
assert.match(router, /onPromotePane=\{handlePromotePane\}/, "promote opens the pane as the primary chat");

// ── Drag source (thread rail) ────────────────────────────────────────────────

assert.match(sidebar, /function sessionDragProps\(/, "rows share one native-drag helper");
assert.match(sidebar, /emitChatSessionDragStart\(\{ sessionId, title \}\)/, "row drag announces itself");
assert.match(sidebar, /emitChatSessionDragEnd\(\)/, "row drag end clears the drop zone");
// Both row flavors are draggable to the chat.
assert.equal(
  (sidebar.match(/\{\.\.\.sessionDragProps\(session\.id, title\)\}/g) ?? []).length,
  2,
  "search-result rows and folder rows are both drag sources",
);
// The dnd-kit reorder handle keeps sole ownership of its slot: a native drag
// started from inside it is cancelled.
assert.match(sidebar, /closest\?\.\("\[data-thread-drag-handle\]"\)/, "handle drags are exempted");
assert.equal(
  (sidebar.match(/data-thread-drag-handle=""/g) ?? []).length,
  2,
  "both reorder handles carry the exemption marker",
);

// ── Styles ───────────────────────────────────────────────────────────────────

assert.match(css, /\.chat-split__dropzone \{/, "drop overlay styles exist");
assert.match(css, /\.chat-split__preview \{/, "snap preview styles exist");
assert.match(
  css,
  /\.chat-split__preview \{ transition: none; \}/,
  "the preview respects prefers-reduced-motion",
);
assert.match(
  css,
  /\.chat-split__pane-panel\[data-focused="true"\]/,
  "the focused pane has a visible affordance",
);
assert.match(
  css,
  /\.chat-split__pane-panel:focus-visible/,
  "programmatic pane focus shows the standard ring",
);

// ── Focus + persistence + keyboard (cave-e3dj) ───────────────────────────────

// The host marks panes with the focus attribute and reports focus/pointer
// entry so the router's logical focus follows real interaction.
assert.match(host, /CHAT_SPLIT_PANE_ATTR = "data-chat-split-pane"/, "pane DOM marker exists");
assert.match(host, /data-focused=\{focusedPaneId === tile\.id \? "true" : undefined\}/, "focused pane is marked");
assert.match(host, /onFocusCapture=\{\(\) => onFocusPane\?\.\(tile\.id\)\}/, "focus entering a pane reports it");
assert.match(host, /onPointerDownCapture=\{\(\) => onFocusPane\?\.\(tile\.id\)\}/, "pointer down on a pane focuses it");
assert.match(host, /tabIndex=\{-1\}/, "panes accept programmatic focus");

// Sizes: only user-driven resizes persist, restore only for a matching pane
// set, and a divider double-click resets to an even split via remount.
assert.match(host, /if \(!meta\.isUserInteraction \|\| !onSizesChange\) return;/, "mount/programmatic layouts don't persist");
assert.match(host, /defaultLayout=\{defaultLayout\}/, "restored sizes feed the group");
assert.match(host, /keys\.length !== ids\.length \|\| !ids\.every\(\(id\) => id in sizes\)/, "stale size maps fall back to even");
assert.match(host, /onDoubleClick=\{\(\) => \{/, "divider double-click resets");
assert.match(host, /setResetNonce\(\(nonce\) => nonce \+ 1\)/, "reset remounts the group");

// The router hydrates the split once, persists changes, and prunes dead panes.
assert.match(router, /parsePersistedChatSplit\(window\.localStorage\.getItem\(CHAT_SPLIT_STORAGE_KEY\)\)/, "layout hydrates from storage");
assert.match(router, /serializeChatSplit\(split, splitSizes\)/, "layout + sizes persist");
assert.match(router, /if \(!enableSplitPanes \|\| splitHydratedRef\.current/, "only the opted-in surface hydrates");
assert.match(router, /pruneChatSplitPanes\(prev, \(id\) => sessions\.some/, "deleted sessions leave the persisted split");

// Keyboard: ⌥⌘arrows move focus, ⌥⌘W closes the focused secondary pane, and
// ⌥↵ on a thread-rail row opens it in a split.
assert.match(router, /chatSplitFocusTarget\(split, focusedPane, delta\)/, "arrow keys move pane focus");
assert.match(router, /e\.code === "KeyW"/, "close matches on e.code (⌥ composes e.key on macOS)");
assert.match(router, /closest\?\.\('\[aria-modal="true"\]'\)/, "modals own the keyboard");
assert.match(router, /chatSplitKeyboardZone\(split\)/, "keyboard split lands on the current axis");
assert.match(router, /onOpenSessionInSplit=\{enableSplit \? handleOpenSessionInSplit : undefined\}/, "the thread rail gets the split opener only when splits are on");
assert.match(router, /announce\(/, "split changes are announced to the live region");
assert.match(router, /focusedPaneId=\{effectiveFocusedPane\}/, "the host renders the reconciled focus");

// The thread rail rows: ⌥↵ opens in a split, plain ↵ still opens.
assert.match(sidebar, /onOpenSessionInSplit\?: \(session: SessionRow\) => void;/, "sidebar accepts the split opener");
assert.equal(
  (sidebar.match(/if \(e\.altKey && onOpenInSplit\) \{/g) ?? []).length,
  2,
  "both row flavors handle ⌥↵",
);

// ── Live IA wiring (the shell nav is the real thread rail) ───────────────────
// The Workspace mounts ChatSurface with hideThreadRail (the router's own
// project sidebar is hidden), so splits must reach the chat through the shell:
// WorkspaceSidebar rows are drag sources + ⌥↵/⌥-click split openers, routed
// through the pending-chat-action pipeline into the router handle.

const shellNav = await readFile(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const surface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");

assert.match(shellNav, /emitChatSessionDragStart\(\{ sessionId: session\.id, title \}\)/, "shell nav rows announce drags");
assert.match(shellNav, /setData\(CHAT_SESSION_DRAG_MIME, session\.id\)/, "shell nav drags carry the session MIME");
assert.match(shellNav, /if \(e\.key === "Enter" && e\.altKey && onOpenInSplit\) \{/, "shell nav rows handle ⌥↵");
assert.match(shellNav, /if \(e\.altKey && onOpenInSplit\) \{/, "shell nav rows handle ⌥-click");
assert.equal(
  (shellNav.match(/onOpenInSplit=\{\s*onOpenSessionInSplit\s*\?\s*\(\)\s*=>\s*onOpenSessionInSplit\(session\)\s*:\s*undefined\s*\}/g) ?? [])
    .length >= 1,
  true,
  "thread rows receive the split opener",
);

assert.match(workspace, /kind: "open-split", sessionId: session\.id/, "the workspace files an open-split pending action");
assert.match(surface, /pendingChatAction\.kind === "open-split"/, "the chat surface routes open-split");
assert.match(surface, /openSessionInSplit\(pendingChatAction\.sessionId\)/, "open-split reaches the router handle");
assert.match(surface, /enableSplitPanes\b/, "the main chat surface opts into split panes");
assert.match(router, /openSessionInSplit: \(sessionId: string\) => \{/, "the router handle exposes openSessionInSplit");
assert.match(
  router,
  /if \(!enableSplit \|\| view\.kind !== "chat"\) \{/,
  "openSessionInSplit falls back to a plain open when it can't split",
);

console.log("chat-split-host.test.ts: ok");
