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
// release.yml now has a macOS leg that does. Routine PR CI stays minimal and
// path-aware; every release pays for the real native compilation.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

// ── The job exists and actually compiles ────────────────────────────────────
assert.match(workflow, /^ {2}release-ios-build:$/m, "release.yml defines the iOS build job");
assert.match(
  workflow,
  /release-ios-build:[\s\S]{0,400}runs-on: macos-15/,
  "the iOS build runs on macOS — xcodebuild cannot run anywhere else",
);
// Anchored to a real `run:` step, NOT merely present in the file. The looser
// form passed while the command sat commented out behind `echo skip` — a guard
// satisfied by a comment is not a guard.
assert.match(
  workflow,
  /^ +run: xcodebuild -scheme CovenCave -destination 'generic\/platform=iOS' CODE_SIGNING_ALLOWED=NO build$/m,
  "the job runs a real xcodebuild as an executable step — a source-text check cannot replace it (that is what failed for three days)",
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

assert.match(
  workflow,
  /build:[\s\S]{0,300}needs:[\s\S]{0,300}- release-ios-build/,
  "artifact publication waits for the release iOS build",
);

console.log("ios-build-ci.test.mjs: ok");
