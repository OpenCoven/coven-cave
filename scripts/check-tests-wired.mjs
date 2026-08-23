// CI guard: every `*.test.ts` / `*.test.tsx` / `*.test.mjs` under src/ and scripts/ must be
// wired into a CI-run test suite (the SUITES map in scripts/run-tests.mjs,
// which `test:app` / `test:api` / `test:mobile` execute) EXACTLY ONCE, so an
// authored test can neither silently never run nor silently run twice.
// (110 of 243 tests were orphaned this way before #524.) Playwright `*.spec.ts`
// are e2e, run separately and intentionally not in CI — they're excluded here.
//
// Run: `node scripts/check-tests-wired.mjs` (wired as `pnpm check:tests-wired`).

import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUITES, VITEST_TESTS } from "./run-tests.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Tests deliberately NOT wired into the frontend gate. Key = repo-relative
// path, value = the reason (printed in the "allowlisted" summary). Keep this
// short and justified — the whole point of the guard is that orphaning is loud.
const ALLOWLIST = new Map([
  // scripts/release-notes.test.mjs used to live here because it read this
  // checkout's own tags and CHANGELOG; it now seeds a throwaway fixture repo
  // and passes COVEN_RELEASE_NOTES_ROOT, so it runs anywhere (cave-5yyj1).
  // Adding an entry means a test nothing runs — justify it here and expect the
  // justification to be read.
]);

function walk(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc; // dir may not exist
  }
  for (const entry of entries) {
    // "target" and "gen" are src-tauri build-output dirs (huge, gitignored).
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "target" || entry.name === "gen" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.test\.(tsx?|mjs)$/.test(entry.name)) acc.push(path.relative(root, full).split(path.sep).join("/"));
  }
  return acc;
}

const onDisk = [
  ...walk(path.join(root, "src"), []),
  ...walk(path.join(root, "scripts"), []),
  // src-tauri source pins (capability ACLs, release runtime) were invisible to
  // this guard and sat orphaned — never running in any CI suite — for weeks.
  ...walk(path.join(root, "src-tauri"), []),
].sort();

// Where each path is listed. A Set answers "wired at least once"; this answers
// "wired at most once" too — the other half of the same contract. Without it a
// path listed twice simply runs twice, which produces no failure and no visible
// symptom, only a slower suite. That is reachable rather than theoretical: two
// sessions repairing the same unwired-test gap insert the same path at
// different offsets, git merges both cleanly, and the double-run lands silently
// (#4790). Keyed globally rather than per-suite because CI runs app, api,
// mobile and conformance in the same pass, so a path in two suites is also a
// double-run.
const referencedIn = new Map();
for (const [suite, files] of Object.entries(SUITES)) {
  files.forEach((f, index) => {
    if (!referencedIn.has(f)) referencedIn.set(f, []);
    referencedIn.get(f).push(`${suite}[${index}]`);
  });
}
const referenced = new Set(referencedIn.keys());
const duplicated = [...referencedIn.entries()].filter(([, at]) => at.length > 1).sort();
const tsxMissingVitest = [...referenced]
  .filter((f) => f.endsWith(".tsx") && !VITEST_TESTS.has(f))
  .sort();

const unwired = onDisk.filter((f) => !referenced.has(f) && !ALLOWLIST.has(f));
const missing = [...referenced].filter((f) => !onDisk.includes(f)).sort();
const staleAllow = [...ALLOWLIST.keys()].filter((f) => !onDisk.includes(f));

let failed = false;

if (unwired.length) {
  failed = true;
  console.error(`\n✗ ${unwired.length} test file(s) on disk are not wired into any CI test suite (${Object.keys(SUITES).join(", ")}):\n`);
  for (const f of unwired) console.error(`    ${f}`);
  console.error(`\n  Fix: append the file path to the relevant suite array (app/api/mobile) in scripts/run-tests.mjs.`);
  console.error(`  (.mjs tests that need the TS stripper go in STRIP_TYPES_MJS; tests whose import graph reaches the \`@/\` alias go in ALIAS_LOADER.)`);
  console.error(`  If it genuinely can't run in CI, add it to ALLOWLIST in scripts/check-tests-wired.mjs with a reason.\n`);
}

if (duplicated.length) {
  failed = true;
  console.error(`\n✗ ${duplicated.length} test file(s) are listed more than once in scripts/run-tests.mjs, so CI runs them more than once:\n`);
  for (const [f, at] of duplicated) console.error(`    ${f}  (${at.join(", ")})`);
  console.error(`\n  Fix: delete the extra entr(y/ies) from the suite array(s) in scripts/run-tests.mjs, keeping exactly one.\n`);
}

if (tsxMissingVitest.length) {
  failed = true;
  console.error(`\n✗ ${tsxMissingVitest.length} *.tsx test file(s) are wired into CI but not routed through VITEST_TESTS in scripts/run-tests.mjs:\n`);
  for (const f of tsxMissingVitest) console.error(`    ${f}`);
  console.error(`\n  Fix: add the file path to VITEST_TESTS in scripts/run-tests.mjs so pnpm test:app runs it through Vitest instead of Node.\n`);
}

if (missing.length) {
  failed = true;
  console.error(`\n✗ ${missing.length} test file(s) are listed in scripts/run-tests.mjs but don't exist on disk:\n`);
  for (const f of missing) console.error(`    ${f}`);
  console.error(`\n  Fix: remove the stale entry from the suite array in scripts/run-tests.mjs (or restore the file).\n`);
}

if (staleAllow.length) {
  failed = true;
  console.error(`\n✗ ${staleAllow.length} ALLOWLIST entr(y/ies) point at a file that no longer exists:\n`);
  for (const f of staleAllow) console.error(`    ${f}`);
  console.error(`\n  Fix: drop the stale entry from ALLOWLIST in scripts/check-tests-wired.mjs.\n`);
}

if (failed) process.exit(1);

const allow = [...ALLOWLIST.keys()];
console.log(
  `✓ all ${onDisk.length} test files wired into CI` +
    (allow.length ? ` (${allow.length} allowlisted: ${allow.join(", ")})` : ""),
);
