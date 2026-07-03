# iOS app: iPad/macOS screen adaptivity + seamless onboarding — design

Date: 2026-07-03
Status: approved (autonomous session — decisions recorded for async review)
Related: goal screenshot (floating overlay sidebar + misaligned composer on a
wide "Designed for iPad" window), `apps/ios/CovenCave/README.md:38-40` (known
connection gap).

## Problems

The native SwiftUI app (`apps/ios/CovenCave`, iPhone+iPad device families,
runs on Apple Silicon Macs as "Designed for iPad") has two distinct gaps:

### A. Wide-screen layout (iPad landscape, macOS windows)

1. The three `NavigationSplitView(.balanced)` surfaces (Chats, Tasks,
   Developer→GitHub) set **no column widths** anywhere, so sidebar sizing is
   left to defaults and the sidebar can present as a floating overlay at
   in-between window widths (the screenshot) instead of a pinned column.
2. **Calendar** and **Settings** are single-column `NavigationStack`s —
   an iPad-landscape/Mac window is mostly dead space, and Calendar opens task
   detail in a modal sheet even when a detail pane would fit.
3. `readableWidth`/`readableListWidth` (Views/ReadableWidth.swift) exists but
   is used **only by ChatView** — Tasks detail, Settings, Library, Journal,
   and GitHub detail stretch edge-to-edge on wide screens.
4. The Tasks **board** opens card detail in a sheet even on regular width,
   while the Tasks **list** uses the split detail column — inconsistent.
5. Zero size-class awareness in the app (no `horizontalSizeClass` usage), so
   compact-vs-regular decisions (sheet vs detail pane) can't be made.

### B. Onboarding & connection

1. **Blocking bug:** the server enforces a signed mobile access token on all
   `/api/*` when `COVEN_CAVE_ACCESS_TOKEN` is set (src/proxy.ts
   mobileAccessGate), and mints QR invites carrying `coven_access_token` via
   `/api/mobile-handoff` — but the iOS client **never attaches any
   credential** (CaveClient/SSE/PTY WebSocket), stores no token, and its
   `probe()` treats 401 as "unreachable". Pairing only works in the special
   tokenless `COVEN_CAVE_TAILNET_TRUST=1` mode.
2. Onboarding is manual host entry only — no invite-URL paste, no QR path,
   no deep link (the `covencave://` scheme exists but only routes widget
   tabs).
3. Credentials live in UserDefaults (bare host), not Keychain; signed tokens
   expire (invite TTL 8h) with no renewal path, so even a fixed client would
   silently rot within a working day.

## Approaches considered

- **Full Mac Catalyst / SwiftUI-multiplatform target** — real Mac windowing,
  menus, resizability. Rejected for now: new target, signing, AppKit
  divergence; the app already runs on macOS as Designed-for-iPad, and every
  regular-width fix below improves that mode directly. Revisit later.
- **Per-screen adaptive fixes on the existing architecture (chosen for A)** —
  pin split-view columns with explicit widths, convert Calendar to a split
  view, spread `readableWidth` to every stretched surface, make sheet-vs-pane
  decisions size-class-aware. One reviewable PR, no architectural rewrite.
- **Tokenless trust everywhere (rejected for B)** — running the desktop with
  the gate relaxed forever is the current workaround, not a fix.
- **Full token pairing + rolling renewal (chosen for B)** — client attaches
  the signed token; onboarding accepts invite URLs (paste/QR/deep link);
  server gains a token-refresh endpoint so a paired device renews silently.

## Design — Part A: adaptive screens (PR 1, Swift-only)

