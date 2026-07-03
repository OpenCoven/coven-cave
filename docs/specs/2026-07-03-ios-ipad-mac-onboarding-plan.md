# iOS iPad/macOS Adaptivity + Seamless Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every screen of the native app lays out properly on iPad landscape and macOS ("Designed for iPad") windows, and pairing a device with a token-gated desktop is a paste/scan/tap affair with actionable errors and silent renewal.

**Architecture:** Part A (PR 1, Swift-only): explicit split-view column widths, Calendar converted to a split view, size-class-aware sheet-vs-pane decisions, `readableWidth` spread to all stretched surfaces. Part B (PR 2, Swift + server): signed-token capture (invite URL paste / QR / `covencave://connect` deep link) → Keychain → `Authorization: Bearer` on every transport, 401-aware connection states, and a rolling 30-day refresh endpoint.

**Tech Stack:** SwiftUI (iOS 18 target, XcodeGen), Next.js API routes (node:test source-text/unit tests, run-tests.mjs suites).

**Spec:** `docs/specs/2026-07-03-ios-ipad-mac-onboarding-design.md`

Verification environment: iPad simulator "Cave iPad Verify" (iPad Pro 13-inch, iOS 26.5, udid 104E9408-B20F-45BE-B9D7-F315D9364AF9); local Cave server; tab navigation in the sim via the existing `covencave://tasks|calendar` deep links. CI does not build Swift — every Swift task must end with a local `xcodebuild build` pass.

---

## Part A — adaptive screens (branch `feat/ipad-mac-adaptive-screens`)

### Task A1: Sidebar column widths (Chats, Tasks, GitHub)

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/Views/ReadableWidth.swift` (append)
- Modify: `apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift` (sidebar Group, ~line 37)
- Modify: `apps/ios/CovenCave/CovenCave/Views/TasksView.swift` (sidebar `content`, ~line 71)
- Modify: `apps/ios/CovenCave/CovenCave/Views/GitHubView.swift` (sidebar `content`, ~line 21)

- [ ] **Step 1:** Append to `ReadableWidth.swift`:

```swift
extension View {
    /// Pin a split-view sidebar to a real column. Without an explicit width
    /// the sidebar sizes by trait defaults and can present as a floating
    /// overlay at in-between window widths (Designed-for-iPad on macOS);
    /// with one it stays a fixed pane and the detail keeps the rest.
    func sidebarColumn() -> some View {
        navigationSplitViewColumnWidth(min: 300, ideal: 340, max: 420)
    }
}
```

- [ ] **Step 2:** In each of the three split views, add `.sidebarColumn()` as the LAST modifier of the sidebar content (after `.onChange`/`.onAppear` chains, inside the `NavigationSplitView { … }` first closure).
- [ ] **Step 3:** `cd apps/ios/CovenCave && xcodegen generate && xcodebuild -project CovenCave.xcodeproj -scheme CovenCave -destination 'platform=iOS Simulator,name=Cave iPad Verify' build` → BUILD SUCCEEDED.
- [ ] **Step 4:** Commit -S "feat(ios): pin split-view sidebars to real columns on wide screens"; push.

### Task A2: Calendar becomes a split view (detail pane instead of sheets on iPad)

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/Views/CalendarView.swift:16-46` (body)

- [ ] **Step 1:** Replace the `NavigationStack { content … }` body with a `NavigationSplitView`: sidebar = existing `content` chain (title, toolbar, refreshable, task, confirmationDialog, `.sidebarColumn()`); detail = selected task or placeholder. Delete the task-detail `.sheet` (the collapsed split view pushes detail on iPhone, so one code path serves both); keep the Journal sheet.

```swift
    var body: some View {
        NavigationSplitView {
            content
                .navigationTitle("Calendar")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showJournal = true } label: { Image(systemName: "book") }
                            .accessibilityLabel("Journal")
                    }
                }
                .refreshable { await reload() }
                .task {
                    if !app.remindersLoaded { await app.loadReminders() }
                    if !app.tasksLoaded { await app.loadTasks() }
                }
                .sheet(isPresented: $showJournal) { JournalView() }
                .confirmationDialog("Delete this reminder?",
                                    isPresented: deleteDialogBinding,
                                    titleVisibility: .visible,
                                    presenting: pendingDelete) { reminder in
                    Button("Delete", role: .destructive) {
                        Task { await app.deleteReminders([reminder.id]) }
                    }
                    Button("Cancel", role: .cancel) {}
                } message: { reminder in Text(reminder.title) }
                .sidebarColumn()
        } detail: {
            if let card = taskSelection {
                NavigationStack { TaskDetailView(card: card) }
            } else {
                ContentUnavailableView {
                    Label("Select an item", systemImage: "calendar")
                } description: {
                    Text("Pick a task to see its details beside the agenda.")
                }
            }
        }
        // Agenda stays visible beside the detail on iPad; iPhone collapses to
        // the familiar single-column push.
        .navigationSplitViewStyle(.balanced)
    }
```

