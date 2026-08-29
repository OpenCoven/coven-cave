import assert from "node:assert/strict";
import { test } from "node:test";

import { parseResearchModelReceiptV1 } from "../research-protocol/topic-discovery.ts";
import {
  createResearchModelTaskExecutor,
  ResearchModelTaskError,
} from "./research-model-task-executor.ts";

function promptBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function request(familiarId = "charm") {
  return { familiarId, inputBytes: promptBytes("produce topics"), outputSchema: "topic-candidates-v1" as const };
}

test("execute parses a valid JSON object and builds a compliant receipt", async () => {
  let capturedArgs: readonly string[] = [];
  const executor = createResearchModelTaskExecutor({
    runOneShot: async (args) => {
      capturedArgs = args;
      return '{"candidates":[]}';
    },
    resolveState: async () => ({ harness: "codex", model: "openai/gpt-5" }),
  });

  const result = await executor.execute(request());
  assert.deepEqual(result.output, { candidates: [] });
  assert.equal(result.modelReceipt.runtime, "codex");
  assert.equal(result.modelReceipt.effectiveModel, "openai/gpt-5");
  assert.equal(result.modelReceipt.modelSource, "familiar-default");
  assert.equal(result.modelReceipt.providerBilling, "user-connected");

  // reportedByRuntime false ⇒ all-null usage, enforced by the portable parser.
  const parsed = parseResearchModelReceiptV1(result.modelReceipt, "$");
  assert.ok(parsed.ok);
  if (parsed.ok) {
    assert.equal(parsed.value.usage.reportedByRuntime, false);
    assert.equal(parsed.value.usage.inputTokens, null);
    assert.equal(parsed.value.usage.outputTokens, null);
    assert.equal(parsed.value.usage.costUsd, null);
  }

  // The invocation must be read-only, no project root, familiar-scoped.
  assert.ok(capturedArgs.includes("--permission"));
  assert.ok(capturedArgs.includes("read-only"));
  assert.ok(capturedArgs.includes("--familiar"));
  assert.ok(capturedArgs.includes("charm"));
});

test("execute extracts JSON from a stream-json assistant event", async () => {
  const executor = createResearchModelTaskExecutor({
    runOneShot: async () =>
      '{"type":"assistant","message":{"content":[{"type":"text","text":"{\\"candidates\\":[1]}"}]}}\n',
    resolveState: async () => ({ harness: "codex" }),
  });
  const result = await executor.execute(request());
  assert.deepEqual(result.output, { candidates: [1] });
});

test("execute rejects malformed output as output_invalid", async () => {
  const executor = createResearchModelTaskExecutor({
    runOneShot: async () => "this is not json at all",
    resolveState: async () => ({ harness: "codex" }),
  });
  await assert.rejects(
    () => executor.execute(request()),
    (err: unknown) => err instanceof ResearchModelTaskError && err.failure.code === "output_invalid",
  );
});

test("execute rejects over-cap output as output_too_large", async () => {
  const executor = createResearchModelTaskExecutor({
    runOneShot: async () => '{"candidates":' + "[" + "1,".repeat(100) + "]}" + "}",
    resolveState: async () => ({ harness: "codex" }),
    maxOutputBytes: 16,
  });
  await assert.rejects(
    () => executor.execute(request()),
    (err: unknown) => err instanceof ResearchModelTaskError && err.failure.code === "output_too_large",
  );
});

test("execute maps a missing familiar to model_unavailable (retryable false)", async () => {
  let ran = false;
  const executor = createResearchModelTaskExecutor({
    runOneShot: async () => {
      ran = true;
      return "{}";
    },
    resolveState: async () => null,
  });
  await assert.rejects(
    () => executor.execute(request()),
    (err: unknown) =>
      err instanceof ResearchModelTaskError &&
      err.failure.code === "model_unavailable" &&
      err.failure.retryable === false,
  );
  assert.equal(ran, false);
});

console.log("research model task executor: ok");
