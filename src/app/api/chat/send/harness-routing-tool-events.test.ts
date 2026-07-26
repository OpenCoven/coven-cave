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
  MAX_PENDING_ENVELOPE_RESULTS,
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
  /const claudeToolsEnabled =\s*binding\.harness !== "claude" \|\|\s*\(claudeCompatibility\?\.kind === "compatible" && !claudeCompatibility\.stale\);[\s\S]*?binding\.harness === "claude" &&\s*claudeCompatibility\?\.kind === "compatible" &&\s*!claudeCompatibility\.stale/,
  "an expired profile must preserve text-only Claude chat while disabling both hook and envelope tool decoding",
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
  /const toolMatch = trimmed\.match\(TOOL_HOOK_RE\);[\s\S]*?if \(!\(binding\.harness === "claude" && toolMatch\)\) \{[\s\S]*?recordStdoutErrorTail\(cleaned\);/,
  "Claude hook payloads must not enter the generic empty-response diagnostic tail",
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
  /const resetToolTrackerForRetry = \(\) => \{[\s\S]*?settleUnfinishedTools\(\);[\s\S]*?priorAttemptTools\.push[\s\S]*?toolTracker = new ToolCallTracker\(Date\.now, `retry-\$\{toolAttempt\}:`\);/,
  "resume and recovery retries must settle and persist prior-attempt tools under a distinct id namespace",
);

assert.match(
  chatRoute,
  /toPersistedTools\(\[\.\.\.priorAttemptTools, \.\.\.toolTracker\.snapshot\(\)\]/,
  "tools emitted before a retry must remain in the saved assistant turn",
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
  const settledEnvelope = tracker.envelopeToolUse("toolu-late-hook", "Bash", "{\"command\":\"ls\"}");
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
  for (let index = 0; index <= MAX_PENDING_ENVELOPE_RESULTS; index += 1) {
    tracker.envelopeToolResult(`unknown-${index}`, "ignored", false);
  }
  assert.equal(
    tracker.envelopeToolUse("unknown-0", "Read")?.status,
    "running",
    "the oldest unmatched result is evicted once the bounded recovery buffer fills",
  );
  assert.equal(
    tracker.envelopeToolUse(`unknown-${MAX_PENDING_ENVELOPE_RESULTS}`, "Read")?.status,
    "ok",
    "the most recent reordered result remains recoverable within the bound",
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
// matching assistant block. Once the tool_use arrives, expose its settled
// state directly rather than leaving a fresh bubble running until persistence.
{
  const tracker = new ToolCallTracker(() => 0);
  assert.equal(tracker.envelopeToolResult("toolu_reordered", "done", false), null);
  const settled = tracker.envelopeToolUse("toolu_reordered", "Read", '{"path":"a.ts"}');
  assert.deepEqual(settled, {
    id: "toolu_reordered",
    name: "Read",
    input: '{"path":"a.ts"}',
    output: "done",
    status: "ok",
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
  const settled = tracker.envelopeToolUse(
    "toolu_reordered_input",
    "Bash",
    '{"command":"pwd"}',
  );
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
  const envelope = tracker.envelopeToolUse("toolu_reordered_hook", "Bash", '{"command":"pwd"}');
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
  assert.equal(
    tracker.envelopeToolUse("toolu_late_envelope", "Read", '{"file_path":"/tmp/x"}'),
    null,
    "a late envelope links to an already-completed hook instead of duplicating it",
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

// A late hook attached to an already settled envelope must not consume the
// next concurrent call of the same name when its assistant frame arrives
// before that hook's post line.
{
  const tracker = new ToolCallTracker(() => 0);
  tracker.envelopeToolResult("toolu_first", "first result", false);
  tracker.envelopeToolUse("toolu_first", "Read");
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
  /ev\.type === "output" && typeof ev\.text === "string"[\s\S]*?assistantFilter\.push\(cleaned\)[\s\S]*?kind: "assistant_chunk", text: filtered/,
  "Coven stream-json output events must pass through the Codex assistant filter instead of being discarded as handled JSON",
);

assert.match(
  chatRoute,
  /ev\.type === "output" && typeof ev\.text === "string"[\s\S]*?recordStdoutErrorTail\(cleaned\)[\s\S]*?assistantFilter\.push\(cleaned\)/,
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
