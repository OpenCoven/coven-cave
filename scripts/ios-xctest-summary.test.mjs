// The gate that proves the iOS XCTests ran must itself be provably able to
// fail. XCTest needs macOS, so nothing here can execute a Swift test — but the
// decision procedure is pure and lives in JS precisely so it can be exercised
// on any runner, including the Windows and Linux ones this repo actually uses.
//
// Each case below is a MUTATION of a passing run, and each one must flip the
// verdict. Two of them are the reason this file grew: a suite whose failures
// were XCTSkip-ed, and one whose failures were XCTExpectFailure-ed, both used
// to be ACCEPTED — 661 passed + 23 skipped = 684 executed satisfied the
// source-derived floor exactly and reported result="Passed". That made the
// cheapest way to green this gate also an unexpiring, invisible one.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  countXCTestMethods,
  countXCTestMethodsInDirectory,
  crossCheckXcodebuild,
  evaluateSuiteExecution,
  normalizeTestName,
  QUARANTINED_FAILURES,
  stripSwiftComments,
  validateQuarantine,
  xctestMethodNames,
} from "./ios-xctest-summary.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unitTestsDir = path.join(root, "apps", "ios", "CovenCave", "CovenCaveTests");

const passingSummary = (overrides = {}) => ({
  result: "Passed",
  totalTestCount: 684,
  passedTests: 684,
  failedTests: 0,
  skippedTests: 0,
  expectedFailures: 0,
  testFailures: [],
  ...overrides,
});

// Every case that is not specifically about the registry runs against an EMPTY
// one, so those verdicts describe the decision procedure rather than today's
// list of known-broken tests.
const evaluate = (options) =>
  evaluateSuiteExecution({ quarantine: new Map(), xcodebuildOutcome: null, ...options });

test("a full passing run is accepted", () => {
  const verdict = evaluate({ summary: passingSummary(), expectedMinimum: 684 });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.executed, 684);
  assert.deepEqual(verdict.problems, []);
});

// THE bug. `xcodebuild test-without-building` exits 0 when its selector
// matches nothing, so a run that executed not one assertion looks identical to
// a healthy one from the process's exit status alone.
test("a run that executed zero tests is rejected even though it 'passed'", () => {
  const verdict = evaluate({
    summary: passingSummary({ totalTestCount: 0, passedTests: 0 }),
    expectedMinimum: 684,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.executed, 0);
  assert.ok(
    verdict.problems.some((problem) => /ZERO test cases executed/.test(problem)),
    `expected a zero-execution problem, got ${JSON.stringify(verdict.problems)}`,
  );
});

test("a truncated suite is rejected", () => {
  const verdict = evaluate({
    summary: passingSummary({ totalTestCount: 300, passedTests: 300 }),
    expectedMinimum: 684,
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => /only 300 test case\(s\) executed/.test(problem)));
});

test("a failing case is rejected even when the bundle forgot to say so", () => {
  const verdict = evaluate({
    summary: passingSummary({
      passedTests: 683,
      failedTests: 1,
      result: "Passed",
      testFailures: [{ testName: "testSomethingReal()" }],
    }),
    expectedMinimum: 684,
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => /unquarantined test case\(s\) failed/.test(problem)));
});

test("a non-Passed result is rejected", () => {
  const verdict = evaluate({ summary: passingSummary({ result: "Failed" }), expectedMinimum: 684 });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => /result="Failed"/.test(problem)));
});

// ── The two silent-quarantine holes ────────────────────────────────────────
//
// Both of these ACCEPTED before cave-ac372's follow-up. They are the highest
// value cases in this file: every other mutation makes a run look obviously
// wrong, while these two make it look perfect.

test("XCTSkip cannot buy a green gate: a skipped case is rejected", () => {
  const summary = passingSummary({
    passedTests: 661,
    failedTests: 0,
    skippedTests: 23,
    totalTestCount: 684,
    result: "Passed",
  });
  const verdict = evaluate({ summary, expectedMinimum: 684 });
  // The floor is still satisfied — that is exactly why this needed its own
  // rule rather than falling out of the executed count.
  assert.equal(verdict.executed, 684);
  assert.equal(verdict.ok, false, "an XCTSkip-ed suite must not read as a pass");
  assert.ok(
    verdict.problems.some((problem) => /23 test case\(s\) were SKIPPED/.test(problem)),
    `expected a skip problem, got ${JSON.stringify(verdict.problems)}`,
  );
});

