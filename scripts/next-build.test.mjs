import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { BUILD_GATE_EXIT_CODE } from "./build-gate-exit.mjs";
import { finishBuild, instrumentationLeakReport, nodeEnvOverrideNotice, productionBuildEnv } from "./next-build.mjs";

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
