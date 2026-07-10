import assert from "node:assert/strict";
import test from "node:test";
import { workspacePaneErrorMessage, workspacePaneResetKey } from "./workspace-pane-error.ts";

const FALLBACK_MESSAGE = "Unexpected pane error";

test("workspace pane reset keys distinguish delimiter-bearing identity pairs", () => {
  const first = workspacePaneResetKey("pane:group", "alpha");
  const second = workspacePaneResetKey("pane", "group:alpha");

  assert.notEqual(first, second);
});

test("workspace pane reset keys are deterministic for ordinary values", () => {
  assert.equal(workspacePaneResetKey("pane-1", "Board"), workspacePaneResetKey("pane-1", "Board"));
});

test("workspace pane errors preserve normal Error messages", () => {
  assert.equal(workspacePaneErrorMessage(new Error("Render failed")), "Render failed");
});

test("workspace pane errors replace blank Error messages with the fallback", () => {
  assert.equal(workspacePaneErrorMessage(new Error("  \n  ")), FALLBACK_MESSAGE);
});

test("workspace pane errors trim thrown strings", () => {
  assert.equal(workspacePaneErrorMessage("  Lazy import failed  "), "Lazy import failed");
});

test("workspace pane errors replace blank strings with the fallback", () => {
  assert.equal(workspacePaneErrorMessage(" \t "), FALLBACK_MESSAGE);
});

test("workspace pane errors use one fallback for unsupported thrown values", () => {
  for (const thrown of [null, undefined, 42, Symbol("failure"), { message: "not trusted" }]) {
    assert.equal(workspacePaneErrorMessage(thrown), FALLBACK_MESSAGE);
  }
});

test("workspace pane error normalization survives hostile values", () => {
  const hostile = new Proxy(new Error("hidden"), {
    getPrototypeOf() {
      throw new Error("prototype inspection blocked");
    },
    get() {
      throw new Error("property inspection blocked");
    },
  });
  let message = "";

  assert.doesNotThrow(() => {
    message = workspacePaneErrorMessage(hostile);
  });
  assert.equal(message, FALLBACK_MESSAGE);
});
