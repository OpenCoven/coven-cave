import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { applyInstrumentationTraceExclusions } from "./instrumentation-trace.mjs";

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
