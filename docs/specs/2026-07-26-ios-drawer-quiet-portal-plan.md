# iOS Drawer Shell and Quiet Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the native iOS bottom tab bar, make the Cave drawer the complete primary navigation surface, and replace the cold connection spinner with the approved Quiet Portal.

**Architecture:** Keep `AppTab` as the established routing value, but render one selected destination from a renamed `MainShellView` instead of mounting a `TabView`. Preserve the existing connection state machine and replace only its `.checking` presentation with a themed, accessible, indeterminate Quiet Portal plus a deterministic debug fixture.

**Tech Stack:** SwiftUI, Observation, XCTest, Node source-contract tests, XcodeGen, iOS Simulator.

---

## File map

- `apps/ios/CovenCave/CovenCave/State/AppModel.swift` — primary destination order and deterministic connecting preview state.
- `apps/ios/CovenCave/CovenCave/CovenCaveApp.swift` — prevent the debug connecting fixture from starting live network recovery.
- `apps/ios/CovenCave/CovenCave/Views/RootView.swift` — selected-destination shell and Quiet Portal presentation.
- `apps/ios/CovenCave/CovenCave/Views/ChatView.swift` — preserve existing drafts when a marketplace plugin hands back to chat.
- `apps/ios/CovenCave/CovenCaveTests/DrawerDestinationOrderTests.swift` — destination completeness, uniqueness, shortcut order, and persisted raw values.
- `apps/ios/CovenCave/CovenCave.xcodeproj/project.pbxproj` — regenerated test-file reference after the test rename.
- `scripts/ios-claude-design-fidelity.test.mjs` — source contracts for drawer-only navigation, Quiet Portal, and safe plugin handoff.

### Task 1: Preserve drafts and checkpoint review hardening

**Files:**

- Modify: `apps/ios/CovenCave/CovenCave/Views/ChatView.swift`
- Modify: `scripts/ios-claude-design-fidelity.test.mjs`
- Commit with: the existing reviewed Swift and source-contract changes already present in the worktree

- [ ] **Step 1: Add a failing source contract for non-destructive plugin handoff**

Add these assertions beside the marketplace handoff assertions in
`scripts/ios-claude-design-fidelity.test.mjs`:

```js
assert.match(
  chat,
  /private func prefillPlugin\(_ plugin: MarketplacePlugin\)[\s\S]*?let prompt = "Use \\\(plugin\.displayName\) to "[\s\S]*?draft = draft\.isEmpty \? prompt : "\\\\\(draft\)\\\\n\\\\\(prompt\)"/,
  "plugin handoff preserves an existing composer draft",
);
assert.match(
  chat,
  /PluginsPanel \{ plugin in\s*prefillPlugin\(plugin\)/,
  "the marketplace returns through the non-destructive prefill helper",
);
```

- [ ] **Step 2: Run the source contract and observe the intended failure**

Run:

```bash
node scripts/ios-claude-design-fidelity.test.mjs
```

Expected: failure at `plugin handoff preserves an existing composer draft`
because `ChatView` still assigns directly to `draft`.

- [ ] **Step 3: Route plugin handoff through a draft-preserving helper**

Replace the current `PluginsPanel` callback in `ChatView` with:

```swift
.fullScreenCover(isPresented: $showPlugins) {
    PluginsPanel { plugin in
        prefillPlugin(plugin)
    }
}
```

Add this helper beside the other composer prefill helpers:

```swift
private func prefillPlugin(_ plugin: MarketplacePlugin) {
    let prompt = "Use \(plugin.displayName) to "
    draft = draft.isEmpty ? prompt : "\(draft)\n\(prompt)"
    showPlugins = false
    composerFocused = true
}
```

This preserves the existing draft byte-for-byte, adds the plugin instruction
on a new line, and keeps the insertion point ready for the user to finish.

- [ ] **Step 4: Run the focused source suites**

Run:

```bash
node scripts/ios-claude-design-fidelity.test.mjs
node scripts/ios-chat-restyle.test.mjs
node scripts/ios-offline-compose.test.mjs
node scripts/ios-slash-commands.test.mjs
git diff --check
```

