// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildPromptWithFamiliarStartupContext,
  familiarDailyMemoryRelativePath,
  readFamiliarDailyMemoryStartupContext,
} from "./familiar-startup-context.ts";

assert.equal(
  familiarDailyMemoryRelativePath(new Date(2026, 5, 15, 23, 30)),
  path.join("memory", "2026-06-15.md"),
  "daily memory paths should use the gateway's local calendar day",
);

const tempRoot = await mkdtemp(path.join(tmpdir(), "cave-familiar-startup-"));
try {
  const workspace = path.join(tempRoot, "charm");
  const memoryDir = path.join(workspace, "memory");
  await mkdir(memoryDir, { recursive: true });
  await writeFile(
    path.join(memoryDir, "2026-06-15.md"),
    "# Daily notes\n\nCodeword: blue orchid\n",
    "utf8",
  );

  const context = await readFamiliarDailyMemoryStartupContext(workspace, {
    now: new Date(2026, 5, 15, 9, 5),
  });
  assert.ok(context, "existing daily memory file should be loaded");
  assert.equal(context.relativePath, path.join("memory", "2026-06-15.md"));
  assert.equal(context.absolutePath, path.join(memoryDir, "2026-06-15.md"));
  assert.match(context.contents, /blue orchid/);

  const prompt = buildPromptWithFamiliarStartupContext("What is today's codeword?", [context]);
  assert.match(prompt, /Project Context \(familiar workspace files loaded at session start\):/);
  assert.match(prompt, /# memory\/2026-06-15\.md instructions for /);
  assert.match(prompt, /# Daily notes\n\nCodeword: blue orchid/);
  assert.match(prompt, /^<INSTRUCTIONS>\n/);
  assert.equal(
    prompt.indexOf("<INSTRUCTIONS>"),
    prompt.lastIndexOf("<INSTRUCTIONS>"),
    "entire startup context should be wrapped in a single INSTRUCTIONS block",
  );
  assert.match(prompt, /<\/INSTRUCTIONS>\n\nWhat is today's codeword\?/);
  assert.match(prompt, /What is today's codeword\?/);

  assert.equal(
    await readFamiliarDailyMemoryStartupContext(workspace, {
      now: new Date(2026, 5, 16, 9, 5),
    }),
    null,
    "missing daily memory file should be skipped without error",
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("familiar-startup-context.test.ts: ok");
