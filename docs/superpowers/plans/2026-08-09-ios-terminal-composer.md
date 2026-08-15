# iOS Terminal Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an accessible native composer below the iOS terminal that safely sends shell input, exposes terminal slash commands, and hands drafts to native chat for review.

**Architecture:** Pure models own command parsing and chat-handoff formatting. `TerminalComposer` owns draft UI policy, `PtyTerminal` remains transport-only while reporting send completion, and `AppModel` carries a one-shot generic new-chat seed through the existing `ChatsHomeView` → `NewChatView` flow.

**Tech Stack:** Swift 5, SwiftUI, Observation, XCTest/XCUITest, XcodeGen, existing iOS Cave theme primitives.

---

## File map

- Create `apps/ios/CovenCave/CovenCave/Models/TerminalCommand.swift`: parser, suggestions, and local command actions.
- Create `apps/ios/CovenCave/CovenCave/Models/NewChatSeed.swift`: safely formatted one-shot chat draft/project seed.
- Create `apps/ios/CovenCave/CovenCave/Views/TerminalComposer.swift`: native field, palette, Send, Ask Familiar.
- Create `apps/ios/CovenCave/CovenCaveTests/TerminalCommandTests.swift`: parser tests.
- Create `apps/ios/CovenCave/CovenCaveTests/NewChatSeedTests.swift`: quoting and preservation-policy tests.
- Create `apps/ios/CovenCave/CovenCaveUITests/TerminalComposerUITests.swift`: visible accessibility contract.
- Create `scripts/ios-terminal-composer-contract.test.mjs`: Linux-friendly source/wiring contract.
- Modify `apps/ios/CovenCave/CovenCave/Networking/PtyTerminal.swift`: report asynchronous send success/failure.
- Modify `apps/ios/CovenCave/CovenCave/State/AppModel.swift`: pending seed and draft persistence helper.
- Modify `apps/ios/CovenCave/CovenCave/Views/TerminalView.swift`: dock composer and dispatch commands.
- Modify `apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift`: capture the pending seed when presenting New Chat.
- Modify `apps/ios/CovenCave/CovenCave/Views/NewChatView.swift`: preselect project and seed the created thread draft.
- Modify `scripts/run-tests.mjs`: wire the mobile source-contract test.
- Regenerate `apps/ios/CovenCave/CovenCave.xcodeproj/project.pbxproj` with `bash scripts/ios-xcodegen.sh`.

### Task 0: Claim the Bead and create its managed worktree

- [ ] **Step 1: Claim after the earlier Beads are complete**

```bash
bd update cave-nv1dk.2 --claim
```

Expected: `cave-nv1dk.2` becomes `in_progress`. Do not claim it while
`cave-1vpy` or `cave-ui5z` is still actively being worked.

- [ ] **Step 2: Fetch canonical main and create the worktree**

```bash
git fetch origin main
pnpm beads:worktrees:create \
  --bead cave-nv1dk.2 \
  --branch feat/cave-nv1dk-2-terminal-composer \
  --owner copilot \
  --purpose "Add the accessible native iOS terminal composer and safe chat handoff"
```

Expected: registered worktree
`.worktrees/cave-nv1dk-2-terminal-composer` based on `origin/main`. If the
command exits 2, use the attributed, expiring exception rerun printed by the
gate; do not use bare `git worktree add`.

- [ ] **Step 3: Install the worktree dependencies**

```bash
cd .worktrees/cave-nv1dk-2-terminal-composer
pnpm install
```

Expected: install completes from the pnpm content-addressed store.

### Task 1: Parse terminal commands without swallowing shell input

**Files:**
- Create: `apps/ios/CovenCave/CovenCave/Models/TerminalCommand.swift`
- Create: `apps/ios/CovenCave/CovenCaveTests/TerminalCommandTests.swift`

- [ ] **Step 1: Write failing parser tests**

