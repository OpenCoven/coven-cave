// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const agentsView = await readFile(new URL("./agents-view.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const callsView = await readFile(new URL("./calls-view.tsx", import.meta.url), "utf8");

assert.match(
  agentsView,
  /export function AgentsView/,
  "AgentsView should be the integrated top-level agents surface",
);

assert.match(
  agentsView,
  /Created by me/,
  "AgentsView should include a GitHub Sessions-style ownership scope",
);

assert.match(
  agentsView,
  /Give an agent a background task to work on/,
  "AgentsView should include an agent task composer",
);

assert.match(
  agentsView,
  /Get started with agents/,
  "AgentsView should include quick-start cards",
);

assert.match(
  agentsView,
  /<CovenFloor \/>/,
  "AgentsView should integrate the Floor directly",
);

assert.match(
  agentsView,
  /<CallsView[\s\S]*embedded[\s\S]*initialTab="delegations"/,
  "AgentsView should embed the delegation graph rather than sending users to a separate Calls tab",
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

assert.match(
  callsView,
  /embedded\?: boolean/,
  "CallsView should support embedded rendering inside Agents",
);
