import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { BUILD_GATE_EXIT_CODE } from "./build-gate-exit.mjs";
import {
  armTraceWalkProbe,
  finishBuild,
  instrumentationLeakReport,
  nodeEnvOverrideNotice,
  productionBuildEnv,
  TRACE_WALK_PROBE,
  traceWalkFailure,
  traceWalkProbeEnabled,
  traceWalkReport,
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
