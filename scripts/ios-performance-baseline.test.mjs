import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const performance = read(
  "apps/ios/CovenCave/CovenCave/Performance/CavePerformance.swift",
);
const fixture = read(
  "apps/ios/CovenCave/CovenCave/Performance/CavePerformanceFixture.swift",
);
const rootView = read(
  "apps/ios/CovenCave/CovenCave/Views/RootView.swift",
);
const projectSwitcher = read(
  "apps/ios/CovenCave/CovenCave/Views/ProjectSwitcherView.swift",
);
const search = read(
  "apps/ios/CovenCave/CovenCave/Views/GlobalSearchView.swift",
);
const markdown = read(
  "apps/ios/CovenCave/CovenCave/Views/MarkdownWebView.swift",
);
const bubble = read(
  "apps/ios/CovenCave/CovenCave/Views/MessageBubble.swift",
);
const app = read(
  "apps/ios/CovenCave/CovenCave/CovenCaveApp.swift",
);
const appModel = read(
  "apps/ios/CovenCave/CovenCave/State/AppModel.swift",
);
const runner = read("scripts/run-tests.mjs");
const uiTest = read(
  "apps/ios/CovenCave/CovenCaveUITests/PerformanceBaselineUITests.swift",
);

const spanNames = [
  "drawer.open",
  "project.switcher.present",
  "project.switch",
  "destination.stable-frame",
  "search.query",
  "chat.first-rich-render",
  "project.projection",
];

for (const name of spanNames) {
  assert.match(
    performance,
    new RegExp(`"${name.replaceAll(".", "\\.")}"`),
    `CavePerformance should declare the stable ${name} span`,
  );
}

assert.match(
  fixture,
  /static let launchArgument = "--performance-fixture"/,
  "the Release performance fixture must use one explicit launch argument",
);
assert.match(
  fixture,
  /static let startTasksLaunchArgument = "--performance-fixture-start-tasks"/,
);
assert.doesNotMatch(
  fixture,
  /#if DEBUG/,
  "the opt-in performance fixture must compile into Release builds",
);
assert.match(fixture, /projectCount = 20/);
assert.match(fixture, /localChatCount = 1_000/);
assert.match(fixture, /serverSessionCount = 1_000/);
assert.match(fixture, /taskCount = 1_000/);
assert.match(fixture, /familiarCount = 12/);
assert.match(fixture, /let isRichStreamingThread = index == 0/);
assert.match(fixture, /streaming: isRichStreamingThread/);
assert.match(fixture, /```swift/);
assert.match(
  fixture,
  /static var threadStoreURL:[\s\S]*performance-fixture[\s\S]*cave-threads\.json/,
  "the fixture must persist only to a fixture-specific thread store",
);
assert.match(
  fixture,
  /projectRoot: index == localChatCount - 1 \? nil : project\.root/,
);

assert.match(app, /CavePerformanceFixture\.shouldEnable/);
assert.match(app, /CavePerformanceFixture\.install/);
assert.match(
  app,
  /widgetSnapshotDefaults: fixtureDefaults/,
  "fixture widget snapshots must not reach the production app group",
);
assert.match(
  app,
  /threadStoreURL: performanceFixtureEnabled\s*\?\s*CavePerformanceFixture\.threadStoreURL\s*:\s*nil/,
  "fixture thread persistence must use its isolated store",
);
assert.match(
  appModel,
  /var projectsLoaded = false \{\s*didSet \{ invalidateProjectProjection\(\) \}\s*\}/,
  "project load-state changes must invalidate the switcher projection",
);
assert.match(
  appModel,
  /var projectContextError: String\? \{\s*didSet \{ invalidateProjectProjection\(\) \}\s*\}/,
  "project context errors must invalidate the switcher projection",
);
assert.match(appModel, /\.drawerOpen/);
assert.match(rootView, /\.projectSwitcherPresent/);
assert.match(rootView, /\.destinationStableFrame/);
assert.match(appModel, /\.projectSwitch/);
assert.match(projectSwitcher, /\.projectProjection/);
assert.match(
  projectSwitcher,
  /if case \.loaded = projectedState \{\s*app\.performanceSpans\.finish\(\.projectSwitcherPresent\)\s*\}/,
  "switcher presentation must settle on loaded rows, not the loading placeholder",
);
assert.match(search, /\.searchQuery/);
assert.match(markdown, /onRenderComplete/);
assert.match(
  markdown,
  /let callback = onRenderStart\s*DispatchQueue\.main\.async \{ callback\?\(\) \}/,
  "rich-render state changes must be deferred past updateUIView",
);
assert.match(bubble, /onRichRenderComplete/);
assert.match(uiTest, /--performance-instrumentation/);
assert.match(uiTest, /--performance-fixture/);
assert.match(uiTest, /--performance-fixture-start-tasks/);
assert.match(uiTest, /Project row project:performance-fixture-project-/);
assert.match(uiTest, /Search everything…/);
assert.match(
  runner,
  /"scripts\/ios-performance-baseline\.test\.mjs"/,
  "mobile test suite should run the iOS performance baseline contract",
);

console.log("ios-performance-baseline.test.mjs: ok");
