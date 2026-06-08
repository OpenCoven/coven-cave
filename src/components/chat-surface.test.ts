// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const agentsMemoryView = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(
  chatSurface,
  /export function ChatSurface/,
  "ChatSurface should be the integrated top-level chat surface",
);

assert.match(
  chatSurface,
  /placeholder="Search"/,
  "ChatSurface should keep chat search in the primary command row",
);

assert.match(
  chatSurface,
  /New/,
  "ChatSurface should expose the primary chat launch action without a separate composer block",
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
  /<AgentsMemoryView[\s\S]*familiars=\{familiars\}[\s\S]*activeFamiliar=\{activeFamiliar\}/,
  "ChatSurface should surface comprehensive memory as a first-class tab",
);

assert.match(
  chatSurface,
  /memory: "Memory"/,
  "ChatSurface should label the third primary tab Memory instead of Traces",
);

// b05fba5 dropped the redundant group-by-Familiar option (familiar scoping
// lives in the avatar rail now). Status/Date/None remain. Lock the removal
// in so a regression that adds "Familiar" back surfaces immediately.
assert.match(
  chatSurface,
  /useState<"status" \| "date" \| "none">/,
  "ChatSurface group-by must only support status/date/none — Familiar option removed by b05fba5",
);
assert.doesNotMatch(
  chatSurface,
  /setGroupBy\("familiar"\)/,
  "ChatSurface should not reintroduce a Familiar group-by button",
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
  /Agent memories[\s\S]*Memory files[\s\S]*Agents with memory/,
  "Agents memory view should summarize the focused agent surface and supporting file source",
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

assert.match(
  chatSurface,
  /<InspectorPane\s+familiar=\{activeFamiliar\}\s+inboxItems=\{inboxItems\}\s+onOpenInbox=\{onOpenInbox\}/,
  "ChatSurface should preserve the inbox-backed inspector entry point",
);

assert.match(
  chatSurface,
  /<aside className="relative hidden h-full min-h-0 w-\[320px\] shrink-0 border-l border-\[var\(--border-hairline\)\] lg:flex lg:flex-col">/,
  "ChatSurface right side panel should be height-bounded so its body can scroll vertically",
);

assert.match(
  chatSurface,
  /<div className="min-h-0 flex-1 overflow-hidden">\s*\{panel === "inspector" &&/,
  "ChatSurface right side panel should put tab content in a min-height-zero scroll boundary",
);

assert.match(
  chatSurface,
  /scope === "conversation" \? \(\s*<div className="flex min-h-0 min-w-0 flex-1">/,
  "ChatSurface conversation row should use remaining height below the tab bar instead of h-full",
);

assert.match(
  workspace,
  /mode === "chat"[\s\S]*<ChatSurface/,
  "Workspace should mount ChatSurface for chat mode",
);

assert.match(
  workspace,
  /onOpenInboxItem=\{\(item\) => \{[\s\S]*openAgentSession\(item\.sessionId, item\.familiarId\)[\s\S]*setMode\("inbox"\)/,
  "Workspace should keep notification-bell inbox routing intact for session and non-session items",
);
