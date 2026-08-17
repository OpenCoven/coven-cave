# Native iOS Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a cohesive, accessible native visual system across the Cave iOS shell and high-traffic surfaces while retaining iOS 18 support and existing data contracts.

**Architecture:** Extend `ChromePalette` and the existing accessibility-aware `Glass` layer; do not introduce an iOS 26-only rendering path. First centralize semantic roles and source tests, then migrate shell/chat, work surfaces, and recovery UI in behaviour-neutral slices.

**Tech Stack:** Swift, SwiftUI, UIKit accessibility APIs, XcodeGen, Node source-contract tests, Xcode simulator.

---

## File structure

| File | Responsibility |
| --- | --- |
| `Theme/Theme.swift` | Desktop-derived semantic palette and status/presence roles. |
| `Theme/ChatChrome.swift` and `Theme/Glass.swift` | Reusable labelled controls and accessible restrained chrome. |
| `Views/NavigationDrawer.swift`, `RootView.swift` | Scalable app shell, selected state, connection pill. |
| `Views/ChatView.swift`, `ChatsHomeView.swift` | Transcript/composer hierarchy without behavioural change. |
| `Views/TasksView.swift`, `GlobalSearchView.swift`, `NewChatView.swift`, `FamiliarThreadsView.swift` | High-traffic work-surface hierarchy. |
| `Views/SettingsView.swift`, `ConnectionView.swift` | Grouped settings and named recovery states. |
| `scripts/ios-native-modernization.test.mjs`, `scripts/run-tests.mjs` | New visual/accessibility source-contract test registration. |

