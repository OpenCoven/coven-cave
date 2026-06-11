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
} from "../../../../lib/chat-tool-events.ts";

const chatRoute = await readFile(
  new URL("./route.ts", import.meta.url),
  "utf8",
);
const boardRoute = await readFile(
  new URL("../../board/enrich-steps/route.ts", import.meta.url),
  "utf8",
);

assert.match(
  chatRoute,
  /isTrustedChatHarness\(binding\.harness\)/,
  "Native chat should enforce the trusted Coven harness gate before spawning coven run",
);

assert.match(
  chatRoute,
  /const adapter = COMPATIBILITY_ADAPTERS\.find\(\(h\) => h\.id === binding\.harness\);/,
  "Native chat should consult bundled adapter metadata before spawning a harness",
);

assert.match(
  chatRoute,
  /if \(adapter && !adapter\.chatSupported\)/,
  "Native chat should reject bundled adapters that opt out of native chat",
);

assert.doesNotMatch(
  chatRoute,
  /const a = \["run", binding\.harness, "--stream-json"\];[\s\S]*binding\.harness === "openclaw"/,
  "OpenClaw should not be special-cased inside the generic coven run argv builder",
);

assert.match(
  chatRoute,
  /if \(binding\.harness === "openclaw" && !sshRuntime\)/,
  "OpenClaw native chat should use its agent CLI bridge instead of coven run",
);

assert.match(
  chatRoute,
  /if \(sshRuntime && binding\.harness === "openclaw"\)[\s\S]*OpenClaw SSH runtime is not supported yet/,
  "OpenClaw over SSH should fail clearly until Cave has a dedicated remote OpenClaw bridge",
);

assert.match(
  chatRoute,
  /const sshRuntime = isSshRuntime\(binding\.runtime\) \? binding\.runtime : null;[\s\S]*buildSshSpawnArgs/,
  "SSH runtime familiars should build SSH argv before local process spawning",
);