```swift
import XCTest
@testable import CovenCave

final class TerminalCommandTests: XCTestCase {
    func testRecognizedCommandsDispatchLocally() {
        XCTAssertEqual(TerminalSubmission.parse(" /help "), .command(.help))
        XCTAssertEqual(TerminalSubmission.parse("/clear"), .command(.clear))
        XCTAssertEqual(TerminalSubmission.parse("/cwd"), .command(.cwd))
    }

    func testUnknownSlashInputPassesToShell() {
        XCTAssertEqual(
            TerminalSubmission.parse("/usr/bin/env bash"),
            .shell("/usr/bin/env bash\n")
        )
    }

    func testShellInputTrimsOuterWhitespaceAndKeepsInternalNewlines() {
        XCTAssertEqual(
            TerminalSubmission.parse("  printf hi\npwd  "),
            .shell("printf hi\npwd\n")
        )
    }

    func testBlankInputDoesNotSubmit() {
        XCTAssertEqual(TerminalSubmission.parse(" \n "), .empty)
    }

    func testSuggestionsMatchRecognizedPrefixOnly() {
        XCTAssertEqual(TerminalCommand.matches("/c"), [.clear, .cwd])
        XCTAssertEqual(TerminalCommand.matches("echo /c"), [])
    }
}
```

- [ ] **Step 2: Regenerate the project and verify the test fails to compile**

```bash
bash scripts/ios-xcodegen.sh
cd apps/ios/CovenCave
xcodebuild test -project CovenCave.xcodeproj -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -only-testing:CovenCaveTests/TerminalCommandTests \
  CODE_SIGNING_ALLOWED=NO
```

Expected: FAIL because terminal command types do not exist.

- [ ] **Step 3: Implement the parser**

```swift
import Foundation

enum TerminalCommand: String, CaseIterable, Equatable, Identifiable {
    case help = "/help"
    case clear = "/clear"
    case cwd = "/cwd"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .help: "Show terminal commands"
        case .clear: "Clear the terminal"
        case .cwd: "Change working directory"
        }
    }

    static func matches(_ draft: String) -> [TerminalCommand] {
        let value = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.hasPrefix("/"), !value.contains(where: { $0.isWhitespace }) else { return [] }
        return allCases.filter { $0.rawValue.hasPrefix(value.lowercased()) }
    }
}

enum TerminalSubmission: Equatable {
    case empty
    case command(TerminalCommand)
    case shell(String)

    static func parse(_ draft: String) -> TerminalSubmission {
        let value = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return .empty }
        if let command = TerminalCommand(rawValue: value.lowercased()) {
            return .command(command)
        }
        return .shell(value + "\n")
    }
}
```

- [ ] **Step 4: Run the parser tests**

Run the Step 2 `xcodebuild test` command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/CovenCave/CovenCave/Models/TerminalCommand.swift \
  apps/ios/CovenCave/CovenCaveTests/TerminalCommandTests.swift \
  apps/ios/CovenCave/CovenCave.xcodeproj/project.pbxproj
git commit -m "feat(ios): parse terminal composer commands"
git push -u origin feat/cave-nv1dk-2-terminal-composer
```

### Task 2: Format and carry a safe native chat handoff

**Files:**
- Create: `apps/ios/CovenCave/CovenCave/Models/NewChatSeed.swift`
- Create: `apps/ios/CovenCave/CovenCaveTests/NewChatSeedTests.swift`
- Modify: `apps/ios/CovenCave/CovenCave/State/AppModel.swift`

- [ ] **Step 1: Write failing handoff tests**

```swift
import XCTest
@testable import CovenCave

final class NewChatSeedTests: XCTestCase {
    func testTerminalReviewIncludesCwdAndIndentedCommand() {
        let seed = NewChatSeed.terminalReview(
            command: "rm -rf \"$TMPDIR/example\"\necho done",
            projectRoot: "/Users/buns/code/app"
        )
        XCTAssertEqual(seed.projectRoot, "/Users/buns/code/app")
        XCTAssertTrue(seed.draft.contains("Working directory:\n\n    /Users/buns/code/app"))
        XCTAssertTrue(seed.draft.contains("Command:\n\n    rm -rf \"$TMPDIR/example\"\n    echo done"))
    }

    func testHomeContextIsExplicit() {
        XCTAssertTrue(
            NewChatSeed.terminalReview(command: "pwd", projectRoot: nil)
                .draft.contains("Working directory:\n\n    Home")
        )
    }
}
```

- [ ] **Step 2: Run the focused tests**

Use the Task 1 `xcodebuild test` command with
`-only-testing:CovenCaveTests/NewChatSeedTests`.

Expected: FAIL.

- [ ] **Step 3: Implement the seed**

```swift
import Foundation

struct NewChatSeed: Equatable {
    let projectRoot: String?
    let draft: String

