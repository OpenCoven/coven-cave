// `next build` that always builds for production (#5701).
//
// Next prerenders /_global-error with the React build NODE_ENV selects. A
// shell that inherited NODE_ENV=development — every terminal and agent session
// the Cave dev server spawns does — made the production build load the
// development React and fail with "Cannot read properties of null (reading
// 'useContext')" while CI, with NODE_ENV unset, stayed green. A build is a
// production build, so this pins NODE_ENV and says so when it overrides one.

import { BUILD_GATE_EXIT_CODE } from "./build-gate-exit.mjs";
import { applyInstrumentationTraceExclusions, instrumentationTraceLeaks } from "./instrumentation-trace.mjs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/** The environment `next build` runs with: always NODE_ENV=production. */
export function productionBuildEnv(env) {
  return { ...env, NODE_ENV: "production" };
}

/** The one-line notice for an overridden NODE_ENV, or null when none applies. */
export function nodeEnvOverrideNotice(env) {
  const current = env.NODE_ENV;
  if (current === undefined || current === "" || current === "production") return null;
  return `next-build: NODE_ENV=${current} is ignored; building with NODE_ENV=production (#5701).`;
}

/** The failure for an instrumentation trace that globs excluded checkout files (#6082). */
export function instrumentationLeakReport(leaks, shown = 20) {
  const lines = [
    `next-build: the instrumentation trace lists ${leaks.length} checkout file(s) that outputFileTracingExcludes covers (#6082).`,
    "Turbopack copies every traced file into .next/standalone before those exclusions are applied, so the build reads",
    "them from the live checkout, and a git repack or Xcode build that deletes one mid-copy fails it. A runtime-derived",
    "path in the instrumentation graph is globbing the checkout: mark the path.join/path.resolve call that builds it",
    "with /* turbopackIgnore: true */ (see scripts/turbopack-runtime-boundaries.test.mjs).",
    ...leaks.slice(0, shown).map(file => `  ${file}`),
  ];
  if (leaks.length > shown) lines.push(`  …and ${leaks.length - shown} more`);
  return lines.join("\n");
}

/**
 * Post-build pass: read the raw trace's leaks, then apply the exclusions. Returns the exit
 * status: a leak is a deterministic build-gate failure, so CI's build retry stops on it (#6087).
 */
export async function finishBuild(root, { error = console.error } = {}) {
  const leaks = await instrumentationTraceLeaks(root);
  await applyInstrumentationTraceExclusions(root);
  if (leaks.length === 0) return 0;
  error(instrumentationLeakReport(leaks));
  return BUILD_GATE_EXIT_CODE;
}

async function main() {
  const notice = nodeEnvOverrideNotice(process.env);
  if (notice) console.warn(notice);
  const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const result = spawnSync(process.execPath, [nextBin, "build", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: productionBuildEnv(process.env),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  process.exit(await finishBuild(process.cwd()));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
