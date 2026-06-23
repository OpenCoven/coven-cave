import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const model = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/State/AppModel.swift", import.meta.url),
  "utf8",
);
const root = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/RootView.swift", import.meta.url),
  "utf8",
);

// The bottom-tab enum no longer carries a canvas case.
assert.match(
  model,
  /enum AppTab: String \{ case chats, read, tasks, dev \}/,
  "AppTab should drop the canvas case",
);
// The enum line itself must not list a canvas case (dormant canvas *state*
// elsewhere in the model is intentionally left in place by this minimal scope).
const appTabLine = model.match(/enum AppTab: String \{[^}]*\}/)?.[0] ?? "";
assert.doesNotMatch(appTabLine, /\bcanvas\b/, "AppTab case list should not include canvas");

// The app opens on Chats now that Canvas is gone.
assert.match(model, /var selectedTab: AppTab = \.chats/, "default tab should be chats");

// The tab bar no longer mounts a Canvas tab and no longer re-asserts it.
assert.doesNotMatch(root, /Tab\("Canvas"/, "RootView should not declare a Canvas tab");
assert.doesNotMatch(root, /CanvasView\(\)/, "RootView should not instantiate CanvasView");
assert.doesNotMatch(root, /selectedTab = \.canvas/, "RootView should not re-assert the canvas tab");

console.log("ios-no-canvas-tab.test.mjs: ok");