Expected: every script prints `ok`; `git diff --check` produces no output.

- [ ] **Step 5: Compile the reviewed Swift paths**

Run from `apps/ios/CovenCave`:

```bash
xcodebuild -quiet test \
  -project CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination 'platform=iOS Simulator,id=8E08D33E-D46E-40D6-921C-6B8475046CFC' \
  -only-testing:CovenCaveTests/ChatResponseControlsTests \
  CODE_SIGNING_ALLOWED=NO
```

Expected: exit 0. The known `CavePerformance.swift` Swift 6 warnings may remain;
no new warnings or errors are accepted.

- [ ] **Step 6: Commit the complete review-hardening checkpoint**

Stage the existing reviewed production and test changes, excluding the design
and plan documents:

```bash
git add \
  apps/ios/CovenCave/CovenCave/Models/ChatResponseControls.swift \
  apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift \
  apps/ios/CovenCave/CovenCave/State/ChatThread.swift \
  apps/ios/CovenCave/CovenCave/Theme/ChatChrome.swift \
  apps/ios/CovenCave/CovenCave/Views/ChatModelControl.swift \
  apps/ios/CovenCave/CovenCave/Views/ChatView.swift \
  apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift \
  apps/ios/CovenCave/CovenCave/Views/FamiliarsListView.swift \
  apps/ios/CovenCave/CovenCave/Views/NavigationDrawer.swift \
  apps/ios/CovenCave/CovenCave/Views/PluginsPanel.swift \
  apps/ios/CovenCave/CovenCave/Views/ProjectsPanel.swift \
  apps/ios/CovenCave/CovenCave/Views/RootView.swift \
  apps/ios/CovenCave/CovenCaveTests/ChatResponseControlsTests.swift \
  scripts/ios-chat-restyle.test.mjs \
  scripts/ios-claude-design-fidelity.test.mjs \
  scripts/ios-offline-compose.test.mjs \
  scripts/ios-slash-commands.test.mjs
git diff --cached --check
git commit -S -m "fix(ios): harden design fidelity interactions"
```

Expected: the signed commit succeeds after the pre-commit hook passes.

### Task 2: Replace native tabs with the drawer-routed shell

**Files:**

- Modify: `apps/ios/CovenCave/CovenCave/State/AppModel.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/RootView.swift`
- Move: `apps/ios/CovenCave/CovenCaveTests/TabOrderTests.swift` to `apps/ios/CovenCave/CovenCaveTests/DrawerDestinationOrderTests.swift`
- Regenerate: `apps/ios/CovenCave/CovenCave.xcodeproj/project.pbxproj`
- Modify: `scripts/ios-claude-design-fidelity.test.mjs`

- [ ] **Step 1: Replace the tab-order unit contract with drawer destinations**

Replace the contents of the existing `TabOrderTests.swift` first so the
generated Xcode project can compile the intentional red test before the file is
renamed:

```swift
import XCTest
@testable import CovenCave

final class DrawerDestinationOrderTests: XCTestCase {
    func testEveryDestinationIsPlacedExactlyOnce() {
        let placed = AppTab.drawerDestinations
        XCTAssertEqual(placed.count, Set(placed).count,
                       "a drawer destination is placed twice")
        XCTAssertEqual(Set(placed), Set(AppTab.allCases),
                       "every AppTab case must be placed in the drawer")
    }

    func testShortcutOrderCoversEveryDestinationExactlyOnce() {
        XCTAssertEqual(AppTab.shortcutOrder.count, AppTab.allCases.count)
        XCTAssertEqual(Set(AppTab.shortcutOrder), Set(AppTab.allCases))
    }

    func testShortcutOrderMatchesDrawerOrder() {
        XCTAssertEqual(AppTab.shortcutOrder, AppTab.drawerDestinations)
    }

    func testRawValuesAreStable() {
        let expected: [AppTab: String] = [
            .chats: "chats",
            .tasks: "tasks",
            .terminal: "terminal",
            .settings: "settings",
        ]
        XCTAssertEqual(expected.count, AppTab.allCases.count)
        for (destination, rawValue) in expected {
            XCTAssertEqual(destination.rawValue, rawValue)
            XCTAssertEqual(AppTab(rawValue: rawValue), destination)
        }
    }
}
```

