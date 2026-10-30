// `next build` that always builds for production (#5701).
//
// Next prerenders /_global-error with the React build NODE_ENV selects. A
// shell that inherited NODE_ENV=development — every terminal and agent session
// the Cave dev server spawns does — made the production build load the
// development React and fail with "Cannot read properties of null (reading
// 'useContext')" while CI, with NODE_ENV unset, stayed green. A build is a
// production build, so this pins NODE_ENV and says so when it overrides one.
//
// It also runs Next's TypeScript pass before compiling rather than after
// (#6036): see typecheckBeforeCompile.

import { BUILD_GATE_EXIT_CODE } from "./build-gate-exit.mjs";
import { applyInstrumentationTraceExclusions, instrumentationTraceLeaks } from "./instrumentation-trace.mjs";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmdirSync } from "node:fs";
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

/**
 * Removes a probe folder an interrupted build left behind, and says whether there was one. A
 * leftover would make every later build or dev server panic on any walk. It is made readable
 * first, so even a folder someone put files in (rmdir then fails and stops the build) no
 * longer breaks tracing.
 */
export function clearStaleTraceWalkProbe(root) {
  const probe = path.join(root, TRACE_WALK_PROBE);
  if (!existsSync(probe)) return false;
  chmodSync(probe, 0o755);
  rmdirSync(probe);
  return true;
}

/**
 * Creates the probe folder (mode 000) and returns a function that removes it. The folder is
 * also removed when the process exits for any reason, uncaught exceptions included (a write to
 * a full disk once crashed the wrapper mid-build), and on SIGINT or SIGTERM.
 */
export function armTraceWalkProbe(root, proc = process) {
  const probe = path.join(root, TRACE_WALK_PROBE);
  clearStaleTraceWalkProbe(root);
  mkdirSync(probe);
  chmodSync(probe, 0o000);
  const onSignal = (signal) => {
    disarm();
    proc.kill(proc.pid, signal);
  };
  function disarm() {
    proc.off("exit", disarm);
    proc.off("SIGINT", onSignal);
    proc.off("SIGTERM", onSignal);
    clearStaleTraceWalkProbe(root);
  }
  proc.on("exit", disarm);
  proc.once("SIGINT", onSignal);
  proc.once("SIGTERM", onSignal);
  return disarm;
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

/**
 * Set on the `next build` that follows a passing typecheckBeforeCompile, and nowhere else.
 * next.config.ts then skips Next's own TypeScript pass for that build only.
 */
export const TYPECHECKED_BEFORE_COMPILE = "COVEN_CAVE_TYPECHECKED_BEFORE_COMPILE";

/** The arguments Next 16.3's CLI checker passes to `tsc` (next/dist/lib/typescript/runTypeCheckCli.js). */
export function nextTypecheckArgs(root, incremental) {
  const args = ["--project", path.join(root, "tsconfig.json"), "--noEmit", "--declarationMap", "false", "--emitDeclarationOnly", "false"];
  if (incremental) args.push("--tsBuildInfoFile", path.join(root, ".next", "cache", ".tsbuildinfo"));
  return args;
}

/** The `tsc` entry Next runs: the typescript package's `bin.tsc`, resolved from the project. */
export function typescriptCompilerPath(root) {
  const manifestPath = createRequire(path.join(root, "package.json")).resolve("typescript/package.json");
  const bin = JSON.parse(readFileSync(manifestPath, "utf8")).bin;
  return path.resolve(path.dirname(manifestPath), typeof bin === "string" ? bin : bin.tsc);
}

/**
 * Next's own TypeScript pass, run before compiling instead of inside `next build` (#6036).
 *
 * Next checks types after compiling, in a `tsc` child, while the process that compiled still
 * holds Turbopack's module graph (5.7 GB resident in a local build) and its Node loader pool
 * (about 400 MB per process). Neither is released until `next build` exits; awaiting Turbopack's
 * shutdown first frees nothing. On the 7 GiB macos-15 runner the checker then pages, and a pass
 * that takes under 2 minutes on its own took 17 to 35. `next typegen` writes the `.next/types`
 * the build writes, so `tsc` with Next's arguments checks the same program in a process tree
 * that holds nothing else. A failing check stops before compiling, with Next's exit status 1.
 */
export function typecheckBeforeCompile(nextBin, root, env, { run = spawnSync, log = console.log, now = () => performance.now() } = {}) {
  log("next-build: Running TypeScript before compiling (#6036) ...");
  const started = now();
  const step = (args, options = { stdio: "inherit" }) => {
    const result = run(process.execPath, args, { ...options, cwd: root, env });
    if (result.error) throw result.error;
    return result;
  };
  if (step([nextBin, "typegen"]).status !== 0) return 1;
  const tsc = typescriptCompilerPath(root);
  const shown = step([tsc, "--showConfig", "--project", path.join(root, "tsconfig.json"), "--pretty", "false"], { encoding: "utf8" });
  if (shown.status !== 0) return 1;
  const { compilerOptions = {} } = JSON.parse(shown.stdout);
  const incremental = Boolean(compilerOptions.incremental || compilerOptions.composite);
  if (step([tsc, ...nextTypecheckArgs(root, incremental)]).status !== 0) return 1;
  log(`next-build: Finished TypeScript in ${((now() - started) / 1000).toFixed(1)}s`);
  return 0;
}

/**
 * The environment for `next build`: unchanged for a fixture build that skips type checking
 * (COVEN_CAVE_SKIP_BUILD_TYPECHECK=1), otherwise marked as checked once the pass above succeeds.
 * Returns null when the check failed and the build must stop.
 */
export function checkedBuildEnv(nextBin, root, env, options) {
  if (env.COVEN_CAVE_SKIP_BUILD_TYPECHECK === "1") return env;
  if (typecheckBeforeCompile(nextBin, root, env, options) !== 0) return null;
  return { ...env, [TYPECHECKED_BEFORE_COMPILE]: "1" };
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
  const env = checkedBuildEnv(nextBin, root, productionBuildEnv(process.env));
  if (env === null) process.exit(1);
  if (!traceWalkProbeEnabled(process.env)) {
    if (clearStaleTraceWalkProbe(root)) {
      console.warn(`next-build: removed a ${TRACE_WALK_PROBE}/ left by an interrupted probed build (#6101).`);
    }
    const result = spawnSync(process.execPath, [nextBin, "build", ...process.argv.slice(2)], { stdio: "inherit", env });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
    process.exit(await finishBuild(root));
  }
  const disarm = armTraceWalkProbe(root);
  console.log(`next-build: trace-walk probe armed at ${TRACE_WALK_PROBE}/ (#6101)`);
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
