# iOS New-Chat Project Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every native iOS first-turn chat carry a persisted, familiar-authorized project root and permanently guard the client/server contract with native and Linux-runnable tests.

**Architecture:** A pure `ChatProjectSelection` policy intersects familiar-scoped project responses and chooses a stable default. `ChatThread` owns the chosen root, persists it, and is the single send-body factory for first sends, groups, retries, and offline replay. The streaming client decodes bounded structured HTTP errors, while SwiftUI entry points either resolve a valid root or route the user through one reusable picker.

**Tech Stack:** Swift 5, SwiftUI, Observation, XCTest, URLSession SSE, Node.js `node:test`, Next.js route tests, XcodeGen, pnpm.

**Repository policy:** Bead `cave-rlscz` is the durable tracker. The active profile is conservative, so the checkpoint steps inspect diffs and status but do not commit or push without separate user authority.

---

## File Map

**Create**

- `apps/ios/CovenCave/CovenCave/Models/ChatProjectSelection.swift` — pure group intersection and preferred-root policy.
- `apps/ios/CovenCave/CovenCave/Views/ChatProjectPicker.swift` — reusable accessible-project loading, loading/error/empty states, and selection UI.
- `apps/ios/CovenCave/CovenCaveTests/ChatProjectSelectionTests.swift` — behavior coverage for intersection/default rules.
- `apps/ios/CovenCave/CovenCaveTests/ChatProjectContractTests.swift` — first-send, persistence, local guard, and structured-error coverage.
- `scripts/ios-chat-project-contract.test.mjs` — Linux-visible cross-file wiring guard.
- `src/app/api/chat/send/ios-first-turn-project-contract.test.ts` — durable route response contract for the exact missing-root regression.

**Modify**

- `apps/ios/CovenCave/CovenCave/Models/DevModels.swift` — decode scoped project access.
- `apps/ios/CovenCave/CovenCave/Models/Models.swift` — decode `project_root` from server session rows.
- `apps/ios/CovenCave/CovenCave/Networking/CaveClient+Dev.swift` — familiar-scoped project fetches and group intersection.
- `apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift` — `SendBody.projectRoot` and bounded stream error decoding.
- `apps/ios/CovenCave/CovenCave/Networking/CaveConnection.swift` — structured server error type and project-code classification.
- `apps/ios/CovenCave/CovenCave/State/ChatThread.swift` — persisted root, send invariant, request factory, and recovery state.
- `apps/ios/CovenCave/CovenCave/State/AppModel.swift` — explicit project-root thread factories and server/task handoff roots.
- `apps/ios/CovenCave/CovenCave/Views/NewChatView.swift` — required shared-project selection.
- `apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift` — familiar shortcut routes through preselected New Chat.
- `apps/ios/CovenCave/CovenCave/Views/FamiliarThreadsView.swift` — empty-state shortcut routes through preselected New Chat.
- `apps/ios/CovenCave/CovenCave/Views/ChatView.swift` — legacy/stale-root guard, picker recovery, and `/new` inheritance.
- `apps/ios/CovenCave/CovenCaveTests/ChatResponseControlsTests.swift` — first-turn wire assertion.
- `apps/ios/CovenCave/CovenCaveTests/ThreadSnapshotStoreTests.swift` — new and legacy snapshot contracts.
- `scripts/run-tests.mjs` — wire the Linux mobile contract test.

### Task 1: Accessible project selection policy

**Files:**

- Create: `apps/ios/CovenCave/CovenCave/Models/ChatProjectSelection.swift`
- Create: `apps/ios/CovenCave/CovenCaveTests/ChatProjectSelectionTests.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Models/DevModels.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Networking/CaveClient+Dev.swift`

- [ ] **Step 1: Add failing project-policy tests**

Use fixtures with one Nova-only project, one Sage-only project, and one shared
project. Pin stable name ordering, shared-project intersection, least access,
current-root retention, recent-root defaulting, first-project fallback, and
empty participant/intersection behavior:

