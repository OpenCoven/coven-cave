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
  /fetch\("\/api\/coven-calls"/,
  "AgentsView should actively load delegation traces on the default sessions surface",
);

assert.match(
  agentsView,
  /fetch\("\/api\/board"/,
  "AgentsView should load board context so inferred delegation traces are visible without opening the graph",
);

assert.match(
  agentsView,
  /setInterval\(loadDelegations,\s*10_000\)/,
  "AgentsView should poll delegation traces so live events keep updating",
);

assert.match(
  agentsView,
  /Live trace events/,
  "AgentsView should show live delegation trace events on the sessions surface",
);

assert.match(
  agentsView,
  /buildDelegationGraph\(\{[\s\S]*includeInferred: true/,
  "AgentsView should build the provenance-aware delegation graph with inferred traces included",
);

assert.match(
  agentsView,
  /setScope\("delegations"\)/,
  "AgentsView trace preview should provide a path into the full Delegations graph",
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
