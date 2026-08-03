import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const desktopSlash = await read("src/lib/slash-commands.ts");
const iosSlash = await read(`${iosRoot}/Models/SlashCommand.swift`);
const chatView = await read(`${iosRoot}/Views/ChatView.swift`);
const commandsSheet = await read(`${iosRoot}/Views/CommandsSheet.swift`);

const desktopCommands = [...desktopSlash.matchAll(/name: "(\/[^"]+)"/g)]
  .map((match) => match[1])
  // /canvas is retired on iOS; /save stays off the native catalog while the
  // Library feature lives on feature/library (ios-library-isolation guard).
  .filter((name) => !["/canvas", "/save", "/rituals", "/projects"].includes(name));

for (const command of desktopCommands) {
  assert.match(
    iosSlash,
    new RegExp(`name: "${command.replace("/", "\\/")}"`),
    `iOS slash catalog should recognize ${command}`,
  );
}

assert.doesNotMatch(iosSlash, /name: "\/canvas"/, "iOS should not reintroduce the removed Canvas command");
assert.match(iosSlash, /name: "\/toggle-agent"/, "iOS should recognize the desktop side-panel toggle token");

assert.match(
  iosSlash,
  /static let available: \[SlashCommand\] = all\.filter \{ \$0\.availability == \.native \}/,
  "iOS should expose a native-only visible command list",
);
assert.match(
  iosSlash,
  /if q == "\/" \{ return available \}/,
  "inline slash autocomplete should show only native iOS commands for bare slash",
);
assert.match(
  iosSlash,
  /return available\.filter/,
  "inline slash autocomplete should filter only native iOS commands",
);
assert.match(
  commandsSheet,
  /SlashCatalog\.available/,
  "Commands sheet should list native iOS commands instead of desktop-only no-ops",
);
assert.doesNotMatch(
  commandsSheet,
  /command\.availability == \.desktopOnly|Text\("Desktop"\)/,
  "Commands sheet should not render desktop-only command rows on iOS",
);

assert.match(
  iosSlash,
  /name: "\/terminal"[\s\S]{0,240}availability: \.native[\s\S]{0,120}action: \.openTerminal/,
  "/terminal should open the native Terminal tab",
);
assert.match(
  chatView,
  /case \.openTerminal:[\s\S]{0,120}app\.selectedTab = \.terminal/,
  "/terminal routes directly to the Terminal tab",
);

// /model is native on iOS: it switches the chat model via the model-state API.
assert.match(
  iosSlash,
  /name: "\/model"[\s\S]{0,360}availability: \.native[\s\S]{0,80}action: \.switchModel/,
  "/model should be a native command wired to .switchModel",
);
assert.match(
  chatView,
  /case \.switchModel:[\s\S]{0,80}await switchModel\(args\)/,
  "Chat slash dispatch should handle /model via switchModel",
);
assert.match(
  chatView,
  /private func selectModel\([\s\S]{0,420}let stagedModel = model \?\? ""[\s\S]{0,240}thread\.pendingModelOverride = stagedModel[\s\S]{0,240}guard sessionId != nil \|\| model == nil else/,
  "switchModel should synchronously retain a model selection or runtime-default clear before any session write",
);
assert.match(
  chatView,
  /client\.setChatModel\(\s*familiarId:[\s\S]{0,220}scope: sessionId == nil \? "familiar-default" : "session"\)/,
  "switchModel should PATCH an existing session, or clear the familiar default before the first session",
);

for (const command of ["/auto", "/journal", "/automations", "/remind", "/attach", "/tui", "/toggle-agent"]) {
  const escaped = command.replace("/", "\\/");
  assert.match(
    iosSlash,
    // Bounded by the NEXT SlashCommand( rather than a character count: a
    // fixed window is too small for a verbose description and, widened,
    // starts matching the following entry's availability instead.
    new RegExp(`name: "${escaped}"(?:(?!SlashCommand\\()[\\s\\S])*?availability: \\.desktopOnly`),
    `${command} should remain recognized but hidden because it has no iOS surface`,
  );
}

console.log("ios-slash-commands.test.mjs: ok");