```swift
@MainActor
final class ChatProjectSelectionTests: XCTestCase {
    private func project(
        _ id: String,
        _ name: String,
        _ access: ProjectAccessLevel
    ) -> ProjectInfo {
        ProjectInfo(
            id: id,
            name: name,
            root: "/repos/\(id)",
            color: nil,
            updatedAt: nil,
            access: access
        )
    }

    func testSharedProjectsIntersectByIdAndKeepLeastAccess() {
        let result = ChatProjectSelection.sharedProjects([
            [project("shared", "Zulu", .write), project("nova", "Nova", .write)],
            [project("shared", "Zulu", .read), project("sage", "Sage", .write)],
        ])

        XCTAssertEqual(result.map(\.id), ["shared"])
        XCTAssertEqual(result.first?.access, .read)
    }

    func testResolvedRootKeepsCurrentThenRecentThenAlphabeticalFirst() {
        let projects = [
            project("z", "Zulu", .write),
            project("a", "Alpha", .write),
        ]
        XCTAssertEqual(
            ChatProjectSelection.resolvedRoot(
                current: "/repos/z", recent: ["/repos/a"], projects: projects
            ),
            "/repos/z"
        )
        XCTAssertEqual(
            ChatProjectSelection.resolvedRoot(
                current: "/missing", recent: ["/repos/z"], projects: projects
            ),
            "/repos/z"
        )
        XCTAssertEqual(
            ChatProjectSelection.resolvedRoot(
                current: nil, recent: [], projects: projects
            ),
            "/repos/a"
        )
    }
}
```

- [ ] **Step 2: Generate the Xcode project and verify RED**

Run:

```bash
xcodegen generate --spec apps/ios/CovenCave/project.yml
xcodebuild test \
  -project apps/ios/CovenCave/CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -only-testing:CovenCaveTests/ChatProjectSelectionTests
```

Expected: compilation fails because `ProjectInfo.access` and
`ChatProjectSelection` do not exist.

- [ ] **Step 3: Implement the pure policy**

Add optional access without breaking unscoped responses:

```swift
struct ProjectInfo: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var name: String
    var root: String
    var color: String?
    var updatedAt: String?
    var access: ProjectAccessLevel?
}
```

Implement:

```swift
enum ChatProjectSelection {
    static func sharedProjects(_ scopes: [[ProjectInfo]]) -> [ProjectInfo] {
        guard var shared = scopes.first, !scopes.isEmpty else { return [] }
        for scope in scopes.dropFirst() {
            let byId = Dictionary(uniqueKeysWithValues: scope.map { ($0.id, $0) })
            shared = shared.compactMap { candidate in
                guard let match = byId[candidate.id] else { return nil }
                var merged = candidate
                merged.access = [candidate.access, match.access].compactMap { $0 }.min()
                return merged
            }
        }
        return shared.sorted {
            let order = $0.name.localizedCaseInsensitiveCompare($1.name)
            return order == .orderedSame ? $0.id < $1.id : order == .orderedAscending
        }
    }

    static func resolvedRoot(
        current: String?,
        recent: [String],
        projects: [ProjectInfo]
    ) -> String? {
        let roots = Set(projects.map(\.root))
        if let current, roots.contains(current) { return current }
        if let recent = recent.first(where: roots.contains) { return recent }
        return projects.sorted {
            $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }.first?.root
    }
}
```

Add `projects(familiarId:)` using `URLComponents` and
`projects(familiarIds:)` using distinct, ordered familiar IDs plus
`ChatProjectSelection.sharedProjects`.

- [ ] **Step 4: Verify GREEN**

Re-run the Task 1 XCTest command. Expected: all
`ChatProjectSelectionTests` pass.

- [ ] **Step 5: Checkpoint**

Run:

```bash
git diff --check
git status --short
```

Expected: only Task 1 files plus the approved spec/plan are modified.

### Task 2: Persisted thread root and first-send invariant

**Files:**

- Modify: `apps/ios/CovenCave/CovenCave/Models/Models.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift`
- Modify: `apps/ios/CovenCave/CovenCave/State/ChatThread.swift`
- Modify: `apps/ios/CovenCave/CovenCave/State/AppModel.swift`
- Modify: `apps/ios/CovenCave/CovenCaveTests/ChatResponseControlsTests.swift`
- Modify: `apps/ios/CovenCave/CovenCaveTests/ThreadSnapshotStoreTests.swift`
- Create: `apps/ios/CovenCave/CovenCaveTests/ChatProjectContractTests.swift`

- [ ] **Step 1: Add failing wire and snapshot tests**

Extend the first-turn body fixture:

```swift
let body = CaveClient.SendBody(
    familiarId: "nyx",
    prompt: "Review the branch",
    sessionId: nil,
    projectRoot: "/repos/cave",
    attachments: nil,
    runId: "run-1"
)
let json = try XCTUnwrap(
    JSONSerialization.jsonObject(with: JSONEncoder().encode(body))
        as? [String: Any]
)
XCTAssertEqual(json["projectRoot"] as? String, "/repos/cave")
XCTAssertNil(json["sessionId"])
```

