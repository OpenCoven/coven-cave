// The iOS build leg must keep existing, and must keep being reachable.
//
// Every other ios-*.test.mjs in this suite reads Swift as SOURCE TEXT. That is
// useful for pinning contracts, but a regex matches perfectly well inside a
// file no compiler accepts — so none of them can tell a broken build from a
// working one. 398b18b proved it: a ChatProjectPicker call closed with '}'
// instead of ')', plus a memberwise-init argument-order mismatch, survived
// three days and every PR in between because nothing in any workflow compiled
// the app (cave-kwv57).
//
// release.yml now has a macOS leg that compiles, signs, exports, and uploads.
// Routine PR CI stays minimal and path-aware; every release pays for the real
// native compilation and TestFlight processing gate.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const iosJobStart = workflow.indexOf("  release-ios-build:");
const iosJobEnd = workflow.indexOf("\n  build:", iosJobStart);
const iosJob = workflow.slice(iosJobStart, iosJobEnd);

// ── The job exists and publishes a signed TestFlight build ──────────────────
assert.match(workflow, /^ {2}release-ios-build:$/m, "release.yml defines the iOS build job");
assert.match(
  iosJob,
  /runs-on: macos-15/,
  "the iOS build runs on macOS — xcodebuild cannot run anywhere else",
);
assert.match(
  iosJob,
  /needs:[\s\S]{0,160}- release-web-validation[\s\S]{0,160}- release-platform-validation/,
  "TestFlight publication waits for release tests and cross-platform conformance",
);
assert.match(
  iosJob,
  /sudo xcode-select --switch "\$XCODE_PATH"[\s\S]*grep -q -- '--build-status'[\s\S]*grep -q -- '--api-key-subject'/,
  "the job pins Xcode 26.3 and proves the required altool commands exist",
);
assert.match(
  workflow,
  /options:[\s\S]{0,200}- ios/,
  "manual release recovery can select the iOS/TestFlight leg",
);
assert.match(
  iosJob,
  /IOS_DISTRIBUTION_CERTIFICATE_BASE64: \$\{\{ secrets\.IOS_DISTRIBUTION_CERTIFICATE_BASE64 \}\}/,
  "the iOS job receives a dedicated Apple Distribution certificate",
);
assert.match(
  iosJob,
  /IOS_APP_PROVISIONING_PROFILE_BASE64: \$\{\{ secrets\.IOS_APP_PROVISIONING_PROFILE_BASE64 \}\}/,
  "the iOS job receives the app App Store provisioning profile",
);
assert.match(
  iosJob,
  /IOS_WIDGET_PROVISIONING_PROFILE_BASE64: \$\{\{ secrets\.IOS_WIDGET_PROVISIONING_PROFILE_BASE64 \}\}/,
  "the iOS job receives the widget App Store provisioning profile",
);
assert.match(
  iosJob,
  /xcodebuild[\s\S]*-archivePath "\$ARCHIVE_PATH"[\s\S]*archive/,
  "the iOS job creates an archive instead of stopping at an unsigned compile",
);
assert.match(
  iosJob,
  /xcodebuild -exportArchive[\s\S]*-exportOptionsPlist "\$EXPORT_OPTIONS_PATH"/,
  "the iOS job exports a signed IPA",
);
assert.match(
  iosJob,
  /pnpm appstore:validate "\$IPA_PATH"[\s\S]*pnpm appstore:upload "\$IPA_PATH" --wait/,
  "the iOS job validates, uploads, and waits for App Store Connect processing",
);
assert.match(
  iosJob,
  /APPLE_API_KEY_SUBJECT: \$\{\{ vars\.APPLE_API_KEY_SUBJECT \}\}/,
  "team and individual API-key subject modes are selected explicitly",
);
assert.match(
  iosJob,
  /appstore:status[\s\S]*--allow-missing[\s\S]*case "\$STATUS_EXIT" in[\s\S]*0\)[\s\S]*3\)[\s\S]*exit "\$STATUS_EXIT"/,
  "only an explicit build-not-found result permits a retry upload",
);
assert.match(
  iosJob,
  /get-task-allow[\s\S]*ProvisionedDevices/,
  "the job rejects development and device-scoped profiles before archive",
);
assert.match(
  iosJob,
  /name: Clean up iOS signing material[\s\S]*security delete-keychain[\s\S]*rm -f "\$profile"/,
  "temporary keychains and provisioning profiles are removed",
);
assert.doesNotMatch(
  iosJob,
  /\bmapfile\b|\$\{[A-Za-z_]+\^\^\}/,
  "the macOS runner must remain compatible with its system Bash",
);
// xcodegen must go through the wrapper, never `xcodegen generate` directly:
// the wrapper builds and PROVES the embedded web bundles exist before the scan,
// because xcodegen scans the tree and a missing bundle otherwise yields a
// project that builds clean and ships a blank markdown view (cave-d8ma3).
// Anchored to a real `run:` step for the same reason as the xcodebuild check
// above — an unanchored match is satisfied by the comment four lines up, which
// is precisely the mistake that check was already rewritten to avoid.
assert.match(
  workflow,
  /^ +- run: bash scripts\/ios-xcodegen\.sh$/m,
  "the project is generated through the wrapper that proves the web bundles exist first",
);
assert.doesNotMatch(
  workflow,
  /^\s+run: xcodegen generate\s*$/m,
  "never call xcodegen generate directly — it scans before the bundles exist (cave-d8ma3)",
);

assert.doesNotMatch(
  workflow,
  /build:[\s\S]{0,300}needs:[\s\S]{0,300}- release-ios-build/,
  "TestFlight publication failures must not block unrelated desktop artifacts",
);

console.log("ios-build-ci.test.mjs: ok");
