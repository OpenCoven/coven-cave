# iOS Claude Design Fidelity Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining compatible gaps between the native SwiftUI app and the supplied Claude Design handoff without undoing the newer, approved familiars-first Chats IA or drawer navigation.

**Architecture:** Add one focused global-search overlay that routes through existing `AppModel` navigation intents. Enrich project and linked-chat chrome only from already-loaded, truthful data. Keep the archived unified-recents home and bottom tab bar documented as superseded by `2026-08-03-ios-chat-familiars-first-design.md` and the current drawer fidelity contract.

**Tech Stack:** SwiftUI, Observation-backed `AppModel`, XcodeGen, Node source-contract tests, XCTest/XCUITest, iOS Simulator.

---

## File map

- Create `apps/ios/CovenCave/CovenCave/Views/GlobalSearchView.swift`: query/result presentation and typed routing callbacks.
- Modify `apps/ios/CovenCave/CovenCave/Views/NavigationDrawer.swift`: launch global search instead of chat-only search.
- Modify `apps/ios/CovenCave/CovenCave/Views/RootView.swift`: present global search and route selected chats, projects, familiars, and tasks.
- Modify `apps/ios/CovenCave/CovenCave/Views/ProjectsPanel.swift`: derive chat, familiar, and task activity from real app state.
- Modify `apps/ios/CovenCave/CovenCave/Views/ChatView.swift`: show a real PR/issue chip beside linked task context.
- Modify `scripts/ios-claude-design-fidelity.test.mjs`: pin the three handoff contracts.
- Modify `docs/design-handoff/IMPLEMENTATION-STATUS.md`: record the closeout and intentional supersessions.

### Task 1: Add app-wide search

**Files:**
- Create: `apps/ios/CovenCave/CovenCave/Views/GlobalSearchView.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/NavigationDrawer.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/RootView.swift`
- Test: `scripts/ios-claude-design-fidelity.test.mjs`

- [x] **Step 1: Write the failing source-contract assertions**

Add assertions that require a `GlobalSearchView`, the canonical `Search everything…` placeholder, four truthful result sections, and drawer/root wiring:

```js
const globalSearch = await read("apps/ios/CovenCave/CovenCave/Views/GlobalSearchView.swift");

assert.match(globalSearch, /TextField\("Search everything…"/);
for (const label of ["Chats", "Projects", "Familiars", "Tasks"]) {
  assert.match(globalSearch, new RegExp(`Section\\("${label}"\\)`));
}
assert.match(drawer, /var openSearch: \(\) -> Void/);
assert.match(drawer, /openSearch\(\)/);
assert.match(root, /case \.search:\s*GlobalSearchView\(/);
```

- [x] **Step 2: Run the contract to verify failure**

Run:

```bash
node scripts/ios-claude-design-fidelity.test.mjs
```

Expected: failure because `GlobalSearchView.swift` and `.search` do not exist.

- [x] **Step 3: Implement typed, loaded-data search**

Create `GlobalSearchView` with:

```swift
struct GlobalSearchView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @State private var query = ""

    let dismiss: () -> Void
    let openThread: (ChatThread) -> Void
    let openProject: (ProjectInfo) -> Void
    let openFamiliar: (Familiar) -> Void
    let openTask: (BoardCard) -> Void
}
```

Normalize the query once, search:

```swift
private var normalizedQuery: String {
    query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
}

private var matchingThreads: [ChatThread] {
    let q = normalizedQuery
    guard !q.isEmpty else { return [] }
    return app.threads
        .filter { !$0.archived }
        .filter { thread in
            thread.title.lowercased().contains(q)
                || thread.messages.last?.text.lowercased().contains(q) == true
                || thread.familiarIds.contains {
                    app.familiar($0)?.displayName.lowercased().contains(q) == true
                }
        }
        .sorted { $0.updatedAt > $1.updatedAt }
}
```

