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
// ci.yml now has a macOS leg that does. This guards the two ways it could
// quietly stop protecting anything: the job being removed, or its change
// detection being narrowed until it never fires on a Swift edit.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

// ── The job exists and actually compiles ────────────────────────────────────
assert.match(workflow, /^ {2}ios-build:$/m, "ci.yml defines the iOS build job");
assert.match(
  workflow,
  /ios-build:[\s\S]{0,400}runs-on: macos-latest/,
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
  /^ +run: bash scripts\/ios-xcodegen\.sh$/m,
  "the project is generated through the wrapper that proves the web bundles exist first",
);
assert.doesNotMatch(
  workflow,
  /^\s+run: xcodegen generate\s*$/m,
  "never call xcodegen generate directly — it scans before the bundles exist (cave-d8ma3)",
);

// ── It stays reachable ──────────────────────────────────────────────────────
// The macOS leg is gated because macOS minutes once exhausted the org Actions
// limit and queued indefinitely, stalling every required check. Gating is the
// point — but a gate that never opens is the same as having deleted the job,
// and that failure is silent, so the trigger set is pinned here.
assert.match(
  workflow,
  /ios-build:[\s\S]{0,200}needs: ios-changed[\s\S]{0,200}if: needs\.ios-changed\.outputs\.ios == 'true'/,
  "the macOS leg is gated on the cheap Linux detection job",
);
// Read the ACTUAL grep pattern out of the detection step rather than searching
// the whole file: every one of these paths also appears in the comments above,
// so a whole-file `includes` stays green even when the live pattern has been
// narrowed to never match a Swift edit.
const detectPattern = workflow.match(/grep -qE '(\^\([^']+\))'/);
assert.ok(detectPattern, "the detection step still uses an anchored grep pattern");
for (const path of [
  "apps/ios/", // the Swift and project.yml
  "scripts/ios-", // the xcodegen wrapper and the source-text contracts
  "scripts/build-ios-", // generators whose output is embedded in the bundle
]) {
  assert.ok(
    detectPattern[1].includes(path),
    `iOS change detection must still trigger on ${path} — a Swift edit that does not run the build is the exact gap this job closes`,
  );
}
// A push to main (and a manual recovery run) must build unconditionally: main
// staying honest is worth more than the minutes, and neither event has a base
// ref to diff against, so the detection would otherwise fall through to false.
assert.match(
  workflow,
  /if \[ "\$EVENT" != "pull_request" \]; then\s*\n\s*echo "ios=true"/,
  "non-PR events build unconditionally rather than silently skipping",
);

// ── It must NOT be a required status check ──────────────────────────────────
// Branch protection requires nine contexts, none of them these. A required
// context that does not report is how a PR ends up BLOCKED with nothing
// failing, and this job deliberately does not report on most PRs. If it is ever
// promoted to required, it must lose the gate in the same change.
assert.doesNotMatch(
  workflow,
  /ios-build[\s\S]{0,200}\n {2}(conformance-required|sidecar-runtime-required):/,
  "the iOS legs are not folded into a required rollup while they are still skippable",
);

console.log("ios-build-ci.test.mjs: ok");
