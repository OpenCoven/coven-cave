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
import { parse } from "yaml";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const project = readFileSync(
  new URL("../apps/ios/CovenCave/project.yml", import.meta.url),
  "utf8",
);
const iosJobStart = workflow.indexOf("  release-ios-build:");
const iosJobEnd = workflow.indexOf("\n  build:", iosJobStart);
assert.notEqual(iosJobStart, -1, "release.yml defines the iOS build job delimiter");
assert.notEqual(iosJobEnd, -1, "release.yml defines the build job after the iOS job");
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
  /IOS_DELIVERY_ID: \$\{\{ inputs\.ios_delivery_id \}\}[\s\S]*appstore:status[\s\S]*--delivery-id "\$IOS_DELIVERY_ID"[\s\S]*--wait[\s\S]*resume-confirmed=true/,
  "a manual retry can resume and verify only the exact delivery ID returned by an earlier upload",
);
assert.match(
  iosJob,
  /else[\s\S]*resume-confirmed=false[\s\S]*fresh iOS[\s\S]*uploaded and awaited by delivery ID/,
  "a fresh tag build uploads its unique build and waits on the returned delivery ID",
);
assert.doesNotMatch(
  iosJob,
  /appstore:status[\s\S]{0,300}--apple-id/,
  "fresh releases never trust the unreliable version-selector status preflight",
);
assert.match(
  workflow,
  /ios_delivery_id:[\s\S]*RECOVERY ONLY:[\s\S]*required: false[\s\S]*type: string/,
  "manual release recovery exposes the delivery ID needed to resume processing safely",
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

// ── The archive can actually resolve signing ────────────────────────────────
// Release run 32496765932 failed the archive with "No profiles for
// 'ai.opencoven.cave' were found ... Automatic signing is disabled", and run
// 32501746425 — after adding -allowProvisioningUpdates — failed with
// "Communication with Apple failed: ... (401) ... listTeams.action". The App
// Store Connect key here is user-scoped (vars.APPLE_API_KEY_SUBJECT=user) and
// cannot perform team operations, so automatic signing is unavailable no matter
// how it is invoked. The archive must therefore sign manually against the
// profiles the preceding step installs and validates.
//
// None of this was caught earlier because every recent release resolved
// `resume-confirmed` and skipped the archive, the export and the upload
// outright — the job reported success without ever building.
assert.match(
  iosJob,
  /CODE_SIGN_STYLE=Manual/,
  "the iOS archive must sign manually; the user-scoped App Store Connect key cannot drive automatic signing",
);
assert.doesNotMatch(
  iosJob,
  /-allowProvisioningUpdates/,
  "automatic provisioning is unavailable with a user-scoped key and must not be reintroduced",
);
// The app and the widget need DIFFERENT profiles, and a build setting passed on
// the xcodebuild command line applies to every target. The specifier is
// therefore a nested expansion keyed by each target's own bundle id, with one
// setting supplied per bundle id.
//
// It has to live HERE and not in project.yml: the iOS job checks out the
// release tag's commit, so a project.yml setting only applies to a release that
// already carried it. Run 32508544547 proved that — the specifier was declared
// on main, the archive ran from the v0.3.9 tree, it resolved empty, and
// xcodebuild reported "requires a provisioning profile with the App Groups
// feature" instead of a missing profile.
assert.ok(
  iosJob.includes(
    "'PROVISIONING_PROFILE_SPECIFIER=$(CAVE_IOS_PROFILE_$(PRODUCT_BUNDLE_IDENTIFIER:identifier))'",
  ),
  "the iOS archive must key the provisioning profile off each target's bundle id, not the checked-out project.yml",
);
assert.doesNotMatch(
  project,
  /PROVISIONING_PROFILE_SPECIFIER/,
  "project.yml must not carry the profile specifier; a tag-pinned checkout makes it silently empty",
);
for (const [setting, envVar] of [
  ["CAVE_IOS_PROFILE_ai_opencoven_cave", "IOS_PROFILE_UUID_APP"],
  ["CAVE_IOS_PROFILE_ai_opencoven_cave_widgets", "IOS_PROFILE_UUID_WIDGET"],
]) {
  assert.ok(
    iosJob.includes(`${setting}="$${envVar}"`),
    `the iOS archive must pass ${setting} from ${envVar} so each target signs with its own profile`,
  );
  assert.match(
    iosJob,
    new RegExp(`${envVar}_?`),
    `the signing-asset step must export ${envVar}`,
  );
}
// Resolution is verified before the archive, so a specifier that goes empty
// again fails in seconds naming the target instead of ~20 minutes later naming
// a capability.
assert.match(
  iosJob,
  /resolved provisioning profile/,
  "the iOS archive must verify each target resolves to its expected profile before archiving",
);
assert.match(
  iosJob,
  /<string>manual<\/string>/,
  "the export options must use manual signing to match the archive",
);
for (const bundleId of ["ai.opencoven.cave", "ai.opencoven.cave.widgets"]) {
  assert.ok(
    iosJob.includes(`<key>${bundleId}</key>`),
    `the export options must map ${bundleId} to its provisioning profile`,
  );
}

// ── Routine PR CI must EXECUTE the XCTests, not merely compile them ─────────
//
// cave-ac372. `xcodebuild build-for-testing` needs no booted simulator, which
// is what made it cheap enough to add to per-PR CI — and exactly why it cannot
// run an assertion. For a while the `iOS build` check therefore certified that
// 684 XCTest methods PARSE. Nothing had ever asked whether they pass, including
// the ~1,900 lines of Familiar-hub store behaviour #4946 shipped with tests.
//
// These assertions are structural rather than textual wherever YAML allows it:
// the `test` action, its destination and the verification step are read off the
// parsed job. The property the gate actually depends on — that a run executing
// zero or too few cases is rejected — is NOT asserted by grepping this file;
// it is unit-tested against the decision procedure in
// scripts/ios-xctest-summary.test.mjs, which can mutate a summary and watch the
// verdict flip. A workflow assertion can only prove the wiring exists.
const ci = parse(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"));
const ciIosJob = ci.jobs?.ios;
assert.ok(ciIosJob, "ci.yml defines an `ios` job");
assert.equal(ciIosJob["runs-on"], "macos-15", "the iOS job needs a macOS runner — xcodebuild runs nowhere else");

const iosSteps = ciIosJob.steps ?? [];
const runScripts = iosSteps.map((step) => String(step.run ?? ""));
const stepRunning = (predicate) => iosSteps.find((step) => predicate(String(step.run ?? "")));

// Matched on the xcodebuild ACTION, not on a substring: `build-for-testing`
// contains "testing", and prose in a comment contains anything at all. The
// action is the last word of the invocation, so it is anchored as a bare
// token in a run script that actually calls xcodebuild.
const invokesXcodebuildAction = (run, action) =>
  run.includes("xcodebuild") && new RegExp(String.raw`(?:^|\s)${action}(?:\s|$)`, "m").test(run);

const compileStep = stepRunning((run) => invokesXcodebuildAction(run, "build-for-testing"));
assert.ok(compileStep, "the iOS job still compiles the test bundles");

const testStep = stepRunning(
  (run) => invokesXcodebuildAction(run, "test-without-building") || invokesXcodebuildAction(run, "test"),
);
assert.ok(
  testStep,
  "the iOS job must RUN the XCTests — `build-for-testing` alone certifies that they compile, not that they pass (cave-ac372)",
);
assert.notEqual(
  testStep,
  compileStep,
  "compiling and running are separate steps so a compile failure is distinguishable from a test failure",
);

// A test action needs a concrete, booted simulator. `generic/platform=iOS
// Simulator` is a build-only destination: pointing the test action at it is the
// cosmetic version of this fix, and it would fail rather than silently pass —
// but pinning it here means nobody has to discover that on a red CI run.
const testRun = String(testStep.run ?? "");
assert.doesNotMatch(
  testRun,
  /-destination\s+["']?generic\//,
  "a generic destination cannot run tests; the test action needs a concrete simulator",
);
assert.match(
  testRun,
  /-destination\s+"id=\$IOS_SIMULATOR_UDID"/,
  "the test action targets the simulator the job resolved and booted",
);
assert.ok(
  stepRunning((run) => run.includes("simctl bootstatus")),
  "the iOS job boots a simulator and waits for it before running tests",
);
// The runner image's device names and iOS versions change without notice, so
// the simulator is discovered, not spelled. A hardcoded name turns an image
// bump into a red iOS job that reads like a product failure.
assert.ok(
  runScripts.some((run) => run.includes("simctl list devices available")),
  "the simulator is resolved from the runner's available devices rather than hardcoded",
);
assert.ok(
  runScripts.some((run) => run.includes("scripts/ios-select-simulator.mjs")),
  "selection goes through the tested selector — a lexicographic sort would pick iOS-9 over iOS-26",
);

// UI tests keep their compile gate but stay out of the blocking path: they
// drive XCUIApplication, which is minutes per case and the most flake-prone
// thing this pipeline could own.
assert.match(
  testRun,
  /-only-testing:CovenCaveTests\b/,
  "routine PR CI runs the unit bundle; CovenCaveUITests stays compile-only for cost and flake reasons",
);

// A hang must cost one test, not the whole job. Run 32666989516 — the first
// run that ever executed these tests — wedged for 36 minutes inside a single
// case and died on the job timeout, leaving an unfinalized result bundle and
// therefore no counts and no failure names at all. Without timeouts enabled
// XCTest does not enforce its per-test allowance, so the flags below are the
// difference between "one test is named and failed" and "the gate reports
// nothing distinguishable from an infrastructure blip".
assert.match(
  testRun,
  /-test-timeouts-enabled\s+YES/,
  "per-test timeouts must be enabled — a hung test otherwise wedges the job until it times out with no report",
);
assert.match(
  testRun,
  /-default-test-execution-time-allowance\s+\d+/,
  "a default per-test allowance bounds a hang to one test instead of the whole run",
);

const verifyStep = iosSteps.find((step) => String(step.run ?? "").includes("scripts/ios-xctest-summary.mjs"));
assert.ok(
  verifyStep,
  "the iOS job verifies the result bundle — xcodebuild exits 0 when its selector matches no tests, which is the original defect one layer up",
);
assert.match(
  testRun,
  /-resultBundlePath\s+"\$IOS_RESULT_BUNDLE"/,
  "the test action writes the result bundle the verification step reads",
);
assert.equal(
  verifyStep.if,
  "always()",
  "the verification step reports counts and failures even when the test action already failed",
);
assert.match(
  String(verifyStep.run),
  /--tests-dir\s+apps\/ios\/CovenCave\/CovenCaveTests/,
  "the executed-count floor is derived from the unit-test sources rather than hardcoded",
);

// ── The simulator guard must fail CLOSED ────────────────────────────────────
//
// "No simulator, so nothing ran" is the silent-green shape this whole change
// exists to remove, and it is the one failure mode that looks like a runner
// problem rather than a code problem — which is exactly how it would get
// waved through. The step's existence was already pinned above; what was NOT
// pinned is that it stops the job.
const bootStep = stepRunning((run) => run.includes("simctl bootstatus"));
const bootRun = String(bootStep.run ?? "");
assert.match(
  bootRun,
  /^\s*exit 1$/m,
  "the simulator step must exit non-zero when no iPhone simulator resolves — a suite that could not run must never read as a pass",
);
assert.match(
  bootRun,
  /set -euo pipefail/,
  "the simulator step must abort on the first failing command, including a failed bootstatus",
);
assert.notEqual(
  bootStep["continue-on-error"],
  true,
  "the simulator step is a hard prerequisite; it must not be allowed to fail softly",
);

// ── The verify step is the SOLE verdict, and knows it ───────────────────────
//
// The test step runs with `continue-on-error` so a run whose only failures are
// enumerated in QUARANTINED_FAILURES can be green. That is safe only while all
// three of the following hold, so all three are pinned: the test step records
// an outcome, the verify step consumes that exact outcome, and the verify step
// itself can still fail the job.
assert.equal(
  testStep["continue-on-error"],
  true,
  "the test step defers its verdict to the verify step, which alone can tell a deferred failure from a new one",
);
assert.ok(
  typeof testStep.id === "string" && testStep.id.length > 0,
  "the test step needs an id so its outcome can be handed to the verify step",
);
const verifyRun = String(verifyStep.run);
assert.ok(
  verifyRun.includes(`steps.${testStep.id}.outcome`),
  `the verify step must receive steps.${testStep.id}.outcome — without it, a test step that died without ` +
    "writing a bad bundle (a build error, a lost simulator, a cancelled step) would pass unnoticed",
);
assert.match(
  verifyRun,
  /--xcodebuild-outcome/,
  "the verify step must cross-check the result bundle against xcodebuild's own exit status",
);
assert.notEqual(
  verifyStep["continue-on-error"],
  true,
  "the verify step IS the gate — allowing it to fail softly would switch the whole check off",
);

// `Frontend build` is the one required context, so the execution gate only
// blocks if that job keeps consuming the iOS job's result.
assert.ok(
  (ci.jobs?.build?.needs ?? []).includes("ios"),
  "Frontend build — the required context — must keep depending on the iOS job",
);

console.log("ios-build-ci.test.mjs: ok");
