#!/usr/bin/env node
// Assert that the iOS XCTest suite ACTUALLY EXECUTED, and that CI would have
// noticed if it had not.
//
// Why this file exists (cave-ac372). Until now the `iOS build` job ran:
//
//     xcodebuild ... build               # the app target compiles
//     xcodebuild ... build-for-testing   # the test bundles compile
//
// Neither runs a single assertion. `build-for-testing` needs no booted
// simulator, which is exactly what made it cheap enough for routine PR CI —
// and exactly why it cannot execute anything. So every XCTest under
// CovenCaveTests/ was unrun: 684 test methods whose green check certified that
// they PARSE, not that they PASS. PR #4946 shipped ~1,900 lines of Swift for
// the Familiar hub store — single-flight dedup, cancellation on Familiar
// switch, nonce/epoch relevance, LRU eviction — with XCTest coverage for
// exactly those behaviours, none of which had ever been asked a question.
//
// The job now boots a simulator and runs the suite, so `xcodebuild`'s own exit
// status is the primary gate. This script exists because that exit status is
// NOT sufficient on its own:
//
//   * `xcodebuild test-without-building` exits 0 when it runs ZERO tests. An
//     `-only-testing:` selector that stops matching (a renamed target, a
//     retired bundle) turns the whole gate off and reports success. That is
//     the precise failure this bead is about, re-armed one layer up.
//   * A suite can also truncate — run 300 of 684 and exit 0 — which reads
//     identical to a healthy run in the log.
//
// So the assertion here is on a PROPERTY, not on a spelling in the log: the
// number of test cases the result bundle says ran must be at least the number
// of XCTest methods that exist in the source tree. A grep for "Test Suite
// ... passed" would be satisfied by a run of one test; this is not.
//
// The floor is derived from the sources rather than hardcoded, so adding tests
// never needs a number bumped here, and DELETING the wiring that runs them
// fails loudly.
//
// ── Why a floor is not enough, either (cave-ac372 follow-up) ────────────────
//
// The first version of this file computed
//
//     executed = passed + failed + skipped + expectedFailures
//
// and then gated only `failed`. That left the cheapest possible escape hatch
// wide open: `XCTSkip`-ing the 23 known-failing cases would have produced
// 661 passed + 23 skipped = 684 executed, satisfied the floor exactly, and
// reported `result: "Passed"` — green, silently, forever, with nothing
// recording that 23 assertions had stopped being asked. `XCTExpectFailure`
// gives the identical shape through `expectedFailures`. A gate whose easiest
// bypass is invisible is not a gate, so both are now hard failures.
//
// `-skip-testing:` — the quarantine mechanism this PR's own description
// originally proposed — is unsound for a different reason: a skipped-by-
// selector test yields NO result at all, so it does not even reach
// `skippedTests`. It lowers the executed count instead, which the source-
// derived floor already rejects. It also means nothing could ever notice that
// the underlying repair had landed.
//
// So deferral, when it is needed, goes through QUARANTINED_FAILURES below:
// every test still RUNS, every failure is still reported, and a listed test
// that starts passing FAILS the gate. Suppression cannot outlive what it
// suppresses.
//
// Usage:
//   node scripts/ios-xctest-summary.mjs \
//     --result-bundle /path/to/CovenCaveTests.xcresult \
//     --tests-dir apps/ios/CovenCave/CovenCaveTests \
//     --xcodebuild-outcome success|failure

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Strip Swift comments so a commented-out `func testFoo()` is not counted. */
export function stripSwiftComments(source) {
  let out = "";
  let i = 0;
  let blockDepth = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (blockDepth > 0) {
      if (two === "/*") {
        blockDepth += 1;
        i += 2;
        continue;
      }
      if (two === "*/") {
        blockDepth -= 1;
        i += 2;
        continue;
      }
      // Preserve newlines so line-oriented reasoning downstream stays sane.
      out += source[i] === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }
    if (two === "/*") {
      blockDepth = 1;
      i += 2;
      continue;
    }
    if (two === "//") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

// XCTest only discovers instance methods named `test…` that take no arguments.
// `async`/`throws` may follow the parameter list, so the pattern deliberately
// stops at the closing paren.
const XCTEST_METHOD = /\bfunc\s+(test[A-Za-z0-9_]*)\s*\(\s*\)/g;

/** Count the XCTest methods declared in one Swift source. */
export function countXCTestMethods(source) {
  return (stripSwiftComments(source).match(XCTEST_METHOD) ?? []).length;
}

/** Every XCTest method name declared in one Swift source, in source order. */
export function xctestMethodNames(source) {
  return [...stripSwiftComments(source).matchAll(XCTEST_METHOD)].map((match) => match[1]);
}

/**
 * Count the XCTest methods across a directory of Swift sources.
 *
 * Returns `{ total, perFile, byName }`:
 *   - `perFile` so a truncation can name the files it expected;
 *   - `byName` maps a bare method name to EVERY file that declares it, which is
 *     what makes the quarantine registry's key checkable. The result bundle
 *     reports an unqualified `testFoo()` with no class attached, so a key that
 *     matches two declarations identifies neither. Measured on this tree:
 *     684 declarations, 683 distinct names, one genuine collision
 *     (`testRawValuesAreStable`, in DrawerDestinationOrderTests and
 *     FamiliarHubNavigationTests). The ambiguity is real, not hypothetical.
 */
export function countXCTestMethodsInDirectory(dir, { readDir = readdirSync, readFile = readFileSync } = {}) {
  const perFile = new Map();
  const byName = new Map();
  let total = 0;
  for (const entry of readDir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const nested = countXCTestMethodsInDirectory(path.join(dir, entry.name), { readDir, readFile });
      for (const [file, count] of nested.perFile) perFile.set(file, count);
      for (const [name, files] of nested.byName) byName.set(name, [...(byName.get(name) ?? []), ...files]);
      total += nested.total;
      continue;
    }
    if (!entry.name.endsWith(".swift")) continue;
    const full = path.join(dir, entry.name);
    const source = readFile(full, "utf8");
    const names = xctestMethodNames(source);
    perFile.set(full, names.length);
    for (const name of names) byName.set(name, [...(byName.get(name) ?? []), full]);
    total += names.length;
  }
  return { total, perFile, byName };
}

