import assert from "node:assert/strict";
import { test } from "node:test";
import { stampChangedFiles } from "./change-file-versions.ts";

test("stamps every file with bounded asynchronous reads and isolates failures", async () => {
  const files: { path: string; changeVersion?: string }[] = Array.from({ length: 25 }, (_, i) => ({ path: String(i) }));
  let active = 0;
  let peak = 0;
  await stampChangedFiles(files, (path) => path === "24" ? null : path, async (path) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    if (path === "3") throw Object.assign(new Error("denied"), { code: "EACCES" });
    if (path === "4") throw Object.assign(new Error("gone"), { code: "ENOENT" });
    return { mtimeMs: 10, ctimeMs: 20, size: Number(path) };
  });
  assert.ok(peak > 1 && peak <= 8, `peak concurrency: ${peak}`);
  assert.equal(files[0].changeVersion, "10:20:0");
  assert.equal(files[3].changeVersion, "unavailable");
  assert.equal(files[4].changeVersion, "missing");
  assert.equal(files[23].changeVersion, "10:20:23");
  assert.equal(files[24].changeVersion, undefined);
});
