// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildPromptWithAttachments,
  IMAGE_ATTACHMENTS_UNSUPPORTED_NOTE,
  MAX_ATTACHMENT_IMAGE_BYTES,
  normalizeChatAttachments,
} from "../../../../lib/chat-attachments.ts";
import {
  flattenToolResultContent,
  formatToolInputValue,
  formatToolPayload,
  ToolCallTracker,
  toPersistedTools,
} from "../../../../lib/chat-tool-events.ts";
import {
  CodexJsonlDecoder,
  resolveCodexSchema,
} from "../../../../lib/codex-compatibility.ts";

const chatRoute = await readFile(
  new URL("./route.ts", import.meta.url),
  "utf8",
);
const streamEvents = await readFile(
  new URL("../../../../lib/stream-events.ts", import.meta.url),
  "utf8",
);
const openclawBridge = await readFile(
  new URL("../../../../lib/openclaw-bridge.ts", import.meta.url),
  "utf8",
);
const boardRoute = await readFile(
  new URL("../../board/enrich-steps/route.ts", import.meta.url),
  "utf8",
);
const chatView = await readFile(
  new URL("../../../../components/chat-view.tsx", import.meta.url),
  "utf8",
);
// ── Tool-event fidelity (CHAT-D4-03 + CHAT-D4-04) ──────────────────────────
// Source pins: the route must route BOTH tool-event sources through the
// shared ToolCallTracker — hook lines and stream-json envelope blocks — and
// must no longer key open calls by bare tool name.

assert.match(
  chatRoute,
  /let toolTracker = new ToolCallTracker\(Date\.now, `attempt-\$\{toolAttempt\}-`\);/,
  "Native chat should track open tool calls with the shared ToolCallTracker",
);

assert.doesNotMatch(
  chatRoute,
  /toolStartTimes/,
  "The name-keyed toolStartTimes map merged concurrent same-name calls (CHAT-D4-03) and must stay gone",
);

