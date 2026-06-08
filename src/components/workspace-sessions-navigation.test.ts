// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const sessionsView = await readFile(new URL("./sessions-view.tsx", import.meta.url), "utf8");
const slashCommands = await readFile(new URL("../lib/slash-commands.ts", import.meta.url), "utf8");

assert.doesNotMatch(
  workspace,
  /mode === "sessions"/,
  "Sessions mode branch has been removed from workspace",
);

assert.match(
  chatSurface,
  /import \{ SessionsView \} from "@\/components\/sessions-view"/,
  "ChatSurface imports SessionsView for the history fallback",
);

assert.match(
  workspace,
  /case "\/sessions":[\s\S]*?setMode\("chat"\)/,
  "/sessions slash routes to chat surface",
);

assert.match(
  workspace,
  /onOpenSession=\{\(sessionId, familiarId\) => \{[\s\S]*openAgentSession\(sessionId, familiarId\)/,
  "ChatSurface receives onOpenSession wired to openAgentSession",
);

assert.match(
  sessionsView,
  /function harnessLabel\(harness: string \| undefined\): string/,
  "SessionsView should normalize harness names for display",
);

assert.match(
  sessionsView,
  /OpenClaw[\s\S]*Hermes[\s\S]*Codex[\s\S]*Claude Code/,
  "SessionsView should advertise the supported all-harness session scope",
);

assert.match(
  sessionsView,
  /const harness = harnessLabel\(session\.harness\)/,
  "Session rows/cards should include each session's harness label",
);

assert.match(
  slashCommands,
  /name: "\/sessions"[\s\S]*description: "Open all sessions across familiars and harnesses\."/,
  "Slash command help should describe Sessions as cross-familiar and cross-harness",
);
