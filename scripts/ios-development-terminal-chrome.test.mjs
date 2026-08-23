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
  /statusButton/,
  "TerminalView should not render the top-right connection status button",
);

assert.match(
  terminalView,
  /ProjectContextButton \{\s*showingProjectSwitcher = true\s*\}/,
  "TerminalView should use the shared project context control in its header",
);

assert.doesNotMatch(
  terminalView,
  /cwdMenu|showingProjectPicker|confirmationDialog\("New terminal"\)|Button\("Home"\)|\/cwd chooses a working directory/,
  "TerminalView should not own a Home/cwd picker or a new-terminal project chooser",
);

assert.match(
  rootView,
  /@State private var terminal = PtyTerminal\(\)[\s\S]*TerminalView\(terminal: terminal\)/,
  "the one-view shell should retain exactly one terminal transport across destination changes",
);
assert.match(
  terminalView,
  /struct ProjectSession:[\s\S]*var threadId: String \{[\s\S]*PtyTerminalProjectIdentity\.threadID\([\s\S]*projectID: projectId[\s\S]*projectRoot: projectRoot[\s\S]*\}[\s\S]*registeredProjects\.first\(where: \{ \$0\.id == selected\.id \}\) \?\? selected/,
  "the terminal session should derive project root from the active project and fingerprint that root into the persistent PTY id",
);
assert.match(
  terminalView,
  /switch terminalContext \{[\s\S]*case \.project\(let session\):[\s\S]*projectTerminal\(session\)[\s\S]*case \.unassigned:[\s\S]*recoveryOnlyState[\s\S]*case \.unresolved:[\s\S]*ProjectContextGateView\(\)/,
  "TerminalView should gate registered, unassigned, and unresolved contexts explicitly",
);
assert.match(
  terminalView,
  /private var recoveryOnlyState: some View \{[\s\S]*ContentUnavailableView[\s\S]*Button\("Switch project"\)/,
  "Unassigned terminal context should stay recovery-only and offer only a Switch project action",
);
assert.match(
  terminalView,
  /private func syncTerminalSession\([\s\S]*if terminal\.isBound\([\s\S]*if reattachIfBound, terminal\.connected \{[\s\S]*terminal\.reattach\(\)[\s\S]*terminal\.disconnect\(\)\s*connect\(\)/,
  "same-project remounts should reattach, while context switches disconnect before reconnecting",
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
