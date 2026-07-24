import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./research-artifact-actions.tsx", import.meta.url), "utf8");

test("artifact actions is a client component with view, download, grimoire, publish", () => {
  assert.match(source, /^"use client";/);
  assert.match(source, /getResearchMissionFile/);
  assert.match(source, /aria-label=\{`View \$\{artifact\.title\}`\}/);
  assert.match(source, /aria-label=\{`Download \$\{artifact\.title\}`\}/);
  assert.match(source, /openGrimoireDoc\("knowledge", artifact\.knowledgeId\)/);
  assert.match(source, /artifact\.state === "working" && !artifact\.knowledgeId/);
});

test("viewer uses the ui Modal with focus management and honest empty copy", () => {
  assert.match(source, /from "@\/components\/ui\/modal"/);
  assert.match(source, /This file has not been written yet\./);
  assert.match(source, /role="alert"/);
  assert.match(source, /focus-ring/);
});

test("download builds a Blob and revokes the object URL", () => {
  assert.match(source, /URL\.createObjectURL/);
  assert.match(source, /URL\.revokeObjectURL/);
});

test("exports the workspace-path fetcher for the desk summary", () => {
  assert.match(source, /export async function fetchResearchWorkspacePath/);
});
