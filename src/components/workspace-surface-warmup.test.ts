// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(
  workspace,
  /type: "deleted"; id: string \};[\s\S]{0,500}?publishSchedulesChanged\(\)/,
  "authoritative inbox SSE events invalidate Schedules' warmed landing cache",
);