Add snapshot tests that round-trip `projectRoot` and decode a literal legacy
JSON object with no project field. Add a thread request-factory test:

```swift
@MainActor
func testFirstTurnBodyUsesPersistedProjectWithoutSession() throws {
    let thread = ChatThread(
        title: "New Nyx chat",
        familiarIds: ["nyx"],
        projectRoot: "/repos/cave"
    )

    let body = try XCTUnwrap(
        thread.makeSendBody(
            familiarId: "nyx",
            prompt: "hello",
            runId: "run-1"
        )
    )

    XCTAssertEqual(body.projectRoot, "/repos/cave")
    XCTAssertNil(body.sessionId)
}
```

- [ ] **Step 2: Verify RED**

Run:

```bash
xcodebuild test \
  -project apps/ios/CovenCave/CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -only-testing:CovenCaveTests/ChatResponseControlsTests \
  -only-testing:CovenCaveTests/ThreadSnapshotStoreTests \
  -only-testing:CovenCaveTests/ChatProjectContractTests
```

Expected: compilation fails on missing `projectRoot` and `makeSendBody`.

- [ ] **Step 3: Implement persistence and request construction**

Add `projectRoot: String?` to `ThreadSnapshot`, `ChatThread`, its initializer,
snapshot conversion, and duplication. Add `projectRoot: String?` to
`CaveClient.SendBody`.

Create one request factory used by `stream`:

```swift
func makeSendBody(
    familiarId: String,
    prompt: String,
    attachments: [CaveClient.ChatAttachment] = [],
    runId: String,
    reasoningEffort: ChatThinkingEffort = .high,
    responseSpeed: ChatResponseSpeed = .fast,
    modelOverride: String? = nil,
    modelOverrideScope: ChatModelOverrideScope? = nil
) -> CaveClient.SendBody? {
    let trimmedRoot = projectRoot?
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let projectRoot = trimmedRoot.flatMap { $0.isEmpty ? nil : $0 }
    let sessionId = sessionIds[familiarId]
    guard projectRoot != nil || sessionId != nil else { return nil }
    return CaveClient.SendBody(
        familiarId: familiarId,
        prompt: prompt,
        sessionId: sessionId,
        projectRoot: projectRoot,
        attachments: attachments.isEmpty ? nil : attachments,
        runId: runId,
        reasoningEffort: reasoningEffort,
        responseSpeed: responseSpeed,
        modelOverride: modelOverride,
        modelOverrideScope: modelOverrideScope
    )
}
```

Make `send`, `enqueue`, `retry`, and `replayQueued` fail locally before
transcript mutation only when both the root and every relevant server session
are absent. A legacy resumed thread may omit the root because the server can
recover its persisted provenance. `stream` must call only `makeSendBody`.

Add `SessionRow.projectRoot` with `CodingKeys.projectRoot = "project_root"`.
Pass explicit roots through `startFreshThread`, `createGroup`,
`openServerSession`, task handoffs, duplicate/import factories, and preview
fixtures. Preserve `nil` only for legacy/imported content that ChatView will
repair before sending.

- [ ] **Step 4: Verify GREEN**

Re-run the Task 2 XCTest command. Expected: all selected tests pass.

- [ ] **Step 5: Checkpoint**

Run `git diff --check && git status --short`.

### Task 3: Structured SSE error envelopes and project recovery

**Files:**

- Modify: `apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Networking/CaveConnection.swift`
- Modify: `apps/ios/CovenCave/CovenCave/State/ChatThread.swift`
- Modify: `apps/ios/CovenCave/CovenCaveTests/ChatProjectContractTests.swift`

- [ ] **Step 1: Add failing decoder and classification tests**

```swift
func testProjectErrorEnvelopePreservesActionableMessage() throws {
    let data = Data("""
    {"ok":false,"code":"project_root_required",
     "error":"Choose a project this familiar can access before starting chat."}
    """.utf8)

    let error = CaveClient.serverResponseError(statusCode: 400, data: data)

    XCTAssertEqual(
        error.localizedDescription,
        "Choose a project this familiar can access before starting chat."
    )
    XCTAssertTrue(error.requiresProjectSelection)
}

func testMalformedEnvelopeFallsBackToStatus() {
    let error = CaveClient.serverResponseError(
        statusCode: 502,
        data: Data("not-json".utf8)
    )
    XCTAssertEqual(error.localizedDescription, "Server returned status 502.")
    XCTAssertFalse(error.requiresProjectSelection)
}
```