New `Views/AdaptiveColumns.swift`:
- `sidebarColumn()` = `.navigationSplitViewColumnWidth(min: 300, ideal: 340,
  max: 420)` — applied to the sidebar column of Chats, Tasks, and GitHub
  split views so the list pins as a real column instead of a floating
  overlay, and the detail pane keeps the remaining width (fixes the
  screenshot's overlay + off-center composer).
- Each split view gets `@State columnVisibility:
  NavigationSplitViewVisibility = .automatic` threaded through so behavior
  stays standard but is explicit and testable.

Per surface:
- **Calendar** → `NavigationSplitView`: sidebar = existing agenda list
  (`readableListWidth` not needed at ≤420pt); detail = selected task
  (`TaskDetailView`) or journal entry; compact width keeps the current
  stack + sheet behavior via `horizontalSizeClass`.
- **Tasks board** → on regular width, tapping a card selects it into the
  split detail column (same as the list path); the sheet remains for compact.
  Kanban columns scale with the pane (`min 280`, growing to fill available
  width instead of the hardcoded 280).
- **Settings** → `readableListWidth(680)` on the Form; the connection hero
  and theme grid stay centered instead of stretching.
- **Tasks detail, GitHub detail, Library, Journal** → `readableWidth`/
  `readableListWidth` (680) so text surfaces read as centered columns.
- **ConnectionView / ConnectingView** → `readableWidth(520)` so onboarding
  is a centered card on iPad/Mac rather than full-bleed.

Not in scope for A: Info.plist windowing keys, multi-window scenes, Catalyst.

## Design — Part B: onboarding + connection (PR 2, Swift + server)

Server (`src/`):
- `POST /api/mobile-token/refresh` — requires a currently-valid credential
  (the existing gate already enforces this before the route runs); returns a
  fresh signed token with a **rolling TTL of 30 days**
  (`MOBILE_APP_TOKEN_TTL_MS` override), so a device that connects at least
  monthly never re-pairs. Unit-tested; wired into run-tests.
- `/api/mobile-handoff` gains an `appInvite` field in its response payload:
  a `covencave://connect?host=<serveHost>&token=<signed 30-day token>` URL
  (and the existing QR keeps working — the QR's https invite URL is ALSO
  accepted by the app via paste/scan).

iOS:
- **`Networking/KeychainStore.swift`** — minimal Keychain wrapper; the access
  token moves there (host string stays in UserDefaults; it's not secret).
- **`CaveClient.request` / SSE / PTY WebSocket** attach
  `Authorization: Bearer <token>` when a token exists.
- **Invite parsing** (`Networking/CaveInvite.swift`, pure + unit-testable):
  accepts `covencave://connect?host=&token=`, any https invite URL carrying
  `coven_access_token` (+ optional `covenCaveToken`), or a bare host; returns
  `{host, token?}`.
- **ConnectionView**: the existing field accepts a pasted invite URL (parsed
  through CaveInvite, token captured automatically); a "Scan QR" button
  (camera devices; `NSCameraUsageDescription` added) scans the same invite;
  `.onOpenURL` routes `covencave://connect` through the same path so tapping
  the invite link pairs with zero typing.
- **Auth-aware connection state**: `probe()` distinguishes 401/403 from
  network failure; new `.needsAuth` connection state renders an actionable
  screen ("This desktop requires pairing — scan the QR from Cave's Connect
  Phone panel") instead of the generic "unreachable".
- **Silent renewal**: on foreground/refresh, if the stored token's expiry
  (readable client-side from the `v1.<expiresAt>.<nonce>.<sig>` shape) is
  within 7 days, call `/api/mobile-token/refresh` and rotate the Keychain
  copy. A 401 with reason=expired routes to `.needsAuth`.
- **Swift unit tests**: new test target (XcodeGen `project.yml`) covering
  CaveInvite parsing and token-expiry extraction. CI doesn't build iOS, so
  these run locally (`xcodebuild test`), but they pin the pure logic.

## Error handling

- Every connection failure now lands in one of three explicit states:
  `unreachable` (network), `needsAuth` (401/403), `connected` — each with its
  own copy and recovery affordance.
- Refresh failures are non-fatal (token keeps working until expiry); expiry
  routes to `.needsAuth` with the pairing instructions.

## Testing / verification

- Part A: build for iPad simulator (`Cave iPad Verify`, iOS 26.5) +
  screenshot every tab in landscape; compare against the goal screenshot.
  Web CI unaffected (Swift-only).
- Part B: server routes unit-tested (web CI); iOS side verified against a
  local Cave server run WITH `COVEN_CAVE_ACCESS_TOKEN` set — confirm 401 →
  `.needsAuth` UX, paste-invite pairing, authorized requests, and refresh
  rotation. Swift unit tests for the pure parsing.

## Out of scope (follow-ups)

- Mac Catalyst target / multi-window scenes.
- iOS CI (Xcode build in GitHub Actions).
- Bonjour LAN discovery of the desktop.