Use equivalent name/root filtering for projects, name/role filtering for familiars, and title/notes/project filtering for tasks. Render a `List` with `Section("Chats")`, `Section("Projects")`, `Section("Familiars")`, and `Section("Tasks")`; omit empty sections and show `ContentUnavailableView.search(text:)` when a non-empty query has no matches. Use `.searchable(text:prompt: "Search everything…")`, themed list/sheet backgrounds, a Close toolbar button, and existing `AvatarView`/`TaskRow` presentation.

Change the drawer callback from:

```swift
var searchChats: () -> Void
```

to:

```swift
var openSearch: () -> Void
```

and call it from the header search button with accessibility label `Search everything`.

Add `.search` to `MainOverlay`, present `GlobalSearchView`, and route callbacks through `app.requestOpen`, `app.requestOpenTask`, the existing project overlay, and the familiar direct-thread path. Dismiss search before switching overlays.

- [x] **Step 4: Run the focused contract**

Run:

```bash
node scripts/ios-claude-design-fidelity.test.mjs
```

Expected: PASS.

### Task 2: Add truthful project activity metadata

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/Views/ProjectsPanel.swift`
- Test: `scripts/ios-claude-design-fidelity.test.mjs`

- [x] **Step 1: Write the failing assertions**

```js
assert.match(projects, /threadsByProjectRoot/);
assert.match(projects, /Set\(threads\.flatMap\(\\\.familiarIds\)\)\.count/);
assert.match(projects, /chat\\\(chats == 1 \? "" : "s"\\\)/);
assert.match(projects, /familiar\\\(familiars == 1 \? "" : "s"\\\)/);
```

- [x] **Step 2: Run the contract to verify failure**

Run:

```bash
node scripts/ios-claude-design-fidelity.test.mjs
```

Expected: failure because project summaries only count tasks.

- [x] **Step 3: Derive metadata from real threads**

Inside `ProjectsPanel`, derive non-archived threads by their exact `projectRoot`:

```swift
let threadsByProjectRoot = Dictionary(grouping: app.threads.filter { !$0.archived }) {
    $0.projectRoot ?? ""
}
```

Replace `summary(for:taskCounts:)` with:

```swift
private func summary(
    for project: ProjectInfo,
    taskCounts: [String: Int],
    threadsByProjectRoot: [String: [ChatThread]]
) -> String? {
    let threads = threadsByProjectRoot[project.root, default: []]
    let chats = threads.count
    let familiars = Set(threads.flatMap(\.familiarIds)).count
    let tasks = taskCounts[project.id, default: 0]
    let parts = [
        chats > 0 ? "\(chats) chat\(chats == 1 ? "" : "s")" : nil,
        familiars > 0 ? "\(familiars) familiar\(familiars == 1 ? "" : "s")" : nil,
        tasks > 0 ? "\(tasks) task\(tasks == 1 ? "" : "s")" : nil,
    ].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
}
```

Do not synthesize zero counts.

- [x] **Step 4: Run the focused contract**

Run:

```bash
node scripts/ios-claude-design-fidelity.test.mjs
```

Expected: PASS.

### Task 3: Restore PR/issue context beside linked tasks

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/Views/ChatView.swift`
- Test: `scripts/ios-claude-design-fidelity.test.mjs`

- [x] **Step 1: Write the failing assertions**

```js
assert.match(chat, /private var linkedGitHubContext: CardGitHubLink\?/);
assert.match(chat, /Link\(destination: url\)/);
assert.match(chat, /githubContextLabel/);
assert.match(chat, /linkedContextStrip[\s\S]{0,1800}showTasks = true/);
```

- [x] **Step 2: Run the contract to verify failure**

Run:

```bash
node scripts/ios-claude-design-fidelity.test.mjs
```

Expected: failure because the strip only exposes tasks.

- [x] **Step 3: Add a validated GitHub chip**

Resolve the first real linked PR/issue:

