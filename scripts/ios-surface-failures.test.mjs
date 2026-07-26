import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// A dropped terminal socket must show an honest error and reconnect action.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const term = await read("apps/ios/CovenCave/CovenCave/Views/TerminalView.swift");

// --- Terminal: show the connection error with a Reconnect when the socket is down
assert.match(
  term,
  /if !terminal\.connected, let err = terminal\.error \{[\s\S]*?statusBanner\([\s\S]*?message: err, button: "Reconnect"[\s\S]*?\) \{ connect\(\) \}/,
  "the terminal should surface its connection error with a Reconnect button",
);

// --- Terminal: an exited shell (typed `exit`, crashed job) gets a Restart, not a dead pane
assert.match(
  term,
  /if terminal\.exited \{[\s\S]*?statusBanner\([\s\S]*?message: exitMessage, button: "Restart"[\s\S]*?\) \{ connect\(\) \}/,
  "an exited shell should surface a Restart affordance",
);

// --- The banner must actually render the message text passed to it
assert.match(
  term,
  /private func statusBanner\([\s\S]*?Text\(message\)/,
  "statusBanner should render the error/exit message text",
);

console.log("ios-surface-failures: OK");