test("XCTExpectFailure cannot buy a green gate either", () => {
  const summary = passingSummary({
    passedTests: 661,
    failedTests: 0,
    expectedFailures: 23,
    totalTestCount: 684,
    result: "Passed",
  });
  const verdict = evaluate({ summary, expectedMinimum: 684 });
  assert.equal(verdict.executed, 684);
  assert.equal(verdict.ok, false, "an XCTExpectFailure-ed suite must not read as a pass");
  assert.ok(
    verdict.problems.some((problem) => /recorded as EXPECTED FAILURES/.test(problem)),
    `expected an expected-failure problem, got ${JSON.stringify(verdict.problems)}`,
  );
});

test("even a single skip or expected failure is rejected", () => {
  for (const overrides of [{ skippedTests: 1 }, { expectedFailures: 1 }]) {
    const verdict = evaluate({
      summary: passingSummary({ passedTests: 683, ...overrides }),
      expectedMinimum: 684,
    });
    assert.equal(verdict.ok, false, `expected ${JSON.stringify(overrides)} to be rejected`);
  }
});

// Guarding the guard: a source scan that finds nothing makes every floor
// trivially satisfiable, which is the same shape of hole one layer up.
test("a source scan that found no test methods cannot certify anything", () => {
  const verdict = evaluate({ summary: passingSummary(), expectedMinimum: 0 });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => /the floor cannot be derived/.test(problem)));
});

test("a missing summary is rejected rather than treated as empty success", () => {
  for (const summary of [null, undefined, "Passed"]) {
    const verdict = evaluate({ summary, expectedMinimum: 684 });
    assert.equal(verdict.ok, false, `expected ${String(summary)} to be rejected`);
  }
});

// A bundle that reports no totalTestCount but does report per-outcome counts
// must not read as zero — that would fail a healthy run, and a gate that cries
// wolf gets disabled.
test("per-outcome counts are used when totalTestCount is absent", () => {
  const verdict = evaluate({
    summary: { result: "Passed", passedTests: 684, failedTests: 0, testFailures: [] },
    expectedMinimum: 684,
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.executed, 684);
});

// ── The quarantine registry ────────────────────────────────────────────────

const declarations = (...names) => new Map(names.map((name) => [name, [`${name}.swift`]]));
const entry = (overrides = {}) => ({
  bead: "cave-vz17i",
  reason: "repaired by #4958",
  expires: "2099-01-01",
  ...overrides,
});
const failingSummary = (...names) =>
  passingSummary({
    result: "Failed",
    passedTests: 684 - names.length,
    failedTests: names.length,
    testFailures: names.map((name) => ({ testName: `${name}()` })),
  });

test("a listed failure is deferred rather than fatal", () => {
  const verdict = evaluateSuiteExecution({
    summary: failingSummary("testKnownBroken"),
    expectedMinimum: 684,
    quarantine: new Map([["testKnownBroken", entry()]]),
    declarationsByName: declarations("testKnownBroken"),
    xcodebuildOutcome: "failure",
  });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.problems));
  assert.deepEqual(
    verdict.deferred.map((deferral) => deferral.name),
    ["testKnownBroken"],
  );
});

test("an unlisted failure alongside a deferred one is still fatal", () => {
  const verdict = evaluateSuiteExecution({
    summary: failingSummary("testKnownBroken", "testBrandNewBreakage"),
    expectedMinimum: 684,
    quarantine: new Map([["testKnownBroken", entry()]]),
    declarationsByName: declarations("testKnownBroken", "testBrandNewBreakage"),
    xcodebuildOutcome: "failure",
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => /testBrandNewBreakage/.test(problem)));
});

// The ratchet. Without this an entry outlives its fix and silently suppresses
// the NEXT failure of that test — a suppression nothing about a passing build
// would ever mention.
test("a listed test that now PASSES fails the gate as a stale entry", () => {
  const verdict = evaluateSuiteExecution({
    summary: passingSummary(),
    expectedMinimum: 684,
    quarantine: new Map([["testRepaired", entry()]]),
    declarationsByName: declarations("testRepaired"),
    xcodebuildOutcome: "success",
  });
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.problems.some((problem) => /is STALE[\s\S]*repair has landed/.test(problem)),
    `expected a stale-entry problem, got ${JSON.stringify(verdict.problems)}`,
  );
});