/**
 * Known-failing iOS tests whose repair is in flight, deferred BY NAME.
 *
 * This is a RATCHET, not a waiver, and it is modelled on `IN_FLIGHT_REPAIRS`
 * in scripts/check-test-clock-consistency.mjs. Four properties make it one:
 *
 *   1. Every listed test still RUNS. Nothing is skipped, nothing is
 *      `-skip-testing:`-ed out, and the source-derived floor is untouched, so
 *      the suite cannot quietly shrink underneath the entry.
 *   2. A listed test that STOPS failing fails this gate — "the repair has
 *      landed, delete the entry". Suppression cannot outlive what it
 *      suppresses, and a leftover entry can therefore never mask the NEXT
 *      failure of that test.
 *   3. Every entry names a bead and a hard expiry. Past that date the gate
 *      fails whether or not the test still fails, so a deferral cannot become
 *      permanent by inattention.
 *   4. A key that does not resolve to exactly one XCTest method in the source
 *      tree is refused (see `byName` above). An ambiguous key would defer a
 *      failure in some OTHER class with the same method name.
 *
 * An UNLISTED failure fails the gate immediately, which is the whole point:
 * this converts "684 tests nobody has ever run" into "684 tests run, 23 known
 * exceptions, and any new failure is red".
 *
 * ⚠️ MERGE ORDER. #4958 (cave-vz17i) repairs 12 of these. Whichever of #4952
 * and #4958 lands second must first merge `main` and delete the entries that
 * have gone stale — otherwise the second merge turns `main` red on rule 2.
 * That is the mechanism working, not a defect, but it is five seconds of work
 * done in advance versus a red `main` discovered afterwards.
 *
 * Key = bare XCTest method name exactly as the result bundle reports it,
 * without the trailing `()`.
 */
export const QUARANTINED_FAILURES = new Map([]);

