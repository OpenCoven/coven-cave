import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const parser = await read("apps/ios/CovenCave/CovenCave/Models/TerminalCommand.swift");
const composer = await read("apps/ios/CovenCave/CovenCave/Views/TerminalComposer.swift");
const terminal = await read("apps/ios/CovenCave/CovenCave/Views/TerminalView.swift");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");
const chats = await read("apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift");

assert.match(
  parser,
  /switch trimmed\.lowercased\(\) \{[\s\S]*?case "\/help", "\/\?":[\s\S]*?case "\/clear", "\/cls":[\s\S]*?case "\/cwd":/,
  "the parser should locally handle only exact terminal command strings",
);
assert.match(
  parser,
  /default:\s*return \.send\(trimmed\)/,
  "unknown slash-prefixed input must pass through unchanged to the shell",
);
assert.match(
  composer,
  /TextField\("Command or shell input", text: \$draft, axis: \.vertical\)[\s\S]*?\.lineLimit\(1\.\.\.5\)[\s\S]*?\.onSubmit\(send\)/,
  "the native composer should support multiline editing and submit",
);
assert.match(
  composer,
  /onSend\(input \+ "\\n"\)/,
  "sending must append exactly one newline at the native boundary",
);
assert.match(
  composer,
  /\.disabled\(!canSend\)[\s\S]*?accessibilityLabel\("Send to terminal"\)/,
  "disconnected/exited sessions must preserve instead of dropping a draft",
);
assert.match(
  terminal,
  /XtermWebView\([\s\S]*?onInput: \{ terminal\.sendInput\(\$0\) \}[\s\S]*?TerminalComposer\(/,
  "the native composer must sit outside the existing Xterm input path",
);
assert.match(
  model,
  /struct TerminalFamiliarHandoff[\s\S]*?func requestTerminalFamiliarHandoff[\s\S]*?selectedTab = \.chats[\s\S]*?newChatRequested = true/,
  "Ask Familiar should hand off draft and cwd through the native chat flow",
);
assert.match(
  chats,
  /initialProjectRoot: app\.terminalFamiliarHandoff\?\.cwd[\s\S]*?app\.applyTerminalFamiliarHandoff\(to: thread\)/,
  "the chat handoff should retain cwd and prefill the new chat",
);
assert.doesNotMatch(
  model,
  /requestTerminalFamiliarHandoff[\s\S]{0,1000}\.send\(/,
  "Ask Familiar must never execute an AI-produced or terminal command",
);

console.log("ios-terminal-composer: OK");
