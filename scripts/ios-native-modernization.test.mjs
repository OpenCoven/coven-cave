import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = "apps/ios/CovenCave/CovenCave";
const read = (path) => readFile(path, "utf8");

const theme = await read(`${root}/Theme/Theme.swift`);

assert.match(theme, /var stateSuccess: Color/, "ChromePalette should expose a success state role");
assert.match(theme, /var stateWarning: Color/, "ChromePalette should expose a warning state role");
assert.match(theme, /var stateDanger: Color/, "ChromePalette should expose a danger state role");
assert.match(theme, /var presenceActive: Color/, "ChromePalette should expose an active presence role");
assert.match(
  theme,
  /static func status\(_ status: CardStatus, chrome: ChromePalette\) -> Color/,
  "task status colour should be resolved from the active chrome palette",
);
assert.match(
  theme,
  /static func presence\(_ status: String\?, chrome: ChromePalette\) -> Color\?/,
  "familiar presence colour should be resolved from the active chrome palette",
);

const drawer = await read(`${root}/Views/NavigationDrawer.swift`);
assert.doesNotMatch(drawer, /font\(\.system\(size: 17\)\)/,
  "drawer rows should use Dynamic Type styles rather than fixed 17-point type");
assert.doesNotMatch(drawer, /font\(\.system\(size: 26, weight: \.semibold, design: \.serif\)\)/,
  "drawer title should scale with Dynamic Type");

const newChat = await read(`${root}/Views/NewChatView.swift`);
assert.match(newChat, /"Start with a familiar"/,
  "New Chat should name familiar selection as the first intentional step");

console.log("ios-native-modernization: ok");
