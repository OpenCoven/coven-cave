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
  MAX_PENDING_TOOL_RESULTS,
  ToolCallTracker,
  toPersistedTools,
} from "../../../../lib/chat-tool-events.ts";

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

assert.match(
  chatRoute,
  /dispatchOpenClawGatewayTurn\([\s\S]*?sessionKey: openClawSessionKey\(conversationId\),[\s\S]*?agentId,[\s\S]*?message: args\.harnessPrompt/,
  "OpenClaw uses the Gateway-owned dispatcher with the canonical session key and agent id before selecting the CLI fallback",
);
assert.match(
  chatRoute,
  /gatewayDispatch\.kind === "accepted"[\s\S]*?return;[\s\S]*?pushProgress\("openclaw-start", "Starting OpenClaw bridge"/,
  "an accepted Gateway turn exits before the CLI branch, preventing duplicate transport ownership",
);
assert.match(
  chatRoute,
  /gatewayDispatch\.kind === "indeterminate"[\s\S]*?openclaw_gateway_indeterminate[\s\S]*?return;/,
  "an ambiguous Gateway acknowledgement produces a terminal error instead of a duplicate CLI turn",
);
assert.match(
  chatRoute,
  /if \(event\.replace\) \{[\s\S]*?gatewayAssistantText = event\.text;[\s\S]*?kind: "assistant_replace"/,
  "a published Gateway replacement delta corrects both the live stream and persisted transcript",
);
assert.match(
  chatRoute,
  /event\.kind === "final" && event\.text[\s\S]*?gatewayAssistantText !== event\.text[\s\S]*?kind: "assistant_replace"/,
  "the terminal Gateway message reconciles divergent streamed text for connected clients",
);
// ── Tool-event fidelity (CHAT-D4-03 + CHAT-D4-04) ──────────────────────────
// Source pins: the route must route BOTH tool-event sources through the
// shared ToolCallTracker — hook lines and stream-json envelope blocks — and
// must no longer key open calls by bare tool name.

assert.match(
  chatRoute,
  /let toolTracker = new ToolCallTracker\(/,
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
  /parseClaudeMessageEnvelope\(ev, claudeCompatibility\.profile\)[\s\S]*?toolTracker\.envelopeToolUse\(/,
  "Profile-selected Claude envelopes should surface running tool events (CHAT-D4-04)",
);

assert.match(
  chatRoute,
  /parseClaudeMessageEnvelope\(ev, claudeCompatibility\.profile\)[\s\S]*?toolTracker\.envelopeToolResult\(/,
  "Profile-selected Claude envelopes should settle matching tool events (CHAT-D4-04)",
);

assert.match(
  chatRoute,
  /if \(toolMatch && claudeToolsEnabled\)/,
  "Claude compatibility fallback must not create tool bubbles from unverified hook lines",
);

assert.match(
  chatRoute,
  /let claudeToolsEnabled =\s*binding\.harness !== "claude" \|\|\s*\(claudeCompatibility\?\.kind === "compatible" && !claudeCompatibility\.stale\);[\s\S]*?binding\.harness === "claude" &&\s*claudeCompatibility\?\.kind === "compatible" &&\s*!claudeCompatibility\.stale &&\s*claudeToolsEnabled/,
  "an expired profile must preserve text-only Claude chat while disabling both hook and envelope tool decoding",
);

assert.match(
  chatRoute,
  /reportMalformedClaudeStreamFrame = \(frame: unknown\) => \{[\s\S]*?claudeToolsEnabled = false;[\s\S]*?reportUnsupportedClaudeToolFrame = \(frame: unknown\) => \{[\s\S]*?claudeToolsEnabled = false;/,
  "a malformed or unknown Claude frame must disable profile-selected tool decoding for the rest of the stream",
);

assert.match(
  chatRoute,
  /hasUnsupportedClaudeToolFrame\(ev, claudeCompatibility\.profile\)[\s\S]*?reportUnsupportedClaudeToolFrame\(ev\)/,
  "a malformed or unknown profiled tool block should emit one redacted compatibility diagnostic instead of silently creating a bubble",
);

assert.match(
  chatRoute,
  /if \(hasUnsupportedClaudeToolFrame\(ev, claudeCompatibility\.profile\)\) \{[\s\S]*?reportUnsupportedClaudeToolFrame\(ev\);[\s\S]*?parseClaudeTextOnlyEnvelope\(ev\)[\s\S]*?return;[\s\S]*?parseClaudeMessageEnvelope\(ev, claudeCompatibility\.profile\)/,
  "a partially malformed Claude envelope must fall back to text-only before any tool block is decoded",
);

assert.match(
  chatRoute,
  /reportUnsupportedClaudeToolFrame = \(frame: unknown\) => \{[\s\S]*?fingerprint: redactedEventFingerprint\(frame\)[\s\S]*?Claude Code tool frame is not supported/,
  "unsupported profiled tool blocks must be logged as redacted fingerprints",
);

assert.match(
  chatRoute,
  /Claude stream frame could not be decoded[\s\S]*?fingerprint: redactedEventFingerprint\(frame\)[\s\S]*?chat text will continue without unverified tool bubbles[\s\S]*?reportMalformedClaudeStreamFrame\(line\)/,
  "malformed Claude JSONL must be reduced to a fingerprint and diagnostic rather than falling through to payload-bearing stdout diagnostics",
);

assert.match(
  chatRoute,
  /let claudeCompatibilityDiagnosticSent = Boolean\(claudeDiagnostic\);[\s\S]*?reportMalformedClaudeStreamFrame[\s\S]*?if \(claudeCompatibilityDiagnosticSent\) return;[\s\S]*?reportUnsupportedClaudeToolFrame[\s\S]*?if \(claudeCompatibilityDiagnosticSent\) return/,
  "a probe or SSH fallback must retain its first truthful diagnostic when a later malformed frame is logged",
);

assert.match(
  chatRoute,
  /binding\.harness === "claude" && \(trimmed\.startsWith\("\{"\) \|\| trimmed\.startsWith\("\["\)\)/,
  "malformed Claude array frames must also bypass payload-bearing stdout diagnostics",
);

assert.match(
  chatRoute,
  /binding\.harness === "claude" && isClaudeStreamJsonFrame\(line\)/,
  "valid primitive Claude JSONL frames must reach the redacted protocol boundary rather than the plain-text stdout path",
);

assert.match(
  chatRoute,
  /binding\.harness !== "claude"[\s\S]*?ev\.type === "output"[\s\S]*?typeof ev\.text === "string"/,
  "the Codex-only output envelope must not render an unknown Claude payload before profile validation",
);

assert.match(
  chatRoute,
  /if \(binding\.harness !== "claude"\) \{\s*recordStdoutErrorTail\(cleaned\);/,
  "Claude stdout must not enter empty-response diagnostics because unrecognised lines can contain tool payloads",
);

assert.match(
  chatRoute,
  /Claude stderr can include tool payloads[\s\S]*?if \(binding\.harness !== "claude"\) \{[\s\S]*?stderrTail\.push\(trimmed\);/,
  "Claude stderr must not enter empty-response diagnostics with tool payloads",
);

assert.match(
  chatRoute,
  /resetToolTrackerForRetry\(\);/,
  "The resume retry should reset tool tracking alongside the other per-attempt state",
);

assert.match(
  chatRoute,
  /toolTracker\.hookStart\(name, formatToolPayload\(rest\), assistantText\.length\)/,
  "hook tool starts are stamped with the current assistant-text offset",
);

assert.match(
  chatRoute,
  /formatToolInputValue\(claudeEvent\.input\),\s*assistantText\.length,/,
  "profile-decoded envelope tool starts are stamped with the current assistant-text offset",
);

assert.match(
  chatRoute,
  /toPersistedTools\(\[\.\.\.priorAttemptTools, \.\.\.toolTracker\.snapshot\(\)\]/,
  "the saved assistant turn captures the tracker's final tool state",
);

assert.match(
  chatRoute,
  /const settleUnfinishedTools = \(\) => \{[\s\S]*?toolTracker\.settleUnfinished\(\)[\s\S]*?push\(\{ kind: "tool_use", \.\.\.toolEv \}\)/,
  "the route must settle every live tool chip before completing the stream",
);

assert.match(
  chatRoute,
  /const hermesSpawnEnvironment = hermesDirect[\s\S]*?harnessSpawnEnv\(body\.familiarId\)[\s\S]*?const hermesApi = hermesSpawnEnvironment[\s\S]*?hermesApiConfig\(hermesSpawnEnvironment as \{/,
  "Hermes API credentials and CLI fallback must reuse one familiar-scoped environment boundary",
);

assert.match(
  chatRoute,
  /const resetToolTrackerForRetry = \(\) => \{[\s\S]*?settleUnfinishedTools\(\);[\s\S]*?priorAttemptTools\.push[\s\S]*?toolTracker = new ToolCallTracker\(Date\.now, `retry-\$\{toolAttempt\}:`\);/,
  "resume and recovery retries must settle and persist prior-attempt tools under a distinct id namespace",
);

assert.match(
  chatRoute,
  /if \(hermesApi\) return runHermesApiAttempt\(apiPrompt\);/,
  "a configured Hermes API must use the structured Responses SSE transport rather than terminal scraping",
);

assert.match(
  chatRoute,
  /toPersistedTools\(\[\.\.\.priorAttemptTools, \.\.\.toolTracker\.snapshot\(\)\]/,
  "tools emitted before a retry must remain in the saved assistant turn",
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
  assert.equal(
    tracker.envelopeToolUse("call-progress", "shell", '{"command":"pwd"}'),
    null,
    "the canonical duplicate start keeps the existing stable id",
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

// Behavioral: a reordered user result can settle an envelope before a late
// pre-hook arrives. That hook is live again and must receive a terminal SSE
// update when its matching post hook is lost before the turn ends.
{
  let t = 0;
  const tracker = new ToolCallTracker(() => t);
  tracker.envelopeToolResult("toolu-late-hook", "done", false);
  const startedEnvelope = tracker.envelopeToolUse("toolu-late-hook", "Bash", "{\"command\":\"ls\"}");
  assert.equal(startedEnvelope?.status, "running");
  const settledEnvelope = tracker.consumePendingEnvelopeResult("toolu-late-hook");
  assert.equal(settledEnvelope?.status, "ok");
  t = 50;
  const lateHook = tracker.hookStart("Bash", "{\"command\":\"ls\"}");
  assert.equal(lateHook.id, "toolu-late-hook");
  assert.equal(lateHook.status, "running");
  t = 100;
  assert.deepEqual(
    tracker.settleUnfinished(),
    [{
      id: "toolu-late-hook",
      name: "Bash",
      output: "[tool did not settle before the turn ended]",
      status: "error",
      durationMs: 50,
    }],
    "a late hook without post_tool_use must not leave the live tool chip running after done",
  );
}

// Unknown result ids are retained briefly to recover reordered JSONL, but a
// malformed stream cannot grow that recovery buffer without bound.
{
  const tracker = new ToolCallTracker(() => 0);
  for (let index = 0; index <= MAX_PENDING_TOOL_RESULTS; index += 1) {
    tracker.envelopeToolResult(`unknown-${index}`, "ignored", false);
  }
  assert.equal(
    tracker.envelopeToolUse("unknown-0", "Read")?.status,
    "running",
    "the oldest unmatched result is evicted once the bounded recovery buffer fills",
  );
  assert.equal(
    tracker.envelopeToolUse(`unknown-${MAX_PENDING_TOOL_RESULTS}`, "Read")?.status,
    "running",
    "the most recent reordered result remains recoverable within the bound",
  );
  assert.equal(
    tracker.consumePendingEnvelopeResult(`unknown-${MAX_PENDING_TOOL_RESULTS}`)?.status,
    "ok",
    "the retained reordered result settles after the start is announced",
  );
}

// Retries create a new tracker. Namespace its stream ids while retaining
// native envelope lookup keys so same-name tool calls cannot overwrite a
// previous attempt's live or persisted record.
{
  const initial = new ToolCallTracker(() => 0);
  const retry = new ToolCallTracker(() => 0, "retry-1:");
  assert.equal(initial.hookStart("Bash").id, "tool-1-Bash");
  assert.equal(retry.hookStart("Bash").id, "retry-1:tool-1-Bash");
  assert.equal(retry.envelopeToolUse("toolu_retry", "Read")?.id, "retry-1:toolu_retry");
  assert.equal(
    retry.envelopeToolResult("toolu_retry", "done", false)?.id,
    "retry-1:toolu_retry",
    "the namespaced UI id must still settle through the native envelope id",
  );
}

// A buffered/partial JSONL transport can deliver the result line before the
// matching assistant block. Once the tool_use arrives, its retained terminal
// result remains available to settle the announced bubble.
{
  const tracker = new ToolCallTracker(() => 0);
  assert.equal(tracker.envelopeToolResult("toolu_reordered", "done", false), null);
  const started = tracker.envelopeToolUse("toolu_reordered", "Read", '{"path":"a.ts"}');
  assert.equal(started?.status, "running");
  const settled = tracker.consumePendingEnvelopeResult("toolu_reordered");
  assert.deepEqual(settled, {
    id: "toolu_reordered",
    name: "Read",
    input: '{"path":"a.ts"}',
    output: "done",
    status: "ok",
    durationMs: 0,
  });
  assert.equal(
    toPersistedTools(tracker.snapshot(), 0)?.[0].status,
    "ok",
    "reordered envelopes must not become an indefinitely running persisted tool",
  );
}

// An announced call that never receives a result must emit a terminal SSE
// update before `done`, not just be fixed up in the persisted transcript.
{
  let t = 0;
  const tracker = new ToolCallTracker(() => t);
  const running = tracker.envelopeToolUse("toolu_unfinished", "Bash");
  assert.equal(running?.status, "running");
  t = 75;
  assert.deepEqual(tracker.settleUnfinished(), [{
    id: "toolu_unfinished",
    name: "Bash",
    output: "[tool did not settle before the turn ended]",
    status: "error",
    durationMs: 75,
  }]);
  assert.equal(
    toPersistedTools(tracker.snapshot(), 0)?.[0].status,
    "error",
    "unfinished calls are terminal both live and after reload",
  );
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

// A buffered stream can flush a user tool_result before the corresponding
// post_tool_use hook. The late hook must update the original bubble, rather
// than creating a second orphan record for the same tool execution.
{
  let t = 0;
  const tracker = new ToolCallTracker(() => t);
  const started = tracker.hookStart("Bash", '{"command":"pwd"}');
  tracker.envelopeToolUse("toolu_late_post", "Bash");
  t = 100;
  const result = tracker.envelopeToolResult("toolu_late_post", "envelope output", false);
  assert.equal(result?.id, started.id);
  t = 250;
  const post = tracker.hookEnd("Bash", "hook output", false);
  assert.equal(post.id, started.id, "late post hooks retain the original tool id");
  assert.equal(post.output, "hook output", "post-hook output takes precedence over the envelope result");
  assert.equal(post.durationMs, 250, "late post-hook timing uses the pre-hook start");
  assert.equal(tracker.snapshot().length, 1, "late post hooks must not create an orphan bubble");
}

// Hooks can be configured independently. If only a post hook arrives before
// its delayed assistant envelope, retain its completed record long enough to
// attach the native id and suppress the matching user result.
{
  const tracker = new ToolCallTracker(() => 0);
  const post = tracker.hookEnd("Bash", "hook output", false);
  assert.equal(post.status, "ok");
  assert.deepEqual(
    tracker.envelopeToolUse("toolu-post-only", "Bash", '{"command":"pwd"}'),
    { id: post.id, name: "Bash", input: '{"command":"pwd"}', status: "ok" },
    "a late envelope must fill the completed post-only hook bubble without duplicating or reopening it",
  );
  assert.equal(tracker.envelopeToolResult("toolu-post-only", "envelope output", false), null);
  assert.deepEqual(
    tracker.snapshot().map(({ id, input, output, status }) => ({ id, input, output, status })),
    [{ id: post.id, input: '{"command":"pwd"}', output: "hook output", status: "ok" }],
    "post-hook output remains authoritative after the native envelope arrives",
  );
}

// A completed hook with no input cannot be safely associated with the next
// same-name envelope. Retaining it by name alone makes the later real call
// disappear from both live activity and the persisted transcript.
{
  const tracker = new ToolCallTracker(() => 0);
  tracker.hookStart("Bash");
  tracker.hookEnd("Bash", "first output", false);
  const nextEnvelope = tracker.envelopeToolUse("toolu-next", "Bash");
  assert.deepEqual(nextEnvelope, {
    id: "toolu-next",
    name: "Bash",
    input: undefined,
    status: "running",
  }, "an ambiguous same-name envelope starts a distinct tool call");
  assert.equal(
    tracker.envelopeToolResult("toolu-next", "second output", false)?.id,
    "toolu-next",
    "the later envelope result settles its own visible call",
  );
}

// When two same-name pre hooks arrive before their envelopes, match each
// envelope by its normalized input instead of assigning native ids by FIFO.
// Otherwise the result/output of the second execution is persisted against the
// first execution's bubble.
{
  const tracker = new ToolCallTracker(() => 0);
  const first = tracker.hookStart("Read", '{"path":"first.md"}');
  const second = tracker.hookStart("Read", '{"path":"second.md"}');
  tracker.envelopeToolUse("toolu-second", "Read", '{"path":"second.md"}');
  tracker.envelopeToolUse("toolu-first", "Read", '{"path":"first.md"}');
  assert.equal(tracker.envelopeToolResult("toolu-second", "second output", false)?.id, second.id);
  assert.equal(tracker.envelopeToolResult("toolu-first", "first output", false)?.id, first.id);
  assert.deepEqual(
    tracker.snapshot().map(({ input, output }) => ({ input, output })),
    [
      { input: '{"path":"first.md"}', output: "first output" },
      { input: '{"path":"second.md"}', output: "second output" },
    ],
    "concurrent reordered same-name calls retain their own inputs and outputs",
  );
}

// The inverse arrival order must make the same input-based association. If
// assistant envelopes are buffered before two same-name pre hooks, FIFO would
// otherwise apply the second hook's timing and output to the first bubble.
{
  const tracker = new ToolCallTracker(() => 0);
  tracker.envelopeToolUse("toolu-first", "Read", '{"path":"first.md"}');
  tracker.envelopeToolUse("toolu-second", "Read", '{"path":"second.md"}');
  const second = tracker.hookStart("Read", '{"path":"second.md"}');
  const first = tracker.hookStart("Read", '{"path":"first.md"}');
  assert.equal(second.id, "toolu-second");
  assert.equal(first.id, "toolu-first");
  assert.equal(tracker.hookEnd("Read", "second output", false).id, "toolu-second");
  assert.equal(tracker.hookEnd("Read", "first output", false).id, "toolu-first");
  assert.deepEqual(
    tracker.snapshot().map(({ id, output }) => ({ id, output })),
    [
      { id: "toolu-first", output: "first output" },
      { id: "toolu-second", output: "second output" },
    ],
    "concurrent same-name envelope-first calls retain their hook outputs",
  );
}

// If a reordered result settles a hook-first call as its delayed envelope
// arrives, the terminal SSE update must retain the envelope input. Otherwise
// the live bubble drops it (the UI keeps prior fields when an update omits
// them), even though the persisted record receives the backfill.
{
  const tracker = new ToolCallTracker(() => 0);
  const started = tracker.hookStart("Bash");
  assert.equal(tracker.envelopeToolResult("toolu_reordered_input", "done", false), null);
  tracker.envelopeToolUse(
    "toolu_reordered_input",
    "Bash",
    '{"command":"pwd"}',
  );
  const settled = tracker.consumePendingEnvelopeResult("toolu_reordered_input");
  assert.equal(settled?.id, started.id);
  assert.equal(settled?.input, '{"command":"pwd"}', "the live terminal update backfills the envelope input");
  assert.equal(tracker.snapshot()[0]?.input, '{"command":"pwd"}', "the persisted tool keeps the same input");
}

// When a buffered stream reorders both envelope frames ahead of its hooks, the
// eventual hooks must still replace the envelope result on the native record.
{
  let t = 0;
  const tracker = new ToolCallTracker(() => t);
  tracker.envelopeToolResult("toolu_reordered_hook", "envelope output", false);
  tracker.envelopeToolUse("toolu_reordered_hook", "Bash", '{"command":"pwd"}');
  const envelope = tracker.consumePendingEnvelopeResult("toolu_reordered_hook");
  assert.equal(envelope?.status, "ok");
  t = 100;
  const hookStart = tracker.hookStart("Bash", '{"command":"pwd"}');
  assert.equal(hookStart.id, "toolu_reordered_hook", "a late pre hook reuses the envelope id");
  t = 250;
  const hookEnd = tracker.hookEnd("Bash", "hook output", false);
  assert.equal(hookEnd.id, "toolu_reordered_hook", "a late post hook updates the same tool record");
  assert.equal(hookEnd.output, "hook output", "hook output takes precedence after full reordering");
  assert.equal(hookEnd.durationMs, 150, "hook timing begins at the late pre hook");
  assert.equal(tracker.snapshot().length, 1, "fully reordered hooks must not create an orphan bubble");
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

// A full pre/post pair can also reach stdout before its delayed assistant
// envelope. Linking the late native id must preserve the hook record so both
// the eventual tool_result and persistence remain deduplicated.
{
  const tracker = new ToolCallTracker(() => 0);
  const hookRunning = tracker.hookStart("Read", undefined);
  const hookDone = tracker.hookEnd("Read", "hook contents", false);
  assert.equal(hookDone.id, hookRunning.id);
  assert.deepEqual(
    tracker.envelopeToolUse("toolu_late_envelope", "Read", '{"file_path":"/tmp/x"}'),
    { id: hookDone.id, name: "Read", input: '{"file_path":"/tmp/x"}', status: "ok", durationMs: 0 },
    "a late envelope fills the completed hook bubble instead of duplicating or reopening it",
  );
  assert.equal(
    tracker.envelopeToolResult("toolu_late_envelope", "envelope contents", false),
    null,
    "the late native id suppresses its duplicate envelope result",
  );
  const snapshot = tracker.snapshot();
  assert.equal(snapshot.length, 1, "late envelopes must not add an orphan bubble");
  assert.equal(snapshot[0].output, "hook contents", "hook output keeps precedence");
  assert.equal(snapshot[0].input, '{"file_path":"/tmp/x"}', "late envelope input backfills the hook record");
}

// A delayed envelope with a different input is a distinct same-name call, not
// a duplicate of an already completed hook. Preserve both records rather than
// silently dropping the envelope's lifecycle.
{
  const tracker = new ToolCallTracker(() => 0);
  const first = tracker.hookStart("Read", '{"path":"first.md"}');
  tracker.hookEnd("Read", "first contents", false);
  const second = tracker.envelopeToolUse("toolu-second-late", "Read", '{"path":"second.md"}');
  assert.ok(second, "a different-input delayed envelope must create its own tool record");
  assert.equal(tracker.envelopeToolResult("toolu-second-late", "second contents", false)?.id, second.id);
  assert.deepEqual(
    tracker.snapshot().map(({ id, input, output }) => ({ id, input, output })),
    [
      { id: first.id, input: '{"path":"first.md"}', output: "first contents" },
      { id: "toolu-second-late", input: '{"path":"second.md"}', output: "second contents" },
    ],
    "a completed same-name hook must not absorb a distinct delayed envelope",
  );
}

// A late hook attached to an already settled envelope must not consume the
// next concurrent call of the same name when its assistant frame arrives
// before that hook's post line.
{
  const tracker = new ToolCallTracker(() => 0);
  tracker.envelopeToolResult("toolu_first", "first result", false);
  tracker.envelopeToolUse("toolu_first", "Read");
  tracker.consumePendingEnvelopeResult("toolu_first");
  const firstHook = tracker.hookStart("Read");
  assert.equal(firstHook.id, "toolu_first");

  const second = tracker.envelopeToolUse("toolu_second", "Read");
  assert.equal(second?.id, "toolu_second", "a pending late post must not absorb a different concurrent envelope id");
  assert.equal(tracker.envelopeToolResult("toolu_second", "second result", false)?.id, "toolu_second");
  assert.equal(tracker.hookEnd("Read", "first hook result", false).id, "toolu_first");
  assert.deepEqual(
    tracker.snapshot().map((event) => event.id),
    ["toolu_first", "toolu_second"],
    "reordered concurrent same-name calls retain one record per native id",
  );
}

// A lost pre hook for one call followed by a same-name later call must not
// overwrite the completed first envelope when their inputs distinguish them.
{
  const tracker = new ToolCallTracker(() => 0);
  tracker.envelopeToolResult("toolu_first", "first result", false);
  tracker.envelopeToolUse("toolu_first", "Read", '{"path":"first.md"}');
  tracker.consumePendingEnvelopeResult("toolu_first");

  const secondHook = tracker.hookStart("Read", '{"path":"second.md"}');
  assert.notEqual(secondHook.id, "toolu_first");
  tracker.hookEnd("Read", "second hook result", false);

  assert.deepEqual(
    tracker.snapshot().map(({ id, input, output }) => ({ id, input, output })),
    [
      { id: "toolu_first", input: '{"path":"first.md"}', output: "first result" },
      { id: secondHook.id, input: '{"path":"second.md"}', output: "second hook result" },
    ],
    "a late completed envelope cannot steal a distinct same-name hook call",
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
  /binding\.harness !== "claude"[\s\S]*?ev\.type === "output"[\s\S]*?typeof ev\.text === "string"[\s\S]*?assistantFilter\.push\(cleaned\)[\s\S]*?kind: "assistant_chunk", text: filtered/,
  "Coven stream-json output events must pass through the Codex assistant filter instead of being discarded as handled JSON",
);

assert.match(
  chatRoute,
  /binding\.harness !== "claude"[\s\S]*?ev\.type === "output"[\s\S]*?typeof ev\.text === "string"[\s\S]*?recordStdoutErrorTail\(cleaned\)[\s\S]*?assistantFilter\.push\(cleaned\)/,
  "Coven stream-json output events must preserve error-looking stdout text for empty-response diagnostics before filtering",
);

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
