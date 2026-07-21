import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canvasView = fs.readFileSync(
  path.join(root, "apps/ios/CovenCave/CovenCave/Views/CanvasView.swift"),
  "utf8",
);
const chatsHome = fs.readFileSync(
  path.join(root, "apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift"),
  "utf8",
);
const runner = fs.readFileSync(path.join(root, "scripts/run-tests.mjs"), "utf8");

// --- Canvas: one scene-aware load task, not two independent .task modifiers ---

const canvasTaskModifiers = canvasView.match(/^\s*\.task[\s({]/gm) ?? [];
assert.equal(
  canvasTaskModifiers.length,
  1,
  `CanvasView should have exactly one .task modifier (found ${canvasTaskModifiers.length}) — duplicate load tasks fire loadCanvas twice on appear`,
);

assert.match(
  canvasView,
  /\.task\(id: scenePhase\) \{\s*guard scenePhase == \.active else \{ return \}\s*if !app\.canvasLoaded \{ await app\.loadCanvas\(\) \}\s*\}/,
  "CanvasView's single load task should be scene-aware and guarded by canvasLoaded",
);

assert.match(
  canvasView,
  /\.refreshable \{ await app\.loadCanvas\(\) \}/,
  "Canvas pull-to-refresh must stay an unconditional loadCanvas",
);

// --- Chats: initial loadSessions guarded by sessionsLoaded ---

assert.match(
  chatsHome,
  /\.task \{ if !app\.sessionsLoaded \{ await app\.loadSessions\(\) \} \}/,
  "ChatsHomeView's initial load task should be guarded by sessionsLoaded",
);

assert.doesNotMatch(
  chatsHome,
  /\.task \{\s*await app\.loadSessions\(\)\s*\}/,
  "ChatsHomeView must not fire an unguarded loadSessions on every appear",
);

assert.match(
  chatsHome,
  /\.refreshable \{\s*await app\.loadFamiliars\(\)\s*await app\.loadSessions\(\)\s*\}/,
  "Chats pull-to-refresh must stay an unconditional familiar + session reload",
);

// --- Wiring ---

assert.match(
  runner,
  /"scripts\/ios-surface-load-discipline\.test\.mjs"/,
  "mobile test suite should run the iOS surface load discipline contract",
);

console.log("ios-surface-load-discipline.test.mjs: ok");
