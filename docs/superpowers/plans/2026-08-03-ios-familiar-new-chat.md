# iOS Familiar-Scoped New Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let iOS start a new conversation from an already-selected familiar without reopening the familiar roster, while preserving authorized project selection and adding an in-flow project-access repair path.

**Architecture:** Extend the existing `NewChatView` instead of creating a second launch surface. A nullable fixed familiar ID determines whether the roster is editable, while `ChatProjectPicker` remains the sole authorized-project loader and gains a parent-supplied access action plus an external refresh token.

**Tech Stack:** SwiftUI, Swift concurrency, XCTest source contracts, Node.js test runner, XcodeGen/xcodebuild.

---

## File map

- `apps/ios/CovenCave/CovenCave/Views/NewChatView.swift`: owns fixed-versus-editable familiar selection, presents familiar-scoped permissions, and refreshes project choices after access repair.
- `apps/ios/CovenCave/CovenCave/Views/ChatProjectPicker.swift`: renders the authorized project state and exposes a Project access action without weakening project scoping.
- `apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift`: distinguishes global compose from familiar-specific compose.
- `apps/ios/CovenCave/CovenCave/Views/FamiliarThreadsView.swift`: launches New Chat with its current familiar fixed.
- `scripts/ios-chat-project-contract.test.mjs`: Linux-friendly regression contract for the new UI wiring.
- `docs/superpowers/specs/2026-08-03-ios-familiar-new-chat-design.md`: approved behavior and security constraints.

### Task 1: Add failing source-contract coverage

**Files:**
- Modify: `scripts/ios-chat-project-contract.test.mjs:120-185`

- [ ] **Step 1: Replace the familiar-launch assertions with fixed-selection and repair assertions**

Add these assertions after the existing New Chat project-blocking assertion:

```js
assert.match(
  newChat,
  /let fixedFamiliarId: String\?[\s\S]*if fixedFamiliarId == nil \{[\s\S]*Section\(selected\.isEmpty \? "Choose familiars" : "\\\(selected\.count\) selected"\)/,
  "fixed familiar launches must hide the editable familiar roster",
);
assert.match(
  newChat,
  /@State private var showProjectAccess = false[\s\S]*@State private var projectRefreshToken = 0/,
  "New Chat must own access repair presentation and project refresh state",
);
assert.match(
  newChat,
  /ChatProjectPicker\([\s\S]*refreshToken: projectRefreshToken,[\s\S]*onManageAccess: fixedFamiliar == nil \? nil : \{ showProjectAccess = true \}/,
  "fixed familiar New Chat must expose project access repair through the picker",
);
assert.match(
  newChat,
  /\.sheet\(isPresented: \$showProjectAccess, onDismiss: \{ projectRefreshToken \+= 1 \}\)[\s\S]*FamiliarPermissionsSheet\(familiar: familiar\)/,
  "closing familiar permissions must reload authorized project choices",
);
assert.match(
  picker,
  /let refreshToken: Int[\s\S]*var onManageAccess: \(\(\) -> Void\)\?/,
  "the project picker must accept an external refresh signal and optional access action",
);
assert.match(
  picker,
  /projects\.isEmpty[\s\S]*Button\("Project access", action: onManageAccess\)/,
  "an empty familiar-scoped project response must offer access repair",
);
```

Replace the two old familiar entry-point assertions with:

```js
assert.match(
  home,
  /NewChatView\([\s\S]*fixedFamiliarId: fixedNewChatFamiliarId[\s\S]*presentNewChat\(fixedFamiliarId: familiar\.id\)/,
  "home familiar shortcuts must lock the already-selected familiar",
);
assert.match(
  familiarThreads,
  /NewChatView\(fixedFamiliarId: familiar\.id\)/,
  "familiar history shortcuts must lock the already-selected familiar",
);
```

- [ ] **Step 2: Run the focused contract and confirm it fails**

Run:

```bash
node scripts/ios-chat-project-contract.test.mjs
```

Expected: FAIL on the first new assertion because `NewChatView` does not yet declare `fixedFamiliarId`.

- [ ] **Step 3: Commit the failing test only if the user explicitly authorizes commits**

```bash
git add scripts/ios-chat-project-contract.test.mjs
git commit -S -m "test(ios): cover familiar-scoped new chat"
```

Expected: a signed test-only commit. Under the repository's conservative profile, skip this step until explicit commit authorization is given.

### Task 2: Add project-access repair to the picker

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/Views/ChatProjectPicker.swift:8-70`
- Test: `scripts/ios-chat-project-contract.test.mjs`

- [ ] **Step 1: Add refresh and access-action inputs**

Add these stored properties beside the existing picker inputs:

```swift
    let refreshToken: Int
    var onManageAccess: (() -> Void)?