- [ ] **Step 2: Add failing source contracts for a tab-free shell**

Add these assertions to `scripts/ios-claude-design-fidelity.test.mjs`:

```js
const terminal = await read("apps/ios/CovenCave/CovenCave/Views/TerminalView.swift");
const settings = await read("apps/ios/CovenCave/CovenCave/Views/SettingsView.swift");

assert.doesNotMatch(root, /\bTabView\b/, "the connected shell has no native tab container");
assert.doesNotMatch(root, /\bTab\("/, "the connected shell declares no bottom tabs");
assert.match(root, /struct MainShellView: View/, "the connected root has destination-neutral naming");
for (const route of [
  ["chats", "ChatsHomeView"],
  ["tasks", "TasksView"],
  ["terminal", "TerminalView"],
  ["settings", "SettingsView"],
]) {
  assert.match(
    root,
    new RegExp(`case \\\\.${route[0]}: ${route[1]}\\\\(\\\\)`),
    `${route[0]} renders from selected-destination state`,
  );
}
for (const label of ["Chats", "Tasks", "Terminal", "Settings"]) {
  assert.equal(
    (drawer.match(new RegExp(`label: "${label}"`, "g")) ?? []).length,
    1,
    `${label} appears exactly once in the drawer`,
  );
}
for (const [name, source] of [
  ["Chats", home],
  ["Tasks", tasks],
  ["Terminal", terminal],
  ["Settings", settings],
]) {
  assert.match(
    source,
    /navigationDrawerOpen = true/,
    `${name} exposes the shared drawer opener`,
  );
}
```

- [ ] **Step 3: Run the tests and observe both missing contract failures**

Run:

```bash
node scripts/ios-claude-design-fidelity.test.mjs
xcodebuild -quiet test \
  -project apps/ios/CovenCave/CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination 'platform=iOS Simulator,id=8E08D33E-D46E-40D6-921C-6B8475046CFC' \
  -only-testing:CovenCaveTests/DrawerDestinationOrderTests \
  CODE_SIGNING_ALLOWED=NO
```

Expected: the source suite fails because `TabView` and `MainTabView` remain;
XCTest fails to compile because `drawerDestinations` does not exist yet.

- [ ] **Step 4: Rename the destination contract without changing route values**

Replace the `AppTab` declaration and extension in `AppModel.swift` with:

```swift
/// Primary app destinations. Slash commands, deep links, the shared drawer,
/// and keyboard shortcuts all route through this value.
enum AppTab: String, CaseIterable { case chats, tasks, terminal, settings }

extension AppTab {
    static let drawerDestinations: [AppTab] = [
        .chats, .tasks, .terminal, .settings,
    ]
    static let shortcutOrder: [AppTab] = drawerDestinations
}
```

Update the `selectedTab` property comment to:

```swift
/// The selected primary destination. Set by the drawer, deep links, and
/// cross-surface commands such as `/board` and `/chats`.
```

- [ ] **Step 5: Render only the selected destination**

Change `RootView` to mount `MainShellView()` in the connected/default branch.
Rename `MainTabView` to `MainShellView`, remove the `@Bindable` local, and
replace its `TabView` with:

```swift
ZStack {
    selectedDestination

    CaveNavigationDrawer(
        isOpen: $app.navigationDrawerOpen,
        openProjects: { project in
            projectToOpen = project
            presentedOverlay = .projects
        },
        openFamiliars: { presentedOverlay = .familiars },
        openThread: { app.requestOpen($0) },
        newChat: {
            app.selectedTab = .chats
            app.newChatRequested = true
        },
        searchChats: {
            app.selectedTab = .chats
            app.chatSearchRequested = true
        }
    )
    .zIndex(100)
}
```

Add this destination builder inside `MainShellView`:

```swift
@ViewBuilder
private var selectedDestination: some View {
    switch app.selectedTab {
    case .chats:
        ChatsHomeView()
    case .tasks:
        TasksView()
    case .terminal:
        TerminalView()
    case .settings:
        SettingsView()
    }
}
```

