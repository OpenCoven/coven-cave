import assert from "node:assert/strict";
import test from "node:test";
import {
  HermesSseDecoder,
  hermesApiConfig,
  hermesApiCanAccessLocalFiles,
  hermesResponsesUrl,
  isHermesInvalidPreviousResponseIdError,
  isHermesMissingPreviousResponseError,
  parseHermesResponsesEvent,
} from "./hermes-responses-stream.ts";

test("Hermes Responses events normalise text, calls, output, session, and completion", () => {
  const partial = parseHermesResponsesEvent("response.output_item.added", { item: {
    type: "function_call", call_id: "partial", name: "shell", arguments: '{"command":"sk-proj-partial',
  } });
  assert.deepEqual(partial, { kind: "tool_start", id: "partial", name: "shell", input: undefined });
  assert.deepEqual(parseHermesResponsesEvent("response.function_call_arguments.done", {
    call_id: "partial", arguments: '{"command":"unfinished',
  }), { kind: "ignore" }, "a malformed final argument value is never disclosed as a safe snapshot");
  assert.deepEqual(
    parseHermesResponsesEvent("response.created", { response: { id: "resp-1" } }),
    { kind: "session", id: "resp-1" },
  );
  assert.deepEqual(
    parseHermesResponsesEvent("response.output_text.delta", { delta: "hello" }),
    { kind: "text", text: "hello" },
  );
  assert.deepEqual(
    parseHermesResponsesEvent("message", { type: "response.output_text.delta", delta: "wrapped" }),
    { kind: "text", text: "wrapped" },
  );
  assert.deepEqual(
    parseHermesResponsesEvent("response.output_item.added", {
      item: { type: "function_call", call_id: "call-1", name: "shell", arguments: { command: "pwd" } },
    }),
    { kind: "tool_start", id: "call-1", name: "shell", input: { command: "pwd" } },
  );
  assert.deepEqual(
    parseHermesResponsesEvent("response.function_call_output", { call_id: "call-1", output: "C:/repo" }),
    { kind: "tool_end", id: "call-1", output: "C:/repo", isError: false },
  );
  assert.deepEqual(
    parseHermesResponsesEvent("response.output_item.done", {
      item: { type: "function_call_output", call_id: "call-failed", status: "failed", error: { message: "denied" } },
    }),
    { kind: "tool_end", id: "call-failed", output: { message: "denied" }, isError: true },
  );
  assert.deepEqual(
    parseHermesResponsesEvent("response.output_item.done", {
      item: { type: "function_call_output", call_id: "call-item-error", error: { message: "blocked" } },
    }),
    { kind: "tool_end", id: "call-item-error", output: { message: "blocked" }, isError: true },
  );
  assert.deepEqual(
    parseHermesResponsesEvent("response.completed", { response: { id: "resp-terminal" } }),
    { kind: "done", isError: false, id: "resp-terminal" },
  );
  assert.deepEqual(
    parseHermesResponsesEvent("response.failed", { response: { id: "resp-failed", error: { message: "invalid model" } } }),
    { kind: "done", isError: true, id: "resp-failed", message: "invalid model" },
  );
  assert.deepEqual(
    parseHermesResponsesEvent("response.failed", {
      response: { error: { message: "Previous response does not exist", param: "previous_response_id" } },
    }),
    { kind: "done", isError: true, message: "Previous response does not exist", invalidPreviousResponseId: true },
  );
  assert.equal(
    isHermesInvalidPreviousResponseIdError({ error: { code: "previous_response_not_found" } }),
    true,
  );
  assert.equal(
    isHermesMissingPreviousResponseError({ error: { message: "Previous response not found: resp-evicted" } }),
    true,
  );
  assert.deepEqual(
    parseHermesResponsesEvent("response.function_call_arguments.delta", {
      item_id: "item-1", delta: '{"command":',
    }),
    { kind: "tool_input", itemId: "item-1", input: '{"command":', isFinal: false },
  );
  assert.deepEqual(
    parseHermesResponsesEvent("response.function_call_arguments.done", {
      item_id: "item-1", arguments: '{"command":"pwd"}',
    }),
    { kind: "tool_input", itemId: "item-1", input: '{"command":"pwd"}', isFinal: true },
  );
  assert.deepEqual(
    parseHermesResponsesEvent("response.output_item.added", {
      item: { id: "item-1", type: "function_call", call_id: "call-1", name: "shell", arguments: "" },
    }),
    { kind: "tool_start", id: "call-1", itemId: "item-1", name: "shell", input: "" },
  );
  assert.deepEqual(
    parseHermesResponsesEvent("response.created", { response: { id: "../../unsafe" } }),
    { kind: "error", message: "Hermes API protocol error: invalid response id" },
  );
});

