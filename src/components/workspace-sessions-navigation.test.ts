// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const modes = await readFile(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");
const sessionsView = await readFile(new URL("./sessions-view.tsx", import.meta.url), "utf8");
const slashCommands = await readFile(new URL("../lib/slash-commands.ts", import.meta.url), "utf8");

assert.match(
  modes,
  /\|\s+"sessions"/,
  "WorkspaceMode should include a dedicated Sessions mode",
);

assert.match(
  workspace,
  /import \{ SessionsView \} from "@\/components\/sessions-view";/,
  "Workspace should import SessionsView for the Sessions navigation entry",
);

assert.match(
  workspace,
  /case "\/sessions":[\s\S]*setMode\("sessions"\)/,
  "The /sessions slash command should route to the cross-harness Sessions view",
);

assert.match(
  workspace,
  /mode === "sessions" \? \([\s\S]*<SessionsView[\s\S]*activeFamiliarId=\{null\}/,
  "Workspace should mount SessionsView in all-session mode from the Sessions nav entry",
);

assert.match(
  workspace,
  /onOpenSession=\{\(sessionId, familiarId\) => \{[\s\S]*openAgentSession\(sessionId, familiarId\)/,
  "SessionsView should open the selected session with its familiar context",
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
