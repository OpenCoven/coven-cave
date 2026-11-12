import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { BUILD_GATE_EXIT_CODE } from "./build-gate-exit.mjs";
import {
  armTraceWalkProbe,
  checkedBuildEnv,
  clearStaleTraceWalkProbe,
  finishBuild,
  instrumentationLeakReport,
  nextTypecheckArgs,
  nodeEnvOverrideNotice,
  productionBuildEnv,
  TRACE_WALK_PROBE,
  traceWalkFailure,
  traceWalkProbeEnabled,
  traceWalkReport,
  TYPECHECKED_BEFORE_COMPILE,
  typescriptCompilerPath,
} from "./next-build.mjs";

test("the build always runs with NODE_ENV=production (#5701)", () => {
  assert.equal(productionBuildEnv({ NODE_ENV: "development", PATH: "/bin" }).NODE_ENV, "production");
  assert.equal(productionBuildEnv({}).NODE_ENV, "production");
  assert.equal(productionBuildEnv({ PATH: "/bin" }).PATH, "/bin", "the rest of the environment passes through");
});

test("an overridden NODE_ENV is named; production or unset is silent", () => {
  assert.match(nodeEnvOverrideNotice({ NODE_ENV: "development" }), /NODE_ENV=development is ignored/);
  assert.equal(nodeEnvOverrideNotice({ NODE_ENV: "production" }), null);
  assert.equal(nodeEnvOverrideNotice({}), null);
  assert.equal(nodeEnvOverrideNotice({ NODE_ENV: "" }), null);
});

test("pnpm build goes through the wrapper", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts.build, /^node scripts\/next-build\.mjs && pnpm build:server$/);
});

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

test("the pre-compile check passes tsc the arguments Next's CLI checker does (#6036)", () => {
  // If a Next upgrade changes its invocation, this fails instead of the two checks drifting apart.
  const cli = readFileSync(path.join(repoRoot, "node_modules/next/dist/lib/typescript/runTypeCheckCli.js"), "utf8");
  assert.match(cli, /const args = \[\s*'--project',\s*tsConfigPath,\s*'--noEmit',\s*'--declarationMap',\s*'false',\s*'--emitDeclarationOnly',\s*'false'\s*\];/);
  assert.match(cli, /args\.push\('--tsBuildInfoFile', _nodepath\.default\.join\(cacheDir, '\.tsbuildinfo'\)\)/);
  assert.match(cli, /Boolean\(configuration\.compilerOptions\.incremental \|\| configuration\.compilerOptions\.composite\)/);
  const checker = readFileSync(path.join(repoRoot, "node_modules/next/dist/build/type-check.js"), "utf8");
  assert.match(checker, /const ignoreTypeScriptErrors = Boolean\(config\.typescript\.ignoreBuildErrors\);/,
    "Next still keys its own pass on ignoreBuildErrors");
  assert.deepEqual(nextTypecheckArgs("/repo", true), [
    "--project", "/repo/tsconfig.json", "--noEmit", "--declarationMap", "false", "--emitDeclarationOnly", "false",
    "--tsBuildInfoFile", "/repo/.next/cache/.tsbuildinfo",
  ]);
  assert.deepEqual(nextTypecheckArgs("/repo", false).slice(-2), ["--emitDeclarationOnly", "false"],
    "a non-incremental project gets no build info file");
  assert.match(typescriptCompilerPath(repoRoot), /[/\\]typescript[/\\]bin[/\\]tsc$/, "the compiler is typescript's bin.tsc");
});

function fakeRun(statuses, config = { compilerOptions: { incremental: true } }) {
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    const status = statuses[calls.length - 1] ?? 0;
    return { status, stdout: args.includes("--showConfig") ? JSON.stringify(config) : "" };
  };
  return { calls, run };
}

test("a build is type-checked before compiling, then marked so Next skips its repeat (#6036)", () => {
  const { calls, run } = fakeRun([0, 0, 0]);
  const logs = [];
  const env = checkedBuildEnv("/next/bin", repoRoot, { NODE_ENV: "production", NODE_OPTIONS: "--max-old-space-size=4096" },
    { run, log: (line) => logs.push(line), now: (() => { let t = 0; return () => (t += 50_000); })() });
  assert.equal(env[TYPECHECKED_BEFORE_COMPILE], "1");
  assert.equal(env.NODE_OPTIONS, "--max-old-space-size=4096", "tsc inherits the build's heap, as under Next");
  const tsc = typescriptCompilerPath(repoRoot);
  assert.deepEqual(calls.map(({ args }) => args), [
    ["/next/bin", "typegen"],
    [tsc, "--showConfig", "--project", path.join(repoRoot, "tsconfig.json"), "--pretty", "false"],
    [tsc, ...nextTypecheckArgs(repoRoot, true)],
  ]);
  for (const call of calls) {
    assert.equal(call.command, process.execPath);
    assert.equal(call.options.cwd, repoRoot);
    assert.equal(call.options.env[TYPECHECKED_BEFORE_COMPILE], undefined, "the marker is set only after the check");
  }
  assert.deepEqual(logs, ["next-build: Running TypeScript before compiling (#6036) ...", "next-build: Finished TypeScript in 50.0s"]);
});

