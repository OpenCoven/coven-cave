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
  Models/        Familiar, SessionRow, ChatTurn, StreamEvent (SSE decoding)
  Networking/    CaveConnection (host/no-token), CaveClient (REST + SSE stream)
  State/         AppModel (connection, familiars, threads), ChatThread (1:1 + group fan-out)
  Views/         Connection, ChatsHome, NewChat (group picker), Chat, MessageBubble, Settings, Avatar
  Theme/         per-familiar colour + initials
```