Update nearby comments from “tabs” or “tab tree” to “destinations” or
“connected shell.” Keep the existing `ForEach(AppTab.shortcutOrder)` keyboard
buttons unchanged so ⌘1–4 still update `selectedTab`.

- [ ] **Step 6: Rename the unit test and regenerate Xcode references**

Move `CovenCaveTests/TabOrderTests.swift` to
`CovenCaveTests/DrawerDestinationOrderTests.swift` with `apply_patch`, then run
from `apps/ios/CovenCave`:

```bash
xcodegen generate
```

Expected: `CovenCave.xcodeproj/project.pbxproj` references
`DrawerDestinationOrderTests.swift` and contains no `TabOrderTests.swift`
reference.

- [ ] **Step 7: Run focused drawer navigation verification**

Run:

```bash
node scripts/ios-claude-design-fidelity.test.mjs
xcodebuild -quiet test \
  -project apps/ios/CovenCave/CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination 'platform=iOS Simulator,id=8E08D33E-D46E-40D6-921C-6B8475046CFC' \
  -only-testing:CovenCaveTests/DrawerDestinationOrderTests \
  CODE_SIGNING_ALLOWED=NO
git diff --check
```

Expected: the source suite and four XCTest methods pass; whitespace validation
produces no output.

- [ ] **Step 8: Commit the drawer-only shell**

Run:

```bash
git add \
  apps/ios/CovenCave/CovenCave/State/AppModel.swift \
  apps/ios/CovenCave/CovenCave/Views/RootView.swift \
  apps/ios/CovenCave/CovenCaveTests/TabOrderTests.swift \
  apps/ios/CovenCave/CovenCaveTests/DrawerDestinationOrderTests.swift \
  apps/ios/CovenCave/CovenCave.xcodeproj/project.pbxproj \
  scripts/ios-claude-design-fidelity.test.mjs
git diff --cached --check
git commit -S -m "feat(ios): move primary navigation into the drawer"
```

Expected: the signed commit succeeds. Staging the old path records its deletion.

### Task 3: Build the Quiet Portal connection state

**Files:**

- Modify: `apps/ios/CovenCave/CovenCave/State/AppModel.swift`
- Modify: `apps/ios/CovenCave/CovenCave/CovenCaveApp.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/RootView.swift`
- Modify: `scripts/ios-claude-design-fidelity.test.mjs`

- [ ] **Step 1: Add failing Quiet Portal source contracts**

Add these assertions:

```js
assert.match(root, /Text\("Opening the Cave"\)/, "connecting state uses the approved headline");
assert.match(root, /Text\("Connecting to your desktop"\)/, "connecting state names the live operation");
assert.match(root, /if let host = app\.connection\?\.host/, "connecting state renders the real saved host");
assert.match(root, /PhaseAnimator\(\[0, 1, 2\]\)/, "connecting state has indeterminate signal motion");
assert.match(root, /if reduceMotion[\s\S]*?staticSignal/, "connecting motion has a static fallback");
assert.match(
  root,
  /\.accessibilityLabel\("Connecting to your desktop"\)[\s\S]*?\.accessibilityValue\(app\.connection\?\.host \?\? ""\)/,
  "connecting state exposes one honest accessibility status",
);
assert.match(appModel, /--ui-preview-connecting/, "connecting state has a deterministic preview fixture");
```

- [ ] **Step 2: Run the source suite and observe the intended failure**

Run:

```bash
node scripts/ios-claude-design-fidelity.test.mjs
```

Expected: failure at the Quiet Portal headline assertion because the generic
`ProgressView` screen remains.

- [ ] **Step 3: Add deterministic connecting preview state**

Inside the DEBUG section of `AppModel`, add:

```swift
var isConnectingPreview = false
```

Before the existing empty-chat preview branch in `init`, add:

```swift
if ProcessInfo.processInfo.arguments.contains("--ui-preview-connecting") {
    connection = CaveConnection(host: "cave-desktop.example")
    connectionState = .checking
    isConnectingPreview = true
    ChatTurnNotifier.shared.app = self
    return
}
```

