# Redundant Chat Chrome Removals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the redundant solo-participant cluster from the web Chat header and the read-only Project band from started iOS chats without removing either platform's remaining group/project recovery paths.

**Architecture:** Treat both screenshots as presentation ownership bugs. The web Chat header stops rendering its dedicated `ChatParticipants` leaf, while the existing rail drag-to-promote callback and Group chat membership controls remain unchanged. The iOS project picker becomes a mutable selection/recovery control only; `ChatView` renders it solely while the thread can still change projects, and New Chat continues to render it normally.

**Tech Stack:** React, TypeScript, CSS, SwiftUI, Node source-contract tests, Xcode build verification

---

## Task 1: Remove the web solo-participant header cluster

**Files:**
- Create: `src/components/chat-header-chrome.test.ts`
- Modify: `src/components/chat-view.tsx`
- Modify: `src/styles/cave-chat/activity.css`
- Modify: `scripts/run-tests.mjs`
- Delete: `src/components/chat-participants.tsx`
- Delete: `src/components/chat-participants.test.ts`

- [ ] **Step 1: Replace the positive participant test with an absence-and-preservation contract**

Create `src/components/chat-header-chrome.test.ts` with this complete test:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const groupChatView = readFileSync(new URL("./group-chat-view.tsx", import.meta.url), "utf8");
const activityCss = readFileSync(new URL("../styles/cave-chat/activity.css", import.meta.url), "utf8");

