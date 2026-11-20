import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { applyInstrumentationTraceExclusions, instrumentationTraceLeaks } from "./instrumentation-trace.mjs";

test("applies configured exclusions only and preserves other traces' dependencies", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-trace-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (name, value) => {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
  };
  await write(".next/required-server-files.json", { config: { outputFileTracingExcludes: { "*": ["./src-tauri/**/*", "./src/**/*"] } } });
  await write(".next/server/instrumentation.js.nft.json", { version: 1, files: ["../../src-tauri/tauri.conf.json", "../../src/required.json", "../../public/keep.json", "../../../outside.json"] });
  await write(".next/server/another.js.nft.json", { version: 1, files: ["../../src/required.json"] });
  await write(".next/standalone/src-tauri/tauri.conf.json", "{}");
  await write(".next/standalone/src/required.json", "{}");
  await write(".next/standalone/public/keep.json", "{}");
  assert.equal(await applyInstrumentationTraceExclusions(root), 1);
  await assert.rejects(access(path.join(root, ".next/standalone/src-tauri")));
  await access(path.join(root, ".next/standalone/src/required.json"));
  await access(path.join(root, ".next/standalone/public/keep.json"));
  assert.deepEqual(JSON.parse(await readFile(path.join(root, ".next/server/instrumentation.js.nft.json"), "utf8")).files, ["../../public/keep.json", "../../../outside.json"]);
  assert.equal(await applyInstrumentationTraceExclusions(root), 0);
});

test("does nothing when there is no instrumentation trace", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-trace-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await applyInstrumentationTraceExclusions(root), 0);
});

test("lists the raw trace's excluded checkout files, a worktree's .git file included (#6082)", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-trace-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (name, value) => {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
  };
  await write(".next/required-server-files.json", { config: { outputFileTracingExcludes: { "*": ["./.git", "./.git/**/*", "./src/**/*", "./apps/ios/**/build*/**/*"] } } });
  await write(".next/server/instrumentation.js.nft.json", { version: 1, files: [
    "../../src/app/api/config/route.ts",
    "../../.git",
    "../../.git/objects/pack/pack-1.idx",
    "../../apps/ios/CovenCave/build/XCBuildData/build.json",
    "../../marketplace/payloads.json",
    "../../node_modules/next/package.json",
    "../../../outside.json",
  ] });
  assert.deepEqual(await instrumentationTraceLeaks(root), [
    ".git",
    ".git/objects/pack/pack-1.idx",
    "apps/ios/CovenCave/build/XCBuildData/build.json",
    "src/app/api/config/route.ts",
  ]);
});

test("reports no leaks without an instrumentation trace or without exclusions", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-trace-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await instrumentationTraceLeaks(root), []);
  await mkdir(path.join(root, ".next/server"), { recursive: true });
  await writeFile(path.join(root, ".next/required-server-files.json"), JSON.stringify({ config: {} }));
  await writeFile(path.join(root, ".next/server/instrumentation.js.nft.json"), JSON.stringify({ version: 1, files: ["../../src/a.ts"] }));
  assert.deepEqual(await instrumentationTraceLeaks(root), []);
});