test("Hermes extension and malformed/future events fail closed", () => {
  assert.deepEqual(
    parseHermesResponsesEvent("hermes.tool.progress", {
      tool_call_id: "call-2", tool_name: "read_file", status: "running", input: { path: "a.ts" },
    }),
    { kind: "tool_start", id: "call-2", name: "read_file", input: { path: "a.ts" }, executionObserved: true },
  );
  assert.deepEqual(
    parseHermesResponsesEvent("hermes.tool.progress", { tool_call_id: "call-2", status: "failed", output: "no" }),
    { kind: "tool_end", id: "call-2", output: "no", isError: true },
  );
  assert.deepEqual(
    parseHermesResponsesEvent("hermes.tool.progress", {
      toolCallId: "call-camel", tool: "read_file", status: "running", input: { path: "a.ts" },
    }),
    { kind: "tool_start", id: "call-camel", name: "read_file", input: { path: "a.ts" }, executionObserved: true },
  );
  assert.deepEqual(
    parseHermesResponsesEvent("hermes.tool.progress", {
      toolCallId: "call-camel", status: "completed", output: "ok",
    }),
    { kind: "tool_end", id: "call-camel", output: "ok", isError: false },
  );
  assert.deepEqual(parseHermesResponsesEvent("response.output_item.added", { item: { name: "missing-id" } }), { kind: "ignore" });
  assert.deepEqual(parseHermesResponsesEvent("new.future.event", { surprise: true }), { kind: "ignore" });
});

test("native reasoning items select only completed summary text and cannot settle tools", () => {
  const item = { id: "rs-one", type: "reasoning", status: "in_progress", summary: [],
    text: "private-raw-text", encrypted_content: "opaque-state", signature: "opaque-signature" };
  assert.deepEqual(parseHermesResponsesEvent("response.output_item.added", { item }),
    { kind: "reasoning", id: "rs-one", phase: "running" });
  for (const type of ["response.reasoning_summary_text.delta", "response.reasoning_summary_text.done", "response.reasoning_summary_part.done"]) {
    assert.deepEqual(parseHermesResponsesEvent(type, { item_id: "rs-one", text: "partial", delta: "partial" }),
      { kind: "ignore" }, "only a complete item establishes the full disclosure unit");
  }
  assert.deepEqual(parseHermesResponsesEvent("response.output_item.done", { item: {
    ...item, status: "completed", summary: [{ type: "summary_text", text: "First." }, { type: "summary_text", text: "Second." }],
  } }), { kind: "reasoning", id: "rs-one", phase: "complete", text: "First.\nSecond." });
  for (const summary of [null, [], [{ type: "thinking", text: "private" }], [{ type: "summary_text", text: 42 }],
    [{ type: "summary_text", text: "safe" }, { type: "unknown", text: "private" }]]) {
    assert.deepEqual(parseHermesResponsesEvent("response.output_item.done", { item: { ...item, status: "completed", summary } }),
      { kind: "reasoning", id: "rs-one", phase: "complete" }, "opaque/malformed summary fields never fall back to raw text");
  }
  assert.deepEqual(parseHermesResponsesEvent("response.output_item.done", { item }),
    { kind: "reasoning", id: "rs-one", phase: "unavailable" });
  for (const type of ["response.output_item.added", "response.output_item.done"]) {
    for (const itemType of ["message", "unknown", undefined]) {
      assert.deepEqual(parseHermesResponsesEvent(type, { item: {
        id: "existing-tool-id", call_id: "existing-tool-id", name: "shell", type: itemType, status: "completed", output: "forged-result",
      } }), { kind: "ignore" }, "non-tool items cannot start or settle a matching call");
    }
  }
});

