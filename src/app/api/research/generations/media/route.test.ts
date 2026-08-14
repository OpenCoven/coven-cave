import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("media serving is local-only, streaming, and range-capable", () => {
  assert.match(route, /rejectNonLocalRequest/);
  assert.match(route, /openResearchGenerationMedia/);
  assert.match(route, /handle\.createReadStream/);
  assert.match(route, /autoClose: true/);
  assert.match(route, /parseResearchMediaRange/);
  assert.match(route, /accept-ranges/);
  assert.match(route, /content-range/);
  assert.match(route, /range \? 206/);
  assert.match(route, /status: 416/);
});

test("media route resolves only ready generation file references", () => {
  assert.match(route, /generation\.status !== "ready"/);
  assert.match(route, /mediaRefForGeneration/);
  assert.match(route, /openResearchGenerationMedia/);
  assert.match(route, /familiarId and id required/);
  assert.match(route, /opened\.mimeType !== expectedMimeType/);
  assert.match(route, /"content-type": contentType/);
  assert.match(route, /"x-content-type-options": "nosniff"/);
});

test("download responses use a safe attachment disposition", () => {
  assert.match(route, /searchParams\.get\("download"\) === "1"/);
  assert.match(route, /content-disposition/);
  assert.match(route, /attachment; filename=/);
});
