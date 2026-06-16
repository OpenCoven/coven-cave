// @ts-nocheck
import assert from "node:assert/strict";
import { isValidFamiliarId } from "./familiar-contract-files.ts";

// Accepts ordinary familiar slugs.
for (const ok of ["sage", "echo", "kitty", "nova", "my-familiar", "agent_01", "A1"]) {
  assert.equal(isValidFamiliarId(ok), true, `${ok} should be a valid familiar id`);
}

// Rejects anything that could escape the workspace root or smuggle a path.
for (const bad of [
  "",
  "..",
  "../etc",
  "../../etc/passwd",
  "sage/../echo",
  "a/b",
  "a\\b",
  ".hidden",
  "-leading-dash",
  "with space",
  "name.with.dots",
  "x".repeat(65),
]) {
  assert.equal(isValidFamiliarId(bad), false, `${JSON.stringify(bad)} must be rejected`);
}

console.log("familiar-contract-files.test.ts: ok");
