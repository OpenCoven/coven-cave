import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("onboarding prerequisite preflight is a local, read-only GET route", () => {
  assert.match(source, /export async function GET/);
  assert.match(source, /rejectNonLocalRequest/);
  assert.match(source, /probeOnboardingPrerequisites/);
  assert.doesNotMatch(source, /export async function POST/);
  assert.doesNotMatch(source, /spawn\(/);
});