### Task 1: Add semantic palette roles and their failing contract

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/Theme/Theme.swift`
- Create: `scripts/ios-native-modernization.test.mjs`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing source-contract test.**

```js
const theme = await read("apps/ios/CovenCave/CovenCave/Theme/Theme.swift");
assert.match(theme, /var stateSuccess: Color/);
assert.match(theme, /var presenceActive: Color/);
assert.match(theme, /static func status\(_ status: CardStatus, chrome: ChromePalette\) -> Color/);
assert.match(theme, /static func presence\(_ status: String\?, chrome: ChromePalette\) -> Color\?/);
for (const file of ["Views/TasksView.swift", "Views/NavigationDrawer.swift"]) {
  assert.doesNotMatch(await read(`${base}/${file}`), /Color\(hex: "#/);
}
```

- [ ] **Step 2: Register and run it to verify failure.**

Add the test beside `scripts/ios-theme.test.mjs` in the app suite in `scripts/run-tests.mjs`, then run `node scripts/ios-native-modernization.test.mjs`. Expected: FAIL because semantic roles do not exist yet.

- [ ] **Step 3: Implement the minimum palette API.**

```swift
var stateSuccess: Color = .green
var stateWarning: Color = .orange
var stateDanger: Color = .red
var stateInfo: Color = .blue
var presenceActive: Color { stateSuccess }
var presenceIdle: Color { stateInfo }
var presenceOffline: Color { textMuted }

static func status(_ status: CardStatus, chrome: ChromePalette) -> Color {
  switch status {
  case .running: return chrome.stateInfo
  case .review: return chrome.accent
  case .blocked: return chrome.stateDanger
  case .inbox: return chrome.stateInfo
  case .backlog: return chrome.textMuted
  case .done: return chrome.stateSuccess
  }
}
static func presence(_ status: String?, chrome: ChromePalette) -> Color? {
  switch status?.lowercased() {
  case "active", "online": return chrome.presenceActive
  case "idle": return chrome.presenceIdle
  case "busy", "running": return chrome.stateWarning
  case "offline", .some: return chrome.presenceOffline
  case nil: return nil
  }
}
```

Keep `Color(hex:)` and fallbacks in `Theme.swift` only. Migrate status/presence callers, preserving familiar configured colours, `/api/theme` decoding, and `accentForeground`.

- [ ] **Step 4: Verify the palette slice.**

Run `node scripts/ios-theme.test.mjs && node scripts/ios-theme-list-background.test.mjs && node scripts/ios-native-modernization.test.mjs`. Expected: all scripts print `ok`.

- [ ] **Step 5: Commit.**

```bash
git add apps/ios/CovenCave/CovenCave/Theme/Theme.swift scripts/ios-native-modernization.test.mjs scripts/run-tests.mjs
git commit -S -m "feat(ios): add semantic visual roles"
```

### Task 2: Refine accessible shell and chat hierarchy

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/Views/NavigationDrawer.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/RootView.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Theme/ChatChrome.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/ChatView.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift`
- Test: `scripts/ios-native-modernization.test.mjs`

- [ ] **Step 1: Add failing pins for scalable selected navigation and explicit send/stop state.**

```js
assert.match(drawer, /accessibilityAddTraits\(isSelected \? \.isSelected : \[\]\)/);
assert.doesNotMatch(drawer, /font\(\.system\(size: 17\)\)/);
assert.match(chrome, /\.frame\(minWidth: 44, minHeight: 44\)/);
assert.match(chat, /\.accessibilityLabel\(isStreaming \? "Stop generating" : "Send message"\)/);
assert.doesNotMatch(chat, /font\(\.system\(size: 26, weight: \.medium, design: \.serif\)\)/);
```

- [ ] **Step 2: Run the new source test.**

Run `node scripts/ios-native-modernization.test.mjs`. Expected: FAIL on fixed drawer/chat typography and missing selected-state/send-state contracts.

- [ ] **Step 3: Implement presentation-only shell and chat changes.**

```swift
Text(title)
  .font(.body.weight(isSelected ? .semibold : .regular))
  .foregroundStyle(isSelected ? chrome.textPrimary : chrome.textSecondary)
  .accessibilityAddTraits(isSelected ? .isSelected : [])

CircularIconButton(systemImage: isStreaming ? "stop.fill" : "arrow.up",
                   label: isStreaming ? "Stop generating" : "Send message") {
  isStreaming ? stopGenerating() : send()
}
.accessibilityHint(isStreaming ? "Stops the current response" : "Sends your message")
```

Use the existing glass layer only for drawer/header/composer controls. Preserve closures, `FloatingActionMenu`, session identifiers, staged-image flow, scroll guards, zoom transition, and reduced-motion branches. Do not glass-wrap message content.

- [ ] **Step 4: Run regression contracts.**

Run `node scripts/ios-accessible-controls.test.mjs && node scripts/ios-chat-restyle.test.mjs && node scripts/ios-modern-polish.test.mjs && node scripts/ios-motion-polish.test.mjs && node scripts/ios-native-modernization.test.mjs`. Expected: all exit 0.

- [ ] **Step 5: Commit.**

```bash
git add apps/ios/CovenCave/CovenCave/Views/NavigationDrawer.swift apps/ios/CovenCave/CovenCave/Views/RootView.swift apps/ios/CovenCave/CovenCave/Theme/ChatChrome.swift apps/ios/CovenCave/CovenCave/Views/ChatView.swift apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift scripts/ios-native-modernization.test.mjs
git commit -S -m "feat(ios): refine accessible shell and chat hierarchy"
```

### Task 3: Converge high-traffic work surfaces

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/Views/TasksView.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/GlobalSearchView.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/NewChatView.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/FamiliarThreadsView.swift`
- Test: `scripts/ios-native-modernization.test.mjs`

- [ ] **Step 1: Add failing source pins for task semantics and intent-first setup.**

```js
assert.match(tasks, /Theme\.status\(card\.status, chrome: chrome\)/);
assert.match(tasks, /\.accessibilityLabel\("Status: \\(card\.status/);
assert.match(search, /\.searchable\(text: \$query, prompt: "Search Cave…"\)/);
assert.match(newChat, /Section\("Start with a familiar"\)/);
```

- [ ] **Step 2: Run the source test.**

Run `node scripts/ios-native-modernization.test.mjs`. Expected: FAIL because task colour ownership and the named New Chat first step are absent.

- [ ] **Step 3: Apply hierarchy without altering data flow.**

```swift
StatusPill(status: card.status, color: Theme.status(card.status, chrome: chrome))
  .accessibilityLabel("Status: \(card.status.displayName)")

Section("Start with a familiar") {
  FamiliarPickerRow(familiar: familiar, isSelected: selectedFamiliarID == familiar.id)
}
```

Group Search results with semantic headers and an explicit empty state. Keep task mutations, result routing, chat-creation payloads, familiar identities, and `NavigationSplitView` selection unchanged.

- [ ] **Step 4: Verify the slice.**

Run `node scripts/ios-native-modernization.test.mjs && node scripts/ios-accessible-controls.test.mjs`. Then run the exact iOS scripts registered in `scripts/run-tests.mjs`; record each command and exit status. Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add apps/ios/CovenCave/CovenCave/Views/TasksView.swift apps/ios/CovenCave/CovenCave/Views/GlobalSearchView.swift apps/ios/CovenCave/CovenCave/Views/NewChatView.swift apps/ios/CovenCave/CovenCave/Views/FamiliarThreadsView.swift scripts/ios-native-modernization.test.mjs
git commit -S -m "feat(ios): unify high-traffic work surfaces"
```

### Task 4: Finish recovery/settings states and prove native delivery

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/Views/SettingsView.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/ConnectionView.swift`
- Modify: `apps/ios/CovenCave/project.yml` only if target test wiring is required
- Test: `scripts/ios-native-modernization.test.mjs`

- [ ] **Step 1: Add failing pins for named recovery and scalable settings.**

```js
assert.match(connection, /enum ConnectionRecoveryKind/);
assert.match(connection, /case \.serviceUnavailable: return "Cave service unavailable"/);
assert.match(connection, /case \.authenticationRequired: return "Sign in required"/);
assert.doesNotMatch(connection, /font\(\.system\(size: 38/);
assert.match(settings, /\.themedListBackground\(\)/);
```

- [ ] **Step 2: Run the source test.**

Run `node scripts/ios-native-modernization.test.mjs`. Expected: FAIL because recovery state is not an explicit, user-facing model.

- [ ] **Step 3: Implement recovery presentation and settings grouping.**

```swift
enum ConnectionRecoveryKind {
  case serviceUnavailable, authenticationRequired, configurationRequired
  var title: String {
    switch self {
    case .serviceUnavailable: return "Cave service unavailable"
    case .authenticationRequired: return "Sign in required"
    case .configurationRequired: return "Cave connection needs configuration"
    }
  }
  var actionTitle: String {
    switch self {
    case .serviceUnavailable: return "Try again"
    case .authenticationRequired: return "Sign in"
    case .configurationRequired: return "Open settings"
    }
  }
}

RecoveryCard(kind: recoveryKind, action: retryConnection)
  .glass(.raised, cornerRadius: 16)
  .accessibilityElement(children: .combine)
```

Map existing service/auth/configuration conditions to this presentation-only enum. Preserve connection logic, credentials storage, settings destinations/toggles, appearance mode, and theme-grid semantics.

- [ ] **Step 4: Run full automated and native proof.**

```bash
pnpm test
cd apps/ios/CovenCave
xcodegen generate
xcodebuild -project CovenCave.xcodeproj -scheme CovenCave -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build
```

Expected: JavaScript suite passes and Xcode ends `** BUILD SUCCEEDED **`. Manually check iPhone 16 Pro and Cave iPad Verify in light/dark, largest Dynamic Type, Reduce Transparency, and Reduce Motion. Capture screenshots and VoiceOver traversal for drawer, composer, task mutation, and recovery.

- [ ] **Step 5: Commit and record evidence.**

```bash
git add apps/ios/CovenCave/CovenCave/Views/SettingsView.swift apps/ios/CovenCave/CovenCave/Views/ConnectionView.swift apps/ios/CovenCave/project.yml scripts/ios-native-modernization.test.mjs
git commit -S -m "feat(ios): refine settings and recovery hierarchy"
bd comment cave-mwehk "Verified pnpm test, iPhone 16 Pro simulator build, Cave iPad Verify, large Dynamic Type, Reduce Transparency, and Reduce Motion; see the PR verification section for command output and screenshots."
git status --short --branch
```

## Self-review

- **Spec coverage:** Task 1 covers semantic roles; Task 2 covers shell, chat, Dynamic Type, glass bounds, and motion; Task 3 covers Tasks, Search, New Chat, and Familiars; Task 4 covers Settings, recovery, iOS 18-compatible native proof, and accessibility modes.
- **No placeholders:** each task names exact files, a failing contract, implementation shape, command, expected result, and commit.
- **Consistency:** `ChromePalette`, `Theme.status(_:chrome:)`, `Theme.presence(_:chrome:)`, and `ConnectionRecoveryKind` are introduced before later consumption. If `CardStatus` lacks `displayName`, use its existing user-facing label property and update the new source pin in the same commit; do not add duplicate model state.
