import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { filterUsableLocalDirectories } from "./chat-send-runtime.ts";

test("stale project grants never reach local harness launch arguments", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-chat-grants-"));
  try {
    const liveDirectory = path.join(root, "live");
    const ordinaryFile = path.join(root, "not-a-directory");
    const missingDirectory = path.join(root, "deleted");
    await mkdir(liveDirectory);
    await writeFile(ordinaryFile, "not a grant root");

    assert.deepEqual(
      await filterUsableLocalDirectories([
        ` ${liveDirectory} `,
        missingDirectory,
        ordinaryFile,
        "",
        liveDirectory,
      ]),
      [liveDirectory],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Chat derives effective grants from usable local directories", async () => {
  const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(
    route,
    /filterUsableLocalDirectories\([\s\S]*?accessibleProjects\.map\(\(entry\) => entry\.project\.root\)/,
  );
  assert.match(
    route,
    /effectiveAccessibleProjects[\s\S]*?const grantedProjectRoots = effectiveAccessibleProjects\.map/,
  );
});

test("a silent stale Copilot resume retries with recent context", async () => {
  const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(
    route,
    /copilotStream[\s\S]*?resumeTarget[\s\S]*?!assistantText\.trim\(\)[\s\S]*?result\.duration_ms == null[\s\S]*?result\.is_error == null[\s\S]*?resumeFailed = true/,
  );
});
