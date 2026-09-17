import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = readFileSync(
  path.join(import.meta.dirname, "code-work-scheduler.tsx"),
  "utf8",
);

test("CodeWorkScheduler requests the classified familiar-workspace session view", () => {
  assert.match(
    source,
    /readJson\(\s*"\/api\/sessions\/list\?collapseFamiliarWorkspace=1&classifyFamiliarWorkspace=1",\s*signal,\s*\)/,
    "scheduler should share the classified familiar-workspace sessions cache entry",
  );
});
