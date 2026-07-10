import assert from "node:assert/strict";
import test from "node:test";
import { workspacePaneErrorMessage, workspacePaneResetKey } from "./workspace-pane-error.ts";

const SAFE_MESSAGE = "This page hit an unexpected error. Try again.";

test("workspace pane reset keys distinguish delimiter-bearing identity pairs", () => {
  const first = workspacePaneResetKey("pane:group", "alpha");
  const second = workspacePaneResetKey("pane", "group:alpha");

  assert.notEqual(first, second);
});

test("workspace pane reset keys are deterministic for ordinary values", () => {
  assert.equal(workspacePaneResetKey("pane-1", "Board"), workspacePaneResetKey("pane-1", "Board"));
});

test("workspace pane errors use one safe message for every thrown category", () => {
  const secretDiagnostic = "token=sk-secret /Users/operator/private.env https://internal.example.test/debug";
  for (const thrown of [
    new Error("Render failed"),
    new Error("  \n  "),
    new Error(secretDiagnostic),
    "Lazy import failed",
    " \t ",
    secretDiagnostic,
    null,
    undefined,
    42,
    Symbol("failure"),
    { message: "not trusted" },
  ]) {
    const message = workspacePaneErrorMessage(thrown);
    assert.equal(message, SAFE_MESSAGE);
    assert.ok(message.trim().length > 0);
    assert.doesNotMatch(message, /sk-secret|\/Users\/operator|internal\.example/);
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
  assert.equal(message, SAFE_MESSAGE);
});
