import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let home: string;
before(async () => {
  home = await mkdtemp(path.join(tmpdir(), "coven-home-"));
  process.env.COVEN_HOME = home;
  await mkdir(path.join(home, "automation-run-logs"), { recursive: true });
});
after(async () => { delete process.env.COVEN_HOME; await rm(home, { recursive: true, force: true }); });

test("accepts a real .log inside the run-logs dir; rejects outside / non-log / symlink", async () => {
  const { isAllowedAutomationLogPath } = await import("./automation-log-paths.ts");
  const good = path.join(home, "automation-run-logs", "abc.log");
  await writeFile(good, "hi", "utf8");
  assert.ok(await isAllowedAutomationLogPath(good));
  assert.ok(!(await isAllowedAutomationLogPath(path.join(home, "automation-run-logs", "abc.txt")))); // not .log (missing file too)
  const outside = path.join(home, "secret.log");
  await writeFile(outside, "nope", "utf8");
  assert.ok(!(await isAllowedAutomationLogPath(outside))); // outside the dir
  const link = path.join(home, "automation-run-logs", "link.log");
  await symlink(outside, link);
  assert.ok(!(await isAllowedAutomationLogPath(link))); // symlink rejected
});
