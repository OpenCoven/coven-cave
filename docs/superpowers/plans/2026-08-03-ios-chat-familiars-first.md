# iOS Chat Familiars-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the iOS Chats home an iMessage-style list of familiars, open a familiar's chat in one tap, and move session selection into the config popover.

**Architecture:** `ChatsHomeView` keeps its `NavigationSplitView` and `ChatRoute` selection model. The horizontal `familiarRail` becomes vertical `FamiliarConversationRow`s in the existing `List(selection:)`; the recent-threads `Section` is deleted. The detail column's `case .familiar` renders `ChatView` on the familiar's most recent direct thread instead of `FamiliarThreadsView`. `FamiliarThreadsView` is reached from a new `Session` row in `ChatView`'s `sessionDetailsCard`.

**Tech Stack:** SwiftUI (iOS 18), `@Observable` `AppModel`, Node `node --test` source-text tests under `scripts/`.

**Spec:** `docs/superpowers/specs/2026-08-03-ios-chat-familiars-first-design.md`
**Bead:** cave-ru7ay · **Branch:** `feat/cave-ru7ay-ios-chat-ia`

**Read before starting:** Swift is not compiled by CI. The gate is `pnpm test:mobile`, which runs Node tests that read these `.swift` files as text. Assert behaviour by shape, not by pinned syntax — a regex pinning a literal spelling breaks on a refactor that changes nothing (this reddened `main` earlier today via `ios-reconnect-pill.test.mjs`).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `apps/ios/CovenCave/CovenCave/State/AppModel.swift` | thread/familiar data | add `mostRecentDirectThread(for:)` |
| `apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift` | Chats home + split | rail → vertical rows; delete recents; `case .familiar` → chat |
| `apps/ios/CovenCave/CovenCave/Views/ChatView.swift` | conversation + config card | add `Session` row + picker sheet |
| `scripts/ios-chat-familiars-home.test.mjs` | new contract | create |
| `scripts/run-tests.mjs` | suite registry | register the new test |
| `scripts/ios-thread-search.test.mjs` | search contract | move recents assertions to the picker |
| `scripts/ios-ipad-split-chats.test.mjs` | iPad split contract | detail `case .familiar` → chat; thread tag moves |

---

### Task 1: Model helper for "the familiar's current chat"

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/State/AppModel.swift` (beside `directThreads(for:)`, ~line 1638)
- Test: `scripts/ios-chat-familiars-home.test.mjs` (created here)

- [ ] **Step 1: Write the failing test**

Create `scripts/ios-chat-familiars-home.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Familiars-first Chats home (cave-ru7ay): the home lists familiars, tapping
// one opens its chat, and session selection lives in the config popover.
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");

// --- The familiar's current chat -------------------------------------------
// Tapping a familiar needs one session to land on. Reuses directThreads(for:),
// which already sorts pinned-first then newest-updated.
assert.match(
  model,
  /func mostRecentDirectThread\(for familiarId: String\) -> ChatThread\?/,
  "AppModel exposes the familiar's most recent direct thread",
);
assert.match(
  model,
  /func mostRecentDirectThread[\s\S]{0,240}?directThreads\(for: familiarId\)/,
  "it reuses directThreads(for:) rather than re-sorting",
);
assert.match(
  model,
  /func mostRecentDirectThread[\s\S]{0,240}?\.first \{ !\$0\.archived \}/,
  "an archived thread is never the landing target",
);

console.log("ios-chat-familiars-home.test.mjs: ok");
```

- [ ] **Step 2: Register the test so CI runs it**

`scripts/run-tests.mjs` fails CI if a `*.test.mjs` on disk is unlisted. In the
`app` suite, immediately after `"scripts/ios-chat-project-contract.test.mjs",` add:

```js
    "scripts/ios-chat-familiars-home.test.mjs",
