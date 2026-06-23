import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const browser = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/CodeBrowserView.swift", import.meta.url),
  "utf8",
);
const reading = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/ReadingView.swift", import.meta.url),
  "utf8",
);
const tasks = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/TasksView.swift", import.meta.url),
  "utf8",
);
const runner = await readFile(new URL("./run-tests.mjs", import.meta.url), "utf8");

assert.match(
  browser,
  /\.navigationBarTitleDisplayMode\(\.inline\)/,
  "iOS Code view should use the compact navigation title",
);
assert.match(
  reading,
  /\.navigationBarTitleDisplayMode\(\.inline\)/,
  "iOS Reading view should use the compact navigation title",
);
assert.match(
  tasks,
  /\.navigationBarTitleDisplayMode\(\.inline\)/,
  "iOS Tasks view should use the compact navigation title",
);
assert.match(
  browser,
  /CodeNode\([\s\S]*isProject: true,[\s\S]*autoExpand: true,[\s\S]*color:/,
  "iOS Code view should expand project roots so files are visible immediately",
);
assert.match(
  browser,
  /private func expandAndLoad\(\)[\s\S]*if isProject \{ onFocusProject\?\(\) \}[\s\S]*Task \{ await load\(\) \}/,
  "iOS Code view should focus and load project trees from one expansion path",
);
assert.match(
  browser,
  /\.onAppear \{[\s\S]*if autoExpand \{ expandAndLoad\(\) \}[\s\S]*\}/,
  "iOS Code view should auto-load expanded project roots on appear",
);
assert.match(
  browser,
  /\.listStyle\(\.plain\)/,
  "iOS Code project tree should use a minimal plain list",
);
assert.match(
  browser,
  /Capsule\(\)[\s\S]*\.frame\(width: 3, height: 18\)/,
  "iOS Code project rows should use a compact color accent",
);
assert.match(
  browser,
  /Text\(name\)\.font\(\.subheadline\.weight\(\.semibold\)\)/,
  "iOS Code project rows should use compact row typography",
);
assert.match(
  runner,
  /"scripts\/ios-code-browser-files\.test\.mjs"/,
  "ios-code-browser-files test should be wired into the mobile suite",
);

console.log("ios-code-browser-files.test.mjs: ok");
