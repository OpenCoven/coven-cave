import assert from "node:assert/strict";
import test from "node:test";
import {
  responseStatusTone,
  splitResponseStatusText,
} from "./response-status-tokens.ts";

test("response statuses map only the strict allowlist", () => {
  assert.equal(responseStatusTone("ready"), "success");
  assert.equal(responseStatusTone("BLOCKED"), "danger");
  assert.equal(responseStatusTone("paused"), "neutral");
  assert.equal(responseStatusTone("custom"), null);
});

test("response status splitting preserves surrounding text and original token text", () => {
  assert.deepEqual(splitResponseStatusText("Deploy [READY], review [BLOCKED]."), [
    { kind: "text", text: "Deploy " },
    { kind: "status", text: "[READY]", label: "READY", tone: "success" },
    { kind: "text", text: ", review " },
    { kind: "status", text: "[BLOCKED]", label: "BLOCKED", tone: "danger" },
    { kind: "text", text: "." },
  ]);
  assert.deepEqual(splitResponseStatusText("[NOT_A_STATUS]"), [
    { kind: "text", text: "[NOT_A_STATUS]" },
  ]);
  assert.deepEqual(splitResponseStatusText("prefix[READY]suffix"), [
    { kind: "text", text: "prefix[READY]suffix" },
  ]);
});
