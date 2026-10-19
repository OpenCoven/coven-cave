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
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * An empty, unreadable folder at the project root while `next build` runs (#6101). A runtime
 * path join, a template path handed to an fs call, or a readdir on a runtime folder makes
 * Turbopack read every non-dot folder under the root while it traces. The excludes keep the
 * matches out of .next/standalone, so nothing else notices the walk; it only costs build time
 * until one interrupted readdir under load panics the build (#6093). With this folder present
 * a walk panics deterministically instead, naming the module that caused it.
 */
export const TRACE_WALK_PROBE = "trace-walk-probe";

/** On under POSIX CI, or when COVEN_TRACE_WALK_PROBE=1; COVEN_TRACE_WALK_PROBE=0 turns it off. */
export function traceWalkProbeEnabled(env, platform = process.platform) {
  if (env.COVEN_TRACE_WALK_PROBE === "1") return platform !== "win32";
  if (env.COVEN_TRACE_WALK_PROBE === "0") return false;
  return env.CI === "true" && platform !== "win32";
}

/** Creates the probe folder (mode 000); returns a function that removes it. */
export function armTraceWalkProbe(root) {
  const probe = path.join(root, TRACE_WALK_PROBE);
  if (existsSync(probe)) {
    chmodSync(probe, 0o755);
    rmdirSync(probe); // fails, and so stops the build, if anything was put inside it
  }
  mkdirSync(probe);
  chmodSync(probe, 0o000);
  return () => {
    if (!existsSync(probe)) return;
    chmodSync(probe, 0o755);
    rmdirSync(probe);
  };
}

/**
 * The walk a probed build died on, or null. Turbopack reports a module reference as
 * `[project]/src/... [layer] (ecmascript)` and a route trace as `Failed to write app endpoint /x`.
 */
export function traceWalkFailure(output, root) {
  const probe = path.join(root, TRACE_WALK_PROBE);
  if (!output.includes(`reading dir "${probe}"`)) return null;
  const plain = output.replace(/\x1b\[[0-9;]*m/g, "");
  const module = plain.match(/\[project\]\/(\S+) \[([\w-]+)\]/);
  const endpoint = plain.match(/Failed to write (?:app|page) endpoint (\S+)/);
  return { module: module ? `${module[1]} [${module[2]}]` : null, endpoint: endpoint?.[1] ?? null };
}

/** The failure for a build whose tracer walked the checkout root (#6101). */
export function traceWalkReport(walk) {
  const where = walk.module
    ? `while resolving a reference in ${walk.module}`
    : `while tracing the ${walk.endpoint ?? "unknown"} endpoint`;
  return [
    `next-build: Turbopack read the checkout root ${where} (#6101).`,
    `The build ran with an unreadable ${TRACE_WALK_PROBE}/ at the root, so any root walk fails here instead of`,
    "costing every build a scan of node_modules and the checkout. In that module, mark the path.join/path.resolve",
    "built from a runtime value, the fs call that takes a template path, or the readdir of a runtime folder with",
    "/* turbopackIgnore: true */ (see scripts/turbopack-runtime-boundaries.test.mjs). An endpoint-level walk",
    "comes from next.config.ts, such as an outputFileTracingIncludes glob.",
  ].join("\n");
}

/** Runs `next build`, mirroring its output while keeping a copy to read a probe failure from. */
function runNextBuild(nextBin, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [nextBin, "build", ...args], { stdio: ["inherit", "pipe", "pipe"], env });
    let output = "";
    for (const [stream, sink] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      stream.on("data", (chunk) => {
        sink.write(chunk);
        output += chunk;
      });
    }
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, output }));
  });
}

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
  const root = process.cwd();
  const env = productionBuildEnv(process.env);
  if (!traceWalkProbeEnabled(process.env)) {
    const result = spawnSync(process.execPath, [nextBin, "build", ...process.argv.slice(2)], { stdio: "inherit", env });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
    process.exit(await finishBuild(root));
  }
  const disarm = armTraceWalkProbe(root);
  let result;
  try {
    result = await runNextBuild(nextBin, process.argv.slice(2), env);
  } finally {
    disarm();
  }
  if (result.status !== 0) {
    const walk = traceWalkFailure(result.output, root);
    if (walk) {
      console.error(traceWalkReport(walk));
      process.exit(BUILD_GATE_EXIT_CODE);
    }
    process.exit(result.status ?? 1);
  }
  process.exit(await finishBuild(root));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
