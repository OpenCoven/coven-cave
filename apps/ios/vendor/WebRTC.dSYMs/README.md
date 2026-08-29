# WebRTC.dSYMs — vendored dSYM drop-in directory

App Store Connect warns on every TestFlight upload that the WebRTC.framework
vendored through the Swift Package binary target pinned in
apps/ios/CovenCave/project.yml has no matching dSYM, so crashes inside WebRTC
cannot be symbolicated (cave-ea6dw). The published M150 xcframework is
DWARF-stripped and no matching dSYM exists upstream, so the release pipeline
cannot fix this by itself.

This directory is the integration point for when a real dSYM for the pinned
revision exists:

- Place the dSYM bundle here as <Framework>.framework.dSYM (e.g.
  WebRTC.framework.dSYM). Its DWARF file must carry the exact UUID of the
  embedded binary — that is what makes it "matching".
- The release workflow (release.yml, "Audit embedded-framework dSYM
  coverage" step) copies any matching bundle from here into the archive's
  dSYMs/ folder before export, and uploadSymbols: true carries it to App
  Store Connect.
- The audit is warn-only: an empty directory (or none) never blocks a
  release; the release log simply reports the gap.

See docs/ios-webrtc-dsym-symbolication.md for the full write-up, how to
verify a release, and the options for producing a matching dSYM (the only
real one is building WebRTC with debug symbols).
