import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SAFE_CAUGHT_PANE_ERROR_MESSAGE,
  installWorkspacePaneErrorConsolePolicy,
  reportCaughtWorkspacePaneError,
  workspacePaneErrorMessage,
  workspacePaneResetKey,
} from "./workspace-pane-error.ts";

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

type ErrorTarget = { error: (...args: unknown[]) => void };

function captureErrorTarget() {
  const calls: Array<{ thisValue: unknown; args: unknown[] }> = [];
  const target: ErrorTarget = {
    error: function (this: unknown, ...args: unknown[]) {
      calls.push({ thisValue: this, args });
    },
  };
  return { target, calls };
}

test("console policy is idempotent and forwards unrelated errors exactly", () => {
  const { target, calls } = captureErrorTarget();
  const unrelatedObject = { error: "ordinary" };
  const unrelatedSymbol = Symbol("ordinary");
  const customThis = { console: "receiver" };

  installWorkspacePaneErrorConsolePolicy(target);
  const installed = target.error;
  installWorkspacePaneErrorConsolePolicy(target);
  assert.equal(target.error, installed);

  target.error.call(customThis, "prefix", unrelatedObject, 17, unrelatedSymbol);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.thisValue, customThis);
  assert.deepEqual(calls[0]?.args, ["prefix", unrelatedObject, 17, unrelatedSymbol]);
});

test("console policy replaces only calls containing the exact marked pane error identity", () => {
  const { target, calls } = captureErrorTarget();
  installWorkspacePaneErrorConsolePolicy(target);
  const marked = { diagnostic: "token=sk-pane-private /Users/operator/private.env" };
  const lookalike = { diagnostic: marked.diagnostic };

  workspacePaneErrorMessage(marked);
  target.error("caught", lookalike);
  target.error("caught", marked, { componentStack: "private stack" });
  target.error("caught again", marked);

  assert.deepEqual(calls[0]?.args, ["caught", lookalike]);
  assert.deepEqual(calls[1]?.args, [SAFE_CAUGHT_PANE_ERROR_MESSAGE]);
  assert.deepEqual(calls[2]?.args, ["caught again", marked]);
});

test("console policy marks hostile object and function identities without inspection", () => {
  const { target, calls } = captureErrorTarget();
  installWorkspacePaneErrorConsolePolicy(target);
  const hostileObject = new Proxy({}, {
    get() { throw new Error("object property inspected"); },
    getPrototypeOf() { throw new Error("object prototype inspected"); },
  });
  const hostileFunction = new Proxy(() => undefined, {
    get() { throw new Error("function property inspected"); },
    getPrototypeOf() { throw new Error("function prototype inspected"); },
  });

  assert.doesNotThrow(() => {
    workspacePaneErrorMessage(hostileObject);
    workspacePaneErrorMessage(hostileFunction);
    target.error(hostileObject);
    target.error(hostileFunction);
  });
  assert.deepEqual(calls.map((call) => call.args), [
    [SAFE_CAUGHT_PANE_ERROR_MESSAGE],
    [SAFE_CAUGHT_PANE_ERROR_MESSAGE],
  ]);
});

test("primitive pane-error marks are consumed and bounded", () => {
  const { target, calls } = captureErrorTarget();
  installWorkspacePaneErrorConsolePolicy(target);
  const values = Array.from({ length: 64 }, (_, index) => `pane-primitive-${index}`);
  for (const value of values) workspacePaneErrorMessage(value);

  target.error(values[0]);
  target.error(values.at(-1));
  target.error(values.at(-1));

  assert.deepEqual(calls[0]?.args, [values[0]], "the oldest primitive mark is evicted");
  assert.deepEqual(calls[1]?.args, [SAFE_CAUGHT_PANE_ERROR_MESSAGE]);
  assert.deepEqual(calls[2]?.args, [values.at(-1)], "a primitive mark is consumed once");
});

test("an unreported primitive pane-error mark expires after a deferred turn", async () => {
  const { target, calls } = captureErrorTarget();
  installWorkspacePaneErrorConsolePolicy(target);
  const privatePrimitive = "token=sk-expiring-pane /Users/operator/private.env";

  workspacePaneErrorMessage(privatePrimitive);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  target.error(privatePrimitive);

  assert.deepEqual(calls[0]?.args, [privatePrimitive]);
});

test("safe caught-error reporter never forwards its thrown value", () => {
  const original = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => calls.push(args);
  try {
    reportCaughtWorkspacePaneError("token=sk-reporter-private /Users/operator/private.env");
  } finally {
    console.error = original;
  }
  assert.deepEqual(calls, [[SAFE_CAUGHT_PANE_ERROR_MESSAGE]]);
});

test("client instrumentation installs the pane console policy before hydration", async () => {
  const source = await readFile(new URL("../instrumentation-client.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /import \{ installWorkspacePaneErrorConsolePolicy \} from "@\/lib\/workspace-pane-error";/,
  );
  assert.match(source, /installWorkspacePaneErrorConsolePolicy\(\);/);
});
