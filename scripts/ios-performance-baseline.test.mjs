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
const stableFrame = read(
  "apps/ios/CovenCave/CovenCave/Performance/CavePerformanceStableFrame.swift",
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
assert.match(fixture, /removePersistentDomain\(forName: defaultsSuiteName\)/);
assert.match(fixture, /removeItem\(at: fixtureDirectory\)/);
assert.doesNotMatch(
  fixture,
  /app\.selectedTab = \.chats/,
  "fixture installation must preserve the launch-selected destination",
);
assert.match(
  fixture,
  /projectRoot: index == localChatCount - 1 \? nil : project\.root/,
);

assert.match(app, /CavePerformanceFixture\.shouldEnable/);
assert.match(app, /CavePerformanceFixture\.install/);
assert.match(app, /CavePerformanceFixture\.makeIsolatedDefaults/);
assert.match(app, /\.defaultAppStorage\(appDefaults\)/);
assert.doesNotMatch(
  app,
  /app\.selectedTab = \.tasks/,
  "fixture startup must not create a synthetic destination timing sample",
);
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
assert.match(performance, /func cancel\(_ name: CavePerformanceSpanName\)/);
assert.match(performance, /func cancelAll\(\)/);
assert.match(performance, /func setSceneActive\(_ isActive: Bool\)/);
assert.match(performance, /guard sceneIsActive else \{ return \}/);
assert.match(stableFrame, /minimumDelay: TimeInterval = 0/);
assert.match(stableFrame, /CADisplayLink/);
assert.match(stableFrame, /displayTicksRemaining = 2/);
assert.match(stableFrame, /self\.generation == scheduledGeneration/);
assert.match(rootView, /\.projectSwitcherPresent/);
assert.match(rootView, /\.destinationStableFrame/);
assert.match(rootView, /app\.navigationDrawerAnimationSettled/);
assert.match(rootView, /!app\.projectSwitchMutationPending/);
assert.match(
  rootView,
  /ProjectSwitcherView \{ context in\s*guard app\.beginProjectSwitchMeasurement\(to: context\) else \{ return \}\s*dismissOverlay \{[\s\S]*measurementAlreadyStarted: true/,
  "project-switch timing must include modal dismissal while mutation waits for onDismiss",
);
assert.match(appModel, /\.projectSwitch/);
assert.match(
  appModel,
  /args\.contains\(CavePerformanceFixture\.startTasksLaunchArgument\)/,
  "the fixture's initial destination must be selected before observers can start spans",
);
assert.match(appModel, /func beginProjectSwitchMeasurement/);
assert.match(appModel, /projectSwitchMutationPending = true/);
assert.match(appModel, /publishWidgetSnapshot\(\)\s*projectSwitchMutationPending = false/);
assert.match(
  appModel,
  /thread\.projectRoot = projectRoot\s*changed = true[\s\S]*if changed \{\s*invalidateProjectProjection\(\)/,
  "in-place project-root reconciliation must invalidate switcher projections",
);
assert.match(
  appModel,
  /target\.archived = archived\s*invalidateProjectProjection\(\)/,
  "in-place archive mutations must invalidate switcher projections",
);
assert.match(projectSwitcher, /\.projectProjection/);
assert.match(
  projectSwitcher,
  /if case \.loaded = projectedState \{\s*app\.performanceSpans\.finish\(\.projectSwitcherPresent\)\s*\}/,
  "switcher presentation must settle on loaded rows, not the loading placeholder",
);
assert.match(search, /\.searchQuery/);
assert.match(search, /Task\.sleep\(for: \.milliseconds\(200\)\)/);
assert.match(search, /effectiveQuery = measuredQuery/);
assert.match(
  search,
  /scope = newValue\s*scheduleSearchMeasurement\(for: query\)/,
  "scope changes must not strand a pending effective query",
);
assert.match(search, /scenePhase == \.active/);
assert.match(search, /Performance search settled/);
assert.match(search, /performanceSpans\.cancel\(\.searchQuery\)/);
assert.match(markdown, /onRenderComplete/);
assert.match(markdown, /onRenderCancelled/);
assert.match(markdown, /static func dismantleUIView/);
assert.match(markdown, /renderGeneration == generation/);
assert.match(markdown, /renderStartGeneration == startGeneration/);
assert.match(
  markdown,
  /DispatchQueue\.main\.async \{ \[weak self\] in[\s\S]*self\.onRenderStart\?\(\)/,
  "rich-render starts must be deferred past updateUIView",
);
assert.match(bubble, /onRichRenderComplete/);
assert.match(bubble, /onRichRenderCancel/);
assert.match(bubble, /\.onDisappear \{[\s\S]*onRichRenderCancel\?\(\)/);
assert.match(appModel, /func persistThreadDraft/);
assert.match(app, /performanceSpans\.setSceneActive\(scenePhase == \.active\)/);
assert.match(app, /app\.cancelProjectSwitchMeasurement\(\)/);
assert.match(
  read("apps/ios/CovenCave/CovenCave/Views/ChatView.swift"),
  /guard scenePhase == \.active,[\s\S]*!recordedFirstRichRender/,
  "rich-render spans must not restart while the scene is inactive",
);
assert.doesNotMatch(
  read("apps/ios/CovenCave/CovenCave/Views/ChatView.swift"),
  /UserDefaults\.standard/,
  "chat drafts must use the AppModel's injected defaults store",
);
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