    static func terminalReview(command: String, projectRoot: String?) -> NewChatSeed {
        func indented(_ value: String) -> String {
            value.split(separator: "\n", omittingEmptySubsequences: false)
                .map { "    " + String($0) }
                .joined(separator: "\n")
        }
        let cwd = projectRoot.flatMap { $0.isEmpty ? nil : $0 } ?? "Home"
        return NewChatSeed(
            projectRoot: projectRoot,
            draft: """
            Review this terminal command before I run it.

            Working directory:

            \(indented(cwd))

            Command:

            \(indented(command))
            """
        )
    }
}
```

In `AppModel` add:

```swift
var pendingNewChatSeed: NewChatSeed?

func requestNewChat(seed: NewChatSeed) {
    pendingNewChatSeed = seed
    selectedTab = .chats
    newChatRequested = true
}

func takeNewChatSeed() -> NewChatSeed? {
    defer { pendingNewChatSeed = nil }
    return pendingNewChatSeed
}

func persistThreadDraft(_ text: String, threadId: String) {
    UserDefaults.standard.set(text, forKey: Self.draftKey(threadId))
    setThreadDraft(threadId, text: text)
}
```

- [ ] **Step 4: Run handoff tests**

Expected: PASS.

- [ ] **Step 5: Commit and push**

```bash
git add apps/ios/CovenCave/CovenCave/Models/NewChatSeed.swift \
  apps/ios/CovenCave/CovenCaveTests/NewChatSeedTests.swift \
  apps/ios/CovenCave/CovenCave/State/AppModel.swift
git commit -m "feat(ios): seed terminal review chats"
git push
```

### Task 3: Make PTY sends report success without adding UI policy

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/Networking/PtyTerminal.swift`
- Test: `apps/ios/CovenCave/CovenCaveTests/TerminalCommandTests.swift`

- [ ] **Step 1: Add a send-result policy test**

Add a pure helper to `TerminalCommand.swift`:

```swift
enum TerminalComposerPolicy {
    static func canSend(draft: String, connected: Bool, exited: Bool, sending: Bool) -> Bool {
        !sending
            && connected
            && !exited
            && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
```

Test:

```swift
func testComposerCanSendOnlyToLiveTransport() {
    XCTAssertTrue(TerminalComposerPolicy.canSend(
        draft: "pwd", connected: true, exited: false, sending: false
    ))
    XCTAssertFalse(TerminalComposerPolicy.canSend(
        draft: "pwd", connected: false, exited: false, sending: false
    ))
    XCTAssertFalse(TerminalComposerPolicy.canSend(
        draft: "pwd", connected: true, exited: true, sending: false
    ))
}
```

- [ ] **Step 2: Run focused tests**

Expected: PASS for policy; transport behavior is not implemented yet.

- [ ] **Step 3: Add send completion**

Change the public API to:

```swift
func sendInput(_ string: String, completion: ((Bool) -> Void)? = nil) {
    guard let task else {
        completion?(false)
        return
    }
    var frame = Data([0x03])
    frame.append(Data(string.utf8))
    send(frame, over: task, completion: completion)
}
```

Change the private sender:

```swift
private func send(
    _ frame: Data,
    over ws: URLSessionWebSocketTask,
    completion: ((Bool) -> Void)? = nil
) {
    ws.send(.data(frame)) { [weak self] error in
        Task { @MainActor [weak self] in
            guard let self, self.task === ws else {
                completion?(false)
                return
            }
            if let error {
                self.fail(error)
                completion?(false)
            } else {
                completion?(true)
            }
        }
    }
}
```

Existing xterm/key-row callers continue calling `sendInput(_:)` and ignore the
optional completion.

- [ ] **Step 4: Build the app target**

```bash
cd apps/ios/CovenCave
xcodebuild -project CovenCave.xcodeproj -scheme CovenCave \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

Expected: BUILD SUCCEEDED.

- [ ] **Step 5: Commit and push**

```bash
git add apps/ios/CovenCave/CovenCave/Networking/PtyTerminal.swift \
  apps/ios/CovenCave/CovenCave/Models/TerminalCommand.swift \
  apps/ios/CovenCave/CovenCaveTests/TerminalCommandTests.swift
git commit -m "feat(ios): report terminal send completion"
git push
```

### Task 4: Build the accessible docked composer

**Files:**
- Create: `apps/ios/CovenCave/CovenCave/Views/TerminalComposer.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/TerminalView.swift`

- [ ] **Step 1: Implement `TerminalComposer`**

Create a view with this public contract:

```swift
struct TerminalComposer: View {
    @Environment(\.chrome) private var chrome
    @Binding var draft: String
    let connected: Bool
    let exited: Bool
    let send: (String, @escaping (Bool) -> Void) -> Void
    let runCommand: (TerminalCommand) -> Void
    let askFamiliar: () -> Void