test("function-call items remain requests; unsupported terminal statuses remain unknown", () => {
  assert.deepEqual(parseHermesResponsesEvent("response.output_item.done", { item: {
    type: "function_call", id: "fc-one", call_id: "call-one", name: "shell", status: "completed", arguments: '{}', output: "not-a-result",
  } }), { kind: "tool_start", id: "call-one", name: "shell", input: '{}', itemId: "fc-one" });
  assert.deepEqual(parseHermesResponsesEvent("response.output_item.added", { item: {
    type: "function_call_output", id: "fco-one", call_id: "call-one", status: "completed", output: [{ type: "input_text", text: "actual result" }],
  } }), { kind: "tool_end", id: "call-one", output: [{ type: "input_text", text: "actual result" }], isError: false });
  assert.deepEqual(parseHermesResponsesEvent("response.output_item.added", { item: {
    type: "function_call_output", id: "fco-one", call_id: "call-one", output: "partial",
  } }), { kind: "ignore" }, "an announced output without completed status is not yet a final result");
  assert.deepEqual(parseHermesResponsesEvent("hermes.tool.progress", {
    tool_call_id: "call-one", status: "completed", item: { status: "future-status", output: "partial" },
  }), { kind: "ignore" }, "a terminal extension cannot override an unknown nested outcome");
  for (const status of ["cancelled", "canceled", "incomplete", "future-status", null, [], ["completed"], {}]) {
    for (const type of ["hermes.tool.progress", "hermes.tool.completed", "response.function_call_output", "response.output_item.done"]) {
      assert.deepEqual(parseHermesResponsesEvent(type, {
        status, tool_call_id: "call-one", tool_name: "shell", output: "partial", error: "not-an-outcome",
        item: { type: "function_call_output", id: "fco-one", call_id: "call-one", status, output: "partial" },
      }), { kind: "ignore" }, "an unrecognized outcome cannot be converted into success, failure, or cancellation");
    }
  }
});

test("SSE decoder handles arbitrary chunk boundaries and multi-line data", () => {
  const decoder = new HermesSseDecoder();
  assert.deepEqual(decoder.push("event: response.output_text.delta\ndata: {\"de"), []);
  assert.deepEqual(decoder.push("lta\":\"hi\"}\n\n"), [
    { event: "response.output_text.delta", data: "{\"delta\":\"hi\"}" },
  ]);
  assert.deepEqual(decoder.push("event: x\ndata: first\ndata: second\n\n"), [
    { event: "x", data: "first\nsecond" },
  ]);

  const crlf = new HermesSseDecoder();
  assert.deepEqual(crlf.push("event: one\r\ndata: 1\r"), []);
  assert.deepEqual(crlf.push("\n\r\nevent: two\r\ndata: 2\r\n\r\n"), [
    { event: "one", data: "1" },
    { event: "two", data: "2" },
  ]);

  const crOnly = new HermesSseDecoder();
  assert.deepEqual(crOnly.push("event: one\rdata: 1\r\r"), []);
  assert.deepEqual(crOnly.push("event: two\rdata: 2\r\r"), [
    { event: "one", data: "1" },
  ]);
  assert.deepEqual(crOnly.finish(), [{ event: "two", data: "2" }]);

  const bareFields = new HermesSseDecoder();
  assert.deepEqual(bareFields.push("event: stale\nevent\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"ok\"}\n\n"), [
    { event: "", data: "{\"type\":\"response.output_text.delta\",\"delta\":\"ok\"}" },
  ]);
  assert.deepEqual(bareFields.push("data\n\n"), [{ event: "", data: "" }]);
});

