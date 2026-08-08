import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveOpenClawGatewayOutcome } from "./openclaw-gateway-outcome.ts";

test("an explicit chat stop remains the sole user-cancellation authority", () => {
  const outcome = resolveOpenClawGatewayOutcome(
    { state: "aborted", message: "Cancelled by user" },
    true,
    false,
  );

  assert.deepEqual(outcome, {
    cancelledByUser: true,
    isError: false,
    emptyText: "(cancelled)",
    progressMessage: "Cancelled by user",
  });
});

test("a detach-timeout Gateway abort is persisted as a client-detached interruption", () => {
  const outcome = resolveOpenClawGatewayOutcome(
    { state: "aborted", message: "Cancelled by user" },
    false,
    true,
  );

  assert.deepEqual(outcome, {
    cancelledByUser: false,
    isError: true,
    emptyText: "_The OpenClaw Gateway response was interrupted before returning text._",
    progressMessage: "The OpenClaw Gateway response was interrupted after the client detached.",
  });
  assert.doesNotMatch(
    outcome.progressMessage ?? "",
    /cancelled by user/i,
    "a detach-timeout abort must not surface the Gateway abort helper's user-cancellation message",
  );
});

test("a remote Gateway abort is a neutral generic interruption", () => {
  const outcome = resolveOpenClawGatewayOutcome(
    { state: "aborted", message: "Cancelled by user" },
    false,
    false,
  );

  assert.deepEqual(outcome, {
    cancelledByUser: false,
    isError: true,
    emptyText: "_The OpenClaw Gateway aborted._",
    progressMessage: "The OpenClaw Gateway response was aborted.",
  });
  assert.doesNotMatch(outcome.emptyText, /client detached/i);
  assert.doesNotMatch(outcome.progressMessage ?? "", /cancelled by user|client detached|returning text/i);
});
