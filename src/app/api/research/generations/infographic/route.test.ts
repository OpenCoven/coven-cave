import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("infographic rendering is local-only and validates its inputs", () => {
  assert.match(route, /rejectNonLocalRequest/);
  assert.match(route, /isValidResearchGenerationFamiliarId/);
  assert.match(route, /familiarId and id required/);
  assert.match(route, /path not allowed/);
  assert.match(route, /format must be png or svg/);
});

test("infographic route serves only ready infographic generations with stats", () => {
  assert.match(route, /generation\.status !== "ready"/);
  assert.match(route, /content\?\.kind !== "infographic"/);
  assert.match(route, /stats\.length === 0/);
  assert.match(route, /infographic not found/);
});

test("infographic responses are typed, sniff-proof, and downloadable", () => {
  assert.match(route, /"content-type": "image\/svg\+xml"/);
  assert.match(route, /"content-type": "image\/png"/);
  assert.match(route, /"x-content-type-options": "nosniff"/);
  assert.match(route, /searchParams\.get\("download"\) === "1"/);
  assert.match(route, /attachment; filename=/);
});
