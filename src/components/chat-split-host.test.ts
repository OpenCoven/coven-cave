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
  /const enableSplit = !compact && !isMobile && !caveChatoutCodex\(\);/,
  "splits are desktop-only: compact rail, mobile and the Codex surface opt out",
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

console.log("chat-split-host.test.ts: ok");
