// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";

await import("../../scripts/test-alias-register.mjs");
const {
  decodeReplayAssistantOutput,
  OFFLINE_REPLAY_LAUNCH_CONTRACT,
  replayOutputContractBlockReason,
  ReplayOutputDecodeError,
} = await import("./travel-replay-output.ts");

function daemonEvent(kind, payloadJson) {
  return { kind, payload_json: payloadJson };
}

function arbitraryChunks(text) {
  const sizes = [1, 4, 2, 9, 3, 7];
  const chunks = [];
  let offset = 0;
  let index = 0;
  while (offset < text.length) {
    const end = Math.min(text.length, offset + sizes[index % sizes.length]);
    chunks.push(text.slice(offset, end));
    offset = end;
    index += 1;
  }
  return chunks;
}

function outputEvents(text) {
  return arbitraryChunks(text).map((data) =>
    daemonEvent("output", JSON.stringify({ data }))
  );
}

function plainDecode(harness, text, extraEvents = []) {
  const stdout = harness === "codex"
    ? [
        "OpenAI Codex",
        "--------",
        "workdir: /workspace",
        "model: gpt-test",
        "user",
        "PROMPT MUST STAY PRIVATE",
        "codex",
        text,
      ].join("\n")
    : text;
  return decodeReplayAssistantOutput({
    harness,
    ...OFFLINE_REPLAY_LAUNCH_CONTRACT,
    events: [...outputEvents(stdout), ...extraEvents],
  });
}

const SAFE_PLAIN_HARNESSES = [
  "claude",
  "coven-code",
  "codex",
  "copilot",
  "grok",
  "hermes",
];

const PLAIN_REPLIES = [
  {
    name: "ordinary multiline prose",
    text: "A plain answer with {braces}.\n\nA second line.",
  },
  {
    name: "JSON and SSE-looking prose",
    text: [
      '{"answer":42}',
      '[1,{"nested":true}]',
      "data: literal answer",
      "event: literal event",
    ].join("\n"),
  },
];

for (const harness of SAFE_PLAIN_HARNESSES) {
  for (const reply of PLAIN_REPLIES) {
    test(`${harness} nonInteractive plain output preserves ${reply.name} across arbitrary chunks`, () => {
      assert.equal(plainDecode(harness, reply.text), reply.text);
    });
  }
}

test("plain replay cleans terminal ANSI and backspaces without interpreting content", () => {
  assert.equal(
    plainDecode("claude", "\u001b[31mwrong\b\b\b\bright\u001b[0m"),
    "wright",
  );
});

test("Hermes removes only its established normalization diagnostic and preserves blank lines", () => {
  assert.equal(
    plainDecode(
      "hermes",
      "Normalized model 'gpt-5' to 'openai-codex/gpt-5' for openai-codex.\nFirst\n\nSecond",
    ),
    "First\n\nSecond",
  );
});

test("plain replay flushes buffered stdout before a later structured assistant event", () => {
  assert.equal(
    plainDecode("codex", "Filtered first.", [
      daemonEvent(
        "assistant.message",
        JSON.stringify({ content: "Structured second." }),
      ),
    ]),
    "Filtered first.Structured second.",
  );
});

test("plain replay merges a later structured replacement without duplicating the buffered prefix", () => {
  assert.equal(
    plainDecode("codex", "Filtered first.", [
      daemonEvent(
        "assistant.message",
        JSON.stringify({ content: "Filtered first.Structured second." }),
      ),
    ]),
    "Filtered first.Structured second.",
  );
});

test("plain replay rejects malformed structured assistant compatibility events", () => {
  assert.throws(
    () =>
      plainDecode("codex", "Filtered first.", [
        daemonEvent("assistant.message", "{"),
      ]),
    (error) =>
      error instanceof ReplayOutputDecodeError &&
      error.code === "malformed_assistant_event" &&
      /assistant data event/.test(error.message),
  );
});

test("replay rejects truncated output after partial chunks with a typed error", () => {
  assert.throws(
    () =>
      decodeReplayAssistantOutput({
        harness: "claude",
        ...OFFLINE_REPLAY_LAUNCH_CONTRACT,
        events: [
          daemonEvent("output", JSON.stringify({ data: "Partial answer." })),
          daemonEvent("output_truncated", JSON.stringify({ droppedEvents: 1 })),
        ],
      }),
    (error) =>
      error instanceof ReplayOutputDecodeError &&
      error.code === "truncated_output" &&
      /truncated/.test(error.message),
  );
});

test("replay rejects malformed output envelopes with a typed error", () => {
  assert.throws(
    () =>
      decodeReplayAssistantOutput({
        harness: "claude",
        ...OFFLINE_REPLAY_LAUNCH_CONTRACT,
        events: [daemonEvent("output", JSON.stringify({ notData: "oops" }))],
      }),
    (error) =>
      error instanceof ReplayOutputDecodeError &&
      error.code === "malformed_output_event" &&
      /malformed daemon output event/.test(error.message),
  );
});

test("Claude stream-json remains available only through its declared structured contract", () => {
  const frames = [
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "tool-1", name: "Read", input: { path: "private.txt" } },
          { type: "text", text: "Structured answer." },
        ],
      },
    }),
    JSON.stringify({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "tool-1", content: "private" }],
      },
    }),
  ].join("\n") + "\n";
  assert.equal(
    decodeReplayAssistantOutput({
      harness: "claude",
      launchMode: "stream",
      outputFormat: "stream-json",
      events: outputEvents(frames),
    }),
    "Structured answer.",
  );
});

test("OpenCode plain replay is rejected with actionable guidance before launch", () => {
  const reason = replayOutputContractBlockReason({
    harness: "opencode",
    ...OFFLINE_REPLAY_LAUNCH_CONTRACT,
  });
  assert.match(reason ?? "", /nonInteractive plain stdout/i);
  assert.match(reason ?? "", /tool or control output/i);
  assert.match(reason ?? "", /choose another harness|online chat/i);

  assert.throws(
    () =>
      decodeReplayAssistantOutput({
        harness: "opencode",
        ...OFFLINE_REPLAY_LAUNCH_CONTRACT,
        events: outputEvents("looks plausible but is unsafe"),
      }),
    (error) =>
      error instanceof ReplayOutputDecodeError &&
      error.code === "unsupported_harness" &&
      error.message === reason,
  );
});
