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
      item: { call_id: "call-failed", status: "failed", error: { message: "denied" } },
    }),
    { kind: "tool_end", id: "call-failed", output: { message: "denied" }, isError: true },
  );
  assert.deepEqual(
    parseHermesResponsesEvent("response.output_item.done", {
      item: { call_id: "call-item-error", error: { message: "blocked" } },
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
    { kind: "tool_start", id: "call-2", name: "read_file", input: { path: "a.ts" } },
  );
  assert.deepEqual(
    parseHermesResponsesEvent("hermes.tool.progress", { tool_call_id: "call-2", status: "failed", output: "no" }),
    { kind: "tool_end", id: "call-2", output: "no", isError: true },
  );
  assert.deepEqual(
    parseHermesResponsesEvent("hermes.tool.progress", {
      toolCallId: "call-camel", tool: "read_file", status: "running", input: { path: "a.ts" },
    }),
    { kind: "tool_start", id: "call-camel", name: "read_file", input: { path: "a.ts" } },
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
