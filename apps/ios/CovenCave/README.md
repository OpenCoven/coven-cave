# Coven Cave — Native iOS app

A genuinely native SwiftUI client for Coven Cave. It connects to your desktop over
your **Tailscale** network with desktop-approved device access (or a legacy
QR/invite credential). Tailnet membership alone does not grant access.
This is *not* a webview wrapper around the web app.

See [`docs/ios-current-direction.md`](../../../docs/ios-current-direction.md)
for the canonical active product direction. The older native rebuild and dated
implementation plans are historical lineage, not active priority queues.

## Distribution

Maintainer release builds use TestFlight, but Coven Cave does not currently
publish a public TestFlight or App Store enrollment link. End users cannot
install the native iOS client publicly yet; the source-build path below is the
available contributor route.

TestFlight uploads carry a known, cosmetic App Store Connect warning that the
vendored WebRTC.framework (SPM binary package, pinned in project.yml) has no
matching dSYM, so WebRTC-side crash frames cannot be symbolicated. It does not
block uploads; the release pipeline audits dSYM coverage and injects vendored
dSYMs from apps/ios/vendor/WebRTC.dSYMs when they exist. See
docs/ios-webrtc-dsym-symbolication.md for the root cause and options.

## Requirements

- Xcode 16+ (developed against Xcode 26)
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`) — the
  `.xcodeproj` is generated from `project.yml`, not checked in.

## Build & run

```bash
# from the repo root: build the generated Markdown resources the app embeds.
# (Resources/markdown.html — generated & gitignored, the Xcode build can't run
# node). Run `pnpm install --frozen-lockfile` first.
pnpm mobile:ios:xcodegen       # builds the bundle, verifies it, then
                               # runs xcodegen — in that order, which matters
                               # (alias for scripts/ios-xcodegen.sh)

cd apps/ios/CovenCave
open CovenCave.xcodeproj    # ⌘R to run, or:

xcodebuild -project CovenCave.xcodeproj -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
```

Markdown resources include `markdown.html`, `markdown.css`, and the lazy
`markdown-mermaid.js` diagram engine. All three are packaged locally; ordinary
replies and streaming diagram placeholders do not load the diagram engine.
Settled diagrams load it once per renderer without requiring a network connection.

⚠️ **`cannot find type <Something> in scope` means a stale `.xcodeproj`, not a
code bug.** `xcodegen` SCANS the source directory, so a project generated before
a Swift file was added simply does not contain it — the file is on disk, in git,
and excluded from the target. Regenerate with `pnpm mobile:ios:xcodegen` rather
than adding the file to `CovenCave.xcodeproj/project.pbxproj`: that file is
generated and gitignored, so a hand-edit fixes one machine, is invisible to git,
and is erased by the next generation. `project.yml` declares the target's
sources as the whole `CovenCave` directory, so regeneration always picks new
files up. CI regenerates before every iOS build (`ci.yml`), which is why `main`
stays green while one laptop fails (`cave-bkp0o`).

On first launch, enter your desktop's Tailscale MagicDNS name (e.g.
`my-mac.tailnet.ts.net`) or its `100.x` address. `.ts.net` hosts use HTTPS; bare
hosts/IPs default to `http://<host>:3000`.

For desktop-managed pairing, enter the desktop's HTTPS Tailscale Serve address,
including its published port. Once the desktop is found, tap **Request access**.
Compare the last eight characters of the request ID on both devices, then choose
**Allow** in desktop Settings → Phone → Device access. Denied, revoked, and
expired requests require a new explicit request; pending requests last five
minutes. **Cancel** pauses waiting without connecting, and a saved pending
request can resume through the status endpoint after app restart.

The installation UUID lives in platform preferences. Pending and approved
credentials live in device-only, non-synchronizing Keychain items bound to the
exact HTTPS origin. Approved grants have no scheduled expiry and never enter
legacy mobile-token refresh. Outages retain credentials. Managed requests do
not follow redirects or gain terminal/WebSocket or client-v1 scopes.
Older desktops returning 404 for device access retain the QR/invite path.
The `x-coven-device-pairing: 1` gateway marker distinguishes managed approval
from a legacy authentication gate. A managed QR contains only the actual HTTPS
origin plus `/connect`; scanning or pasting it shows **Request access** without
connecting or granting access. A disabled-policy response also retains the
legacy QR/invite path; a forbidden tailnet does not downgrade to legacy access.

## Layout

```
CovenCave/
  Models/        Familiar, SessionRow, ChatTurn, StreamEvent (SSE decoding),
                 PermissionModels (grants, proposals, effective access)
  Networking/    CaveConnection (origin-bound credential), DeviceAccess (pairing),
                 CaveClient (REST + SSE stream),
                 CaveClient+Permissions (grants console API)
  State/         AppModel (connection, familiars, threads), ChatThread (1:1 + group fan-out)
  Views/         Connection, ChatsHome, NewChat (group picker), Chat, MessageBubble,
                 Settings, Permissions (Access / Requests / Audit console), Avatar
  Theme/         per-familiar colour + initials
```

## Familiar permissions & phone write access

Settings → **Familiar permissions** opens the same permissions console the
desktop has: per-familiar project access (read/write, including "via group"
levels inherited from access groups), the grant-request inbox (accept/reject
with the 30-second undo window), and the recent allow/deny audit log. Each
familiar's screen also has a key toolbar button scoped to just that familiar.

Changing anything from the phone is **off by default**. The desktop's
Settings → Phone section has two opt-ins — "Allow permission changes from
phone" and "Allow file edits from phone" (the Code tab's Save) — and they can
only be flipped on the desktop itself: the server refuses the toggles' PATCH
from any non-loopback origin, so a phone (or anything else on the tailnet) can
never widen its own authority. Until the opt-in is enabled the iOS console
renders read-only with a banner pointing at the desktop setting.
