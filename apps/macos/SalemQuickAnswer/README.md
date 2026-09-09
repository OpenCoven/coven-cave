# Salem Quick Answer for macOS

Tracking: OpenCoven/coven-cave#5329 under #5323.

This is the native Cave-owned menu-bar shell for Salem Quick Answer. The #5329 slice is deliberately fixture-only: it contains no live Salem networking, Keychain credential, model/provider secret, familiar runtime, Psyche/Threads/Coven mutation path, chat history, or voice input.

## What works in this slice

- menu-bar status item with a SwiftUI popover;
- global `⌥ Space` toggle without an Accessibility permission dependency;
- question field focused when the popover appears;
- Anyone / AI user / Creator / Developer / Security / Partner audience selector;
- Quick / Conversation / Deep / Technical depth selector;
- explicit answered, low-confidence, stale, offline, unauthorized, rate-limited, and failed states;
- claim status and confidence rendered separately;
- caveat and evidence disclosure;
- versioned offline pitch cards clearly labeled as reference language, not live implementation status;
- deterministic fixture service implementing the `opencoven.salem-brief/v1` client shape;
- XCTest state coverage plus a portable source-contract verifier.

## Generate and run

Requires macOS, Xcode 16+, and XcodeGen.

```sh
cd apps/macos/SalemQuickAnswer
xcodegen generate
open SalemQuickAnswer.xcodeproj
```

Or build/test from the command line:

```sh
cd apps/macos/SalemQuickAnswer
xcodegen generate
xcodebuild test \
  -project SalemQuickAnswer.xcodeproj \
  -scheme SalemQuickAnswer \
  -destination 'platform=macOS'
```

The generated `.xcodeproj` is not the source of truth and should not be committed unless Cave later standardizes a different Apple-project policy. `project.yml` is canonical, matching the existing native iOS convention.

## Portable source check

From the repository root:

```sh
node scripts/verify-quick-answer-macos.mjs
```

This is not a substitute for Xcode compilation. It verifies the principal product boundary in CI/dev environments that cannot build macOS: LSUIElement/menu-bar wiring, ⌥Space registration, explicit failure states, offline pitch language, fixture schema version, and absence of live-network/provider-secret wiring.

## Fixture paths

Normal questions return a synthetic `specified` answer. These phrases exercise failures without network access:

```text
fixture:unknown
fixture:stale
fixture:offline
fixture:unauthorized
fixture:rate
fixture:failed
```

Questions containing `every model` also exercise the low-confidence “I wouldn't claim that yet” path.

## Trust boundary

The bundled pitches are reference language only. They are not evidence that a feature is currently implemented, verified, released, private, secure, or universally compatible. The next live-integration slice (#5330) must decode the server's structured Brief response and preserve its explicit evidence/freshness/failure states instead of turning the offline library into a cache of current truth.