Also pin a 64 KiB cap and `project_access_denied` classification.

- [ ] **Step 2: Verify RED**

Run:

```bash
xcodebuild test \
  -project apps/ios/CovenCave/CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -only-testing:CovenCaveTests/ChatProjectContractTests
```

Expected: compilation fails on the missing decoder and structured error case.

- [ ] **Step 3: Implement bounded decoding**

Add:

```swift
case serverResponse(status: Int, code: String?, message: String?)
```

to `CaveError`, update auth classification, and expose:

```swift
var requiresProjectSelection: Bool {
    guard case .serverResponse(_, let code, _) = self else { return false }
    return [
        "project_root_required",
        "project_root_unavailable",
        "project_root_not_directory",
        "project_root_invalid",
        "project_not_registered",
        "project_access_denied",
    ].contains(code)
}
```

`sendStream` inspects the HTTP status before parsing SSE. For non-2xx, consume
at most 65,536 bytes from `URLSession.AsyncBytes`, decode
`{ error, code, hint }`, and throw the structured case. A definitive HTTP
response must not enter the interrupted-stream resume path.

When a pre-session thread receives a project-classified error, clear its stale
root, retain the actionable error text, and set an observable
`needsProjectSelection` flag. Normal transport errors keep existing queue and
resume behavior.

- [ ] **Step 4: Verify GREEN**

Re-run the Task 3 XCTest command. Expected: all tests pass.

- [ ] **Step 5: Checkpoint**

Run `git diff --check && git status --short`.

### Task 4: Required New Chat project picker

**Files:**

- Create: `apps/ios/CovenCave/CovenCave/Views/ChatProjectPicker.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/NewChatView.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/FamiliarThreadsView.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/ChatView.swift`
- Modify: `apps/ios/CovenCave/CovenCaveTests/ChatProjectContractTests.swift`

- [ ] **Step 1: Add failing state-policy tests**

Pin that project loading is keyed by sorted distinct familiar IDs, a changed
roster clears an inaccessible selection, and a thread with any `sessionId`
reports its project as locked:

```swift
@MainActor
func testProjectCanChangeOnlyBeforeFirstServerSession() {
    let fresh = ChatThread(
        title: "Fresh",
        familiarIds: ["nova"],
        projectRoot: "/repos/a"
    )
    XCTAssertTrue(fresh.canChangeProject)

    fresh.sessionIds["nova"] = "session-1"
    XCTAssertFalse(fresh.canChangeProject)
}
```

- [ ] **Step 2: Verify RED**

Run the focused `ChatProjectContractTests` command. Expected: failure on
missing `canChangeProject` and picker state.

- [ ] **Step 3: Build the reusable picker**

`ChatProjectPicker` accepts:

```swift
let familiarIds: [String]
let recentRoots: [String]
@Binding var selectedRoot: String?
let locked: Bool
let onResolved: (() -> Void)?
```

It calls `client.projects(familiarIds:)` in `.task(id: familiarIds.sorted())`,
renders `ProgressView`, a retryable error, a no-common-project explanation, or
a navigation-style `Picker`. VoiceOver labels include project name and access.
Locked mode renders the selected project as read-only text.

- [ ] **Step 4: Wire every entry point**

`NewChatView` gains `initialFamiliarIds`, initializes its selection from that
value, renders `ChatProjectPicker`, and disables Start/Create unless a root is
resolved.

`ChatsHomeView.startNewChat(with:)` and
`FamiliarThreadsView.startNewChat()` present `NewChatView` with the familiar
preselected instead of creating a thread synchronously.

`ChatView`:

- displays the project context control before the first send;
- opens the picker when `thread.needsProjectSelection` is true;
- blocks the send action locally until a root exists;
- clears the recovery flag after a valid selection;
- makes `/new` pass `projectRoot: thread.projectRoot`;
- renders a locked context after the first server session.

- [ ] **Step 5: Verify focused native tests and build**

Run:

```bash
xcodebuild test \
  -project apps/ios/CovenCave/CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -only-testing:CovenCaveTests/ChatProjectContractTests

xcodebuild build \
  -project apps/ios/CovenCave/CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  CODE_SIGNING_ALLOWED=NO
```

Expected: tests pass and the app target builds.

- [ ] **Step 6: Checkpoint**

Run `git diff --check && git status --short`.

### Task 5: Durable Linux and route-level regression gates