assert.match(
  chatRoute,
  /toolTracker\.hookEnd\([\s\S]*?toolTracker\.hookStart\(/,
  "Hook lines should feed the tracker so posts pair FIFO with the oldest open pre",
);

assert.match(
  chatRoute,
  /block\.type === "tool_use" && block\.id && block\.name[\s\S]*?toolTracker\.envelopeToolUse\(/,
  "Assistant envelope tool_use blocks should surface as running tool events (CHAT-D4-04)",
);

assert.match(
  chatRoute,
  /ev\.type === "user" && Array\.isArray\(ev\.message\?\.content\)[\s\S]*?block\.type === "tool_result" && block\.tool_use_id[\s\S]*?toolTracker\.envelopeToolResult\(/,
  "User envelope tool_result blocks should settle the matching tool event (CHAT-D4-04)",
);

assert.match(
  chatRoute,
  /settleToolCallsBeforeRetry\(\);[\s\S]*?toolAttempt \+= 1;[\s\S]*?toolTracker = new ToolCallTracker\(Date\.now, `attempt-\$\{toolAttempt\}-`\);/,
  "Retries settle announced tools before resetting per-attempt state, so live bubbles cannot remain running",
);

assert.match(
  chatRoute,
  /toolTracker\.hookStart\(name, formatToolPayload\(rest\), assistantText\.length\)/,
  "hook tool starts are stamped with the current assistant-text offset",
);

assert.match(
  chatRoute,
  /formatToolInputValue\(block\.input\),\s*assistantText\.length,/,
  "envelope tool starts are stamped with the current assistant-text offset",
);

assert.match(
  chatRoute,
  /toPersistedTools\(\[\.\.\.retrySettledTools, \.\.\.toolTracker\.snapshot\(\)\]/,
  "the saved assistant turn captures both retry-settled and final tool state",
);

assert.match(
  chatRoute,
  /hermesApiConfig\(harnessSpawnEnv\(body\.familiarId\) as \{/,
  "Hermes API credentials must come through the familiar-scoped environment boundary",
);

assert.match(
  chatRoute,
  /if \(hermesApi\) return runHermesApiAttempt\(apiPrompt\);/,
  "a configured Hermes API must use the structured Responses SSE transport rather than terminal scraping",
);

assert.match(
  chatRoute,
  /hermesDirect && !hermesApi[\s\S]*?Hermes tool activity unavailable[\s\S]*?HERMES_API_URL/,
  "the CLI fallback must disclose that structured tool activity is unavailable and how to enable it",
);

assert.match(
  chatRoute,
  /parseHermesResponsesEvent\(frame\.event, payload\)[\s\S]*?toolTracker\.envelopeToolUse\([\s\S]*?toolTracker\.envelopeToolResult\(/,
  "Hermes structured tool starts and completions must flow through the shared persistent tracker",
);

assert.match(
  chatRoute,
  /previous_response_id: previousResponseId/,
  "Hermes API follow-ups must continue from the stored Responses id, not Cave's stable conversation id",
);

assert.match(
  chatRoute,
  /req\.signal\.addEventListener\("abort", onAbort, \{ once: true \}\)[\s\S]*?req\.signal\.removeEventListener\("abort", onAbort\)/,
  "Hermes API attempts must arm and clean up the shared detached-stream deadline",
);

assert.match(
  chatRoute,
  /text\/event-stream[\s\S]*?Hermes API protocol error/,
  "Hermes API attempts must reject successful non-SSE responses",
);

assert.match(
  chatRoute,
  /frame\.data === "\[DONE\]"\) return true[\s\S]*?await reader\.cancel\(\)/,
  "the Responses DONE sentinel must stop a still-open SSE reader",
);

assert.match(
  chatRoute,
  /!terminal && !abort\.signal\.aborted[\s\S]*?Hermes API stream ended before a terminal event/,
  "an SSE EOF without a terminal event must be persisted as an error, never a completed response",
);

assert.match(
  chatRoute,
  /if \(abort\.signal\.aborted\) \{[\s\S]*?!runHandle\.stopRequested[\s\S]*?Hermes API stream aborted after client disconnect/,
  "a detach-time Hermes fetch abort must persist as an error while explicit Stop remains a cancellation",
);

assert.match(
  chatRoute,
  /isHermesInvalidPreviousResponseIdError\(apiError\)[\s\S]*?resumeFailed = true/,
  "only a structured invalid previous Responses id may use the fresh-session retry",
);

assert.match(
  chatRoute,
  /response\.status === 404 && isHermesMissingPreviousResponseError\(apiError\)/,
  "Hermes's documented missing previous-response 404 must use the safe fresh-session retry",
);

assert.match(
  chatRoute,
  /event\.isError && previousResponseId && event\.invalidPreviousResponseId[\s\S]*?previousResponseId && event\.invalidPreviousResponseId/,
  "streamed model and tool failures must not retry unless they explicitly reject the previous Responses id",
);

assert.match(
  chatRoute,
  /await runAttempt\(buildArgs\(null, retry\.prompt\), retry\.prompt\);/,
  "the Responses fresh-session retry must receive replayed conversation context",
);

assert.match(
  chatRoute,
  /await response\.body\?\.cancel\(\)\.catch\(\(\) => undefined\)/,
  "rejected Hermes responses must cancel their body before returning the connection to the pool",
);

assert.match(
  chatRoute,
  /settleOpenHermesTools[\s\S]*?toolTracker\.failOpenCalls[\s\S]*?kind: "tool_use"/,
  "every terminal Hermes attempt must emit interrupted updates for open tool calls",
);

assert.match(
  chatRoute,
  /pushProgress\("harness-start", "Starting Hermes API", "running"\);/,
  "Hermes API progress must not disclose the configured endpoint",
);

assert.doesNotMatch(
  chatRoute,
  /Starting Hermes API", "running", hermesApi\.baseUrl/,
  "Hermes API URLs may contain reverse-proxy credentials and must never reach the stream",
);

assert.match(
  chatRoute,
  /envelopeToolUse\(event\.id, event\.name, input, assistantText\.length\)[\s\S]*?envelopeToolInput\(event\.id, input\)/,
  "a canonical duplicate Hermes tool start must refresh the existing bubble input",
);

assert.match(
  chatRoute,
  /redirect: "error"/,
  "Hermes API requests must reject redirects rather than crossing the validated endpoint boundary",
);

assert.match(
  chatRoute,
  /redactSecretsDeep\(event\.output\)[\s\S]*?flattenToolResultContent\(safeOutput\) \?\? formatToolInputValue\(safeOutput\)/,
  "structured Hermes function output must display supported text blocks without exposing tool-supplied credentials",
);

assert.match(
  chatRoute,
  /if \(event\.isError\) recordStdoutErrorTail\("Hermes API stream failed", true\)[\s\S]*?recordStdoutErrorTail\("Hermes API stream failed", true\)/,
  "terminal Hermes failures must persist only a fixed diagnostic, never endpoint-provided error text",
);

assert.match(
  chatRoute,
  /JSON\.parse\(frame\.data\)[\s\S]*?Hermes API protocol error: malformed SSE payload[\s\S]*?return true/,
  "malformed Hermes SSE data must fail and terminate the attempt rather than allowing a later terminal frame to succeed",
);

assert.match(
  chatRoute,
  /if \(!frame\.data\.trim\(\)\) return false;[\s\S]*?if \(frame\.data === "\[DONE\]"\) return true;/,
  "empty Hermes SSE keepalive frames must be ignored before JSON parsing",
);

assert.match(
  chatRoute,
  /case "done":\s*if \(event\.id\) \{\s*hermesResponseId = event\.id;\s*if \(!sessionId\) announceSession\(event\.id\);/,
  "terminal Responses events must retain response ids even when no earlier session event arrived",
);

assert.match(
  chatRoute,
  /hermesDirect && hermesApi\s*\? !result\.is_error && hermesResponseId\s*\? hermesResponseId\s*:\s*existingConversation\?\.harnessSessionId \?\? null/,
  "failed Hermes API turns must retain only a prior successful Responses id, never a failed first-turn id",
);

assert.match(
  chatRoute,
  /hermesCallNamesById\.set\(event\.id, event\.name\)[\s\S]*?if \(event\.isFinal\) \{\s*const name = hermesCallNamesById\.get\(id\);\s*if \(name\) boundarySentinel\?\.observe\(name, next\);/,
  "final streamed Hermes tool arguments must pass through the runtime boundary sentinel",
);

assert.match(
  chatRoute,
  /\.\.\.\(persistedTools \? \{ tools: persistedTools \} : \{\}\)/,
  "tools persist on the assistant turn alongside usage and cost",
);

// Behavioral: per-name FIFO queue gives overlapping same-name calls distinct
// ids and pairs each post with the oldest open pre (correct durations).
{
  let t = 0;
  const tracker = new ToolCallTracker(() => t);

  const first = tracker.hookStart("Bash", '{"command":"sleep 5"}');
  t = 100;
  const second = tracker.hookStart("Bash", '{"command":"ls"}');
  assert.notEqual(
    first.id,
    second.id,
    "two overlapping Bash calls must get distinct ids",
  );
  assert.equal(first.status, "running");
  assert.equal(second.status, "running");

  t = 250;
  const firstDone = tracker.hookEnd("Bash", '{"exitCode":0}', false);
  assert.equal(firstDone.id, first.id, "first post pairs with the FIRST open pre (FIFO)");
  assert.equal(firstDone.status, "ok");
  assert.equal(firstDone.durationMs, 250, "duration measured from the first call's own start");

  t = 400;
  const secondDone = tracker.hookEnd("Bash", '{"exitCode":1}', true);
  assert.equal(secondDone.id, second.id, "second post pairs with the remaining open call");
  assert.equal(secondDone.status, "error");
  assert.equal(secondDone.durationMs, 300, "duration measured from the second call's own start");
}

// Responses function calls are announced before their standard argument-delta
// stream completes. Updating the same envelope id must replace the partial
// input in both the live event and the persisted snapshot.
{
  const tracker = new ToolCallTracker();
  const started = tracker.envelopeToolUse("call-args", "shell");
  assert.ok(started);
  const partial = tracker.envelopeToolInput("call-args", '{"command":');
  assert.deepEqual(partial, { id: "call-args", name: "shell", input: '{"command":', status: "running" });
  const complete = tracker.envelopeToolInput("call-args", '{"command":"pwd"}');
  assert.deepEqual(complete, { id: "call-args", name: "shell", input: '{"command":"pwd"}', status: "running" });
  assert.equal(tracker.snapshot()[0]?.input, '{"command":"pwd"}');
}

// Hermes progress may announce the native id before the canonical Responses
// item supplies final arguments. The route's duplicate-start update preserves
// the one stable bubble while replacing that incomplete input.
{
  const tracker = new ToolCallTracker();
  tracker.envelopeToolUse("call-progress", "shell");
  assert.deepEqual(
    tracker.envelopeToolUse("call-progress", "shell", '{"command":"pwd"}'),
    { id: "call-progress", name: "shell", input: '{"command":"pwd"}', status: "running" },
    "the canonical duplicate start refreshes the existing stable bubble",
  );
  const refreshed = tracker.envelopeToolInput("call-progress", '{"command":"pwd"}');
  assert.deepEqual(refreshed, {
    id: "call-progress", name: "shell", input: '{"command":"pwd"}', status: "running",
  });
  assert.equal(tracker.snapshot()[0]?.input, '{"command":"pwd"}');
}

// A terminal stream failure must settle the SAME live tool id, so the UI and
// persisted turn agree instead of leaving a running bubble until refresh.
{
  let t = 0;
  const tracker = new ToolCallTracker(() => t);
  const started = tracker.envelopeToolUse("call-interrupted", "shell", '{"command":"pwd"}');
  assert.ok(started);
  t = 250;
  assert.deepEqual(tracker.failOpenCalls("[stream ended]"), [{
    id: "call-interrupted",
    name: "shell",
    output: "[stream ended]",
    status: "error",
    durationMs: 250,
  }]);
  assert.deepEqual(tracker.failOpenCalls(), [], "settling open calls twice must not duplicate tool events");
  assert.equal(tracker.snapshot()[0]?.status, "error");
}

// Behavioral: a post with no open call still surfaces, under a fresh id.
{
  const tracker = new ToolCallTracker(() => 0);
  const orphan = tracker.hookEnd("Edit", "done", false);
  assert.ok(orphan.id, "orphan post still gets an id");
  assert.equal(orphan.status, "ok");
  assert.equal(orphan.durationMs, undefined, "no start time means no fabricated duration");
}

// Native Codex item ids are scoped to one invocation. A transparent retry can
// restart at item_0, so the UI keys must remain attempt-scoped while terminal
// frames continue to resolve by their original native id.
{
  const firstAttempt = new ToolCallTracker(() => 0, "attempt-0-");
  const retryAttempt = new ToolCallTracker(() => 0, "attempt-1-");
  const first = firstAttempt.envelopeToolUse("item_0", "Bash");
  const retry = retryAttempt.envelopeToolUse("item_0", "Bash");
  assert.notEqual(first?.id, retry?.id, "reused native item ids never overwrite a prior retry bubble");
  assert.equal(firstAttempt.envelopeToolResult("item_0", "first", false)?.id, first?.id);
  assert.equal(retryAttempt.envelopeToolResult("item_0", "second", false)?.id, retry?.id);
}

// item.updated may fill in arguments after a bare item.started. It updates the
// existing live bubble rather than creating a second call.
{
  const tracker = new ToolCallTracker(() => 0, "attempt-0-");
  const started = tracker.envelopeToolUse("item-input", "Bash");
  const updated = tracker.envelopeToolUse("item-input", "Bash", '{"command":"pwd"}');
  assert.equal(updated?.id, started?.id, "richer input updates the original native bubble");
  assert.equal(updated?.input, '{"command":"pwd"}');
  tracker.envelopeToolResult("item-input", "ok", false);
  assert.equal(tracker.snapshot()[0]?.input, '{"command":"pwd"}', "updated input persists with the settled call");
}

// Behavioral: transparent retries preserve the first attempt's settled hook
// activity, so a replacement tracker must not mint the same UI merge key.
{
  const firstAttempt = new ToolCallTracker(() => 0, "attempt-0-");
  const retryAttempt = new ToolCallTracker(() => 0, "attempt-1-");
  const first = firstAttempt.hookStart("Bash", '{"command":"pwd"}');
  const retry = retryAttempt.hookStart("Bash", '{"command":"pwd"}');
  assert.notEqual(first.id, retry.id, "same-name hook calls from separate attempts keep distinct live and persisted ids");
}

// Behavioral: envelope-only harnesses (no pre/post_tool_use hooks) get a full
// running → settled lifecycle from the stream-json blocks alone.
{
  let t = 0;
  const tracker = new ToolCallTracker(() => t);
  const running = tracker.envelopeToolUse(
    "toolu_01",
    "Bash",
    formatToolInputValue({ command: "ls" }),
  );
  assert.ok(running, "envelope tool_use must surface as a tool event");
  assert.equal(running.id, "toolu_01", "envelope events keep the native tool_use id");
  assert.equal(running.status, "running");
  assert.match(running.input ?? "", /"command": "ls"/, "envelope input is pretty-printed");

  assert.equal(
    tracker.envelopeToolUse("toolu_01", "Bash"),
    null,
    "a repeated tool_use block for the same native id is deduped",
  );

  t = 1200;
  const settled = tracker.envelopeToolResult(
    "toolu_01",
    flattenToolResultContent([{ type: "text", text: "file-a\nfile-b" }]),
    false,
  );
  assert.ok(settled, "envelope tool_result must settle the call");
  assert.equal(settled.id, "toolu_01");
  assert.equal(settled.status, "ok");
  assert.equal(settled.output, "file-a\nfile-b");
  assert.equal(settled.durationMs, 1200);

  const errored = tracker.envelopeToolUse("toolu_02", "Bash");
  assert.ok(errored);
  const erroredDone = tracker.envelopeToolResult("toolu_02", "boom", true);
  assert.equal(erroredDone?.status, "error", "is_error tool_result blocks settle as errors");
}

// Behavioral: hook events win when hooks AND envelopes describe the same
// call — envelope blocks are linked onto the hook's id (UI merges on id) or
// suppressed once the hook has settled the call.
{
  // Envelope first (assistant message flushes before the tool executes).
  let t = 0;
  const tracker = new ToolCallTracker(() => t);
  const announced = tracker.envelopeToolUse("toolu_a", "Bash", '{"command":"pwd"}');
  assert.ok(announced);

  t = 50;
  const hookRunning = tracker.hookStart("Bash", '{"command":"pwd"}');
  assert.equal(
    hookRunning.id,
    "toolu_a",
    "the hook pre claims the envelope-announced call's id so the UI merges them",
  );

  t = 350;
  const hookDone = tracker.hookEnd("Bash", '{"exitCode":0}', false);
  assert.equal(hookDone.id, "toolu_a");
  assert.equal(hookDone.durationMs, 300, "duration baselined at the hook pre, not envelope parse");

  assert.equal(
    tracker.envelopeToolResult("toolu_a", "pwd output", false),
    null,
    "the envelope tool_result is suppressed once the post hook settled the call",
  );
}

{
  // Hook first (interleaving can deliver the hook line before the envelope).
  const tracker = new ToolCallTracker(() => 0);
  const hookRunning = tracker.hookStart("Read", '{"file_path":"/tmp/x"}');
  assert.equal(
    tracker.envelopeToolUse("toolu_b", "Read", '{"file_path":"/tmp/x"}'),
    null,
    "the envelope tool_use links to the already-announced hook call instead of duplicating",
  );
  const hookDone = tracker.hookEnd("Read", "contents", false);
  assert.equal(hookDone.id, hookRunning.id);
  assert.equal(
    tracker.envelopeToolResult("toolu_b", "contents", false),
    null,
    "the linked native id dedups the tool_result after the hook settled the call",
  );
}

// Behavioral: payload formatters used by both event sources.
{
  assert.equal(formatToolPayload(""), undefined);
  assert.equal(formatToolPayload("not json"), "not json");
  assert.equal(formatToolPayload('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(formatToolInputValue(undefined), undefined);
  assert.equal(formatToolInputValue({}), undefined, "empty input objects stay blank");
  assert.equal(formatToolInputValue({ a: 1 }), '{\n  "a": 1\n}');
  assert.equal(flattenToolResultContent("plain"), "plain");
  assert.equal(
    flattenToolResultContent([
      { type: "text", text: "one" },
      { type: "text", text: "two" },
    ]),
    "one\ntwo",
  );
  assert.equal(
    flattenToolResultContent([{ type: "input_text", text: "tool output" }]),
    "tool output",
    "Responses function output blocks flatten to their text rather than protocol scaffolding",
  );
  assert.equal(flattenToolResultContent(null), undefined);
}

// ── Token usage + cost capture (CHAT-D12-02) ───────────────────────────────
// Source pins: the stream-json `result` parse must capture `total_cost_usd`
// and `usage` through the shared defensive validators, forward both on the
// `done` SSE event, and persist them on the saved assistant turn.

import {
  formatCost,
  formatTokens,
  normalizeTurnUsage,
  parseCostUsd,
  parseStreamJsonUsage,
  usageBreakdown,
  usageSummary,
} from "../../../../lib/usage-format.ts";

assert.match(
  chatRoute,
  /if \(ev\.type === "result"\) \{[\s\S]*?usage: parseStreamJsonUsage\(ev\.usage\),[\s\S]*?costUsd: parseCostUsd\(ev\.total_cost_usd\),/,
  "The result-event parse must capture usage and total_cost_usd through the defensive validators (CHAT-D12-02)",
);

assert.match(
  chatRoute,
  /const codexLaunch = codexHarnessEnv[\s\S]*?codexLaunchCommand\(codexBin\(codexHarnessEnv\)\)/,
  "Codex parsing must probe the same credential-sanitized executable it later launches",
);

assert.doesNotMatch(
  chatRoute,
  /codex_jsonl\?: boolean|ev\.codex_jsonl/,
  "generic captured stdout cannot self-attest as Codex JSONL from assistant-authored content",
);

assert.match(
  chatRoute,
  /let codexDecoder: CodexJsonlDecoder \| null = codexDirect[\s\S]*?new CodexJsonlDecoder\(\{ trustThreadPreamble: true \}\)/,
  "Codex JSONL decoding is created only for Cave's direct native process channel",
);

assert.match(
  chatRoute,
  /const selectedCodexDirect = codexCompatibility\?\.ok === true;[\s\S]*?const codexCapabilities = codexCompatibility\?\.ok === true[\s\S]*?codexCapabilities\?\.skipGitRepoCheck === true[\s\S]*?codexCapabilities\.resumeJson === true[\s\S]*?\["exec", "resume", "--json"\][\s\S]*?codexCapabilities\?\.color === true[\s\S]*?codexCapabilities\?\.resumeSkipGitRepoCheck === true[\s\S]*?command: codexLaunch\.command,[\s\S]*?\.\.\.codexLaunch\.fixedArgs/,
  "a selected local Codex schema launches its authenticated native JSONL pipe only after probing the fresh and resume argv contracts",
);

assert.match(
  chatRoute,
  /const retrySettledTools: RecordedToolEvent\[\] = \[\];[\s\S]*?retrySettledTools\.push\(\.\.\.toolTracker\.snapshot\(\)\);[\s\S]*?toPersistedTools\(\[\.\.\.retrySettledTools, \.\.\.toolTracker\.snapshot\(\)\]/,
  "retry-settled tool records are retained for reload parity with live SSE",
);

assert.match(
  chatRoute,
  /Codex emitted an unsupported tool event; continuing in plain chat/,
  "unknown Codex shapes surface a visible plain-chat compatibility diagnostic",
);

assert.match(
  chatRoute,
  /const safeDirectCodexFailure = binding\.harness === "codex" && codexDirect;[\s\S]*?const tailSource = safeDirectCodexFailure \? \[\] : \(stderrTail\.length \? stderrTail : stdoutErrTail\);[\s\S]*?_The Codex CLI failed/,
  "direct Codex failures use a payload-free transcript diagnostic instead of raw stderr",
);

assert.match(
  chatRoute,
  /case "text":[\s\S]*?assistantText \+= event\.text;[\s\S]*?kind: "assistant_chunk", text: event\.text/,
  "known Codex agent-message items bypass the legacy transcript phase gate and preserve assistant prose",
);

assert.match(
  chatRoute,
  /let codexHarnessSessionId: string \| null = null;[\s\S]*?codexHarnessSessionId = event\.sessionId/,
  "Codex's resume handle is retained separately from Cave's stable conversation id",
);

assert.match(
  chatRoute,
  /const MAX_DIRECT_CODEX_STDOUT_RECORD_CHARS = 256 \* 1024;[\s\S]*?discardingOversizedDirectCodexRecord[\s\S]*?line\.length > MAX_DIRECT_CODEX_STDOUT_RECORD_CHARS[\s\S]*?jsonBuf\.length > MAX_DIRECT_CODEX_STDOUT_RECORD_CHARS/,
  "direct Codex stdout bounds unterminated and complete records before JSONL buffering",
);

assert.match(
  chatRoute,
  /ev\.type === "output" && typeof ev\.text === "string"[\s\S]*?recordStdoutErrorTail\(passthrough\)[\s\S]*?assistantFilter\.push\(passthrough\)/,
  "Coven stream-json output events must preserve error-looking transcript passthrough for empty-response diagnostics before filtering",
);

// Behavioral: Windows captured pipes can coalesce prose and several JSONL
// records, then close without a final newline. Drive the same decoder and
// tracker pair used by the route and assert the ordered SSE/persistence shape
// rather than inferring it from source text.
{
  const resolution = resolveCodexSchema({
    version: "0.145.0",
    capabilities: { jsonEvents: true, resume: true },
  });
  assert.ok(resolution.ok, "fixture runtime resolves a Codex schema");
  if (!resolution.ok) throw new Error("fixture schema unavailable");

  const decoder = new CodexJsonlDecoder({ trustThreadPreamble: true });
  const tracker = new ToolCallTracker(() => 0);
  const sse: Array<{ kind: string; id?: string; status?: string; text?: string }> = [];
  let text = "";
  let threadId: string | null = null;
  const routeCapturedOutput = (chunk: string) => {
    for (const token of decoder.push(chunk, resolution.schema).tokens) {
      if (token.kind === "passthrough") {
        text += token.text;
        sse.push({ kind: "assistant_chunk", text: token.text });
      } else if (token.kind === "session") {
        threadId = token.sessionId;
      } else if (token.kind === "tool_start") {
        const tool = tracker.envelopeToolUse(token.id, token.name, formatToolInputValue(token.input), text.length);
        if (tool) sse.push({ kind: "tool_use", id: tool.id, status: tool.status });
      } else if (token.kind === "tool_end") {
        const tool = tracker.envelopeToolResult(token.id, token.output, token.isError);
        if (tool) sse.push({ kind: "tool_use", id: tool.id, status: tool.status });
      } else if (token.kind === "text") {
        text += token.text;
        sse.push({ kind: "assistant_chunk", text: token.text });
      }
    }
  };

  routeCapturedOutput('notice\ncodex\n{"type":"thread.started","thread_id":"thread-captured"}\n{"type":"item.started","item":{"id":"call-captured","type":"command_execution","command":"pwd"}}\n');
  routeCapturedOutput('{"type":"item.completed","item":{"id":"call-captured","type":"command_execution","exit_code":2}}\n{"type":"item.completed","item":{"id":"answer-captured","type":"agent_message","text":"answer"}}');
  routeCapturedOutput("\n"); // equivalent to the route's close-time flush

  assert.equal(threadId, "thread-captured", "captured thread id is retained for resume");
  assert.deepEqual(
    sse.map((event) => [event.kind, event.status ?? event.text]),
    [["assistant_chunk", "notice\n"], ["tool_use", "running"], ["tool_use", "error"], ["assistant_chunk", "answer"]],
    "mixed captured chunks preserve assistant/tool SSE ordering and settle nonzero exits as errors",
  );
  assert.deepEqual(
    toPersistedTools(tracker.snapshot(), 0).map((tool) => [tool.id, tool.status, tool.textOffset]),
    [["call-captured", "error", 7]],
    "the same stable tool lifecycle is retained for persistence with its prose offset",
  );
}

assert.match(
  streamEvents,
  /kind: "done";[\s\S]*?usage\?: TurnUsage;[\s\S]*?costUsd\?: number;/,
  "The done StreamEvent must carry optional usage and costUsd fields (CHAT-D12-02)",
);

assert.match(
  chatRoute,
  /kind: "done",\s*\n\s*durationMs: result\.duration_ms,\s*\n\s*isError: result\.is_error,\s*\n\s*sessionId: finalSessionId \?\? undefined,\s*\n\s*\.\.\.\(result\.usage \? \{ usage: result\.usage \} : \{\}\),\s*\n\s*\.\.\.\(result\.costUsd !== undefined \? \{ costUsd: result\.costUsd \} : \{\}\),/,
  "The final done event must forward captured usage and cost, omitting them when the harness emitted none (CHAT-D12-02)",
);

assert.match(
  chatRoute,
  /durationMs: result\.duration_ms,\s*\n\s*isError: result\.is_error,\s*\n\s*\.\.\.\(cancelledByUser \? \{ cancelled: true \} : \{\}\),\s*\n\s*\.\.\.\(result\.usage \? \{ usage: result\.usage \} : \{\}\),\s*\n\s*\.\.\.\(result\.costUsd !== undefined \? \{ costUsd: result\.costUsd \} : \{\}\),/,
  "The persisted assistant turn must carry usage and cost alongside durationMs (CHAT-D12-02)",
);

// Behavioral: stream-json usage parse is defensive — optional fields,
// validated numbers, undefined when nothing usable was emitted.
{
  assert.deepEqual(
    parseStreamJsonUsage({
      input_tokens: 10200,
      output_tokens: 2150,
      cache_read_input_tokens: 5000,
      cache_creation_input_tokens: 1200,
    }),
    {
      inputTokens: 10200,
      outputTokens: 2150,
      cacheReadTokens: 5000,
      cacheCreationTokens: 1200,
    },
    "a full usage block maps snake_case counters onto the turn shape",
  );
  assert.deepEqual(
    parseStreamJsonUsage({ input_tokens: 12, output_tokens: 34 }),
    { inputTokens: 12, outputTokens: 34 },
    "cache counters are optional and omitted when absent",
  );
  assert.equal(parseStreamJsonUsage(undefined), undefined, "missing usage stays absent");
  assert.equal(parseStreamJsonUsage(null), undefined);
  assert.equal(parseStreamJsonUsage("12k"), undefined, "non-object usage is rejected");
  assert.equal(parseStreamJsonUsage({}), undefined, "empty usage objects stay absent");
  assert.equal(
    parseStreamJsonUsage({ input_tokens: "12", output_tokens: NaN }),
    undefined,
    "non-numeric and NaN counters are rejected",
  );
  assert.deepEqual(
    parseStreamJsonUsage({ input_tokens: 7, output_tokens: -3, cache_read_input_tokens: -1 }),
    { inputTokens: 7, outputTokens: 0 },
    "negative counters drop; partial blocks keep the valid fields",
  );
}

// Behavioral: cost validation.
{
  assert.equal(parseCostUsd(0.0812), 0.0812);
  assert.equal(parseCostUsd(0), 0, "zero cost is captured (display layer hides it)");
  assert.equal(parseCostUsd(-1), undefined);
  assert.equal(parseCostUsd(NaN), undefined);
  assert.equal(parseCostUsd("0.08"), undefined);
  assert.equal(parseCostUsd(undefined), undefined);
}

// Behavioral: persisted camelCase round-trip validator (conversation POST/PUT).
{
  assert.deepEqual(
    normalizeTurnUsage({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 }),
    { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 },
  );
  assert.equal(normalizeTurnUsage({}), undefined);
  assert.equal(normalizeTurnUsage({ inputTokens: "10" }), undefined);
}

// Behavioral: formatting thresholds, sub-cent floor, absent states.
{
  assert.equal(formatTokens(980), "980");
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1000), "1k", "trailing .0 is trimmed");
  assert.equal(formatTokens(1234), "1.2k");
  assert.equal(formatTokens(12350), "12.4k", "12350 tokens read as 12.4k");
  assert.equal(formatTokens(999_950), "1M", "rounded token counts should promote across suffix boundaries");
  assert.equal(formatTokens(2_500_000), "2.5M");
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(-5), null);
  assert.equal(formatTokens(NaN), null);

  assert.equal(formatCost(0.08), "$0.08");
  assert.equal(formatCost(1.5), "$1.50");
  assert.equal(formatCost(0.004), "<$0.01", "sub-cent costs floor at <$0.01");
  assert.equal(formatCost(0), null, "zero cost renders nothing");
  assert.equal(formatCost(undefined), null);
  assert.equal(formatCost(-0.5), null);

  assert.equal(
    usageSummary({ inputTokens: 10200, outputTokens: 2150 }, 0.0812),
    "12.4k tok · $0.08",
    "the compact form sums input+output and appends the cost",
  );
  assert.equal(
    usageSummary({ inputTokens: 500, outputTokens: 480 }, undefined),
    "980 tok",
    "cost-less usage shows tokens alone",
  );
  assert.equal(usageSummary(undefined, 0.05), "$0.05", "cost without usage still shows");
  assert.equal(usageSummary(undefined, undefined), null, "no usage, no cost → nothing renders");
  assert.equal(usageSummary({ inputTokens: 0, outputTokens: 0 }, 0), null, "all-zero usage renders nothing");

  assert.equal(
    usageBreakdown(
      { inputTokens: 10200, outputTokens: 2150, cacheReadTokens: 5000, cacheCreationTokens: 1200 },
      0.0812,
    ),
    "input 10200 · output 2150 · cache read 5000 · cache write 1200 · $0.08",
    "the tooltip breakdown lists every captured counter",
  );
  assert.equal(
    usageBreakdown({ inputTokens: 1, outputTokens: 2 }, 0.004),
    "input 1 · output 2 · $0.0040",
    "sub-cent tooltip costs keep precision instead of flooring",
  );
  assert.equal(usageBreakdown(undefined, undefined), null);
}

// ── Tool persistence: tracker recording + snapshot (spec 2026-06-12) ────────
{
  let t = 0;
  const tracker = new ToolCallTracker(() => t);
  tracker.hookStart("Bash", '{"command":"ls"}', 12);
  t = 1500;
  tracker.hookEnd("Bash", "file-list", false);
  const snap = tracker.snapshot();
  assert.equal(snap.length, 1, "snapshot keeps the settled hook call");
  assert.equal(snap[0].name, "Bash");
  assert.equal(snap[0].status, "ok");
  assert.equal(snap[0].durationMs, 1500);
  assert.equal(snap[0].textOffset, 12, "offset stamped at start survives the end merge");
  assert.equal(snap[0].input, '{"command":"ls"}', "input stored verbatim — the route formats before calling");
  assert.equal(snap[0].output, "file-list");
}

{
  let t = 0;
  const tracker = new ToolCallTracker(() => t);
  tracker.envelopeToolUse("toolu_x", "Read", '{"file":"a.ts"}', 40);
  t = 250;
  tracker.envelopeToolResult("toolu_x", "contents", false);
  const snap = tracker.snapshot();
  assert.equal(snap.length, 1, "envelope lifecycle recorded once");
  assert.equal(snap[0].id, "toolu_x");
  assert.equal(snap[0].textOffset, 40);
  assert.equal(snap[0].status, "ok");
  assert.equal(snap[0].durationMs, 250);
}

{
  // A terminated JSONL stream must settle the same live id that started the
  // bubble; otherwise the client spinner stays running until a reload.
  let t = 0;
  const tracker = new ToolCallTracker(() => t);
  tracker.envelopeToolUse("codex-open", "Bash", '{"command":"pwd"}', 3);
  t = 400;
  const [settled] = tracker.settleOpenCalls();
  assert.deepEqual(
    settled,
    {
      id: "codex-open",
      name: "Bash",
      output: "[tool did not settle before the turn ended]",
      status: "error",
      durationMs: 400,
    },
    "an unterminated tool becomes a terminal error with its original stream id",
  );
  assert.equal(tracker.settleOpenCalls().length, 0, "terminal settlement is idempotent");
  assert.equal(tracker.snapshot()[0]?.status, "error", "the settled state is what persistence sees");
}

{
  // A Codex tool can fail before the runtime writes its start frame (for
  // example, while validating its sandbox). Preserve a terminal bubble keyed
  // by the native id instead of silently dropping that failure.
  const tracker = new ToolCallTracker(() => 0);
  const failed = tracker.envelopeToolResult(
    "codex-preflight-failure",
    "permission denied",
    true,
    { name: "Bash", input: '{"command":"pwd"}', textOffset: 2 },
  );
  assert.deepEqual(failed, {
    id: "codex-preflight-failure",
    name: "Bash",
    output: "permission denied",
    status: "error",
    durationMs: 0,
  });
  assert.equal(
    tracker.envelopeToolResult("codex-preflight-failure", "duplicate", true, { name: "Bash" }),
    null,
    "a duplicate terminal frame must not reopen an already failed tool",
  );
}

{
  // Hook + envelope describing the same call must record ONE entry.
  const tracker = new ToolCallTracker(() => 0);
  tracker.hookStart("Bash", undefined, 5);
  tracker.envelopeToolUse("toolu_dup", "Bash", '{"command":"pwd"}', 9);
  tracker.hookEnd("Bash", "done", false);
  const snap = tracker.snapshot();
  assert.equal(snap.length, 1, "linked hook+envelope call records a single entry");
  assert.equal(snap[0].textOffset, 5, "first stamp (hook start) wins");
  assert.equal(
    snap[0].input,
    '{"command":"pwd"}',
    "envelope input backfills a hook call that had none (stored verbatim)",
  );
}

{
  // toPersistedTools: caps, running coercion, offset shift, empty → undefined.
  const tracker = new ToolCallTracker(() => 0);
  tracker.hookStart("Bash", "x".repeat(3000), 10);
  // never ended — still running at save time
  const persisted = toPersistedTools(tracker.snapshot(), 4);
  assert.ok(persisted && persisted.length === 1);
  assert.equal(persisted[0].status, "error", "running coerces to error at save");
  assert.ok(
    (persisted[0].output ?? "").includes("[tool did not settle before the turn ended]"),
    "coercion is explained in the output",
  );
  assert.equal(persisted[0].input?.length, 2000, "input head-capped at 2000");
  assert.equal(persisted[0].textOffset, 6, "offset shifted by the leading trim (10 - 4)");

  const longOut = new ToolCallTracker(() => 0);
  longOut.hookStart("Bash", undefined, 0);
  longOut.hookEnd("Bash", "HEAD" + "y".repeat(9000), false);
  const capped = toPersistedTools(longOut.snapshot(), 0);
  assert.equal(capped?.[0].output?.length, 4000, "output tail-capped at 4000");
  assert.ok(
    !capped?.[0].output?.includes("HEAD"),
    "output keeps the tail, not the head",
  );

  assert.equal(
    toPersistedTools(new ToolCallTracker().snapshot(), 0),
    undefined,
    "no tools → undefined, not an empty array",
  );
}
console.log("tool persistence tracker tests passed");
