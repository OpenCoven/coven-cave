// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const home = await mkdtemp(path.join(os.tmpdir(), "submissions-retained-"));
process.env.COVEN_HOME = home;
const {
  deleteRetainedSubmissions,
  exportRetainedSubmissions,
  submissionsStorePath,
  summarizeRetainedSubmissions,
} = await import("./opencoven-submissions-retained.ts");

test.after(() => rm(home, { recursive: true, force: true }));

test("the store sits under the synthetic home", () => {
  assert.equal(path.dirname(submissionsStorePath()), home);
});

test("no file reads as nothing saved", async () => {
  assert.deepEqual(await summarizeRetainedSubmissions(), { exists: false, count: 0 });
  assert.equal(await exportRetainedSubmissions(), null);
  assert.equal(await deleteRetainedSubmissions(), false);
});

test("a saved file is counted and exports byte for byte", async () => {
  const raw = `{ "version": 1,\n  "submissions": [{"name":"a"},{"future":"field"}] }\n`;
  await writeFile(submissionsStorePath(), raw);
  assert.deepEqual(await summarizeRetainedSubmissions(), { exists: true, count: 2 });
  assert.equal(await exportRetainedSubmissions(), raw);
  assert.equal(await readFile(submissionsStorePath(), "utf8"), raw, "reading never rewrites the file");
});

test("malformed or newer data is left alone but stays exportable and deletable", async () => {
  for (const raw of ["not json", `{"version":99}`]) {
    await writeFile(submissionsStorePath(), raw);
    assert.deepEqual(await summarizeRetainedSubmissions(), { exists: true, count: null });
    assert.equal(await exportRetainedSubmissions(), raw);
    assert.equal(await readFile(submissionsStorePath(), "utf8"), raw);
  }
  assert.equal(await deleteRetainedSubmissions(), true);
  assert.deepEqual(await summarizeRetainedSubmissions(), { exists: false, count: 0 });
});

test("backup keeps covering the file", async () => {
  const source = await readFile(new URL("./backup-manifest.ts", import.meta.url), "utf8");
  assert.match(source, /COVEN_FILES = \[[\s\S]*"opencoven-submissions\.json"/);
});
