// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const slashCommands = await readFile(new URL("../lib/slash-commands.ts", import.meta.url), "utf8");

assert.doesNotMatch(
  workspace,
  /mode === "sessions"/,
  "Sessions mode branch has been removed from workspace",
);

assert.doesNotMatch(
  chatSurface,
  /import \{ SessionsView \}/,
  "ChatSurface should no longer import SessionsView — ChatList from chat-router is the single chat list",
);

assert.match(
  workspace,
  /case "\/sessions":[\s\S]*?setMode\("chat"\)/,
  "/sessions slash routes to chat surface",
);

assert.match(
  slashCommands,
  /name: "\/sessions"[\s\S]*description: "Open all sessions across familiars and runtimes\."/,
  "Slash command help should describe Sessions as cross-familiar and cross-runtime",
);

// The daemon-offline banner must only appear once the status poll has resolved
// — never during the initial unknown window (which flashed the banner on load).
assert.match(
  workspace,
  /else if \(daemonStatusResolved\)/,
  "daemon-offline banner is gated on a resolved status, not the initial unknown state",
);

assert.match(
  workspace,
  /classifyDaemonStatusPoll\(/,
  "daemon status polling should distinguish definitive offline from unavailable checks",
);

assert.match(
  workspace,
  /requestId !== daemonStatusRequestRef\.current/,
  "an older status poll must not overwrite a newer post-start result",
);

assert.match(
  workspace,
  /id: "daemon-status-unavailable"[\s\S]{0,300}label: "Retry"/,
  "inconclusive daemon checks should be retryable without offering Start daemon",
);

const unavailableBranch = workspace.match(
  /if \(result\.kind === "unavailable"\) \{([\s\S]*?)\n    \}/,
)?.[1] ?? "";
assert.doesNotMatch(
  unavailableBranch,
  /setDaemonOffline\(false\)/,
  "an inconclusive check must not clear a previously confirmed sticky offline state",
);
