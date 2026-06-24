import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The Developer surface used to swallow failures silently — a failed code search
// looked like "no results", a failed tree-node load looked like an empty folder,
// and a dropped terminal socket looked like a frozen shell. Each should now show
// an honest error + retry. This locks that wiring.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const code = await read("apps/ios/CovenCave/CovenCave/Views/CodeBrowserView.swift");
const term = await read("apps/ios/CovenCave/CovenCave/Views/TerminalView.swift");

// --- Code search: track the error, set it in catch, show "Search failed" + Retry
assert.match(code, /@State private var searchError: String\?/, "search should track an error state");
assert.match(
  code,
  /catch \{[\s\S]*?searchError = error\.localizedDescription/,
  "a failed search should record the error (not silently empty the results)",
);
assert.match(
  code,
  /else if let searchError \{[\s\S]*?Label\("Search failed"[\s\S]*?Button\("Retry"\)/,
  "the search empty-state should show 'Search failed' + Retry when a search errored",
);

// --- Tree node: track the error, set it in load() catch, show error row + Retry
assert.match(code, /@State private var nodeError: String\?/, "a tree node should track a load error");
assert.match(
  code,
  /catch \{[\s\S]*?nodeError = error\.localizedDescription/,
  "a failed folder load should record the error (not look like an empty folder)",
);
assert.match(
  code,
  /else if let nodeError \{[\s\S]*?Button\("Retry"\) \{ Task \{ await load\(\) \} \}/,
  "an errored folder should show the error with a Retry that reloads it",
);

// --- Terminal: show the connection error with a Reconnect when the socket is down
assert.match(
  term,
  /if !terminal\.connected, let err = terminal\.error \{[\s\S]*?Text\(err\)[\s\S]*?Button\("Reconnect"\) \{ connect\(\) \}/,
  "the terminal should surface its connection error with a Reconnect button",
);

console.log("ios-surface-failures: OK");
