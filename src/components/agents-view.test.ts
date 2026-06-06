// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const agentsView = await readFile(new URL("./agents-view.tsx", import.meta.url), "utf8");
const agentsMemoryView = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(
  agentsView,
  /export function AgentsView/,
  "AgentsView should be the integrated top-level agents surface",
);

assert.match(
  agentsView,
  /Search agents\.\.\./,
  "AgentsView should keep agent search in the primary command row",
);

assert.match(
  agentsView,
  /Chat/,
  "AgentsView should expose the primary chat launch action without a separate composer block",
);

assert.match(
  agentsView,
  /fetch\("\/api\/daemon\/start", \{ method: "POST" \}\)/,
  "AgentsView should make the offline daemon state actionable from the main Agents surface",
);

assert.match(
  agentsView,
  /Start daemon/,
  "AgentsView should show a clear start button when the daemon is offline",
);

assert.doesNotMatch(
  agentsView,
  /Get started with agents|Give an agent a background task to work on/,
  "AgentsView should not reintroduce the busy GitHub-style hero/composer cards",
);

assert.match(
  agentsView,
  /<CovenFloor \/>/,
  "AgentsView should integrate the Floor directly",
);

assert.match(
  agentsView,
  /<AgentsMemoryView[\s\S]*familiars=\{familiars\}[\s\S]*activeFamiliar=\{activeFamiliar\}/,
  "AgentsView should surface comprehensive memory as a first-class tab",
);

assert.match(
  agentsView,
  /memory: "Memory"/,
  "AgentsView should label the third primary tab Memory instead of Traces",
);

assert.match(
  agentsView,
  /groupBy[\s\S]*Familiar[\s\S]*Status[\s\S]*Date[\s\S]*None/,
  "AgentsView should preserve the Chats group-by controls while replacing traces with memory",
);

assert.doesNotMatch(
  agentsView,
  /Traces/,
  "AgentsView should not foreground trace terminology in the primary tabs",
);

assert.doesNotMatch(
  agentsView,
  /fetch\("\/api\/coven-calls"|buildDelegationGraph|loadDelegations/,
  "AgentsView should not load trace graph data just to render the primary agents surface",
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
  /Coven entries[\s\S]*Memory files[\s\S]*Familiars/,
  "Agents memory view should summarize all memory sources",
);

assert.match(
  agentsMemoryView,
  /familiarFilter/,
  "Agents memory view should support familiar-scoped memory filtering",
);

assert.doesNotMatch(
  agentsView,
  /Left nav|w-\[44px\]/,
  "AgentsView should not render a second persistent left navigation rail inside the app shell",
);

assert.match(
  agentsView,
  /<ChatRouter/,
  "AgentsView should keep live chat available inside the Agents tab",
);

assert.match(
  agentsView,
  /<InspectorPane\s+familiar=\{activeFamiliar\}\s+inboxItems=\{inboxItems\}\s+onOpenInbox=\{onOpenInbox\}/,
  "AgentsView should preserve the inbox-backed inspector entry point",
);

assert.match(
  workspace,
  /mode === "agents"[\s\S]*<AgentsView/,
  "Workspace should mount AgentsView for agents mode",
);

assert.match(
  workspace,
  /onOpenInboxItem=\{\(item\) => \{[\s\S]*openAgentSession\(item\.sessionId, item\.familiarId\)[\s\S]*setMode\("inbox"\)/,
  "Workspace should keep notification-bell inbox routing intact for session and non-session items",
);