Check how agenda rows set `taskSelection` (the `row(item)` builder further down) — taps must keep setting `taskSelection`; only the presentation changes.

- [ ] **Step 2:** Build (same xcodebuild) → SUCCEEDED. Commit -S "feat(ios): Calendar detail pane on iPad instead of modal sheets"; push.

### Task A3: Tasks board — detail column on regular width + columns that fill the pane

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/Views/TasksView.swift` (board `Button { boardDetail = card }` ~line 295; `kanbanBoard` ~line 270; add `@Environment(\.horizontalSizeClass)`)

- [ ] **Step 1:** Add `@Environment(\.horizontalSizeClass) private var horizontalSizeClass` to `TasksView`. Change the card tap:

```swift
                        Button {
                            // Regular width has a live detail column — use it,
                            // matching the List path; compact keeps the sheet.
                            if horizontalSizeClass == .regular { selection = card }
                            else { boardDetail = card }
                        } label: {
```

- [ ] **Step 2:** Make column widths fill the pane:

```swift
    private var kanbanBoard: some View {
        GeometryReader { geo in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(sections) { section in
                        kanbanColumn(section, width: kanbanColumnWidth(available: geo.size.width))
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
        }
    }

    /// Fit as many 280pt-minimum columns as the pane allows (capped at the
    /// section count), then stretch them to consume the leftover width — no
    /// dead right margin on iPad/Mac.
    private func kanbanColumnWidth(available: CGFloat) -> CGFloat {
        let inset: CGFloat = 32, spacing: CGFloat = 12, minWidth: CGFloat = 280
        let usable = max(minWidth, available - inset)
        let fit = max(1, min(CGFloat(sections.count), ((usable + spacing) / (minWidth + spacing)).rounded(.down)))
        return max(minWidth, (usable - spacing * (fit - 1)) / fit)
    }
```

`kanbanColumn(_:)` gains a `width: CGFloat` parameter and its `.frame(width: 280)` becomes `.frame(width: width)`.

- [ ] **Step 3:** Build → SUCCEEDED. Commit -S "feat(ios): board cards open the detail pane on iPad; kanban columns fill the width"; push.

### Task A4: Readable columns everywhere text stretches

**Files:**
- Modify: `SettingsView.swift` (Form, after `.themedListBackground()`): `.readableListWidth(680)`
- Modify: `TaskDetailView.swift` (root container — List/Form → `.readableListWidth(680)`; ScrollView → `.readableWidth(680)`)
- Modify: `GitHubView.swift` (`GitHubItemDetailView` root): `.readableListWidth(720)` (or `readableWidth` per container)
- Modify: `LibraryView.swift`, `JournalView.swift` (lists): `.readableListWidth(680)`
- Modify: `FamiliarThreadsView.swift` (thread list): `.readableListWidth(740)` to align with ChatView's 740
- Modify: `ConnectionView.swift` (onboarding card): `.readableWidth(520)`

- [ ] **Step 1:** Apply each modifier at the screen's outermost scroll container; inspect each file's root first and put the modifier where the container is greedy (List/Form → `readableListWidth`, ScrollView/VStack → `readableWidth`).
- [ ] **Step 2:** Build → SUCCEEDED. Commit -S "feat(ios): readable centered columns for wide-screen text surfaces"; push.

### Task A5: iPad simulator verification + PR

- [ ] **Step 1:** Start the Cave web server from the worktree (build once: `pnpm build`; then `rm -rf .next/dev && PORT=3496 node server.mjs &`). NOTE: the iOS app hardcodes port 3000 for bare hosts (`CaveConnection.swift:16-35`) — run on PORT=3000 instead if free, else temporarily seed the host as `localhost:3496`? The connection host accepts `host:port`? CHECK `CaveConnection` parsing first; if it doesn't accept an explicit port, use PORT=3000 (check `lsof -ti tcp:3000` first — another session may own it).
- [ ] **Step 2:** Boot + seed the sim:

```bash
xcrun simctl boot 104E9408-B20F-45BE-B9D7-F315D9364AF9 || true
xcrun simctl spawn 104E9408-B20F-45BE-B9D7-F315D9364AF9 defaults write ai.opencoven.cave cave.connection.host -string "localhost"
xcrun simctl install 104E9408-B20F-45BE-B9D7-F315D9364AF9 <DerivedData .app path>
xcrun simctl launch 104E9408-B20F-45BE-B9D7-F315D9364AF9 ai.opencoven.cave
```

- [ ] **Step 3:** Screenshot Chats (default), then `xcrun simctl openurl … covencave://tasks` and `covencave://calendar` for those tabs; `xcrun simctl io … screenshot /tmp/ios-<tab>.png` each time; READ the images — sidebar must be a pinned column, composer centered, no dead panes.
- [ ] **Step 4:** PR `feat(ios): iPad/macOS adaptive layouts across all tabs`; six required checks (all web — should be green quickly since no web files change); verify MERGED; clean worktree.

## Part B — onboarding + connection (branch `feat/mobile-pairing-auth`)

### Task B1: Server — rolling refresh endpoint + app invite

**Files:**
- Create: `src/app/api/mobile-token/refresh/route.ts`
- Modify: `src/lib/mobile-handoff.ts` (add `appInviteUrl` to invite payload)
- Modify: `src/app/api/mobile-handoff/route.ts` (include `appInvite` in responses)
- Test: `src/app/api/mobile-token/refresh/route.test.ts` (new), extend `src/lib/mobile-handoff.test.ts` if present
- Modify: `scripts/run-tests.mjs` (wire new test into the `api` suite)

- [ ] **Step 1:** Failing test: POST with valid credential returns `{ok:true, token, expiresAt}` where `expiresAt - now ≈ 30d` (override via `MOBILE_APP_TOKEN_TTL_MS`); GET rejected 405. The route itself can trust the proxy gate for auth (it never runs unauthenticated), but still re-verify the supplied credential to bind the response to it.
- [ ] **Step 2:** Implement route with `signMobileAccessToken({secret: process.env.COVEN_CAVE_ACCESS_TOKEN, expiresAt: Date.now() + TTL})`; return 503 `{ok:false, error:"token gate disabled"}` when no secret configured. `appInviteUrl`: `covencave://connect?host=<serve host>&token=<30-day signed token>` built beside the https invite in `createMobileInvite`.
- [ ] **Step 3:** Wire tests, `pnpm run check:tests-wired`, `pnpm run test:api`, typecheck, build. Commit -S; push.

### Task B2: iOS — credential capture, storage, attachment, auth-aware states

**Files:**
- Create: `apps/ios/CovenCave/CovenCave/Networking/KeychainStore.swift` (kSecClassGenericPassword get/set/delete for `cave.access-token`)
- Create: `apps/ios/CovenCave/CovenCave/Networking/CaveInvite.swift` — pure parser: `covencave://connect?host&token` | https URL with `coven_access_token`/`covenCaveToken` query | bare host → `struct CaveInvite { let host: String; let token: String? }`; plus `tokenExpiry(_ token: String) -> Date?` reading the `v1.<expiresAt>.<nonce>.<sig>` shape.
- Modify: `Networking/CaveConnection.swift` — token accessor via KeychainStore (host stays in UserDefaults).
- Modify: `Networking/CaveClient.swift:22-48` request builder + `:260-307` SSE: `if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }`.
- Modify: `Networking/PtyTerminal.swift` — same header on the WebSocket URLRequest.
- Modify: `State/AppModel.swift` — `probe()` returns an enum (`ok | unauthorized | unreachable`); new `.needsAuth` connection state; `configure(host:token:)`; silent renewal on foreground when expiry < 7 days via `api/mobile-token/refresh`.
- Modify: `Views/ConnectionView.swift` — paste/typed input routed through `CaveInvite`; "Scan QR" button (`DataScannerViewController` availability-gated; `NSCameraUsageDescription` in Info.plist); `.needsAuth` copy with pairing instructions.
- Modify: `Views/RootView.swift` — route `.needsAuth` to ConnectionView with the auth message.
- Modify: `CovenCaveApp.swift` / `AppModel.handleDeepLink` — accept `covencave://connect?host&token` → configure + connect.
- Modify: `project.yml` — add a unit-test target `CovenCaveTests`; tests for CaveInvite parsing + expiry extraction.

- [ ] Steps: failing Swift tests for CaveInvite → implement parser → wire storage/attachment → states/UI → `xcodegen generate && xcodebuild test -destination 'platform=iOS Simulator,name=Cave iPad Verify'` → commit -S per coherent slice; push each.

### Task B3: End-to-end verification + PR

- [ ] Run the local server WITH `COVEN_CAVE_ACCESS_TOKEN=<random>`: fresh app shows `.needsAuth` (not "unreachable"); mint a signed token via a node one-liner using `signMobileAccessToken`; `xcrun simctl openurl … "covencave://connect?host=localhost&token=…"` → app pairs, familiars load; screenshot the flow. Kill server; confirm `.unreachable` copy still distinct. PR `feat(mobile): seamless pairing — QR/deep-link invites, Bearer auth, rolling renewal`; six checks; merge; clean up.

## Self-review notes

- Spec coverage: A1→pain 1, A2→pain 2, A3→pains 4/5 (board+size class), A4→pain 3, B1→token TTL/renewal, B2→pains B1-B3 (attach/capture/states/Keychain), B3→verified end-to-end. Out-of-scope items have no tasks by design.
- Line anchors are from today's exploration of `origin/main`; re-locate by content before editing.
- `CaveConnection` port handling must be confirmed before A5 step 1 (bare-host port hardcode).