/**
 * Reduce whatever the bundle calls a test to the bare method name the
 * registry is keyed on.
 *
 * Xcode's summary reports `testFoo()`. Other xcresult surfaces report a
 * qualified `SomeTests/testFoo()`. Accept either, key on the method.
 */
export function normalizeTestName(value) {
  if (typeof value !== "string") return "";
  const name = value.trim();
  const tail = name.slice(name.lastIndexOf("/") + 1);
  return tail.replace(/\(\s*\)$/, "").trim();
}

// Fields an xcresult failure record MIGHT carry that would qualify a bare
// method name. None is guaranteed by any schema this repo can verify off
// macOS, so nothing depends on them — they are printed alongside a deferred
// failure purely so a future session has the evidence to upgrade the key from
// "unique in the source tree" to a genuinely qualified identifier.
const QUALIFIER_FIELDS = ["targetName", "testIdentifierString", "identifierString", "nodeIdentifier"];

/**
 * Decide whether an xcresult summary proves the suite executed and passed.
 *
 * `summary` is the object `xcrun xcresulttool get test-results summary` emits.
 * Returns `{ ok, executed, problems }`; `problems` is empty iff `ok`.
 */
export function evaluateSuiteExecution({
  summary,
  expectedMinimum,
  quarantine = QUARANTINED_FAILURES,
  declarationsByName = null,
  xcodebuildOutcome = null,
  now = new Date(),
}) {
  const problems = [];
  const deferred = [];
  const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

  if (!summary || typeof summary !== "object") {
    return {
      ok: false,
      executed: 0,
      deferred,
      problems: ["the result bundle summary is missing or not an object"],
    };
  }

  const passed = num(summary.passedTests);
  const failed = num(summary.failedTests);
  const skipped = num(summary.skippedTests);
  const expectedFailures = num(summary.expectedFailures);
  const reportedTotal = num(summary.totalTestCount);
  // Prefer the reported total, but never let a missing/zero total hide a run
  // that plainly executed cases.
  const executed = Math.max(reportedTotal, passed + failed + skipped + expectedFailures);

  // The guard needs a guard: a source scan that finds nothing would make every
  // floor trivially satisfiable, which is the same class of hole as the one
  // this file closes.
  if (!Number.isFinite(expectedMinimum) || expectedMinimum <= 0) {
    problems.push(
      `expected at least one XCTest method in the source tree but the scan found ${expectedMinimum} — ` +
        "the floor cannot be derived, so this run proves nothing",
    );
  }

  if (executed === 0) {
    problems.push(
      "ZERO test cases executed. xcodebuild exits 0 when its test selector matches nothing, " +
        "so a green step here would certify only that the bundles compiled (cave-ac372).",
    );
  } else if (Number.isFinite(expectedMinimum) && executed < expectedMinimum) {
    problems.push(
      `only ${executed} test case(s) executed but ${expectedMinimum} XCTest method(s) exist in the source tree — ` +
        "the suite truncated or part of it was never wired in",
    );
  }

  // ── Hole 1: a skip is not a pass ──────────────────────────────────────────
  // `XCTSkip` keeps the case in the executed count, so the floor above is
  // satisfied while the assertion is never made. That is the cheapest possible
  // way to turn this whole gate green and it leaves no trace anywhere.
  // Deferral must go through QUARANTINED_FAILURES, which expires.
  if (skipped > 0) {
    problems.push(
      `${skipped} test case(s) were SKIPPED. A skipped case still counts toward the executed floor, ` +
        "so an XCTSkip would satisfy this gate while asserting nothing — silently and with no expiry. " +
        "Defer a known failure through QUARANTINED_FAILURES in scripts/ios-xctest-summary.mjs instead.",
    );
  }

  // ── Hole 2: an expected failure is not a pass ─────────────────────────────
  // `XCTExpectFailure` produces the identical shape through a different
  // counter, and additionally reports result="Passed".
  if (expectedFailures > 0) {
    problems.push(
      `${expectedFailures} test case(s) were recorded as EXPECTED FAILURES. XCTExpectFailure keeps the case ` +
        'in the executed count AND leaves result="Passed", so it is an unexpiring silent quarantine. ' +
        "Defer a known failure through QUARANTINED_FAILURES in scripts/ios-xctest-summary.mjs instead.",
    );
  }

  // ── Failures, enumerated by name so deferral can be explicit ──────────────
  const records = Array.isArray(summary.testFailures) ? summary.testFailures : [];
  const failureNames = new Set();
  const firstRecord = new Map();
  for (const record of records) {
    const name = normalizeTestName(record?.testName);
    if (!name) continue;
    failureNames.add(name);
    if (!firstRecord.has(name)) firstRecord.set(name, record);
  }

  // Deferral is only defensible if every failure can be named. A bundle that
  // says "23 failed" and names 20 leaves three unaccounted for, and matching
  // the named ones against the registry would report green over them.
  const enumerable = failed === 0 || failureNames.size >= failed;
  if (!enumerable) {
    problems.push(
      `the bundle reports ${failed} failed case(s) but names only ${failureNames.size} — the failures cannot be ` +
        "enumerated, so none of them can be matched against the quarantine registry",
    );
  }

  const unlisted = [];
  for (const name of [...failureNames].sort()) {
    if (enumerable && quarantine.has(name)) {
      deferred.push({ name, entry: quarantine.get(name), record: firstRecord.get(name) });
    } else {
      unlisted.push(name);
    }
  }
  if (unlisted.length > 0) {
    problems.push(
      `${unlisted.length} unquarantined test case(s) failed: ${unlisted.join(", ")}`,
    );
  }
  if (failed > 0 && failureNames.size === 0) {
    problems.push(`${failed} test case(s) failed and the bundle named none of them`);
  }

  // ── The registry is itself gated ──────────────────────────────────────────
  problems.push(...validateQuarantine({ quarantine, declarationsByName, failureNames, now }));

  // A non-`Passed` result is normally fatal. The single exception is a run
  // whose ONLY failures are deferred ones — there the bundle is correctly
  // reporting "Failed" and the registry is the thing deciding.
  if (typeof summary.result === "string" && summary.result !== "Passed") {
    const explainedByQuarantine =
      summary.result === "Failed" && deferred.length > 0 && unlisted.length === 0 && enumerable;
    if (!explainedByQuarantine) {
      problems.push(`the result bundle reports result="${summary.result}"`);
    }
  }

  // ── Cross-check the bundle against the process that produced it ───────────
  // The test step runs with `continue-on-error`, because a run whose only
  // failures are deferred must not fail the job. That hands this script sole
  // authority, so it has to notice when the two disagree.
  problems.push(...crossCheckXcodebuild({ xcodebuildOutcome, failed, skipped, otherProblems: problems.length }));

  return { ok: problems.length === 0, executed, deferred, problems };
}

