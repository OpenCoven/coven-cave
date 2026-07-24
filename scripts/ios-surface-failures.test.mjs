import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// A dropped terminal socket must show an honest error and reconnect action.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const term = await read("apps/ios/CovenCave/CovenCave/Views/TerminalView.swift");

// --- Terminal: show the connection error with a Reconnect when the socket is down
assert.match(
  term,
  /if !terminal\.connected, let err = terminal\.error \{[\s\S]*?Text\(err\)[\s\S]*?Button\("Reconnect"\) \{ connect\(\) \}/,
  "the terminal should surface its connection error with a Reconnect button",
);

console.log("ios-surface-failures: OK");