test("structured transport is opt-in and refuses non-HTTP endpoint values", () => {
  assert.equal(hermesApiConfig({}), null);
  assert.equal(hermesApiConfig({ HERMES_API_URL: "https://hermes.example.test" }), null);
  assert.equal(hermesApiConfig({ HERMES_API_URL: "https://hermes.example.test", HERMES_API_KEY: "bad\nkey" }), null);
  assert.equal(hermesApiConfig({ HERMES_API_URL: "file:///tmp/hermes" }), null);
  assert.equal(hermesApiConfig({ HERMES_API_URL: "http://hermes.example.test:8080" }), null);
  assert.equal(hermesApiConfig({ HERMES_API_URL: "http://192.168.1.20:8080" }), null);
  assert.equal(hermesApiConfig({ HERMES_API_URL: "https://user:token@example.test" }), null);
  assert.equal(hermesApiConfig({ HERMES_API_URL: "https://example.test?api_key=token" }), null);
  assert.deepEqual(hermesApiConfig({ HERMES_API_URL: "https://hermes.example.test:8443", HERMES_API_KEY: "scoped" }), {
    baseUrl: "https://hermes.example.test:8443",
    apiKey: "scoped",
  });
  assert.deepEqual(hermesApiConfig({ HERMES_API_URL: "http://[::1]:8080", HERMES_API_KEY: "scoped" }), {
    baseUrl: "http://[::1]:8080",
    apiKey: "scoped",
  });
  assert.equal(hermesApiCanAccessLocalFiles({ baseUrl: "https://hermes.example.test", apiKey: "scoped" }), false);
  assert.equal(hermesApiCanAccessLocalFiles({ baseUrl: "http://127.0.0.1:8080", apiKey: "scoped" }), true);
  assert.deepEqual(hermesApiConfig({ HERMES_API_URL: "http://127.0.0.1:8080/", HERMES_API_KEY: " scoped " }), {
    baseUrl: "http://127.0.0.1:8080",
    apiKey: "scoped",
  });
  assert.equal(hermesResponsesUrl({ baseUrl: "http://127.0.0.1:8080", apiKey: "scoped" }), "http://127.0.0.1:8080/v1/responses");
  assert.equal(hermesResponsesUrl({ baseUrl: "http://127.0.0.1:8080/v1", apiKey: "scoped" }), "http://127.0.0.1:8080/v1/responses");
  assert.equal(hermesResponsesUrl({ baseUrl: "http://127.0.0.1:8080/v1/responses", apiKey: "scoped" }), "http://127.0.0.1:8080/v1/responses");
});


test("response identity requires a terminal served-runtime report, never the echoed request", () => {
  const response = { id: "resp_identity", model: "requested-alias", runtime: {
    provider: "provider", model: "actual-model-v2", route_source: "model_routes",
    requested: { provider: "requested-provider", model: "requested-alias" },
  } };
  for (const type of ["response.created", "response.in_progress"]) {
    assert.deepEqual(parseHermesResponsesEvent(type, { response }),
      { kind: "session", id: "resp_identity" }, "an early route cannot confirm which fallback eventually serves the turn");
  }
  assert.deepEqual(parseHermesResponsesEvent("response.completed", { response }),
    { kind: "done", id: "resp_identity", model: "actual-model-v2", isError: false });
  for (const runtime of [undefined, null, [], "actual-model-v2", {}, { model: 42 }, { model: "bad\nmodel" },
    { requested: { model: "requested-alias" } }]) {
    assert.deepEqual(parseHermesResponsesEvent("response.completed", {
      model: "forged-root-model", runtime: response.runtime, response: { id: "resp_identity", model: "requested-alias", runtime },
    }), { kind: "done", id: "resp_identity", isError: false }, "missing or malformed served identity stays unavailable");
  }
});