/**
 * Gate the quarantine registry itself.
 *
 * Every rule here exists because the registry is a suppression mechanism, and
 * an unchecked suppression mechanism is indistinguishable from deleting the
 * tests. Fails CLOSED: without a source index the registry cannot be validated
 * at all, so a non-empty registry is refused outright.
 */
export function validateQuarantine({ quarantine, declarationsByName, failureNames, now = new Date() }) {
  const problems = [];
  if (quarantine.size === 0) return problems;

  if (!declarationsByName) {
    problems.push(
      `the quarantine registry lists ${quarantine.size} test(s) but no source index was supplied, so its keys ` +
        "cannot be checked for ambiguity — refusing to defer anything",
    );
  }

  for (const [name, entry] of quarantine) {
    const where = `quarantine entry "${name}"`;

    if (!entry || typeof entry !== "object") {
      problems.push(`${where} is not an object — every entry needs { bead, reason, expires }`);
      continue;
    }
    for (const field of ["bead", "reason", "expires"]) {
      if (typeof entry[field] !== "string" || entry[field].trim() === "") {
        problems.push(`${where} is missing a non-empty "${field}" — a deferral must name what tracks and ends it`);
      }
    }

    const expiresAt = Date.parse(entry.expires ?? "");
    if (Number.isNaN(expiresAt)) {
      problems.push(`${where} has an unparseable "expires" (${JSON.stringify(entry.expires)}); use an ISO date`);
    } else if (expiresAt <= now.getTime()) {
      problems.push(
        `${where} EXPIRED on ${entry.expires}. A deferral that outlives its deadline is a deleted test with extra ` +
          `steps — fix ${entry.bead ?? "the bead"}, or renew the entry deliberately with a new date.`,
      );
    }

    if (declarationsByName) {
      const files = declarationsByName.get(name) ?? [];
      if (files.length === 0) {
        problems.push(
          `${where} names no XCTest method in the source tree. The test was renamed or deleted, so the entry now ` +
            "defers nothing and must go.",
        );
      } else if (files.length > 1) {
        problems.push(
          `${where} is AMBIGUOUS: ${files.length} XCTest methods share that name (${files.join(", ")}). The result ` +
            "bundle reports a bare, unqualified method name, so this key cannot identify one test — it would defer " +
            "a failure in whichever class happened to fail. Rename one of the methods before deferring either.",
        );
      }
    }

    if (!failureNames.has(name)) {
      problems.push(
        `${where} is STALE: that test did not fail in this run, so its repair has landed. Delete the entry from ` +
          "QUARANTINED_FAILURES in scripts/ios-xctest-summary.mjs — leaving it would silently suppress the NEXT " +
          "failure of that test.",
      );
    }
  }

  return problems;
}

