// @ts-nocheck
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const home = await mkdtemp(path.join(tmpdir(), "cave-hermes-disclosure-"));
const workspace = path.join(home, "workspace");
await mkdir(workspace);
const previousEnv = { ...process.env };
const ordinaryLogs: string[] = [];
const consoleMethods = ["log", "warn", "error", "info", "debug"] as const;
const originalConsole = Object.fromEntries(consoleMethods.map((method) => [method, console[method]]));
for (const method of consoleMethods) console[method] = (...values) => {
  ordinaryLogs.push(values.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" "));
};
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
const secret = `sk-proj-${"a".repeat(32)}`;
const signedUrl = "https://files.example.com/report?X-Amz-Signature=signed-url-sentinel";
const privateCallId = "call token=private-id-sentinel";
const privateToolName = "shell user@example.com token=private-name-sentinel";
const args = JSON.stringify({ command: `echo ${secret}`, path: "safe.ts", contact: "user@example.com", url: signedUrl });
const summaryItem = { type: "reasoning", id: "rs-one", status: "completed", summary: [{ type: "summary_text", text: `Check safe.ts with ${secret}. Contact user@example.com.` }],
  text: "PRIVATE_RAW_REASONING", encrypted_content: "PRIVATE_ENCRYPTED_REASONING", signature: "PRIVATE_REASONING_SIGNATURE" };