```

Extend `LoadKey` and `loadKey`:

```swift
    private struct LoadKey: Hashable {
        var familiarIds: [String]
        var reloadToken: Int
        var refreshToken: Int
        var requiresExplicitSelection: Bool
    }

    private var loadKey: LoadKey {
        LoadKey(
            familiarIds: familiarKey,
            reloadToken: reloadToken,
            refreshToken: refreshToken,
            requiresExplicitSelection: requiresExplicitSelection
        )
    }
```

- [ ] **Step 2: Replace the empty-project label with a repair-capable state**

Replace the `projects.isEmpty` branch with:

```swift
            } else if projects.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Label(
                        familiarKey.count == 1
                            ? "This familiar has no accessible projects."
                            : "These familiars do not share an accessible project.",
                        systemImage: "folder.badge.questionmark"
                    )
                    .foregroundStyle(.secondary)
                    if let onManageAccess {
                        Button("Project access", action: onManageAccess)
                    }
                }
```

This keeps empty authorization distinct from transport failure and does not show unscoped projects.

- [ ] **Step 3: Update existing call sites with a neutral refresh token**

For `ChatProjectPicker` uses outside New Chat, including `ChatView.swift`, add:

```swift
refreshToken: 0,
```

Do not pass `onManageAccess`; its default remains `nil`.

- [ ] **Step 4: Run the focused contract**

Run:

```bash
node scripts/ios-chat-project-contract.test.mjs
```

Expected: FAIL now moves to the missing fixed-familiar New Chat wiring; picker assertions pass.

- [ ] **Step 5: Commit the picker change only if commits are authorized**

```bash
git add apps/ios/CovenCave/CovenCave/Views/ChatProjectPicker.swift \
  apps/ios/CovenCave/CovenCave/Views/ChatView.swift
git commit -S -m "fix(ios): add project access repair to new chat"
```

Expected: a signed implementation commit. Otherwise leave the changes uncommitted for handoff.

### Task 3: Lock familiar-specific New Chat launches

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/Views/NewChatView.swift:5-100`
- Modify: `apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift:15-225`
- Modify: `apps/ios/CovenCave/CovenCave/Views/FamiliarThreadsView.swift:160-171`
- Test: `scripts/ios-chat-project-contract.test.mjs`

- [ ] **Step 1: Add fixed-familiar state and initialization to New Chat**

Add the stored property and state:

```swift
    let fixedFamiliarId: String?
    @State private var showProjectAccess = false
    @State private var projectRefreshToken = 0
```

Replace the initializer with:

```swift
    init(
        initialFamiliarIds: [String] = [],
        fixedFamiliarId: String? = nil,
        onStart: @escaping (ChatThread) -> Void
    ) {
        self.fixedFamiliarId = fixedFamiliarId
        self.onStart = onStart
        _selected = State(
            initialValue: Set(
                fixedFamiliarId.map { [$0] } ?? initialFamiliarIds
            )
        )
    }
```

Add this lookup:

```swift
    private var fixedFamiliar: Familiar? {
        fixedFamiliarId.flatMap(app.familiar)
    }
```

- [ ] **Step 2: Hide the roster in fixed mode**

Wrap the existing familiar `Section` in:

```swift
                if fixedFamiliarId == nil {
                    Section(selected.isEmpty ? "Choose familiars" : "\(selected.count) selected") {
                        if app.familiars.isEmpty {
                            Text("No familiars found. Pull to refresh on the Chats screen, or check the desktop connection.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        ForEach(app.familiars) { familiar in
                            Button { toggle(familiar.id) } label: {
                                HStack(spacing: 12) {
                                    AvatarView(
                                        familiar: familiar,
                                        url: app.client?.avatarURL(for: familiar),
                                        size: 40,
                                        showStatus: true
                                    )
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(familiar.displayName)
                                            .font(.body)
                                            .foregroundStyle(.primary)
                                        if let role = familiar.role, !role.isEmpty {
                                            Text(role)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    Spacer()
                                    Image(
                                        systemName: selected.contains(familiar.id)
                                            ? "checkmark.circle.fill"
                                            : "circle"
                                    )
                                    .foregroundStyle(
                                        selected.contains(familiar.id)
                                            ? Color.accentColor
                                            : Color.secondary
                                    )
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
```

Keep the group-name section conditional on `isGroup`; fixed mode can never become a group because it exposes no toggle.

- [ ] **Step 3: Wire project refresh and access repair**

Update the picker call:

```swift
                    ChatProjectPicker(
                        familiarIds: selectedFamiliarIds,
                        recentRoots: app.recentProjectRoots,
                        selectedRoot: $selectedProjectRoot,
                        isResolved: $projectResolved,
                        refreshToken: projectRefreshToken,
                        onManageAccess: fixedFamiliar == nil
                            ? nil
                            : { showProjectAccess = true }
                    )
```