In `CovenCaveApp`, configure notifications first, then guard the supervisor and
initial retry:

```swift
.task {
    notificationDelegate.onOpen = { app.handleDeepLink($0) }
    UNUserNotificationCenter.current().delegate = notificationDelegate
    #if DEBUG
    guard !app.isConnectingPreview else { return }
    #endif
    app.startConnectionSupervisor()
    if app.connection != nil {
        await app.connectWithRetry()
    }
}
```

Release behavior remains unchanged because the guard is compiled only in DEBUG.

- [ ] **Step 4: Replace the generic spinner with Quiet Portal**

Replace `ConnectingView` in `RootView.swift` with:

```swift
struct ConnectingView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            ZStack {
                RadialGradient(
                    colors: [chrome.accent.opacity(0.18), .clear],
                    center: .center,
                    startRadius: 0,
                    endRadius: 56
                )
                .frame(width: 112, height: 112)

                Image(systemName: "moon.stars.fill")
                    .font(.system(size: 27, weight: .medium))
                    .foregroundStyle(chrome.accent)
            }
            .accessibilityHidden(true)
            .padding(.bottom, 34)

            Text("Opening the Cave")
                .font(.title.weight(.medium))
                .fontDesign(.serif)
                .italic()

            Text("Connecting to your desktop")
                .font(.subheadline)
                .foregroundStyle(chrome.textSecondary)
                .padding(.top, 12)

            connectionSignal
                .padding(.top, 24)

            if let host = app.connection?.host, !host.isEmpty {
                Text(host)
                    .font(.caption.monospaced())
                    .foregroundStyle(chrome.textMuted)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .padding(.top, 22)
            }

            Spacer()
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Connecting to your desktop")
        .accessibilityValue(app.connection?.host ?? "")
    }

    @ViewBuilder
    private var connectionSignal: some View {
        if reduceMotion {
            staticSignal
        } else {
            PhaseAnimator([0, 1, 2]) { phase in
                signalDots(active: phase)
            } animation: { _ in
                .easeInOut(duration: 0.34)
            }
        }
    }

    private var staticSignal: some View {
        signalDots(active: 1)
    }

    private func signalDots(active: Int) -> some View {
        HStack(spacing: 6) {
            ForEach(0..<3) { index in
                Circle()
                    .fill(chrome.accent)
                    .frame(width: 5, height: 5)
                    .opacity(index == active ? 1 : 0.24)
                    .scaleEffect(index == active ? 1.12 : 1)
            }
        }
        .accessibilityHidden(true)
    }
}
```

- [ ] **Step 5: Compile and run focused source verification**

Run:

```bash
node scripts/ios-claude-design-fidelity.test.mjs
xcodebuild -quiet test \
  -project apps/ios/CovenCave/CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination 'platform=iOS Simulator,id=8E08D33E-D46E-40D6-921C-6B8475046CFC' \
  -only-testing:CovenCaveTests/DrawerDestinationOrderTests \
  CODE_SIGNING_ALLOWED=NO
git diff --check
```

Expected: source and XCTest verification pass with no new compiler errors or
warnings.

- [ ] **Step 6: Build and inspect the deterministic Quiet Portal**

Run from `apps/ios/CovenCave`:

```bash
xcodebuild -quiet build \
  -project CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination 'platform=iOS Simulator,id=8E08D33E-D46E-40D6-921C-6B8475046CFC' \
  CODE_SIGNING_ALLOWED=NO
xcrun simctl install booted \
  /Users/<someone>/Library/Developer/Xcode/DerivedData/CovenCave-dzmowrhvcyskqggugzwiftgejwqr/Build/Products/Debug-iphonesimulator/CovenCave.app
xcrun simctl launch --terminate-running-process booted \
  ai.opencoven.cave --ui-preview-connecting
xcrun simctl io booted screenshot /tmp/coven-cave-ios-quiet-portal.png
```

Expected: the screenshot shows the centered Quiet Portal, real fixture host,
no native tab bar, no clipped text, and no controls implying a cancellable or
staged operation.

- [ ] **Step 7: Commit Quiet Portal**

Run:

```bash
git add \
  apps/ios/CovenCave/CovenCave/State/AppModel.swift \
  apps/ios/CovenCave/CovenCave/CovenCaveApp.swift \
  apps/ios/CovenCave/CovenCave/Views/RootView.swift \
  scripts/ios-claude-design-fidelity.test.mjs
git diff --cached --check
git commit -S -m "feat(ios): add quiet portal connection state"
```

Expected: the signed commit succeeds after pre-commit verification.

### Task 4: Final verification, review, and delivery

**Files:**

- Verify: all files changed by Tasks 1–3
- Update: Bead `cave-hysd4`
- Deliver: branch `fix/ios-design-fidelity`

- [ ] **Step 1: Run complete local gates**

Run:

```bash
pnpm lint
pnpm test:mobile
xcodebuild -quiet test \
  -project apps/ios/CovenCave/CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination 'platform=iOS Simulator,id=8E08D33E-D46E-40D6-921C-6B8475046CFC' \
  -only-testing:CovenCaveTests \
  CODE_SIGNING_ALLOWED=NO \
  -resultBundlePath /tmp/coven-cave-ios-drawer-quiet-portal.xcresult
git diff --check
```

Expected: lint passes, all 74 mobile test files pass, all iOS unit tests pass,
and whitespace validation is clean.

- [ ] **Step 2: Inspect both required simulator states**

Capture Quiet Portal using `--ui-preview-connecting`. Then launch the existing
empty-chat fixture:

```bash
SIMCTL_CHILD_CAVE_OPEN_THREAD=ui-preview-empty-chat \
  xcrun simctl launch --terminate-running-process booted \
  ai.opencoven.cave --ui-preview-empty-chat
xcrun simctl io booted screenshot \
  /tmp/coven-cave-ios-start-page-no-tabs.png
```

Expected: the start page matches the supplied composition and has no bottom
tab bar. Open the drawer and confirm Chats, Projects, Familiars, Tasks,
Terminal, and Settings are visible.

- [ ] **Step 3: Request independent final review**

Give the reviewer the exact HEAD and require checks for:

```text
no TabView/native tab bar
drawer destination uniqueness and reachability
drawer opener on every root destination
slash-command, deep-link, and keyboard routing
Quiet Portal state honesty and reduced-motion fallback
composer draft preservation
generated Xcode build and full XCTest result
```

Expected: a ship verdict with no unresolved production findings.

- [ ] **Step 4: Verify signed commits and clean branch state**

Run:

```bash
git log --show-signature --format=fuller -5
git status --short
git diff origin/main...HEAD --check
```

Expected: every new commit has Val’s valid GitHub-linked ED25519 signature;
the worktree is clean; the complete branch diff has no whitespace errors.

- [ ] **Step 5: Push, open the PR, and attach evidence**

Run:

```bash
git push -u origin fix/ios-design-fidelity
gh pr create \
  --repo OpenCoven/coven-cave \
  --base main \
  --head fix/ios-design-fidelity \
  --title "feat(ios): complete Claude Design fidelity rehaul" \
  --body-file /tmp/coven-cave-ios-fidelity-pr.md
```

The PR body records the drawer-only shell, Quiet Portal, truthful marketplace
and response controls, 74-file mobile result, complete XCTest count, simulator
captures, and the pre-existing `cave-ae48w` Swift 6 warnings.

- [ ] **Step 6: Enforce the review and merge gates**

Use live PR state to:

1. Wait for every required check to pass.
2. Fetch every review thread and address actionable findings test-first.
3. Resolve a thread only after its fix is present and verified.
4. Confirm zero unresolved conversations immediately before merge.
5. Fetch current `origin/main`; rebase and rerun affected checks if it moved.
6. Squash-merge with an explicit subject and body.
7. Verify the merge inline from fetched `origin/main`.
8. Remove the remote branch and isolated worktree only after merge proof.
9. Update and close `cave-hysd4` with the PR, checks, review, merge SHA, and
   cleanup evidence.

Expected: the PR is merged into protected `main`, the worktree and feature
branch are removed, the canonical checkout’s unrelated dirty files remain
untouched, and the chat is safe to archive.