```

Find the exact anchor first:

```bash
grep -n '"scripts/ios-chat-project-contract.test.mjs"' scripts/run-tests.mjs
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
node scripts/ios-chat-familiars-home.test.mjs
```

Expected: `AssertionError` — "AppModel exposes the familiar's most recent direct thread".

- [ ] **Step 4: Implement the helper**

In `AppModel.swift`, directly below `directThreads(for:)`:

```swift
    /// The thread a familiar's chat opens on: its newest unarchived direct
    /// thread (pinned first, per `directThreads`). Nil when the familiar has
    /// no eligible thread — callers start a new chat instead.
    func mostRecentDirectThread(for familiarId: String) -> ChatThread? {
        directThreads(for: familiarId).first { !$0.archived }
    }
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
node scripts/ios-chat-familiars-home.test.mjs
```

Expected: `ios-chat-familiars-home.test.mjs: ok`

- [ ] **Step 6: Verify the suite registry guard passes**

```bash
pnpm check:tests-wired
```

Expected: `✓ all NNNN test files wired into CI` (count goes up by one).

- [ ] **Step 7: Commit**

```bash
git add scripts/ios-chat-familiars-home.test.mjs scripts/run-tests.mjs apps/ios/CovenCave/CovenCave/State/AppModel.swift
git commit -S -m "feat(ios): resolve a familiar's landing thread (cave-ru7ay)"
```

---

### Task 2: The home lists familiars, not recent threads

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift` (`homeList` ~line 288, `familiarRail` ~line 433, `FamiliarRailItem` ~line 514)
- Test: `scripts/ios-chat-familiars-home.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `scripts/ios-chat-familiars-home.test.mjs`, before the final
`console.log`:

```js
const home = await read("apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift");