**Files:**

- Create: `scripts/ios-chat-project-contract.test.mjs`
- Create: `src/app/api/chat/send/ios-first-turn-project-contract.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the Linux contract guard and verify RED**

The source guard reads the Swift files and asserts:

```js
assert.match(sendBody, /var projectRoot: String\?/);
assert.match(chatThread, /var projectRoot: String\?/);
assert.match(chatThread, /projectRoot: projectRoot/);
assert.match(newChat, /\.disabled\([\s\S]*selectedProjectRoot == nil/);
assert.match(chatView, /projectRoot: thread\.projectRoot/);
assert.match(caveClient, /serverResponseError\(statusCode:/);
assert.match(runner, /"scripts\/ios-chat-project-contract\.test\.mjs"/);
```

Run:

```bash
node scripts/ios-chat-project-contract.test.mjs
```

Expected before production wiring: assertion failure.

- [ ] **Step 2: Add the route regression and verify RED/GREEN boundary**

The route test imports `POST`, sends the exact iOS first-turn shape with no
session or root, and asserts:

```ts
assert.equal(response.status, 400);
assert.deepEqual(await response.json(), {
  ok: false,
  error: "Choose a project this familiar can access before starting chat.",
  code: "project_root_required",
});
```

This should pass against the secure server and documents the client obligation.
The adjacent `chat-project-launch.test.ts` retains accessible and denied root
coverage.

- [ ] **Step 3: Finish and wire the Linux guard**

Add the new script to `suites.mobile` in `scripts/run-tests.mjs`.

Run:

```bash
node scripts/ios-chat-project-contract.test.mjs
node --import ./scripts/test-alias-register.mjs \
  --experimental-strip-types \
  src/app/api/chat/send/ios-first-turn-project-contract.test.ts
node scripts/check-tests-wired.mjs
```

Expected: all commands exit 0.

- [ ] **Step 4: Verify the mobile suite**

Run:

```bash
pnpm test:mobile
```

Expected: all mobile-suite files pass, including the new guard.

- [ ] **Step 5: Checkpoint**

Run `git diff --check && git status --short`.

### Task 6: Full verification and requirement audit

**Files:**

- Verify all files listed above.
- Update Bead `cave-rlscz` with exact evidence.

- [ ] **Step 1: Run full native tests**

```bash
xcodegen generate --spec apps/ios/CovenCave/project.yml
xcodebuild test \
  -project apps/ios/CovenCave/CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro'
```

Expected: `CovenCaveTests` executes with zero failures.

- [ ] **Step 2: Run server and repository gates**

```bash
node --experimental-strip-types src/lib/server/chat-project-launch.test.ts
node --import ./scripts/test-alias-register.mjs \
  --experimental-strip-types \
  src/app/api/chat/send/ios-first-turn-project-contract.test.ts
pnpm test:mobile
pnpm lint
pnpm typecheck
node scripts/check-tests-wired.mjs
```

Expected: every command exits 0.

- [ ] **Step 3: Run relevant app/API suites**

```bash
pnpm test:app
pnpm test:api
```

Expected: both suites pass. If an unrelated known baseline failure occurs,
capture the exact test and reproduce it on clean `origin/main` before
classifying it.

- [ ] **Step 4: Walk the native UI shipping checklist**

On an iPhone simulator verify:

- direct New Chat chooses a valid accessible project;
- group New Chat lists only the shared intersection;
- loading, retryable failure, and no-common-project states are readable;
- Start/Create cannot bypass unresolved project state;
- `/new` inherits the current root;
- a synthetic project error exposes the server message and repicker;
- VoiceOver names include project and access;
- Dynamic Type does not truncate the recovery action;
- no new animation exists, so Reduce Motion behavior remains unchanged.

- [ ] **Step 5: Audit the final diff and workspace isolation**

```bash
git diff --check
git diff --stat origin/main...
git status --short --branch
git -C /Users/<someone>/Documents/GitHub/OpenCoven/coven-cave status --short --branch
```

Expected: the feature worktree contains only this task; the canonical
checkout retains its pre-existing unrelated edits unchanged.

- [ ] **Step 6: Record completion evidence**

Update `cave-rlscz` notes with:

- branch/worktree;
- red/green evidence;
- native test and build counts;
- mobile/app/API/lint/typecheck results;
- manual simulator observations;
- any explicit proof gaps.

Close the Bead only after every acceptance criterion is proven. Do not commit,
push, or open a PR unless the user separately authorizes those actions.