// The bundle reports a bare `testFoo()` with no class attached, so a key that
// matches two declarations defers whichever one happened to fail.
test("an ambiguous key is refused rather than guessed at", () => {
  const verdict = evaluateSuiteExecution({
    summary: failingSummary("testRawValuesAreStable"),
    expectedMinimum: 684,
    quarantine: new Map([["testRawValuesAreStable", entry()]]),
    declarationsByName: new Map([["testRawValuesAreStable", ["A.swift", "B.swift"]]]),
    xcodebuildOutcome: "failure",
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => /is AMBIGUOUS/.test(problem)));
});

test("a key that names no XCTest method in the tree is refused", () => {
  const verdict = evaluateSuiteExecution({
    summary: failingSummary("testRenamedAway"),
    expectedMinimum: 684,
    quarantine: new Map([["testRenamedAway", entry()]]),
    declarationsByName: new Map(),
    xcodebuildOutcome: "failure",
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => /names no XCTest method/.test(problem)));
});

test("the registry cannot be applied at all without a source index", () => {
  const verdict = evaluateSuiteExecution({
    summary: failingSummary("testKnownBroken"),
    expectedMinimum: 684,
    quarantine: new Map([["testKnownBroken", entry()]]),
    declarationsByName: null,
    xcodebuildOutcome: "failure",
  });
  assert.equal(verdict.ok, false, "a registry that cannot be validated must fail closed");
  assert.ok(verdict.problems.some((problem) => /no source index was supplied/.test(problem)));
});

test("an expired entry fails even while the test is still failing", () => {
  const verdict = evaluateSuiteExecution({
    summary: failingSummary("testKnownBroken"),
    expectedMinimum: 684,
    quarantine: new Map([["testKnownBroken", entry({ expires: "2026-01-01" })]]),
    declarationsByName: declarations("testKnownBroken"),
    xcodebuildOutcome: "failure",
    now: new Date("2026-08-24T00:00:00Z"),
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => /EXPIRED on 2026-01-01/.test(problem)));
});

test("an entry missing its bead, reason or expiry is refused", () => {
  for (const field of ["bead", "reason", "expires"]) {
    const broken = entry();
    delete broken[field];
    const problems = validateQuarantine({
      quarantine: new Map([["testKnownBroken", broken]]),
      declarationsByName: declarations("testKnownBroken"),
      failureNames: new Set(["testKnownBroken"]),
    });
    assert.ok(
      problems.some((problem) => new RegExp(`"${field}"`).test(problem)),
      `expected a problem naming ${field}, got ${JSON.stringify(problems)}`,
    );
  }
});

// Deferral is only defensible if every failure can be named. A bundle that
// says "23 failed" and names two leaves 21 unaccounted for.
test("failures that cannot be enumerated are never deferred", () => {
  const verdict = evaluateSuiteExecution({
    summary: passingSummary({
      result: "Failed",
      passedTests: 661,
      failedTests: 23,
      testFailures: [{ testName: "testKnownBroken()" }],
    }),
    expectedMinimum: 684,
    quarantine: new Map([["testKnownBroken", entry()]]),
    declarationsByName: declarations("testKnownBroken"),
    xcodebuildOutcome: "failure",
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => /cannot be enumerated/.test(problem)));
  assert.deepEqual(verdict.deferred, [], "nothing may be deferred out of an unenumerable set");
});

// ── The bundle is cross-checked against the process that produced it ───────
//
// `continue-on-error` on the test step is what allows a fully-deferred run to
// be green. These are what stop that becoming its own silent hole.

test("xcodebuild success with failures in the bundle is a contradiction", () => {
  assert.ok(
    crossCheckXcodebuild({ xcodebuildOutcome: "success", failed: 3, skipped: 0, otherProblems: 0 }).some(
      (problem) => /disagree/.test(problem),
    ),
  );
});

test("xcodebuild failure over a spotless bundle is not a pass", () => {
  assert.ok(
    crossCheckXcodebuild({ xcodebuildOutcome: "failure", failed: 0, skipped: 0, otherProblems: 0 }).some(
      (problem) => /outside the suite/.test(problem),
    ),
  );
});

test("a test step that was skipped or cancelled never reads as a pass", () => {
  for (const outcome of ["skipped", "cancelled", ""]) {
    const problems = crossCheckXcodebuild({ xcodebuildOutcome: outcome, failed: 0, skipped: 0, otherProblems: 0 });
    assert.ok(
      problems.some((problem) => /rather than success or failure/.test(problem)),
      `expected outcome=${JSON.stringify(outcome)} to be refused`,
    );
  }
});