assert.match(
  chatRoute,
  /spawn\("ssh", sshArgs/,
  "SSH runtime chat should spawn the local ssh binary with prebuilt argv instead of shell-concatenating locally",
);

assert.match(
  chatRoute,
  /resolveOpenClawAgentId\(args\.body\.familiarId\)/,
  "OpenClaw native chat should resolve Cave familiar ids to real OpenClaw agent ids",
);

assert.match(
  chatRoute,
  /"agent"[\s\S]*"--agent"[\s\S]*agentId[\s\S]*"--message"[\s\S]*harnessPrompt[\s\S]*"--json"/,
  "OpenClaw native chat should call openclaw agent with the resolved agent id and JSON output",
);

assert.match(
  chatRoute,
  /"--session-id"[\s\S]*body\.sessionId/,
  "OpenClaw native chat should pass the current session id when resuming",
);

assert.match(
  chatRoute,
  /\| \{ kind: "progress"; id\?: string; label: string; detail\?: string; status\?: "running" \| "done" \| "error"; durationMs\?: number \}/,
  "Native chat streams should expose progress SSE events for quiet phases",
);

assert.match(
  chatRoute,
  /pushProgress\("openclaw-resolve", "Resolving OpenClaw agent", "running"[\s\S]*pushProgress\("openclaw-resolve", "OpenClaw agent resolved", "done"/,
  "OpenClaw bridge should show agent resolution progress before the JSON response returns",
);

assert.match(
  chatRoute,
  /pushProgress\(\s*"harness-start",\s*`Starting \$\{binding\.harness\}`,\s*"running"[\s\S]*pushProgress\(\s*"harness-start",\s*`\$\{binding\.harness\} exited`,\s*"done"/,
  "Coven harness streams should show process start and exit progress",
);

assert.match(
  chatRoute,
  /pushProgress\("resume-retry", "Resume failed; starting a fresh chat", "running"[\s\S]*await runAttempt\(buildArgs\(null\)\)[\s\S]*pushProgress\("resume-retry", "Fresh chat started", "done"/,
  "Transparent resume fallback should be visible in the progress timeline",
);

assert.match(
  chatRoute,
  /session\\s\+\\S\+\\s\+not found in local store/,
  "Transparent resume fallback should also handle Coven local-store misses from stale session ids",
);

assert.match(
  chatRoute,
  /stderrTail\.length = 0;[\s\S]*stdoutErrTail\.length = 0;[\s\S]*await runAttempt\(buildArgs\(null\)\)/,
  "Fresh-chat retry should clear stale diagnostic tails before the retry attempt",
);

assert.match(
  chatRoute,
  /pushProgress\("save-transcript", "Saving transcript", "running"[\s\S]*await saveConversation\(conv\)[\s\S]*pushProgress\("save-transcript", "Transcript saved", "done"/,
  "Conversation persistence should be visible before the final done event",
);

assert.match(
  chatRoute,
  /defaultChatTitleForSession\(finalSessionId\)/,
  "Fresh persisted chats should use a neutral New Session title instead of the first user prompt",
);

assert.match(
  chatRoute,
  /await setDefaultSessionTitleIfMissing\(finalSessionId, chatTitle\)/,
  "Fresh chats should store a Cave-side title override so daemon prompt-derived titles do not win in the session list",
);

assert.match(
  chatRoute,
  /async function setDefaultSessionTitleIfMissing[\s\S]*await setSessionTitle\(sessionId, title\)/,
  "The default title override helper should preserve existing titles and write only through the Cave title override path",
);

assert.match(
  boardRoute,
  /isTrustedChatHarness\(binding\.harness\)/,
  "Board step enrichment should enforce the same trusted Coven harness gate",
);

// ── Image attachment delivery (CHAT-D1-01) ────────────────────────────────
// Source pins: the route must write validated image payloads to private temp
// files for file-reading harnesses, and never offer file paths to the
// OpenClaw bridge or SSH runtimes (they cannot read this machine's disk).

assert.match(
  chatRoute,
  /const imagesSupported = !sshRuntime && binding\.harness !== "openclaw";/,
  "Image temp-file delivery should be limited to local coven-run harnesses with a Read tool",
);

assert.match(
  chatRoute,
  /imagesSupported\s*\?\s*await writeImageAttachmentsToTemp\(attachments\)/,
  "Image payloads should be written to temp files before the harness prompt is built",
);

assert.match(
  chatRoute,
  /buildPromptWithAttachments\(promptText, attachments, \{\s*imagesSupported,\s*imageFilePaths,\s*\}\)/,
  "The harness prompt should carry the saved image paths or the unsupported notice",
);

assert.match(
  chatRoute,
  /await writeFile\(filePath, payload, \{ mode: 0o600 \}\)/,
  "Saved image payloads should be private temp files (mode 0600)",
);

assert.match(
  chatRoute,
  /crypto\.randomUUID\(\)\}\.\$\{imageExtension\(attachment\.mimeType\)/,
  "Temp image filenames should be random with an extension derived from the validated mime type, never user input",
);

assert.match(
  chatRoute,
  /cleanupImageTempFiles\(imageFilePaths\);/,
  "Image temp files should be best-effort deleted after the harness child has exited",
);

assert.match(
  chatRoute,
  /const persistedAttachments = stripPreviewOnlyAttachmentFields\(attachments\);/,
  "Persisted transcripts should keep attachment metadata only, not base64 image payloads",
);

// Behavioral coverage: normalization keeps bounded image payloads and rejects
// anything malformed or oversized; prompt building renders the file-path line
// for capable harnesses and an explicit notice otherwise.

const smallPng = `data:image/png;base64,${Buffer.from("png-payload-bytes").toString("base64")}`;

{
  const [image] = normalizeChatAttachments([
    { name: "shot.png", type: "image/png", mimeType: "image/png", size: 17, dataUrl: smallPng },
  ]);
  assert.equal(image.dataUrl, smallPng, "normalize should preserve a bounded image dataUrl");
  assert.equal(image.mimeType, "image/png", "normalize should preserve the image mime type");
}

{
  const oversizedBase64 = "A".repeat((Math.ceil(MAX_ATTACHMENT_IMAGE_BYTES / 3) + 4) * 4);
  const cases = [
    { label: "oversized payload", dataUrl: `data:image/png;base64,${oversizedBase64}` },
    { label: "non-image data URL", dataUrl: "data:application/pdf;base64,aGVsbG8=" },
    { label: "non-base64 payload", dataUrl: "data:image/png;base64,not!!valid~~" },
    { label: "non-data URL", dataUrl: "https://example.com/x.png" },
    { label: "empty payload", dataUrl: "data:image/png;base64," },
  ];
  for (const { label, dataUrl } of cases) {
    const [image] = normalizeChatAttachments([
      { name: "shot.png", mimeType: "image/png", size: 1, dataUrl },
    ]);
    assert.equal(image.dataUrl, undefined, `normalize should reject ${label}`);
  }
}

{
  const attachments = normalizeChatAttachments([
    { name: "shot.png", type: "image/png", mimeType: "image/png", size: 17, dataUrl: smallPng },
  ]);
  const savedPath = "/tmp/coven-cave-attachments/00000000-0000-0000-0000-000000000000.png";
  const withPath = buildPromptWithAttachments("Look at this.", attachments, {
    imagesSupported: true,
    imageFilePaths: new Map([[0, savedPath]]),
  });
  assert.match(
    withPath,
    new RegExp(`Image saved to ${savedPath} — open it with the Read tool to view\\.`),
    "Capable harnesses should be pointed at the saved image file",
  );
  assert.doesNotMatch(
    withPath,
    /\(content unavailable\)/,
    "Delivered images should never render the misleading (content unavailable)",
  );

  const unsupported = buildPromptWithAttachments("Look at this.", attachments, {
    imagesSupported: false,
  });
  assert.ok(
    unsupported.includes(IMAGE_ATTACHMENTS_UNSUPPORTED_NOTE),
    "Harnesses without file access should see an explicit unsupported notice",
  );
  assert.doesNotMatch(
    unsupported,
    /\(content unavailable\)/,
    "Unsupported-harness images should never render (content unavailable)",
  );

  const undelivered = buildPromptWithAttachments("Look at this.", [
    { name: "shot.png", mimeType: "image/png", size: 17 },
  ]);
  assert.match(
    undelivered,
    /\(image attachment was not delivered — payload missing or over the size limit\)/,
    "Images whose payload never arrived should explain why instead of (content unavailable)",
  );
  assert.doesNotMatch(undelivered, /\(content unavailable\)/);
}

// ── Tool-event fidelity (CHAT-D4-03 + CHAT-D4-04) ──────────────────────────
// Source pins: the route must route BOTH tool-event sources through the
// shared ToolCallTracker — hook lines and stream-json envelope blocks — and
// must no longer key open calls by bare tool name.

assert.match(
  chatRoute,
  /let toolTracker = new ToolCallTracker\(\);/,
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
  /toolTracker = new ToolCallTracker\(\);/,
  "The resume retry should reset the tool tracker alongside the other per-attempt state",
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
  assert.equal(flattenToolResultContent(null), undefined);
}

console.log("harness-routing tests passed");
