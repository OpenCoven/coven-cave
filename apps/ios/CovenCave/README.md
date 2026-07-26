# Coven Cave — Native iOS app

A genuinely native SwiftUI client for Coven Cave. It connects to your desktop over
your **Tailscale** network — **no token, no password**; tailnet membership is the
trust boundary. This is *not* a webview wrapper around the web app.

See [`docs/ios-native-rebuild.md`](../../../docs/ios-native-rebuild.md) for the full
phased plan and architecture.

## Requirements

- Xcode 16+ (developed against Xcode 26)
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`) — the
  `.xcodeproj` is generated from `project.yml`, not checked in.

## Build & run

```bash
# from the repo root: build the web bundles the app embeds (Resources/markdown.html
# and Resources/terminal.html — generated & gitignored, the Xcode build can't run
# node). Needs `pnpm install`. Skipping the terminal bundle ships a blank Terminal tab.
node scripts/build-ios-markdown.mjs
node scripts/build-ios-terminal.mjs

cd apps/ios/CovenCave
xcodegen generate          # produces CovenCave.xcodeproj from project.yml
open CovenCave.xcodeproj    # ⌘R to run, or:

xcodebuild -project CovenCave.xcodeproj -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
```

On first launch, enter your desktop's Tailscale MagicDNS name (e.g.
`my-mac.tailnet.ts.net`) or its `100.x` address. `.ts.net` hosts use HTTPS; bare
hosts/IPs default to `http://<host>:3000`.

> The desktop must serve the mobile API tokenlessly over its Tailscale interface
> (Phase 1b server change). Until that lands, point the app at a mock or a dev
> server with the gate relaxed.

## Layout

```
CovenCave/
  Models/        Familiar, SessionRow, ChatTurn, StreamEvent (SSE decoding),
                 PermissionModels (grants, proposals, effective access)
  Networking/    CaveConnection (host/no-token), CaveClient (REST + SSE stream),
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
