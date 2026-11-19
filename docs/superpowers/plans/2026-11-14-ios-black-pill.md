# Native iOS black and pill implementation plan

> Execute inline with the executing-plans workflow in the approved #6331 worktree. Preserve the canonical issue, original owners and complete acceptance scope.

**Goal:** Implement all seven documented native chat visual targets and qualify the changed candidate through the original native/TestFlight/device gates.

**Architecture:** Reuse existing SwiftUI chat, drawer, toolbar and prose owners. Add a neutral chat surface treatment beside existing `ChatChrome` primitives; preserve the global palette, native navigation, exact state bindings and transcript lifecycle.

**Tech stack:** SwiftUI/UIKit, Xcode 27.2 currently installed, iOS 18 deployment target, XcodeGen and pinned bundled markdown resources.

**Spec:** `docs/superpowers/specs/2026-11-14-ios-black-pill-design.md`, with original #6331 criteria authoritative.

## Global constraints

Native bundle remains `ai.opencoven.cave`; no version/build stamp changes in the styling unit.

Chat-only scope, exact identity and project/session authority, original permissions, keyboard/scroll behavior and Duo reserved-region support remain intact.

Colors resolve through `ChromePalette`; use Dynamic Type and at least 44-point interactive targets, with Reduce Motion/Transparency and Increase Contrast alternatives.

Private references are missing. Continue the approved textual targets and native baseline; keep exact-reference acceptance open. Preserve N0's source, first failures, retries and outstanding physical/human gates on #6090.

Do not commit/push/merge or perform signing/upload/physical-device changes without applicable authority. No hosted Actions or paid work.

## Review focus

Long conversation/familiar/model labels must remain usable at narrow Duo widths and accessibility text sizes.

Keyboard open/close, rotation and fold transitions must keep attach/model/dictate/send controls reachable without losing the draft or staged images.

Rich/streaming history must preserve row identity, measured geometry, reader intent and full native accessibility text through visual changes.

Drawer, session picker and Settings round trips must preserve the selected conversation and focus and must not expose unsupported destinations.

Light/high-contrast and reduced motion/transparency appearances must remain readable and obey current user preferences.

## Task 1: Implement and locally qualify the complete native treatment

Files: `Theme/ChatChrome.swift`, `Views/ChatView.swift`, `Views/ChatsHomeView.swift`, `Views/NavigationDrawer.swift`, `Views/MessageProseView.swift` and existing transcript owners only where visual geometry requires it. Preserve `Theme/NativeToolbar.swift` and `Theme/DisplayFold.swift` unless a reproduced integration failure requires a scoped fix.

- [x] Restore this worktree's locked dependencies and generate the native project through `pnpm mobile:ios:xcodegen`; retain an unchanged-source contract baseline.
- [x] Add meaningful native UI coverage for the multiline-above-controls composer, suggestion fill-before-send, control target bounds and draft preservation. Run the unchanged layout to retain its first geometric failure before editing production views.
- [x] Add shared neutral chat surfaces and point-based sizes; adapt circular controls, session pill, drawer, transcript surfaces, vertical composer/action row and compact empty suggestions. Keep existing meaningful choice behavior and reject a fake Work segment.
- [x] Reconcile source pins for intentional visual changes without weakening identity, permissions, row/renderer lifecycle, Back or fixture assertions.
- [x] Run relevant source contracts and native `ChatHeaderBackNavigationUITests`, `ChatScrollingUITests`, `FoldLayoutUITests`, new composer checks and relevant unit/strict transcript gates. Preserve every first failure, retry and skip.
- [ ] Inspect actual empty/populated/drawer, focused/unfocused keyboard, attachments/streaming, dark/light/non-default palette, large text and accessibility captures on an owned simulator. Extend to ordinary iPhone/iPad and Duo open/upright/book/tabletop where the installed tooling supports it; record unsupported rows explicitly.
- [x] Obtain one fresh read-only whole-change review, fix important findings with reproduced tests, and retain an exact source/artifact/capture manifest.

## Task 2: Protected delivery and original owner acceptance

- [ ] Recover and compare the five original private images through authorized access, without republishing private contents.
- [ ] Present the complete candidate and remaining native/human rows to Val and the original owners; obtain operation-specific publication and native device authority where required.
- [ ] Complete protected PR review/merge under current repository policy and reconcile #6090/#6207/#6211 ownership and acceptance independently.
- [ ] From clean main under release authority, record exact source/Xcode/SDK/version/build, signing/archive/export/upload hashes and receipts, App Store Connect processing and intended tester-group availability.
- [ ] Observe physical Duo installation/launch/chat smoke and the original regression/accessibility/fold gates. Keep #6331 open until all original criteria are proven or explicitly dispositioned by its owner.

## Local checkpoint, 15 November

Implementation, one fresh whole-change review and available local qualification are complete. Native menu text-overlap RED/GREEN and clipped-menu phone/iPad captures supplement the original regression receipts. The full appearance, private-reference, exact-toolchain and physical/TestFlight rows remain unchecked. Exact source/app/capture manifests and all first failures are retained in the local `cave6331-resume-20261114` evidence packet; the canonical issue carries the publication decision and original owners. No commit or distribution operation is implied.

The subsequent appearance audit adds native RED/GREEN for full light chat/session-menu contrast and selected-row contrast/trait, plus verified Increase Contrast cases with setting restoration. Compact and iPad controlled recovery now both qualify every original saved-content/privacy/order assertion and bounded native reachability, preserving the viewport-assumption failures. Full human appearance/VoiceOver, missing references, exact toolchain, protected delivery and TestFlight/device rows remain open.
