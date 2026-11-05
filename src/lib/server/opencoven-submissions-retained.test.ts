// @ts-nocheck
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const home = await mkdtemp(path.join(os.tmpdir(), "submissions-retained-"));
process.env.COVEN_HOME = home;
const token = "synthetic-retained-export-token";
process.env.COVEN_CAVE_AUTH_TOKEN = token;
const { GET } = await import("../../app/api/opencoven/submissions/retained/route.ts");
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
  const raw = Buffer.from(`{ "version": 1,\n  "submissions": [{"name":"a"},{"future":"field"}] }\n`);
  await writeFile(submissionsStorePath(), raw);
  assert.deepEqual(await summarizeRetainedSubmissions(), { exists: true, count: 2 });
  assert.deepEqual(await exportRetainedSubmissions(), raw);
  assert.deepEqual(await readFile(submissionsStorePath()), raw, "reading never rewrites the file");
});

test("malformed or newer data is left alone but stays exportable and deletable", async () => {
  for (const text of ["not json", `{"version":99}`]) {
    const raw = Buffer.from(text);
    await writeFile(submissionsStorePath(), raw);
    assert.deepEqual(await summarizeRetainedSubmissions(), { exists: true, count: null });
    assert.deepEqual(await exportRetainedSubmissions(), raw);
    assert.deepEqual(await readFile(submissionsStorePath()), raw);
  }
  assert.equal(await deleteRetainedSubmissions(), true);
  assert.deepEqual(await summarizeRetainedSubmissions(), { exists: false, count: 0 });
});

test("the download route preserves malformed UTF-8 byte for byte", async () => {
  const file = submissionsStorePath();
  // {"x":"<FF>"} with a literal invalid byte inside the quoted value.
  await writeFile(file, Buffer.from("7b2278223a22ff227d", "hex"));
  const stored = await readFile(file);
  const response = await GET(new Request("http://localhost/api/opencoven/submissions/retained?download=1", {
    headers: { host: "localhost", "x-coven-cave-token": token },
  }));
  assert.equal(response.status, 200);
  const downloaded = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(downloaded, stored);
  const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha256(downloaded), sha256(stored));
  assert.deepEqual(await readFile(file), stored, "downloading must leave the stored bytes intact");
});

test("backup keeps covering the file", async () => {
  const source = await readFile(new URL("./backup-manifest.ts", import.meta.url), "utf8");
  assert.match(source, /COVEN_FILES = \[[\s\S]*"opencoven-submissions\.json"/);
});
