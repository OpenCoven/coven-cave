// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const slashCommands = await readFile(new URL("../lib/slash-commands.ts", import.meta.url), "utf8");
// b7ecf460e ("decouple heartbeat from daemon diagnostics") moved daemon-status
// staleness out of workspace.tsx and into the connection supervisor, so the
// guard has to be asserted where it now lives.
const daemonSupervisor = await readFile(
  new URL("../lib/daemon-connection-supervisor.ts", import.meta.url),
  "utf8",
);

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

// Same behaviour, new owner: the supervisor stamps each request with a
// generation and only accepts a result while that generation is still current,
// which is what the old requestGate.isLatest(requestId) call did in-line.
assert.match(
  daemonSupervisor,
  /generation === request\.generation/,
  "an older status poll must not overwrite a newer post-start result",
);
assert.doesNotMatch(
  workspace,
  /requestGate\.isLatest\(/,
  "workspace no longer hand-rolls the staleness gate — the supervisor owns it",
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