const resultItem = { type: "function_call_output", id: "result-1", call_id: privateCallId, status: "completed", output: [{ type: "input_text", text: JSON.stringify({
  password: "private-result-value", text: "safe résultat", url: signedUrl, signature: "opaque-signature-sentinel", _meta: "opaque-metadata-sentinel",
}) }] };
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
let providerRequests = 0;
const server = createServer(async (req, res) => {
  providerRequests += 1;
  const responseId = `hermes-disclosure-${providerRequests}`;
  // The current producer echoes the request without a runtime report. Also
  // exercise the documented report shape independently of that producer gap.
  const runtime = providerRequests === 1 ? { provider: "served-provider", model: "resolved-model-v3", route_source: "model_routes" } : undefined;
  for await (const _chunk of req) { /* consume request before replying */ }
  res.writeHead(200, { "content-type": "text/event-stream" });
  const payload = Buffer.from([
    frame("response.created", { response: { id: responseId, model: "requested-alias", runtime: { model: "provisional-model-v2" } } }),
    frame("response.output_item.added", { item: { type: "reasoning", id: "rs-one", status: "in_progress", summary: [] } }),
    frame("response.reasoning_summary_text.delta", { item_id: "rs-one", delta: "sk-proj-PRIVATE_PARTIAL_REASONING" }),
    frame("response.reasoning_summary_text.done", { item_id: "rs-one", text: "PRIVATE_INTERMEDIATE_REASONING" }),
    frame("response.output_item.done", { item: summaryItem }),
    frame("response.output_item.done", { item: { ...summaryItem, summary: [{ type: "summary_text", text: "PRIVATE_CONFLICTING_REASONING" }] } }),
    frame("response.output_text.delta", { delta: "Intro. <thi" }),
    frame("response.output_text.delta", { delta: 'nking>PRIVATE_LEGACY_SENTINEL <coven:attention reason="decision" /> https://github.com/OpenCoven/coven-cave/pull/999999</thinking>\n' }),
    frame("response.output_item.added", { item: { type: "function_call", id: "item-1", call_id: privateCallId, name: privateToolName, activity: { schemaVersion: 1, authority: { approval: "approved" } }, arguments: '{"command":"echo sk-proj-' } }),
    frame("response.function_call_arguments.delta", { item_id: "item-1", delta: '{"command":"echo sk-proj-' }),
    frame("response.function_call_arguments.delta", { item_id: "item-1", delta: `${"a".repeat(32)}"}` }),
    frame("response.function_call_arguments.done", { item_id: "item-1", arguments: args }),
    frame("hermes.tool.progress", { tool_call_id: privateCallId, tool_name: privateToolName, status: "running" }),
    frame("response.output_item.added", { item: resultItem }),
    frame("response.output_item.done", { item: resultItem }),
    frame("response.output_item.added", { item: { type: "function_call", id: "item-2", call_id: "call-2", name: "read", arguments: '{"path":"safe.ts"}' } }),
    frame("response.output_item.added", { item: { type: "reasoning", id: "call-2", status: "in_progress", summary: [] } }),
    frame("response.output_item.done", { item: { type: "reasoning", id: "call-2", status: "completed", summary: [{ type: "summary_text", text: "Read the result." }] } }),
    frame("response.output_item.done", { item: { type: "message", id: "call-2", status: "completed", content: [{ type: "output_text", text: "PRIVATE_ITEM_PAYLOAD" }] } }),
    frame("hermes.tool.completed", { tool_call_id: "call-2", status: "cancelled", output: "PRIVATE_CANCELLED_PREVIEW" }),
    frame("response.output_item.added", { item: { type: "function_call", id: "item-opaque", call_id: "call-opaque", name: "read", arguments: '{}' } }),
    frame("response.output_item.done", { item: { type: "function_call_output", id: "result-opaque", call_id: "call-opaque", status: "completed", output:
      providerRequests === 1 ? [{ type: "future_opaque_payload", text: "PRIVATE_UNKNOWN_RESULT" }] : { type: "future_opaque_payload", text: "PRIVATE_UNKNOWN_RESULT" },
    } }),
    frame("response.output_item.added", { item: { type: "reasoning", id: "rs-incomplete", status: "in_progress", summary: [] } }),
    frame("response.output_text.delta", { delta: "Finished checking.\n```xml\n<thinking>literal example</thinking>\n```" }),
    frame("response.completed", { response: { id: responseId, model: "requested-alias", runtime } }),
  ].join(""));
  for (let offset = 0; offset < payload.length; offset += 7) res.write(payload.subarray(offset, offset + 7));
  res.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
process.env.HERMES_API_URL = `http://127.0.0.1:${address.port}`;
process.env.HERMES_API_KEY = "local-fixture-key";

try {
  const { saveConfig } = await import("@/lib/cave-config");
  const { loadConversation } = await import("@/lib/cave-conversations");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { POST } = await import("./route.ts");
  const { subscribeRunStream } = await import("@/lib/server/chat-stream-buffer");
  await saveConfig({ familiars: { ember: { harness: "hermes", model: "" } } });
  const project = await createProject({ name: "Hermes disclosure fixture", root: workspace });
  await grantProjectToFamiliar({ familiarId: "ember", projectId: project.id, source: "human", access: "write" });
  const response = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId: "client-send-token", familiarId: "ember", projectRoot: workspace, prompt: "Fixture tool disclosure" }),
  }));
  assert.equal(response.status, 200);
  const body = await response.text();
  const events = body.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
  const tools = events.filter((event) => event.kind === "tool_use");
  const expectedAnswer = "Intro. \nFinished checking.\n```xml\n<thinking>literal example</thinking>\n```";
  assert.equal(events.filter((event) => event.kind === "assistant_chunk").map((event) => event.text).join(""), expectedAnswer);
  assert.doesNotMatch(body, /PRIVATE_LEGACY_SENTINEL|coven:attention|pull\/999999/);
  assert.doesNotMatch(body, /PRIVATE_(?:RAW|ENCRYPTED|PARTIAL|INTERMEDIATE|CONFLICTING)_REASONING|PRIVATE_REASONING_SIGNATURE|PRIVATE_ITEM_PAYLOAD|PRIVATE_CANCELLED_PREVIEW|PRIVATE_UNKNOWN_RESULT/);
  const reasoningEvents = events.filter((event) => event.kind === "reasoning");
  assert.deepEqual(reasoningEvents.map((event) => event.block.phase), ["running", "complete", "running", "complete", "running", "unavailable"]);
  assert.deepEqual(reasoningEvents.map((event) => event.block.observation.sequence), [0, 0, 3, 3, 5, 5]);
  assert.deepEqual(reasoningEvents.map((event) => event.block.textOffset), [0, 0, 8, 8, 8, 8],
    "reasoning anchors exclude private tagged text and stay fixed through completion/settlement");
  const summaries = reasoningEvents.filter((event) => event.block.phase === "complete").map((event) => event.block);
  assert.equal(summaries.length, 2, "multiple native summary items remain separate; a duplicate cannot replace the first completed value");
  assert.match(summaries[0].text, /Check safe.ts/);
  assert.match(summaries[0].text, /redacted/);
  assert.equal(summaries[1].text, "Read the result.");
  for (const { block } of reasoningEvents) {
    assert.equal(block.representation, "provider-summary");
    assert.deepEqual(block.observation.producer, { harness: "hermes", version: null, protocol: "hermes-responses-v1" });
    assert.equal(block.observation.binding, "unavailable");
    if (block.phase !== "complete") {
      assert.equal(block.disclosure, "withheld");
      assert.equal(block.text, undefined);
    }
  }
  assert.equal(tools.length, 8, "request, complete arguments, execution and outcome are distinct; deltas remain private");
  assert.deepEqual(tools.map((event) => event.status), ["requested", "requested", "running", "ok", "requested", "requested", "ok", "unknown"]);
  assert.deepEqual(tools.map((event) => event.activity.sequence), [1, 1, 1, 1, 2, 4, 4, 2],
    "tools and reasoning share one first-observation sequence, without reordering on later updates");
  assert.equal(tools[6].output, undefined, "a completed tool with an unknown content-block shape retains only its outcome");
  assert.equal(tools[0].input, undefined, "partial initial arguments stay private too");
  assert.equal(tools[0].activity.schemaVersion, 1);
  assert.notEqual(tools[0].activity.runId, "client-send-token", "client correlation is not observation provenance");
  assert.deepEqual(tools[0].activity.producer, { harness: "hermes", version: null, protocol: "hermes-responses-v1" });
  for (const tool of tools) {
    assert.equal(tool.activity.callId, tool.id);
    assert.equal(tool.activity.phase, tool.status);
    assert.deepEqual(tool.activity.authority, { binding: "unavailable", approval: "unavailable", effect: "unavailable" });
    assert.equal(tool.activity.attemptId, tools[0].activity.attemptId);
    assert.equal(tool.activity.runId, tools[0].activity.runId);
  }
  const replay = subscribeRunStream("client-send-token", 0, () => {}, () => {});
  assert.ok(replay?.done);
  assert.deepEqual(replay.replay.map((entry) => JSON.parse(entry.json)).filter((event) => event.kind === "tool_use"), tools,
    "cursor replay preserves the already-projected observations without invoking the provider again");
  assert.deepEqual(replay.replay.map((entry) => JSON.parse(entry.json)).filter((event) => event.kind === "reasoning"), reasoningEvents);
  assert.doesNotMatch(JSON.stringify(replay.replay), /PRIVATE_LEGACY_SENTINEL|coven:attention|999999/);
  replay.unsubscribe();
  assert.equal(providerRequests, 1, "replay never re-executes a provider turn or tool");
  assert.match(tools[1].input, /safe.ts/);
  assert.match(tools[1].input, /redacted/);
  assert.equal(tools[3].status, "ok");
  assert.match(tools[3].output, /safe résultat/);
  assert.doesNotMatch(body, /sk-proj-|aaaaaaaa|private-result-value|user@example|private-id-sentinel|private-name-sentinel|signed-url-sentinel|opaque-signature-sentinel|opaque-metadata-sentinel/, "no credential prefix or fragment crosses the live stream");
  const done = events.findLast((event) => event.kind === "done");
  assert.equal(done.isError, false);
  assert.deepEqual(done.responseMetadata.runtimeIdentity, { schemaVersion: 1, harness: "hermes", version: null, model: "resolved-model-v3",
    activity: { schemaVersion: 1, path: "api", tools: "supported", reasoning: "supported" } });
  const identities = events.filter((event) => event.kind === "response_metadata");
  assert.equal(identities[0]?.responseMetadata.runtimeIdentity.model, null, "launch does not establish a model report");
  assert.deepEqual(identities.map((event) => event.responseMetadata.runtimeIdentity.model), [null, "resolved-model-v3"],
    "neither echoed request nor provisional route becomes a confirmed model");
  assert.ok(events.findIndex((event) => event.kind === "response_metadata" && event.responseMetadata.runtimeIdentity.model) >
    events.findLastIndex((event) => event.kind === "assistant_chunk"), "only the terminal runtime report confirms the served model");
  assert.deepEqual(identities.at(-1)?.responseMetadata.runtimeIdentity, done.responseMetadata.runtimeIdentity);
  assert.deepEqual(replay.replay.map((entry) => JSON.parse(entry.json)).filter((event) => event.kind === "response_metadata"), identities);
  assert.ok(events.findIndex((event) => event.kind === "response_metadata") < events.findIndex((event) => event.kind === "tool_use"), "runtime identity is visible before tools execute");
  const conversation = await loadConversation(done.sessionId);
  const saved = conversation.turns.at(-1);
  assert.equal(saved.text, expectedAnswer);
  assert.equal(saved.reasoning, undefined, "unclassified tagged reasoning is never a persisted summary");
  assert.deepEqual(saved.reasoningBlocks, [summaries[0], summaries[1], reasoningEvents.at(-1).block]);
  assert.equal(saved.responseMetadata.attentionRequest, undefined, "hidden reasoning cannot create an attention request");
  assert.equal(conversation.prUrl, undefined, "hidden reasoning cannot set the reported PR");
  assert.doesNotMatch(JSON.stringify(saved), /PRIVATE_|999999/);
  assert.doesNotMatch(ordinaryLogs.join("\n"), /PRIVATE_|999999/);
  assert.equal(saved.tools[0].textOffset, "Intro. \n".length, "saved tools align with the visible answer");
  assert.equal(saved.tools.length, 3);
  assert.deepEqual(saved.tools[0].activity, tools[3].activity);
  assert.deepEqual(saved.tools[1].activity, tools[7].activity);
  assert.deepEqual(saved.tools[2].activity, tools[6].activity);
  assert.deepEqual(saved.tools.map((tool) => tool.status), ["ok", "unknown", "ok"]);
  assert.equal(saved.tools[2].output, undefined);
  assert.match(saved.tools[0].input, /redacted/);
  assert.doesNotMatch(JSON.stringify(saved), /sk-proj-|aaaaaaaa|private-result-value|user@example|private-id-sentinel|private-name-sentinel|signed-url-sentinel|opaque-signature-sentinel|opaque-metadata-sentinel/);
  assert.deepEqual(saved.responseMetadata.runtimeIdentity, done.responseMetadata.runtimeIdentity);
  assert.doesNotMatch(ordinaryLogs.join("\n"), /sk-proj-|aaaaaaaa|private-result-value|user@example|private-id-sentinel|private-name-sentinel|signed-url-sentinel|opaque-signature-sentinel|opaque-metadata-sentinel/);

  const echoResponse = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId: "echo-only-send-token", familiarId: "ember", projectRoot: workspace, prompt: "Fixture without served identity" }),
  }));
  assert.equal(echoResponse.status, 200);
  const echoEvents = (await echoResponse.text()).split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
  assert.doesNotMatch(JSON.stringify(echoEvents), /PRIVATE_/);
  const echoDone = echoEvents.findLast((event) => event.kind === "done");
  assert.equal(echoDone.isError, false, "unavailable identity does not fail the turn");
  assert.equal(echoDone.responseMetadata.runtimeIdentity.model, null, "the current producer's echoed model remains unconfirmed");
  assert.ok(echoEvents.filter((event) => event.kind === "response_metadata").every((event) => event.responseMetadata.runtimeIdentity.model === null));
  const echoReplay = subscribeRunStream("echo-only-send-token", 0, () => {}, () => {});
  assert.ok(echoReplay?.done);
  assert.deepEqual(echoReplay.replay.map((entry) => JSON.parse(entry.json)).filter((event) => event.kind === "response_metadata"),
    echoEvents.filter((event) => event.kind === "response_metadata"));
  echoReplay.unsubscribe();
  const echoSaved = (await loadConversation(echoDone.sessionId)).turns.at(-1);
  assert.doesNotMatch(JSON.stringify(echoSaved), /PRIVATE_/);
  assert.equal(echoSaved.tools[2].output, undefined, "an opaque single content block cannot bypass the result decoder either");
  assert.equal(echoSaved.responseMetadata.runtimeIdentity.model, null, "history does not upgrade an echoed request into a report");
  assert.equal(providerRequests, 2, "two explicit turns; neither replay dispatches the provider");
  originalConsole.log("route-hermes-disclosure.integration.test.ts: ok");
} catch (error) {
  originalConsole.error(error);
  throw error;
} finally {
  for (const method of consoleMethods) console[method] = originalConsole[method];
  await new Promise((resolve) => server.close(resolve));
  for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
  Object.assign(process.env, previousEnv);
  await rm(home, { recursive: true, force: true });
}