Add the sheet after `.fileImporter(...)`:

```swift
            .sheet(
                isPresented: $showProjectAccess,
                onDismiss: { projectRefreshToken += 1 }
            ) {
                if let familiar = fixedFamiliar {
                    FamiliarPermissionsSheet(familiar: familiar)
                }
            }
```

The existing `selectedFamiliarIds` calculation deliberately filters through the hydrated roster, so a deleted or stale fixed familiar cannot launch.

- [ ] **Step 4: Make Chats Home preserve whether compose is global or familiar-scoped**

Replace:

```swift
@State private var initialNewChatFamiliarIds: [String] = []
```

with:

```swift
@State private var fixedNewChatFamiliarId: String?
```

In the Familiars sheet selection callback, set:

```swift
fixedNewChatFamiliarId = familiar.id
```

Update the New Chat sheet:

```swift
            .sheet(
                isPresented: $showNewChat,
                onDismiss: { fixedNewChatFamiliarId = nil }
            ) {
                NewChatView(fixedFamiliarId: fixedNewChatFamiliarId) { thread in
                    showNewChat = false
                    open(.thread(thread))
                }
            }
```

Replace the helpers with:

```swift
    private func startNewChat(with familiar: Familiar) {
        presentNewChat(fixedFamiliarId: familiar.id)
    }

    private func presentNewChat(fixedFamiliarId: String? = nil) {
        fixedNewChatFamiliarId = fixedFamiliarId
        showNewChat = true
    }
```

Calls to `presentNewChat()` from global compose remain editable because they pass `nil`.

- [ ] **Step 5: Lock the Familiar Threads entry point**

Replace:

```swift
NewChatView(initialFamiliarIds: [familiar.id])
```

with:

```swift
NewChatView(fixedFamiliarId: familiar.id)
```

- [ ] **Step 6: Run the focused contract**

Run:

```bash
node scripts/ios-chat-project-contract.test.mjs
```

Expected: `ios-chat-project-contract.test.mjs: ok`.

- [ ] **Step 7: Commit the familiar-scoped flow only if commits are authorized**

```bash
git add apps/ios/CovenCave/CovenCave/Views/NewChatView.swift \
  apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift \
  apps/ios/CovenCave/CovenCave/Views/FamiliarThreadsView.swift \
  scripts/ios-chat-project-contract.test.mjs
git commit -S -m "fix(ios): lock familiar in new chat"
```

Expected: a signed commit with no AI attribution trailer. Otherwise retain the uncommitted diff.

### Task 4: Validate the complete iOS change

**Files:**
- Verify: `apps/ios/CovenCave/CovenCave/Views/NewChatView.swift`
- Verify: `apps/ios/CovenCave/CovenCave/Views/ChatProjectPicker.swift`
- Verify: `apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift`
- Verify: `apps/ios/CovenCave/CovenCave/Views/FamiliarThreadsView.swift`
- Verify: `scripts/ios-chat-project-contract.test.mjs`

- [ ] **Step 1: Run the full mobile contract suite**

Run:

```bash
pnpm test:mobile
```

Expected: all mobile source-contract tests pass.

- [ ] **Step 2: Verify test wiring**

Run:

```bash
pnpm check:tests-wired
```

Expected: exit code 0 with no unwired test report.

- [ ] **Step 3: Generate the iOS project and compile the simulator app**

Run:

```bash
cd apps/ios/CovenCave &&
xcodegen generate &&
xcodebuild \
  -project CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination "generic/platform=iOS Simulator" \
  -derivedDataPath /tmp/covencave-y0blo-derived \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 4: Inspect the final scoped diff**

Run:

```bash
git status --short
git diff --check
git diff -- \
  apps/ios/CovenCave/CovenCave/Views/NewChatView.swift \
  apps/ios/CovenCave/CovenCave/Views/ChatProjectPicker.swift \
  apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift \
  apps/ios/CovenCave/CovenCave/Views/FamiliarThreadsView.swift \
  scripts/ios-chat-project-contract.test.mjs \
  docs/superpowers/specs/2026-08-03-ios-familiar-new-chat-design.md \
  docs/superpowers/plans/2026-08-03-ios-familiar-new-chat.md
```

Expected: only the intended Bead export, design/plan, iOS views, and contract test are modified; `git diff --check` emits nothing.

- [ ] **Step 5: Record verification in Beads**

Run:

```bash
bd update cave-y0blo --notes "Implemented fixed-familiar iOS New Chat, familiar-scoped Project access repair, and reload-on-return. Verification: node scripts/ios-chat-project-contract.test.mjs; pnpm test:mobile; pnpm check:tests-wired; iOS simulator xcodebuild."
```

Expected: Bead `cave-y0blo` remains `in_progress` until the change is merged or the user explicitly declares completion.