```swift
private var linkedGitHubContext: CardGitHubLink? {
    app.linkedTasks(for: thread)
        .flatMap(\.githubLinks)
        .first { link in
            guard let url = URL(string: link.url),
                  let scheme = url.scheme?.lowercased()
            else { return false }
            return scheme == "https" || scheme == "http"
        }
}
```

Refactor `linkedContextStrip` into a horizontal strip. When `linkedGitHubContext` has a valid URL, render a compact `Link(destination: url)` with the appropriate `arrow.triangle.pull` or `smallcircle.filled.circle` glyph, `PR #<number>` / `Issue #<number>` label, and `arrow.up.right`. Keep the linked-task button as the remaining flexible-width control. When no URL exists, render only the task control exactly as today.

- [x] **Step 4: Run the focused contract**

Run:

```bash
node scripts/ios-claude-design-fidelity.test.mjs
```

Expected: PASS.

### Task 4: Record intentional supersessions

**Files:**
- Modify: `docs/design-handoff/IMPLEMENTATION-STATUS.md`

- [x] **Step 1: Update the iOS ledger row**

Document that:

```markdown
- The supplied July archive's familiar rail + unified recents and persistent
  bottom tab bar were intentionally superseded by the approved
  `2026-08-03-ios-chat-familiars-first-design.md` and drawer shell.
- Global search, project activity metadata, and linked PR/issue context now
  preserve the remaining compatible handoff affordances.
```

- [x] **Step 2: Check the ledger source paths**

Run:

```bash
pnpm exec vitest run src/lib/design-handoff-ledger.test.ts
```

Expected: PASS.

### Task 5: Validate behavior and visuals

**Files:**
- Test: `scripts/ios-claude-design-fidelity.test.mjs`
- Test: `scripts/ios-chat-familiars-home.test.mjs`
- Test: `apps/ios/CovenCave/CovenCaveTests`
- Test: `apps/ios/CovenCave/CovenCaveUITests`

- [x] **Step 1: Run source and mobile gates**

```bash
node scripts/ios-claude-design-fidelity.test.mjs
node scripts/ios-chat-familiars-home.test.mjs
pnpm test:mobile
```

Expected: all pass.

- [x] **Step 2: Generate and build the simulator target**

```bash
bash scripts/ios-xcodegen.sh
xcodebuild \
  -project apps/ios/CovenCave/CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -derivedDataPath apps/ios/CovenCave/build \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Expected: `** BUILD SUCCEEDED **`.

- [x] **Step 3: Run native unit and UI tests**

```bash
xcodebuild test \
  -project apps/ios/CovenCave/CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -derivedDataPath apps/ios/CovenCave/build \
  CODE_SIGNING_ALLOWED=NO
```

Expected: `** TEST SUCCEEDED **`.

- [x] **Step 4: Capture visual evidence**

Launch with deterministic fixtures:

```bash
xcrun simctl launch booted ai.opencoven.cave --ui-preview-empty-chat
```

Verify in dark and light appearance:

1. Drawer search opens `Search everything…`.
2. Matching chat/project/familiar/task sections route correctly.
3. Project rows show only non-zero real activity counts.
4. A linked task with a GitHub URL shows both context controls without truncating the task title.
5. Dynamic Type, Reduce Motion, and VoiceOver labels remain usable.

- [x] **Step 5: Inspect the final diff**

```bash
git status --short
git diff --check
git diff -- apps/ios/CovenCave scripts/ios-claude-design-fidelity.test.mjs docs/design-handoff/IMPLEMENTATION-STATUS.md
```

Expected: only the scoped SwiftUI, fidelity-test, ledger, and plan files changed; no whitespace errors.

## Completion evidence

- All 84 mobile test files passed.
- All 374 native Swift unit tests passed.
- All 8 UI tests passed on an erased iPhone 16 Pro simulator.
- The native simulator build passed with Swift warnings treated as errors.
- Design-fidelity, familiars-home, implementation-ledger, configuration, and whitespace gates passed.
- A fresh-context review found no blocking correctness, concurrency, lifecycle, routing, data-counting, accessibility, or security issues.
