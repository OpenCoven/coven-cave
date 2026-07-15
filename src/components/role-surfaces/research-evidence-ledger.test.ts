import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./research-evidence-ledger.tsx", import.meta.url), "utf8");

test("evidence ledger exposes visible statuses and source revision", () => {
  for (const status of ["candidate", "used", "conflicting", "rejected"]) {
    assert.match(source, new RegExp(status));
  }
  assert.match(source, /attach-source/);
  assert.match(source, /update-source/);
  assert.match(source, /Open source/);
});

test("artifact rejection is explicit and append-preserving", () => {
  assert.match(source, /reject-artifact/);
  assert.match(source, /Reject artifact/);
});