test("a failed typegen, config read or type check stops the build before compiling", () => {
  for (const [statuses, ran] of [[[1], 1], [[0, 1], 2], [[0, 0, 2], 3]]) {
    const { calls, run } = fakeRun(statuses);
    assert.equal(checkedBuildEnv("/next/bin", repoRoot, {}, { run, log() {} }), null);
    assert.equal(calls.length, ran);
  }
});

test("a non-incremental project is checked without a build info file", () => {
  const { calls, run } = fakeRun([0, 0, 0], { compilerOptions: {} });
  checkedBuildEnv("/next/bin", repoRoot, {}, { run, log() {} });
  assert.deepEqual(calls[2].args.slice(1), nextTypecheckArgs(repoRoot, false));
});

test("a fixture build that opts out of type checking skips both passes", () => {
  const { calls, run } = fakeRun([]);
  const env = { COVEN_CAVE_SKIP_BUILD_TYPECHECK: "1" };
  assert.equal(checkedBuildEnv("/next/bin", repoRoot, env, { run, log() {} }), env);
  assert.equal(calls.length, 0);
});

test("only the build wrapper sets the already-checked marker", () => {
  const allowed = new Set(["next.config.ts", "scripts/next-build.mjs", "scripts/next-build.test.mjs", "scripts/ios-build-ci.test.mjs"]);
  const offenders = [];
  for (const dir of [".github", "scripts", "src", "tests", "src-tauri"]) {
    let entries;
    try {
      entries = readdirSync(path.join(repoRoot, dir), { recursive: true, withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const file = path.relative(repoRoot, path.join(entry.parentPath, entry.name));
      if (/(^|[/\\])(node_modules|target|gen)([/\\]|$)/.test(file) || !/\.(m?[jt]sx?|cjs|ya?ml|sh|py|rs)$/.test(file)) continue;
      if (!allowed.has(file) && readFileSync(path.join(repoRoot, file), "utf8").includes(TYPECHECKED_BEFORE_COMPILE)) offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], "no workflow or script may skip Next's pass by setting the marker itself");
});

async function buildFixture(t, traceFiles) {
  const root = await mkdtemp(path.join(tmpdir(), "cave-next-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (name, value) => {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
  };
  await write(".next/required-server-files.json", { config: { outputFileTracingExcludes: { "*": ["./.git/**/*", "./src/**/*"] } } });
  await write(".next/server/instrumentation.js.nft.json", { version: 1, files: traceFiles });
  for (const file of traceFiles) await write(path.join(".next/standalone", path.relative("../..", file)), "x");
  return root;
}

test("a clean instrumentation trace finishes the build (#6082)", async t => {
  const root = await buildFixture(t, ["../../marketplace/payloads.json"]);
  const errors = [];
  assert.equal(await finishBuild(root, { error: message => errors.push(message) }), 0);
  assert.deepEqual(errors, []);
});

test("excluded checkout files in the raw trace fail the build after the exclusion pass (#6082)", async t => {
  const root = await buildFixture(t, ["../../.git/objects/pack/pack-1.idx", "../../src/app/api/config/route.ts", "../../marketplace/payloads.json"]);
  const errors = [];
  // The build-gate status, so CI's flake retry stops instead of rebuilding (#6087).
  assert.equal(await finishBuild(root, { error: message => errors.push(message) }), BUILD_GATE_EXIT_CODE);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /lists 2 checkout file\(s\) that outputFileTracingExcludes covers \(#6082\)/);
  assert.match(errors[0], /^  \.git\/objects\/pack\/pack-1\.idx$/m);
  assert.match(errors[0], /^  src\/app\/api\/config\/route\.ts$/m);
  assert.match(errors[0], /turbopackIgnore: true/);
  // The exclusion pass still ran, so a failed build leaves no excluded copies behind.
  await assert.rejects(access(path.join(root, ".next/standalone/.git")));
  await access(path.join(root, ".next/standalone/marketplace/payloads.json"));
  const trace = JSON.parse(await readFile(path.join(root, ".next/server/instrumentation.js.nft.json"), "utf8"));
  assert.deepEqual(trace.files, ["../../marketplace/payloads.json"]);
});

test("the leak report caps the listing", () => {
  const leaks = Array.from({ length: 23 }, (_, i) => `src/f${i}.ts`);
  const report = instrumentationLeakReport(leaks);
  assert.match(report, /^  src\/f19\.ts$/m);
  assert.doesNotMatch(report, /^  src\/f20\.ts$/m);
  assert.match(report, /…and 3 more$/);
});

test("the trace-walk probe runs under POSIX CI or on request, never on Windows (#6101)", () => {
  assert.equal(traceWalkProbeEnabled({ CI: "true" }, "linux"), true);
  assert.equal(traceWalkProbeEnabled({ CI: "true" }, "darwin"), true);
  assert.equal(traceWalkProbeEnabled({ CI: "true" }, "win32"), false, "chmod 000 does not stop reads on Windows");
  assert.equal(traceWalkProbeEnabled({}, "darwin"), false, "a local build is unchanged by default");
  assert.equal(traceWalkProbeEnabled({ COVEN_TRACE_WALK_PROBE: "1" }, "darwin"), true);
  assert.equal(traceWalkProbeEnabled({ CI: "true", COVEN_TRACE_WALK_PROBE: "0" }, "linux"), false);
});

test("the probe is an empty, unreadable root folder that is removed afterwards", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-trace-probe-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const probe = path.join(root, TRACE_WALK_PROBE);
  const disarm = armTraceWalkProbe(root);
  await assert.rejects(readdir(probe), { code: "EACCES" });
  disarm();
  await assert.rejects(access(probe), { code: "ENOENT" });

  // A leftover from a killed build is replaced; one with contents stops the build.
  await mkdir(probe);
  armTraceWalkProbe(root)();
  await mkdir(probe);
  await writeFile(path.join(probe, "kept"), "x");
  assert.throws(() => armTraceWalkProbe(root), { code: "ENOTEMPTY" });
});

test("a probed build failure names the walking module or endpoint", () => {
  const root = "/repo";
  const moduleWalk = [
    "Error [TurbopackInternalError]: [project]/src/lib/server/journal-store.ts [app-route] (ecmascript)",
    "Caused by:",
    `- reading dir "/repo/${TRACE_WALK_PROBE}"`,
    "- Permission denied (os error 13)",
  ].join("\n");
  assert.deepEqual(traceWalkFailure(moduleWalk, root), { module: "src/lib/server/journal-store.ts [app-route]", endpoint: null });
  assert.match(traceWalkReport(traceWalkFailure(moduleWalk, root)), /in src\/lib\/server\/journal-store\.ts \[app-route\] \(#6101\)/);

  const endpointWalk = `Failed to write app endpoint /page\n- reading dir "/repo/${TRACE_WALK_PROBE}"`;
  assert.deepEqual(traceWalkFailure(endpointWalk, root), { module: null, endpoint: "/page" });
  assert.match(traceWalkReport(traceWalkFailure(endpointWalk, root)), /tracing the \/page endpoint/);

  assert.equal(traceWalkFailure("Error: Turbopack build failed with 1 error", root), null, "other failures pass through");
  assert.equal(traceWalkFailure('- reading dir "/elsewhere/trace-walk-probe"', root), null);
});

test("a probe folder left by an interrupted build is cleared before the next one", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-trace-stale-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const probe = path.join(root, TRACE_WALK_PROBE);
  assert.equal(clearStaleTraceWalkProbe(root), false, "nothing to clear");
  await mkdir(probe, { mode: 0o000 });
  assert.equal(clearStaleTraceWalkProbe(root), true);
  await assert.rejects(access(probe), { code: "ENOENT" });

  await mkdir(probe);
  await writeFile(path.join(probe, "kept"), "x");
  await import("node:fs/promises").then(({ chmod }) => chmod(probe, 0o000));
  assert.throws(() => clearStaleTraceWalkProbe(root), { code: "ENOTEMPTY" });
  assert.deepEqual(await readdir(probe), ["kept"], "a folder with contents is made readable, never emptied");
});

const ARM_IN_CHILD = (root, then) => `
  const { armTraceWalkProbe } = await import(${JSON.stringify(new URL("./next-build.mjs", import.meta.url).href)});
  armTraceWalkProbe(${JSON.stringify(root)});
  ${then}
`;

test("the probe is removed when the wrapper crashes", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-trace-crash-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", ARM_IN_CHILD(root, 'throw new Error("ENOSPC writing stdout");')], { encoding: "utf8" });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /ENOSPC writing stdout/);
  await assert.rejects(access(path.join(root, TRACE_WALK_PROBE)), { code: "ENOENT" });
});

test("the probe is removed when the wrapper is terminated", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-trace-term-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, ["--input-type=module", "-e", ARM_IN_CHILD(root, 'console.log("armed"); setInterval(() => {}, 1000);')]);
  await new Promise((resolve) => child.stdout.once("data", resolve));
  await assert.rejects(readdir(path.join(root, TRACE_WALK_PROBE)), { code: "EACCES" });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve(signal)));
  child.kill("SIGTERM");
  assert.equal(await exited, "SIGTERM", "the signal still ends the process");
  await assert.rejects(access(path.join(root, TRACE_WALK_PROBE)), { code: "ENOENT" });
});
