import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const terminalView = fs.readFileSync(
  path.join(root, "apps/ios/CovenCave/CovenCave/Views/TerminalView.swift"),
  "utf8",
);
const rootView = fs.readFileSync(
  path.join(root, "apps/ios/CovenCave/CovenCave/Views/RootView.swift"),
  "utf8",
);
const xtermWebView = fs.readFileSync(
  path.join(root, "apps/ios/CovenCave/CovenCave/Views/XtermWebView.swift"),
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

assert.match(
  rootView,
  /@State private var terminal = PtyTerminal\(\)[\s\S]*@State private var terminalCwd: String\?[\s\S]*TerminalView\(terminal: terminal, cwd: \$terminalCwd\)/,
  "the one-view shell should retain exactly one terminal transport and cwd across destination changes",
);
assert.match(
  terminalView,
  /if terminal\.connected \{[\s\S]{0,240}terminal\.reattach\(\)\s*\} else if !terminal\.exited \{\s*connect\(\)\s*\}/,
  "returning to Terminal should replay server scrollback into the remounted renderer",
);
assert.doesNotMatch(
  terminalView,
  /\.onDisappear\s*\{[\s\S]{0,100}terminal\.disconnect\(\)/,
  "destination switching should not detach and reap the retained shell",
);

assert.match(
  xtermWebView,
  /static func dismantleUIView\([\s\S]*removeScriptMessageHandler\(forName: "term"\)[\s\S]*navigationDelegate = nil[\s\S]*terminal\.onData = nil[\s\S]*terminal\.onReset = nil/,
  "dismantling xterm should break WebKit handlers, delegates, and terminal callbacks",
);

console.log("ios-development-terminal-chrome.test.mjs: ok");