test("xcodebuild failure explained by deferred failures is consistent", () => {
  assert.deepEqual(
    crossCheckXcodebuild({ xcodebuildOutcome: "failure", failed: 23, skipped: 0, otherProblems: 0 }),
    [],
  );
});

// ── Source scanning ────────────────────────────────────────────────────────

test("XCTest methods are counted, helpers and comments are not", () => {
  const source = `
import XCTest

final class ExampleTests: XCTestCase {
    func testOne() {}
    @MainActor
    func testTwo() async throws {}
    // func testCommentedOut() {}
    /*
    func testBlockCommented() {}
    */
    func testHelper(named: String) {}
    func helperTestish() {}
}
`;
  assert.equal(countXCTestMethods(source), 2);
  assert.deepEqual(xctestMethodNames(source), ["testOne", "testTwo"]);
});

test("nested block comments are stripped without eating the code after them", () => {
  const stripped = stripSwiftComments("/* a /* b */ c */ func testKept() {}");
  assert.match(stripped, /func testKept\(\)/);
  assert.equal(countXCTestMethods("/* a /* b */ c */ func testKept() {}"), 1);
});

test("a qualified or parenthesised test name reduces to the registry's key", () => {
  for (const reported of ["testFoo()", "testFoo", "SomeTests/testFoo()", "  testFoo() "]) {
    assert.equal(normalizeTestName(reported), "testFoo", reported);
  }
  assert.equal(normalizeTestName(undefined), "");
});

// The floor is only meaningful if it is read off the real tree. This is the
// link between the pure logic above and the sources CI actually runs.
test("the real CovenCaveTests tree yields a substantial, source-derived floor", () => {
  const { total, perFile } = countXCTestMethodsInDirectory(unitTestsDir, { readDir: readdirSync, readFile: readFileSync });
  assert.ok(total > 100, `expected the iOS unit-test tree to declare many XCTest methods, found ${total}`);
  assert.ok(perFile.size > 10, `expected many Swift files under ${unitTestsDir}, found ${perFile.size}`);
  // The store shipped by #4946 is the concrete suite this bead was filed over;
  // if it ever stops contributing to the floor, the floor stops protecting it.
  const storeTests = [...perFile.entries()].find(([file]) => file.endsWith("FamiliarDashboardStoreTests.swift"));
  assert.ok(storeTests, "FamiliarDashboardStoreTests.swift must be part of the executed suite's floor");
  assert.ok(storeTests[1] > 0, "FamiliarDashboardStoreTests.swift must declare XCTest methods");
});

// ── The registry that actually ships ───────────────────────────────────────
//
// Everything above proves the machinery. This proves the LIST is admissible,
// on every runner, without waiting for a 15-minute macOS job to say so.
test("every shipped quarantine entry is well-formed, unexpired and unambiguous", () => {
  const { byName } = countXCTestMethodsInDirectory(unitTestsDir, { readDir: readdirSync, readFile: readFileSync });
  const problems = validateQuarantine({
    quarantine: QUARANTINED_FAILURES,
    declarationsByName: byName,
    // Pretend every listed test failed, so this case reports ONLY the
    // structural problems — staleness is a property of a CI run, not of the
    // list, and is covered by its own case above.
    failureNames: new Set(QUARANTINED_FAILURES.keys()),
  });
  assert.deepEqual(problems, [], `the shipped quarantine registry is inadmissible:\n${problems.join("\n")}`);
});

test("the ambiguity rule is load-bearing on this tree, not theoretical", () => {
  const { byName } = countXCTestMethodsInDirectory(unitTestsDir, { readDir: readdirSync, readFile: readFileSync });
  const colliding = [...byName.entries()].filter(([, files]) => files.length > 1);
  assert.ok(
    colliding.length > 0,
    "this tree used to declare two XCTest methods with the same name; if that is no longer true the " +
      "ambiguity rule still guards the next collision, but update this case's premise",
  );
  for (const [name] of colliding) {
    assert.ok(
      !QUARANTINED_FAILURES.has(name),
      `${name} is declared in several classes, so it cannot be deferred by bare name`,
    );
  }
});

console.log("ios-xctest-summary.test.mjs: ok");