/**
 * Reconcile the result bundle with xcodebuild's own exit status.
 *
 * `continue-on-error` on the test step is what lets a fully-deferred run go
 * green, and it is also what would let a build error, a dead simulator, or a
 * crashed test runner pass unnoticed if the bundle happened to look benign.
 */
export function crossCheckXcodebuild({ xcodebuildOutcome, failed, skipped, otherProblems }) {
  const problems = [];
  if (xcodebuildOutcome == null) return problems;

  if (xcodebuildOutcome !== "success" && xcodebuildOutcome !== "failure") {
    problems.push(
      `the xcodebuild test step reported outcome="${xcodebuildOutcome}" rather than success or failure — it was ` +
        "skipped or cancelled, and a suite that did not run must never read as a pass",
    );
    return problems;
  }

  if (xcodebuildOutcome === "success" && failed > 0) {
    problems.push(
      `xcodebuild reported success while the result bundle reports ${failed} failed case(s) — the two disagree, ` +
        "so neither can be trusted",
    );
  }

  if (xcodebuildOutcome === "failure" && failed === 0 && skipped === 0 && otherProblems === 0) {
    problems.push(
      "xcodebuild FAILED but the result bundle reports nothing wrong — the failure is outside the suite " +
        "(a build error, a lost simulator, a crashed runner) and must not read as a pass",
    );
  }

  return problems;
}

