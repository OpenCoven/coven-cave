# iOS vendor dSYM symbolication (cave-ea6dw)

## The warning

Every TestFlight upload of Coven Cave triggers an App Store Connect
notification that the vendored WebRTC.framework has no matching dSYM:

    The archive did not include a dSYM for the WebRTC.framework with the UUIDs
    [4C4C4419-5555-3144-A1D7-1C6CC95E36CE]. Ensure that the archive's dSYM
    folder includes a DWARF file for WebRTC.framework with the expected UUIDs.

The upload succeeds and the build processes normally — this is a
symbolication-coverage warning, not a rejection. v0.2.2 shipped with it
present. What it means in practice: crash reports from TestFlight and App
Store Connect show raw addresses for frames inside WebRTC code instead of
function names, which makes diagnosing WebRTC-side crashes (audio capture,
SDP handling, network transport) harder.

## Root cause (verified, not assumed)

1. apps/ios/CovenCave/project.yml pins the WebRTC Swift Package binary target
   from https://github.com/stasel/WebRTC.git at revision
   6ed87f05368632f71dc95c89c14c051561710925 (release 150.0.0, "M150").
2. That revision's Package.swift downloads
   WebRTC-M150.xcframework.zip from the 150.0.0 GitHub release. Inspecting the
   archive directly shows it contains **zero dSYM entries**.
3. The framework binary inside is **DWARF-stripped**: parsing its mach-o load
   commands shows an LC_SYMTAB (symbol table) but no __DWARF segment, so the
   DWARF debug information symbolication needs was removed when the binary was
   built.
4. stasel/WebRTC publishes only the XCFramework zip for every release —
   there is no dSYM artifact anywhere upstream to download, and no other
   build of WebRTC can produce a *matching* dSYM because dSYM matching is
   by exact binary UUID.
5. A dSYM **cannot be synthesized from a stripped binary**: dsymutil extracts
   debug info that is no longer in the file. The community has hit this exact
   wall (flutter-webrtc/flutter-webrtc#1818,
   m1guelpf/swift-realtime-openai#33 — both open).

So the warning is accurate and unavoidable while the pinned M150 artifact is
used: WebRTC frames cannot be symbolicated from upstream binaries, and the
app code around them can. Nothing in the app's own build was wrong.

## What the fix does

The release pipeline now makes the gap explicit, uploads any dSYM that does
exist, and automatically starts carrying a WebRTC dSYM the moment one is
available — without ever blocking a release:

- **Audit (scripts/ios-dsym-coverage.mjs).** After xcodebuild archive and
  before export, release.yml runs the audit. It parses the mach-o UUID of
  every binary embedded in the archive (app, extensions, frameworks — pure
  Node, no macOS tooling), matches them against the archive's dSYMs/ folder,
  and prints a per-binary coverage report to the release log. When the
  vendored WebRTC.framework is uncovered it names the package, the pinned
  revision and the exact UUID, so the log answers the App Store warning
  instead of leaving maintainers to google it.
- **Injection hook (--vendor-dsyms).** The audit scans
  apps/ios/vendor/WebRTC.dSYMs (see the README there). Any *.dSYM bundle
  whose DWARF UUIDs match an uncovered embedded binary is copied into the
  archive's dSYMs/ folder before export. The day a real WebRTC dSYM exists
  for the pinned revision — a locally built WebRTC with debug symbols, or an
  upstream artifact — dropping it into that directory is the whole
  integration: releases automatically symbolicate WebRTC frames again.
- **uploadSymbols (config).** The export options plist now sets
  uploadSymbols: true, so the export (and the altool upload that follows)
  carries the archive's dSYMs — including anything the audit injected — to
  App Store Connect.
- **Warn-only by design.** The audit exits 0 unless explicitly given
  --fail-on-missing. A missing vendored dSYM is cosmetic and must not block
  an otherwise-good upload; the release log and this doc carry the honest
  status instead.

## How to verify on a release

The release log prints, between "Archive the iOS app" and "Export the iOS app
to IPA":

    [dsym-coverage]   [WARN] WebRTC.framework — missing dSYM for
    4C4C4419-5555-3144-A1D7-1C6CC95E36CE
    [dsym-coverage]          stasel/WebRTC (Swift Package binary target)
    (6ed87f05368632f71dc95c89c14c051561710925): the published M150 xcframework
    is DWARF-stripped and contains no dSYM; ...

Until a WebRTC dSYM is vendored, expect that warning on every release and
confirm the app binary (CovenCave.app) and the widget are reported [ok]. If
the app's own dSYM ever shows as missing, that is a real defect in the build
and should be treated as one even though the audit does not fail the job.

## Closing the gap completely (options, in order of effort)

1. **Vendor a WebRTC built with debug symbols.** The only way to get real
   DWARF for WebRTC frames. This means building WebRTC from webrtc.org source
   (depot_tools, multi-hour build) once per pinned revision, keeping
   WebRTC.framework.dSYM next to the binary, and dropping it into
   apps/ios/vendor/WebRTC.dSYMs. Worth doing if WebRTC-side crashes become a
   support burden; overkill today.
2. **Upstream ships dSYMs.** If stasel/WebRTC (or a fork the project moves
   to) starts publishing dSYMs, download the matching one into
   apps/ios/vendor/WebRTC.dSYMs — releases pick it up automatically.
3. **Keep the audit and the warning.** Zero cost, honest status; WebRTC
   frames stay unsymbolicated but app-side frames are unaffected.

## Tests

- scripts/ios-dsym-coverage.test.mjs — unit tests for the mach-o UUID parser
  (thin 32/64-bit, fat 32/64-bit), binary discovery, coverage matching,
  vendor injection and the CLI contract, using synthetic fixtures; runs on
  Linux CI. Registered in scripts/run-tests.mjs (mobile suite).
- scripts/ios-build-ci.test.mjs — pins that release.yml audits coverage
  between archive and export, scans the vendor drop-in directory, never
  passes --fail-on-missing, and exports with uploadSymbols.
