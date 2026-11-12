// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Successor to right-sidebar-fit.test.ts: the Inspector right sidepanel is
// retired, so the code rail is the only right sidepanel on the chat surface.
// These pins hold the surviving layout contracts (split persistence, rail
// sizing, the collapsed reopen rail) and guard the retired panel's fossils.

const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const reopen = await readFile(new URL("./code-rail-reopen.tsx", import.meta.url), "utf8");
const controller = await readFile(new URL("../lib/use-workspace-rail-controller.ts", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const caveChatAux = await readFile(new URL("../styles/cave-chat/auxiliary-surfaces.css", import.meta.url), "utf8");
const caveChat = (
  await Promise.all(
    ["cave-md", "cave-composer", "chat-list", "calendar", "cave-chat"].map((sheet) =>
      readFile(new URL(`../styles/${sheet}.css`, import.meta.url), "utf8"),
    ),
  )
).join("\n");

// The split width must persist across reloads via useDefaultLayout under
// CHAT_GROUP_ID, keyed by the mounted panel set (bare vs with-code-rail).
assert.match(
  chatSurface,
  /useDefaultLayout\(\{[\s\S]*id: CHAT_GROUP_ID[\s\S]*storage: chatStorage/,
  "ChatSurface should persist the chat/right-area split width across reloads",
);

assert.match(
  chatSurface,
  /<Group[\s\S]*orientation="horizontal"[\s\S]*defaultLayout=\{defaultLayout\}[\s\S]*onLayoutChanged=\{onLayoutChanged\}/,
  "The horizontal chat Group should apply the persisted layout",
);

// The code rail is the ONLY right sidepanel: exactly one right-side Panel
// (id="code-rail"), drag-resizable behind an outer separator.
assert.match(
  chatSurface,
  /Panel[\s\S]*id="code-rail"[\s\S]*defaultSize="280px"[\s\S]*minSize="220px"[\s\S]*maxSize="480px"/,
  "ChatSurface code rail should default to 280px, drag-resizable within a compact 220–480px band",
);
assert.doesNotMatch(
  chatSurface,
  /id="right-sidebar"|id="right-panel-primary"|id="right-panel-changes"/,
  "the retired inspector right sidebar must not remount beside the code rail",
);
assert.match(
  chatSurface,
  /<Separator className="shell-separator hidden lg:flex">[\s\S]*<SeparatorHandle orientation="col" \/>/,
  "The code rail should have an outer drag-to-resize separator before it",
);

// ── Collapsed code rail — the reflection of the left nav's collapsed rail ──
// A closed rail leaves a small reopen tab at the right edge of wide panes.
assert.match(
  chatSurface,
  /rail\.available && !rail\.open && !isMobile && !paneNarrow && \([\s\S]{0,600}?<CodeRailReopen[\s\S]{0,300}?onOpen=\{railController\.openChanges\}/,
  "collapsing the code rail must leave a reopen rail (wide desktop panes) that restores it",
);

// A closed rail reserves no column; only the small transparent edge tab overlays.
assert.match(
  caveChatAux,
  /\.workspace-rail-reopen \{[^}]*position: absolute;[^}]*background: transparent;/,
  "the collapsed rail has no full-height opaque gutter",
);
assert.doesNotMatch(
  caveChatAux.match(/\.workspace-rail-reopen \{[^}]*\}/)?.[0] ?? "",
  /height: 100%|flex: 0 0/,
  "the Code control owns only the pull-tab bounds",
);

assert.match(reopen, /workspace-rail-reopen__label">Code</, "the Code label remains available for reveal");
assert.match(reopen, /ph:caret-left/, "the pull tab points inward");
assert.match(controller, /autoRevealChanges: false/, "new changes must not force open the conversation's code rail");
assert.match(reopen, /previousNonce\.current === changeNonce/, "unchanged polls cannot replay the cue");
assert.match(reopen, /setTimeout\(\(\) => setNotifying\(false\), 1600\)/, "reduced motion also settles the cue");
assert.match(caveChatAux, /animation: code-rail-change-nudge[^;]+ 2;/, "new changes expand exactly twice");

// The rail carries the left panel's glass (with honest fallbacks).
assert.match(
  caveChatAux,
  /\.workspace-rail-reopen__tab \{[\s\S]{0,500}?background: color-mix\(in oklch, var\(--bg-raised\) 65%, transparent\);/,
  "the pull tab is discreet at rest",
);
assert.match(
  caveChatAux,
  /@media \(prefers-reduced-transparency: reduce\) \{\s*\.workspace-rail-reopen:hover \.workspace-rail-reopen__tab,/,
  "rail glass respects reduced transparency",
);

// The retired inspector panel's CSS fossils stay deleted.
assert.doesNotMatch(
  globals,
  /\.right-panel-tabs\s*\{|\.right-panel-tab\s*\{|\.chat-right-aside\s*\{|right-panel-strip--closed\s*\{/,
  "the retired right-panel / chat-right-aside CSS fossils stay deleted",
);
assert.doesNotMatch(
  caveChat,
  /\.chat-right-rail\b/,
  "the retired Inspector reopen-rail CSS stays deleted",
);

console.log("code-rail-fit.test.ts OK");