    @State private var sending = false
    @FocusState private var focused: Bool

    private var canSend: Bool {
        TerminalComposerPolicy.canSend(
            draft: draft,
            connected: connected,
            exited: exited,
            sending: sending
        )
    }

    private var matches: [TerminalCommand] { TerminalCommand.matches(draft) }
}
```

Render:

- an inline native command list when `matches` is non-empty,
- `TextField("Type a command…", text: $draft, axis: .vertical)` with
  `.lineLimit(1...5)`,
- hardware Return handling matching `ChatView` (`Shift+Return` ignored so it
  inserts a newline),
- an `Ask Familiar` button with `sparkles` icon,
- a 44-point Send button,
- explicit accessibility labels/hints,
- existing `glass`/`glassFill` theme primitives only.

The inline command list dispatches the selected local command and clears only
that recognized command text:

```swift
if !matches.isEmpty {
    VStack(spacing: 0) {
        ForEach(matches) { command in
            Button {
                runCommand(command)
                draft = ""
            } label: {
                HStack {
                    Text(command.rawValue)
                        .font(.system(.footnote, design: .monospaced))
                    Text(command.title)
                        .font(.footnote)
                        .foregroundStyle(chrome.textSecondary)
                    Spacer()
                }
                .frame(minHeight: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(command.rawValue), \(command.title)")
        }
    }
    .glass(.elevated, in: RoundedRectangle(cornerRadius: 12))
}
```

The submit function must parse first:

```swift
private func submit() {
    switch TerminalSubmission.parse(draft) {
    case .empty:
        return
    case .command(let command):
        runCommand(command)
        draft = ""
    case .shell(let payload):
        sending = true
        send(payload) { accepted in
            sending = false
            if accepted { draft = "" }
        }
    }
}
```

- [ ] **Step 2: Dock it in `TerminalView`**

Add:

```swift
@State private var draft = ""
@State private var showingTerminalHelp = false
```

Insert between `XtermWebView` and `keyRow`:

```swift
Divider()
TerminalComposer(
    draft: $draft,
    connected: terminal.connected,
    exited: terminal.exited,
    send: { payload, completion in
        terminal.sendInput(payload, completion: completion)
    },
    runCommand: runTerminalCommand,
    askFamiliar: {
        let command = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !command.isEmpty else { return }
        app.requestNewChat(seed: .terminalReview(command: command, projectRoot: cwd))
    }
)
Divider()
keyRow
```

Add:

```swift
private func runTerminalCommand(_ command: TerminalCommand) {
    switch command {
    case .help:
        showingTerminalHelp = true
    case .clear:
        terminal.sendInput("clear\n")
    case .cwd:
        showingProjectPicker = true
    }
}
```

Present a native sheet listing all `TerminalCommand.allCases` with command,
title, and a dismiss button. Keep the original Xterm input, key row, lifecycle,
and cwd picker unchanged.

- [ ] **Step 3: Regenerate and build**

```bash
bash scripts/ios-xcodegen.sh
cd apps/ios/CovenCave
xcodebuild -project CovenCave.xcodeproj -scheme CovenCave \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

Expected: BUILD SUCCEEDED.

- [ ] **Step 4: Commit and push**

```bash
git add apps/ios/CovenCave/CovenCave/Views/TerminalComposer.swift \
  apps/ios/CovenCave/CovenCave/Views/TerminalView.swift \
  apps/ios/CovenCave/CovenCave.xcodeproj/project.pbxproj
git commit -m "feat(ios): add native terminal composer"
git push
```

### Task 5: Route Ask Familiar through existing New Chat

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/NewChatView.swift`
- Modify: `apps/ios/CovenCave/CovenCaveTests/ChatNewConversationContextTests.swift`

- [ ] **Step 1: Add seed-capture tests**

Extend `ChatNewConversationContextTests` with a pure helper:

```swift
func testTerminalSeedUsesGeneralFamiliarPicker() {
    let seed = NewChatSeed(projectRoot: "/work/app", draft: "Review")
    let presentation = ChatNewConversationContext.presentation(
        seed: seed,
        selection: .familiar(familiar("nyx")),
        detailPath: []
    )
    XCTAssertNil(presentation.fixedFamiliarId)
    XCTAssertEqual(presentation.seed, seed)
}
```

- [ ] **Step 2: Add a presentation value**

In `ChatsHomeView.swift`:

```swift
struct ChatNewConversationPresentation: Equatable {
    let fixedFamiliarId: String?
    let seed: NewChatSeed?
}
```

Add:

```swift
static func presentation(
    seed: NewChatSeed?,
    selection: ChatRoute?,
    detailPath: [ChatRoute]
) -> ChatNewConversationPresentation {
    ChatNewConversationPresentation(
        fixedFamiliarId: seed == nil
            ? fixedFamiliarId(selection: selection, detailPath: detailPath)
            : nil,
        seed: seed
    )
}
```

- [ ] **Step 3: Capture the seed when presenting**

Add local state:

```swift
@State private var newChatSeed: NewChatSeed?
```

Pass it into `NewChatView`:

```swift
NewChatView(
    fixedFamiliarId: fixedNewChatFamiliarId,
    initialProjectRoot: newChatSeed?.projectRoot,
    initialDraft: newChatSeed?.draft
) { thread in
    showNewChat = false
    open(.thread(thread))
}
```

Clear `newChatSeed` in the sheet `onDismiss`.

In `presentContextualNewChat`, call `app.takeNewChatSeed()` and use
`ChatNewConversationContext.presentation(...)`.

- [ ] **Step 4: Seed project and draft in `NewChatView`**

Add initializer arguments:

```swift
initialProjectRoot: String? = nil,
initialDraft: String? = nil,
```

Store `initialDraft` as an immutable property and initialize:

```swift
_selectedProjectRoot = State(initialValue: initialProjectRoot)
```

After `start()` creates the thread and before `onStart(thread)`:

```swift
if let initialDraft,
   !initialDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
    app.persistThreadDraft(initialDraft, threadId: thread.id)
}
```

The New Chat sheet remains user-confirmed: it selects a familiar/project but
does not send the message.

- [ ] **Step 5: Run focused tests and build**

```bash
bash scripts/ios-xcodegen.sh
cd apps/ios/CovenCave
xcodebuild test -project CovenCave.xcodeproj -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -only-testing:CovenCaveTests/ChatNewConversationContextTests \
  -only-testing:CovenCaveTests/NewChatSeedTests \
  CODE_SIGNING_ALLOWED=NO
```

Expected: PASS.

- [ ] **Step 6: Commit and push**

```bash
git add apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift \
  apps/ios/CovenCave/CovenCave/Views/NewChatView.swift \
  apps/ios/CovenCave/CovenCaveTests/ChatNewConversationContextTests.swift \
  apps/ios/CovenCave/CovenCave.xcodeproj/project.pbxproj
git commit -m "feat(ios): hand terminal drafts to native chat"
git push
```

### Task 6: Add mobile contract and UI coverage

**Files:**
- Create: `scripts/ios-terminal-composer-contract.test.mjs`
- Create: `apps/ios/CovenCave/CovenCaveUITests/TerminalComposerUITests.swift`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Add the Linux-friendly contract**

The script must assert:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const terminal = read("apps/ios/CovenCave/CovenCave/Views/TerminalView.swift");
const composer = read("apps/ios/CovenCave/CovenCave/Views/TerminalComposer.swift");
const transport = read("apps/ios/CovenCave/CovenCave/Networking/PtyTerminal.swift");
const appModel = read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");
const newChat = read("apps/ios/CovenCave/CovenCave/Views/NewChatView.swift");

assert.match(terminal, /XtermWebView[\s\S]*TerminalComposer[\s\S]*keyRow/);
assert.match(composer, /TextField\("Type a command…"/);
assert.match(composer, /Ask Familiar/);
assert.match(composer, /TerminalSubmission\.parse\(draft\)/);
assert.match(transport, /completion: \(\(Bool\) -> Void\)\? = nil/);
assert.match(appModel, /pendingNewChatSeed: NewChatSeed\?/);
assert.match(newChat, /app\.persistThreadDraft\(initialDraft, threadId: thread\.id\)/);
assert.doesNotMatch(terminal, /eval\(|callAsyncJavaScript/, "composer policy stays outside xterm");

console.log("ios-terminal-composer-contract.test.mjs: ok");
```

Wire it into the `mobile` array in `scripts/run-tests.mjs`.

- [ ] **Step 2: Add a simulator UI test**

Launch with existing preview support plus `--ui-tab terminal`, then assert:

```swift
import XCTest

final class TerminalComposerUITests: XCTestCase {
    @MainActor
    func testTerminalComposerIsNativeAndAccessibleWhileDisconnected() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat", "--ui-tab", "terminal"]
        app.launch()

        XCTAssertTrue(app.textFields["Terminal command"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Ask Familiar"].exists)
        XCTAssertTrue(app.buttons["Send terminal command"].exists)
        XCTAssertFalse(app.buttons["Send terminal command"].isEnabled)
        XCTAssertTrue(app.buttons["Reconnect"].exists || app.staticTexts["Terminal"].exists)
    }
}
```

Set matching accessibility labels in `TerminalComposer`.

- [ ] **Step 3: Regenerate and run mobile tests**

```bash
bash scripts/ios-xcodegen.sh
pnpm test:mobile
cd apps/ios/CovenCave
xcodebuild test -project CovenCave.xcodeproj -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -only-testing:CovenCaveTests/TerminalCommandTests \
  -only-testing:CovenCaveTests/NewChatSeedTests \
  -only-testing:CovenCaveTests/ChatNewConversationContextTests \
  -only-testing:CovenCaveUITests/TerminalComposerUITests \
  CODE_SIGNING_ALLOWED=NO
```

Expected: PASS.

- [ ] **Step 4: Commit and push**

```bash
git add scripts/ios-terminal-composer-contract.test.mjs \
  scripts/run-tests.mjs \
  apps/ios/CovenCave/CovenCaveUITests/TerminalComposerUITests.swift \
  apps/ios/CovenCave/CovenCave.xcodeproj/project.pbxproj
git commit -m "test(ios): cover terminal composer handoff"
git push
```

### Task 7: Full verification and native behavior review

- [ ] **Step 1: Run all relevant gates**

```bash
pnpm test:mobile
pnpm check:tests-wired
pnpm test:app
bash scripts/ios-xcodegen.sh
cd apps/ios/CovenCave
xcodebuild -project CovenCave.xcodeproj -scheme CovenCave \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

Expected: PASS / BUILD SUCCEEDED.

- [ ] **Step 2: Verify on an iPhone simulator**

Run:

```bash
pnpm mobile:ios:sim
```

Confirm:

- direct xterm typing still reaches the PTY,
- composer send and special-key row both work,
- multiline paste remains editable,
- hardware Return sends and Shift+Return adds a line,
- disconnected/exited states retain the draft,
- `/help`, `/clear`, `/cwd`, and unknown slash input behave as designed,
- Ask Familiar opens New Chat with cwd selected and the review prompt preserved,
- returning to Terminal shows the original draft unchanged,
- VoiceOver order and Dynamic Type remain usable.

- [ ] **Step 3: Record evidence**

```bash
bd comments add cave-nv1dk.2 \
  "Implemented on feat/cave-nv1dk-2-terminal-composer. Verified parser/handoff XCTest coverage, mobile contract suite, app tests, Xcode simulator tests, generic iOS build, direct xterm input, reconnect draft retention, terminal slash commands, Ask Familiar draft preservation, Dynamic Type, and VoiceOver order."
```

### Task 8: Open, review, merge, and close the PR

- [ ] **Step 1: Review and push final head**

```bash
git status --short
git diff origin/main...HEAD --check
git push
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create \
  --base main \
  --head feat/cave-nv1dk-2-terminal-composer \
  --title "feat(ios): add accessible terminal composer" \
  --body "## Summary
- add a native docked iOS terminal composer
- dispatch terminal-only slash commands without swallowing shell paths
- hand terminal drafts and cwd to native chat for review without auto-execution

## Verification
- pnpm test:mobile
- pnpm check:tests-wired
- pnpm test:app
- focused XCTest/XCUITest
- generic iOS xcodebuild
- simulator behavior and accessibility pass

Closes cave-nv1dk.2"
```

- [ ] **Step 3: Wait for required checks and read review threads**

```bash
gh pr checks --required --watch
```

Fix real review findings and push them before merge.

- [ ] **Step 4: Exact-head squash merge**

```bash
expected_head=$(git rev-parse HEAD)
actual_head=$(gh pr view --json headRefOid --jq .headRefOid)
test "$actual_head" = "$expected_head"
gh pr checks --required
gh pr merge --squash --match-head-commit "$expected_head"
```

- [ ] **Step 5: Record merge evidence and close**

```bash
pr_url=$(gh pr view --json url --jq .url)
bd update cave-nv1dk.2 --external-ref "$pr_url"
bd comments add cave-nv1dk.2 "Merged exact verified head $expected_head via $pr_url."
bd close cave-nv1dk.2 --reason "Accessible native terminal composer merged through the protected PR path."
pnpm beads:worktrees
```

Record the worktree disposition before bounded retirement.
