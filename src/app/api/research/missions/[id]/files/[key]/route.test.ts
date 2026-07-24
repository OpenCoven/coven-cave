import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("research mission file route is dynamic, node-only, and local-only", () => {
  assert.match(source, /export const dynamic = "force-dynamic"/);
  assert.match(source, /export const runtime = "nodejs"/);
  assert.match(source, /rejectNonLocalRequest/);
});

test("route validates the mission id and resolves the artifact by key", () => {
  assert.match(source, /"path not allowed"/);
  assert.match(source, /"research mission not found"/);
  assert.match(source, /"research artifact not found"/);
  assert.match(source, /isValidResearchMissionId/);
});

test("route reads through the validated store reader and tolerates missing files", () => {
  assert.match(source, /readValidatedMissionFile/);
  assert.match(source, /content: string \| null/);
  assert.match(source, /workspacePath/);
});