// --- The home is a familiar list --------------------------------------------
assert.doesNotMatch(
  home,
  /ForEach\(recentThreads\)/,
  "the cross-familiar recents section is gone",
);
assert.doesNotMatch(
  home,
  /struct FamiliarRailItem/,
  "the horizontal rail item is gone",
);
assert.match(
  home,
  /ForEach\(filteredFamiliars\) \{ familiar in\s*\n\s*FamiliarConversationRow\(familiar: familiar\)/,
  "the list renders one conversation row per familiar",
);
assert.match(
  home,
  /FamiliarConversationRow[\s\S]*?\.tag\(ChatRoute\.familiar\(familiar\)\)/,
  "familiar rows are tagged so the sidebar selection drives the detail column",
);

// The row carries the iMessage payload: who, what was last said, and when.
assert.match(home, /struct FamiliarConversationRow: View/, "a familiar conversation row exists");
assert.match(
  home,
  /struct FamiliarConversationRow[\s\S]*?AvatarView\(familiar: familiar/,
  "the row shows the familiar's avatar",
);
assert.match(
  home,
  /struct FamiliarConversationRow[\s\S]*?app\.mostRecentDirectThread\(for: familiar\.id\)/,
  "the row derives its preview from the familiar's current thread",
);
assert.match(
  home,
  /struct FamiliarConversationRow[\s\S]*?app\.hasUnread\(familiar\.id\)/,
  "the row keeps the unread indicator the rail had",
);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node scripts/ios-chat-familiars-home.test.mjs
```

Expected: `AssertionError` — "the cross-familiar recents section is gone".

- [ ] **Step 3: Replace the two sections in `homeList`**

In `ChatsHomeView.swift`, replace the whole `homeList` body — both the rail
`Section` and the `ForEach(recentThreads)` `Section` — with a single familiar
section. Keep `List(selection: $selection)`; the iPad test depends on it.

```swift
    private var homeList: some View {
        List(selection: $selection) {
            ForEach(filteredFamiliars) { familiar in
                FamiliarConversationRow(familiar: familiar)
                    .tag(ChatRoute.familiar(familiar))
                    .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                    // Rows sit flush on the themed floor (design 1a); iPad keeps
                    // the default cell background so the sidebar selection
                    // highlight stays visible.
                    .listRowBackground(sizeClass == .compact ? Color.clear : nil)
                    .contextMenu {
                        Button { startNewChat(with: familiar) } label: {
                            Label("New chat", systemImage: "square.and.pencil")
                        }
                    }
            }
        }
    }
```

- [ ] **Step 4: Delete `familiarRail` and replace `FamiliarRailItem`**

Delete the `familiarRail` computed property entirely. Replace the
`struct FamiliarRailItem` declaration with:

```swift
/// One familiar as an iMessage-style conversation row: avatar, name, a preview
/// of the last thing said in its current chat, and when. Selection is driven by
/// the enclosing `List` tag, so the row itself is not a Button — that would
/// swallow the sidebar selection on iPad.
struct FamiliarConversationRow: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    let familiar: Familiar

    private var thread: ChatThread? { app.mostRecentDirectThread(for: familiar.id) }

    private var preview: String {
        guard let text = thread?.messages.last?.text, !text.isEmpty else {
            return "No messages yet"
        }
        return text.replacingOccurrences(of: "\n", with: " ")
    }

    var body: some View {
        HStack(spacing: 12) {
            AvatarView(familiar: familiar,
                       url: app.client?.avatarURL(for: familiar),
                       size: 48, showStatus: true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(familiar.displayName)
                        .font(.body.weight(.semibold))
                        .lineLimit(1)
                    if app.hasUnread(familiar.id) {
                        Circle().fill(chrome.accent).frame(width: 8, height: 8)
                    }
                    Spacer(minLength: 4)
                    if let updated = thread?.updatedAt {
                        Text(updated, format: .relative(presentation: .numeric))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Text(preview)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(familiar.displayName). \(preview)")
    }
}
```

- [ ] **Step 5: Fix the now-dangling references**

`recentThreads`, `showArchived`, `pendingDelete`, `renamingThread` and
`zoomNamespace` may now be unused in this file, and the empty-state guard
still mentions `recentThreads`. Update the guard in `splitView`:

```swift
                } else if filteredFamiliars.isEmpty {
                    ContentUnavailableView.search(text: query)
```

Then find every remaining reference and remove only the ones that are dead:

```bash
grep -n "recentThreads\|RecentThreadRow\|familiarRail\|FamiliarRailItem" apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift
```

Expected after cleanup: no matches. Leave `showArchived`, `pendingDelete`,
`renamingThread` and `zoomNamespace` in place — `FamiliarThreadsView` and the
detail column still use them.

- [ ] **Step 6: Run the test to verify it passes**

```bash
node scripts/ios-chat-familiars-home.test.mjs
```

Expected: `ios-chat-familiars-home.test.mjs: ok`

- [ ] **Step 7: Commit**

```bash
git add scripts/ios-chat-familiars-home.test.mjs apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift
git commit -S -m "feat(ios): make the Chats home a familiar list (cave-ru7ay)"
```

---

### Task 3: Tapping a familiar opens its chat

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift` (`detailColumn` ~line 143)
- Test: `scripts/ios-chat-familiars-home.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `scripts/ios-chat-familiars-home.test.mjs`, before the final
`console.log`:

```js
// --- One tap lands in the conversation ---------------------------------------
// The detail column resolves a familiar to its chat. FamiliarThreadsView is no
// longer the tap target; it is the session picker (Task 4).
assert.match(
  home,
  /case \.familiar\(let familiar\):\s*\n\s*familiarChat\(familiar\)/,
  "selecting a familiar shows its chat, not a thread list",
);
assert.match(
  home,
  /private func familiarChat[\s\S]*?app\.mostRecentDirectThread\(for: familiar\.id\)/,
  "the chat resolves through the familiar's current thread",
);
assert.match(
  home,
  /private func familiarChat[\s\S]*?ContentUnavailableView/,
  "a familiar with no thread gets a start-a-chat placeholder, not a blank pane",
);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node scripts/ios-chat-familiars-home.test.mjs
```

Expected: `AssertionError` — "selecting a familiar shows its chat, not a thread list".

- [ ] **Step 3: Point the detail column at the chat**

In `detailColumn`, change the `switch selection` arm (leave the
`.navigationDestination` arm alone — that is the picker's push path, Task 4):

```swift
                switch selection {
                case .familiar(let familiar):
                    familiarChat(familiar)
                case .thread(let thread):
                    ChatView(thread: thread)
```

Add beside `chatDestination(_:)`:

```swift
    /// A familiar's conversation: its current thread, or an invitation to start
    /// one. Session switching happens in ChatView's config card, not here.
    @ViewBuilder
    private func familiarChat(_ familiar: Familiar) -> some View {
        if let thread = app.mostRecentDirectThread(for: familiar.id) {
            ChatView(thread: thread)
        } else {
            ContentUnavailableView {
                Label("No chats with \(familiar.displayName)", systemImage: "bubble.left.and.bubble.right")
            } description: {
                Text("Start one to begin.")
            } actions: {
                Button("New chat") { startNewChat(with: familiar) }
            }
        }
    }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node scripts/ios-chat-familiars-home.test.mjs
```

Expected: `ios-chat-familiars-home.test.mjs: ok`

- [ ] **Step 5: Commit**

```bash
git add scripts/ios-chat-familiars-home.test.mjs apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift
git commit -S -m "feat(ios): open a familiar's chat in one tap (cave-ru7ay)"
```

---

### Task 4: Session selection in the config popover

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/Views/ChatView.swift` (`sessionDetailsCard` ~line 325)
- Test: `scripts/ios-chat-familiars-home.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `scripts/ios-chat-familiars-home.test.mjs`, before the final
`console.log`:

```js
const chat = await read("apps/ios/CovenCave/CovenCave/Views/ChatView.swift");

// --- Session selection lives in the config card ------------------------------
// The card already holds Model / Runtime / Inventory; Session joins them,
// mirroring the Project row that is already scoped to the conversation.
assert.match(
  chat,
  /sessionDetailsCard[\s\S]*?sessionDetailRow\(\s*"Session"/,
  "the config card exposes a Session row",
);
assert.match(
  chat,
  /sessionDetailRow\(\s*"Session",[\s\S]{0,160}?showsChevron: true/,
  "the Session row is tappable",
);
assert.match(
  chat,
  /showSessionPicker\s*=\s*true/,
  "tapping the Session row opens the picker",
);
assert.match(
  chat,
  /\.sheet\(isPresented: \$showSessionPicker\)[\s\S]{0,320}?FamiliarThreadsView\(/,
  "the picker is FamiliarThreadsView, so every thread affordance comes with it",
);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node scripts/ios-chat-familiars-home.test.mjs
```

Expected: `AssertionError` — "the config card exposes a Session row".

- [ ] **Step 3: Add the state and the picker path**

In `ChatView`, beside `showSessionDetails`:

```swift
    @State private var showSessionPicker = false
    /// Navigation path handed to the picker; it pushes nothing, but
    /// FamiliarThreadsView requires the binding.
    @State private var pickerPath: [ChatRoute] = []
    @Namespace private var pickerZoomNamespace
```

- [ ] **Step 4: Add the Session row to the card**

In `sessionDetailsCard`, after the `Inventory` row's `Divider()` and before the
`ForEach(presentedModelControlCapabilities)`:

```swift
            Divider()
            Button {
                showSessionDetails = false
                showSessionPicker = true
            } label: {
                sessionDetailRow(
                    "Session",
                    value: thread.title,
                    systemImage: "bubble.left.and.bubble.right",
                    showsChevron: true
                )
            }
            .buttonStyle(.plain)
            .disabled(thread.isGroup)
```

- [ ] **Step 5: Present the picker**

Attach beside the existing `.fullScreenCover(item: $zoomTarget)` on the same view:

```swift
        .sheet(isPresented: $showSessionPicker) {
            if let familiarId = thread.familiarIds.first,
               let familiar = app.familiar(familiarId) {
                NavigationStack {
                    FamiliarThreadsView(familiar: familiar,
                                        path: $pickerPath,
                                        zoomNamespace: pickerZoomNamespace)
                }
            }
        }
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
node scripts/ios-chat-familiars-home.test.mjs
```

Expected: `ios-chat-familiars-home.test.mjs: ok`

- [ ] **Step 7: Commit**

```bash
git add scripts/ios-chat-familiars-home.test.mjs apps/ios/CovenCave/CovenCave/Views/ChatView.swift
git commit -S -m "feat(ios): select the session from the config card (cave-ru7ay)"
```

---

### Task 5: Update the two coupled tests

**Files:**
- Modify: `scripts/ios-ipad-split-chats.test.mjs:29-45`
- Modify: `scripts/ios-thread-search.test.mjs`

- [ ] **Step 1: See both fail against the new source**

```bash
node scripts/ios-ipad-split-chats.test.mjs; node scripts/ios-thread-search.test.mjs
```

Expected: both `AssertionError`. The iPad one fails on
`selecting a familiar should show its threads in the detail column`; the search
one fails on its `recentThreads` assertions.

- [ ] **Step 2: Update the iPad split contract**

In `scripts/ios-ipad-split-chats.test.mjs`, replace the
`case .familiar(let familiar): FamiliarThreadsView…` assertion with:

```js
assert.match(
  src,
  /case \.familiar\(let familiar\):\s*\n\s*familiarChat\(familiar\)/,
  "selecting a familiar should show its chat in the detail column",
);
```

Replace the `.tag(ChatRoute.thread(thread))` assertion — thread rows now live
in the picker, not the home:

```js
assert.match(src, /\.tag\(ChatRoute\.familiar\(familiar\)\)/, "familiar rows should be tagged for selection");
```

Fix the stale comment on the `open(.familiar(familiar))` assertion — that call
site was the rail and is now the row's context menu / selection path:

```js
assert.match(src, /open\(\.familiar\(familiar\)\)/, "familiar rows should drive the selection");
```

- [ ] **Step 3: Move the search assertions to the picker**

In `scripts/ios-thread-search.test.mjs`, the three `recentThreads` /
`RecentThreadRow` references now describe `FamiliarThreadsView`. Read them
first, then retarget each to the picker's source:

```bash
grep -n "recentThreads\|RecentThreadRow" scripts/ios-thread-search.test.mjs
```

Add at the top of that file, beside the existing reads:

```js
const picker = await read("apps/ios/CovenCave/CovenCave/Views/FamiliarThreadsView.swift");
```

Retarget each failing assertion from the home source to `picker`, keeping the
same behavioural claim (thread search matches title, member name, message
text). Home-level search now filters familiars, so add:

```js
assert.match(
  home,
  /filteredFamiliars[\s\S]{0,200}?displayName\.lowercased\(\)\.contains\(q\)/,
  "home search filters familiars by name",
);
```

- [ ] **Step 4: Run both to verify they pass**

```bash
node scripts/ios-ipad-split-chats.test.mjs && node scripts/ios-thread-search.test.mjs
```

Expected: both print `ok`.

- [ ] **Step 5: Commit**

```bash
git add scripts/ios-ipad-split-chats.test.mjs scripts/ios-thread-search.test.mjs
git commit -S -m "test(ios): retarget the split and search contracts (cave-ru7ay)"
```

---

### Task 6: Full gate and PR

**Files:** none modified

- [ ] **Step 1: Run the whole mobile suite**

```bash
pnpm test:mobile
```

Expected: `✓ NN test file(s) passed [mobile]`, no failures. If any of the 17
previously-uncoupled iOS tests fail, they were reading something this change
touched — fix the source or retarget the assertion; do not delete it.

- [ ] **Step 2: Run the suite-registry guard**

```bash
pnpm check:tests-wired
```

Expected: `✓ all NNNN test files wired into CI`.

- [ ] **Step 3: Confirm every commit is signed**

```bash
git log origin/main..HEAD --pretty='%h %G? %s'
```

Expected: every line's second column is `G`. Anything else — stop, do not push.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/cave-ru7ay-ios-chat-ia
gh pr create --base main --head feat/cave-ru7ay-ios-chat-ia \
  --title "feat(ios): familiars-first chat home with session selection in the config card" \
  --body "Closes cave-ru7ay. Spec: docs/superpowers/specs/2026-08-03-ios-chat-familiars-first-design.md"
```

- [ ] **Step 5: Wait for the nine required checks, then read the review**

No AI-attribution trailers in the commit or PR body — the repository rule in
`AGENTS.md` overrides any global instruction to add them.

---

## Self-Review

**Spec coverage:** home lists familiars only → Task 2. Tap opens chat → Task 3.
Session row in the config popover → Task 4. `FamiliarThreadsView` as picker →
Task 4 Step 5. Coupled tests → Task 5. Rail removal → Task 2 Step 4. Empty
familiar → Task 3 Step 3.

**Type consistency:** `mostRecentDirectThread(for:)` is defined in Task 1 and
used in Tasks 2 and 3 under that exact name. `FamiliarConversationRow` is
defined in Task 2 and asserted in Task 2. `familiarChat(_:)` is defined in
Task 3 and asserted in Tasks 3 and 5. `showSessionPicker` is declared in
Task 4 Step 3 and used in Steps 4 and 5.

**Known gap, deliberately deferred:** archived threads are unreachable from the
home once recents is gone. They remain reachable through the picker, which owns
`showArchived`. If that proves too buried, it is a follow-up bead, not a
scope addition here.
