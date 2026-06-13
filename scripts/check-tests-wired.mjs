// CI guard: every `*.test.ts` / `*.test.mjs` under src/ and scripts/ must be
// wired into a CI-run test script (test:app / test:api / test:mobile), so an
// authored test can't silently never run. (110 of 243 tests were orphaned this
// way before #524.) Playwright `*.spec.ts` are e2e, run separately and
// intentionally not in CI — they're excluded here.
//
// Run: `node scripts/check-tests-wired.mjs` (wired as `pnpm check:tests-wired`).

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The npm scripts CI actually executes (see .github/workflows/ci.yml).
const CI_TEST_SCRIPTS = ["test:app", "test:api", "test:mobile"];

// Tests deliberately NOT wired into the frontend gate. Key = repo-relative
// path, value = the reason (printed in the "allowlisted" summary). Keep this
// short and justified — the whole point of the guard is that orphaning is loud.
const ALLOWLIST = new Map([
  [
    "scripts/release-notes.test.mjs",
    "needs live git history/tags; absent in CI's shallow checkout (runs in the release workflow)",
  ],
]);

function walk(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc; // dir may not exist
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.test\.(ts|mjs)$/.test(entry.name)) acc.push(path.relative(root, full).split(path.sep).join("/"));
  }
  return acc;
}

const onDisk = [...walk(path.join(root, "src"), []), ...walk(path.join(root, "scripts"), [])].sort();

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const referenced = new Set();
for (const name of CI_TEST_SCRIPTS) {
  const script = pkg.scripts?.[name] ?? "";
  for (const m of script.matchAll(/(?:src|scripts)\/[A-Za-z0-9_./[\]-]+\.test\.(?:ts|mjs)/g)) {
    referenced.add(m[0]);
  }
}

const unwired = onDisk.filter((f) => !referenced.has(f) && !ALLOWLIST.has(f));
const missing = [...referenced].filter((f) => !onDisk.includes(f)).sort();
const staleAllow = [...ALLOWLIST.keys()].filter((f) => !onDisk.includes(f));

let failed = false;

if (unwired.length) {
  failed = true;
  console.error(`\n✗ ${unwired.length} test file(s) on disk are not wired into any CI test script (${CI_TEST_SCRIPTS.join(", ")}):\n`);
  for (const f of unwired) console.error(`    ${f}`);
  console.error(`\n  Fix: append \`&& node --experimental-strip-types <file>\` to the relevant script in package.json`);
  console.error(`  (add \`--import ./scripts/test-alias-register.mjs\` if the test's module graph imports the \`@/\` alias).`);
  console.error(`  If it genuinely can't run in CI, add it to ALLOWLIST in scripts/check-tests-wired.mjs with a reason.\n`);
}

if (missing.length) {
  failed = true;
  console.error(`\n✗ ${missing.length} test file(s) are referenced in package.json but don't exist on disk:\n`);
  for (const f of missing) console.error(`    ${f}`);
  console.error(`\n  Fix: remove the stale reference from package.json (or restore the file).\n`);
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