export function readResultBundleSummary(resultBundlePath, { run = execFileSync } = {}) {
  const raw = run(
    "xcrun",
    ["xcresulttool", "get", "test-results", "summary", "--path", resultBundlePath, "--format", "json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(raw);
}

function parseArgs(argv) {
  const args = { resultBundle: "", testsDir: "", xcodebuildOutcome: "" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--result-bundle") args.resultBundle = argv[i + 1] ?? "";
    if (argv[i] === "--tests-dir") args.testsDir = argv[i + 1] ?? "";
    if (argv[i] === "--xcodebuild-outcome") args.xcodebuildOutcome = argv[i + 1] ?? "";
  }
  return args;
}

function main() {
  const { resultBundle, testsDir, xcodebuildOutcome } = parseArgs(process.argv.slice(2));
  // `--xcodebuild-outcome` is REQUIRED rather than optional. It is the only
  // thing that notices a test step which died without producing a bad bundle,
  // and an optional flag is one deleted line away from being absent forever.
  if (!resultBundle || !testsDir || !xcodebuildOutcome) {
    console.error(
      "usage: ios-xctest-summary.mjs --result-bundle <path.xcresult> --tests-dir <dir> " +
        "--xcodebuild-outcome <success|failure>",
    );
    process.exit(2);
  }

  const { total: expectedMinimum, perFile, byName } = countXCTestMethodsInDirectory(testsDir);

  let summary;
  try {
    summary = readResultBundleSummary(resultBundle);
  } catch (error) {
    console.error(`✗ could not read the xcresult bundle at ${resultBundle}`);
    console.error(String(error?.stderr || error?.message || error));
    process.exit(1);
    return;
  }

  const { ok, executed, deferred, problems } = evaluateSuiteExecution({
    summary,
    expectedMinimum,
    declarationsByName: byName,
    xcodebuildOutcome,
  });

  const line = (label, value) => console.log(`  ${label.padEnd(22)} ${value}`);
  console.log("iOS XCTest execution report");
  line("source test methods", expectedMinimum);
  line("executed", executed);
  line("passed", summary.passedTests ?? 0);
  line("failed", summary.failedTests ?? 0);
  line("deferred", `${deferred.length} of ${QUARANTINED_FAILURES.size} quarantined`);
  line("skipped", summary.skippedTests ?? 0);
  line("expected failures", summary.expectedFailures ?? 0);
  line("result", summary.result ?? "(unreported)");
  line("xcodebuild", xcodebuildOutcome);

  if (deferred.length > 0) {
    console.log("");
    console.log("Deferred failures (QUARANTINED_FAILURES — these still RAN and still FAILED):");
    for (const { name, entry, record } of deferred) {
      console.log(`  … ${name}  [${entry.bead}, expires ${entry.expires}]`);
      console.log(`      ${entry.reason}`);
      // Print any qualifying field the bundle happens to carry, so whoever
      // wants to upgrade this registry to a class-qualified key has evidence
      // rather than a guess about the xcresult schema.
      const qualifiers = QUALIFIER_FIELDS.filter((field) => record?.[field] != null)
        .map((field) => `${field}=${JSON.stringify(record[field])}`);
      if (qualifiers.length > 0) console.log(`      bundle fields: ${qualifiers.join(" ")}`);
    }
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = [
      "### iOS XCTest execution",
      "",
      "| metric | value |",
      "| --- | --- |",
      `| source test methods | ${expectedMinimum} |`,
      `| executed | ${executed} |`,
      `| passed | ${summary.passedTests ?? 0} |`,
      `| failed | ${summary.failedTests ?? 0} |`,
      `| deferred (quarantined) | ${deferred.length} |`,
      `| skipped | ${summary.skippedTests ?? 0} |`,
      `| expected failures | ${summary.expectedFailures ?? 0} |`,
      `| result | ${summary.result ?? "(unreported)"} |`,
      "",
    ].join("\n");
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${rows}\n`);
    } catch {
      /* a summary we cannot write is never a reason to fail the gate */
    }
  }

  if (!ok) {
    console.error("");
    for (const problem of problems) console.error(`✗ ${problem}`);
    if (executed > 0 && executed < expectedMinimum) {
      console.error("");
      console.error("Per-file XCTest method counts the floor was derived from:");
      for (const [file, count] of perFile) {
        if (count > 0) console.error(`    ${count.toString().padStart(4)}  ${file}`);
      }
    }
    for (const failure of summary.testFailures ?? []) {
      console.error(`    ${failure.testName ?? "(unnamed)"}: ${failure.failureText ?? ""}`);
    }
    process.exit(1);
  }

  if (deferred.length > 0) {
    console.log(
      `✓ ${executed} iOS XCTest case(s) executed; ${deferred.length} known failure(s) deferred by name, ` +
        `every other case passed (floor ${expectedMinimum})`,
    );
    return;
  }
  console.log(`✓ ${executed} iOS XCTest case(s) executed and passed (floor ${expectedMinimum})`);
}

// Windows paths make `file://${process.argv[1]}` an unreliable identity check,
// so compare basenames instead. The test module has a different basename, so
// importing this file never runs the CLI.
if (process.argv[1] && path.basename(process.argv[1]) === "ios-xctest-summary.mjs") {
  main();
}
