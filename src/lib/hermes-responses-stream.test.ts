import assert from "node:assert/strict";
import test from "node:test";
import {
  HermesSseDecoder,
  hermesApiConfig,
  hermesResponsesUrl,
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
    parseHermesResponsesEvent("response.output_item.added", {
      item: { type: "function_call", call_id: "call-1", name: "shell", arguments: { command: "pwd" } },
    }),
    { kind: "tool_start", id: "call-1", name: "shell", input: { command: "pwd" } },
  );
  assert.deepEqual(
    parseHermesResponsesEvent("response.function_call_output", { call_id: "call-1", output: "C:/repo" }),
    { kind: "tool_end", id: "call-1", output: "C:/repo", isError: false },
  );
  assert.deepEqual(parseHermesResponsesEvent("response.completed", {}), { kind: "done", isError: false });
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
});

test("structured transport is opt-in and refuses non-HTTP endpoint values", () => {
  assert.equal(hermesApiConfig({}), null);
  assert.equal(hermesApiConfig({ HERMES_API_URL: "file:///tmp/hermes" }), null);
  assert.deepEqual(hermesApiConfig({ HERMES_API_URL: "http://127.0.0.1:8080/", HERMES_API_KEY: " scoped " }), {
    baseUrl: "http://127.0.0.1:8080",
    apiKey: "scoped",
  });
  assert.equal(hermesResponsesUrl({ baseUrl: "http://127.0.0.1:8080" }), "http://127.0.0.1:8080/v1/responses");
  assert.equal(hermesResponsesUrl({ baseUrl: "http://127.0.0.1:8080/v1" }), "http://127.0.0.1:8080/v1/responses");
});