assert.doesNotMatch(
  chatView,
  /from "@\/components\/chat-participants"|<ChatParticipants\b/,
  "solo Chat must not render the participant identity/add cluster in its header",
);
assert.doesNotMatch(
  activityCss,
  /\.cave-chat-participants(?:__[\w-]+)?\b/,
  "the removed participant cluster must not leave dead CSS behind",
);
assert.match(
  chatView,
  /const handleFamiliarDrop = useCallback\([\s\S]*promoteToCoven\(dropped\)/,
  "dragging a familiar into a solo Chat must still promote it to a coven",
);
assert.match(
  groupChatView,
  /aria-label="Add familiars to this coven"/,
  "Group chat must retain its explicit add-familiar control",
);

console.log("chat-header-chrome.test.ts: ok");
```

Delete `src/components/chat-participants.test.ts`, and replace its entry in the `app` array in `scripts/run-tests.mjs` with:

```js
"src/components/chat-header-chrome.test.ts",
```

- [ ] **Step 2: Run the focused test and verify it fails for the intended reason**

Run:

```bash
node --experimental-strip-types src/components/chat-header-chrome.test.ts
```

Expected: FAIL on the first `doesNotMatch` because `chat-view.tsx` still imports/renders `ChatParticipants`. Do not continue if the failure is a syntax, path, or fixture error.

- [ ] **Step 3: Remove only the header cluster**

In `src/components/chat-view.tsx`:

- Remove the `ChatParticipants` import.
- Remove the explanatory `cave-9xadi` comment immediately above `promoteToCoven`; replace it with a short comment stating that rail drag-to-promote retains the callback.
- Update the later drag comment so it no longer claims the removed `+` control is the primary affordance.
- Remove the `ChatParticipants` render block and its adjacent `cave-9xadi` JSX comment from `.cave-chat-session-actions`.
- Keep `promoteToCoven`, `handleFamiliarDrop`, the relevant `familiars` prop usage, coven events, and Group chat code unchanged.

Delete `src/components/chat-participants.tsx`.

In `src/styles/cave-chat/activity.css`, delete the complete participant block beginning with the `cave-9xadi: participants cluster` comment and ending after the mobile media rule. Keep `.cave-chat-session-actions` and the following archive-button rules unchanged.

- [ ] **Step 4: Run the web-focused and test-wiring checks**

Run:

```bash
node --experimental-strip-types src/components/chat-header-chrome.test.ts
pnpm check:tests-wired
git diff --check
```

Expected: all commands exit 0, and the focused test prints `chat-header-chrome.test.ts: ok`.

- [ ] **Step 5: Commit the independently verified web change**

Review scope:

```bash
git diff -- src/components/chat-view.tsx src/styles/cave-chat/activity.css scripts/run-tests.mjs src/components/chat-header-chrome.test.ts src/components/chat-participants.tsx src/components/chat-participants.test.ts
```

Commit:

```bash
git add src/components/chat-view.tsx src/styles/cave-chat/activity.css scripts/run-tests.mjs src/components/chat-header-chrome.test.ts src/components/chat-participants.tsx src/components/chat-participants.test.ts
git commit -m "fix(chat): remove solo participant header cluster"
```

## Task 2: Remove the locked iOS Project band while preserving selection recovery

**Files:**
- Modify: `scripts/ios-chat-project-contract.test.mjs`
- Modify: `apps/ios/CovenCave/CovenCave/Views/ChatView.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/ChatProjectPicker.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/NewChatView.swift`

- [ ] **Step 1: Rewrite the iOS source contract around the approved behavior**

In `scripts/ios-chat-project-contract.test.mjs`, replace the assertion that requires `lockedProject` with:

```js
assert.doesNotMatch(
  picker,
  /\blocked\b|lockedProject|Start a new chat to use another project\./,
  "the project picker must not contain a read-only started-chat presentation",
);
```

Replace the two Chat picker assertions with:

```js
assert.match(
  chat,
  /if thread\.canChangeProject && \(thread\.needsProjectSelection \|\| !thread\.canSendMessages\) \{[\s\S]*ChatProjectPicker\([\s\S]*selectedRoot: \$thread\.projectRoot[\s\S]*requiresExplicitSelection: thread\.needsProjectSelection/,
  "Chat must show project recovery only while the thread can still change project",
);
assert.doesNotMatch(
  chat,
  /locked: !thread\.canChangeProject/,
  "started chats must not configure a locked Project band",
);
```

Strengthen the existing New Chat assertion so it proves the mutable picker remains:

```js
assert.match(
  newChat,
  /Section\("Project"\) \{[\s\S]*ChatProjectPicker\([\s\S]*familiarIds: selectedFamiliarIds[\s\S]*selectedRoot: \$selectedProjectRoot[\s\S]*isResolved: \$projectResolved[\s\S]*\.disabled\([\s\S]*!projectResolved[\s\S]*selectedProjectRoot == nil/,
  "New Chat must retain project selection and remain blocked until it resolves",
);
```

- [ ] **Step 2: Run the iOS contract and verify it fails for the intended reason**

Run:

```bash
node scripts/ios-chat-project-contract.test.mjs
```

Expected: FAIL because `ChatProjectPicker.swift` still contains `locked`, `lockedProject`, and the read-only helper copy. Do not continue if the failure is unrelated to those old contracts.

- [ ] **Step 3: Make ChatProjectPicker mutable-only**

In `apps/ios/CovenCave/CovenCave/Views/ChatProjectPicker.swift`:

- Delete `let locked: Bool`.
- Delete `LoadKey.locked` and its `locked: locked` initializer argument.
- Change the body branch from `if locked { ... } else if familiarKey.isEmpty {` to begin directly with `if familiarKey.isEmpty {`.
- Delete the complete `lockedProject` computed property.
- Delete `selectedProjectLabel`, which is only consumed by `lockedProject`.
- Delete the initial `if locked { ... return }` branch from `loadProjects()`.
- Leave familiar scoping, explicit recovery selection, connection recovery, and project resolution unchanged.

- [ ] **Step 4: Render recovery only for mutable Chat threads**

In `apps/ios/CovenCave/CovenCave/Views/ChatView.swift`, change `projectContext` to:

```swift
@ViewBuilder
private var projectContext: some View {
    if thread.canChangeProject && (thread.needsProjectSelection || !thread.canSendMessages) {
        ChatProjectPicker(
            familiarIds: thread.familiarIds,
            recentRoots: app.recentProjectRoots,
            selectedRoot: $thread.projectRoot,
            isResolved: $projectResolved,
            requiresExplicitSelection: thread.needsProjectSelection
        ) {
            thread.needsProjectSelection = false
            app.touch(thread)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(chrome.bgRaised)
    }
}
```

This deliberately preserves the recovery UI for unsent legacy/stale threads and suppresses it once a server session makes `canChangeProject` false.

In `apps/ios/CovenCave/CovenCave/Views/NewChatView.swift`, remove only the obsolete `locked: false` argument from `ChatProjectPicker`; keep the Project section and bindings unchanged.

- [ ] **Step 5: Run focused iOS validation**

Run:

```bash
node scripts/ios-chat-project-contract.test.mjs
xcodebuild -project apps/ios/CovenCave/CovenCave.xcodeproj -scheme CovenCave -destination 'generic/platform=iOS Simulator' build
git diff --check
```

Expected: the source contract prints `ios-chat-project-contract.test.mjs: ok`, the Swift app builds, and the diff check exits 0.

- [ ] **Step 6: Commit the independently verified iOS change**

Review scope:

```bash
git diff -- scripts/ios-chat-project-contract.test.mjs apps/ios/CovenCave/CovenCave/Views/ChatView.swift apps/ios/CovenCave/CovenCave/Views/ChatProjectPicker.swift apps/ios/CovenCave/CovenCave/Views/NewChatView.swift
```

Commit:

```bash
git add scripts/ios-chat-project-contract.test.mjs apps/ios/CovenCave/CovenCave/Views/ChatView.swift apps/ios/CovenCave/CovenCave/Views/ChatProjectPicker.swift apps/ios/CovenCave/CovenCave/Views/NewChatView.swift
git commit -m "fix(ios): remove locked project band from chats"
```

## Task 3: Verify the combined UI change from clean branch state

**Files:**
- Verify: all files changed in Tasks 1-2
- Update outside Git only: Bead `cave-cqll3`

- [ ] **Step 1: Run the focused contracts together**

```bash
node --experimental-strip-types src/components/chat-header-chrome.test.ts
node scripts/ios-chat-project-contract.test.mjs
pnpm check:tests-wired
```

Expected: all three commands exit 0.

- [ ] **Step 2: Run repository quality gates**

```bash
pnpm lint
pnpm typecheck
pnpm test:app
pnpm test:mobile
git diff --check
```

Expected: all commands exit 0. If an unrelated pre-existing failure appears, record the exact command and failure in the Bead rather than weakening the focused contracts.

- [ ] **Step 3: Perform targeted visual checks**

Web/Tauri:

```bash
bash scripts/dev-app.sh
```

Open a solo Chat and verify:

- The familiar avatar, `solo` label, and dashed add button are absent from the header.
- Archive, voice, find, and remaining session actions retain their alignment and focus behavior.
- Dragging an addable familiar from the rail still opens the resulting coven.
- Group chat still exposes `Add familiars to this coven`.

Stop the foreground wrapper with `Ctrl-C` after verification.

iOS Simulator:

- Open a started thread and verify no Project band appears above the composer.
- Open New Chat and verify Project selection still appears and gates Start/Create.
- Exercise an unsent thread needing project recovery and verify the mutable picker appears.
- Capture the simulator/device and observed results in Bead `cave-cqll3`.

- [ ] **Step 4: Prove branch scope and record the handoff**

```bash
git status --short --branch
git log --oneline --decorate origin/main..HEAD
git diff --stat origin/main...HEAD
pnpm beads:worktrees
```

Expected: only the approved spec/plan and two scoped implementation commits are ahead of `origin/main`; the worktree remains associated with `cave-cqll3` until PR delivery.

Record in the Bead:

- Branch and managed worktree path.
- Both commit IDs.
- Focused, full-suite, build, and visual evidence.
- Any proof gap that remains.

Do not close the Bead until the PR merges or Val explicitly accepts another completion criterion.
