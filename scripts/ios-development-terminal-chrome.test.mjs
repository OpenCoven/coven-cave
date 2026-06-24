import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const terminalView = fs.readFileSync(
  path.join(root, "apps/ios/CovenCave/CovenCave/Views/TerminalView.swift"),
  "utf8",
);

assert.doesNotMatch(
  terminalView,
  /\.navigationTitle\("Terminal"\)/,
  "TerminalView should not render a duplicate Terminal title inside Development",
);

assert.doesNotMatch(
  terminalView,
  /ToolbarItem\(placement: \.topBarLeading\)\s*\{\s*cwdMenu\s*\}/,
  "TerminalView should not keep folder selection in the top toolbar",
);

assert.doesNotMatch(
  terminalView,
  /statusButton/,
  "TerminalView should not render the top-right connection status button",
);

assert.match(
  terminalView,
  /HStack\(spacing: 8\)\s*\{\s*cwdMenu\s*keyButton\("esc", "Escape"\)/,
  "TerminalView should place the folder selector in the bottom key row before esc",
);

console.log("ios-development-terminal-chrome.test.mjs: ok");
