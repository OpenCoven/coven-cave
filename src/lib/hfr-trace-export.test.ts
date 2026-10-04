import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conversationToHfrEvents,
  conversationToHfrJsonl,
  serializeHfrJsonl,
  type HfrConversationInput,
  type HfrObserverEvent,
  type HfrSubagentLink,
} from "./hfr-trace-export.ts";

function baseConversation(
  overrides: Partial<HfrConversationInput> = {},
): HfrConversationInput {
  return {
    sessionId: "sess-1",
    familiarId: "cody",
    harness: "claude",
    model: "sonnet",
    title: "Fix the thing",
    createdAt: "2026-07-04T10:00:00.000Z",
    turns: [],
    ...overrides,
  };
}

function byHook(events: HfrObserverEvent[], hook: string): HfrObserverEvent[] {
  return events.filter((e) => e.hook === hook);
}

test("emits a session header with source_format and familiar scope", () => {
  const events = conversationToHfrEvents(baseConversation());
  const [head] = events;
  assert.equal(head.hook, "session");
  assert.equal(head.session_id, "sess-1");
  assert.equal(head.familiar_id, "cody");
  assert.equal(head.harness, "claude");
  assert.equal(head.source_format, "coven.cave.v1");
  assert.equal(head.ts, "2026-07-04T10:00:00.000Z");
  assert.equal(head.timestamp, "2026-07-04T10:00:00.000Z");
});

test("source_format is overridable", () => {
  const events = conversationToHfrEvents(baseConversation(), {
    sourceFormat: "coven.cave.v2",
  });
  assert.equal(events[0].source_format, "coven.cave.v2");
});

test("a tool call becomes a pre/post pair with a shared call_id", () => {
  const events = conversationToHfrEvents(
    baseConversation({
      turns: [
        {
          id: "t1",
          role: "assistant",
          text: "done",
          createdAt: "2026-07-04T10:00:01.000Z",
          durationMs: 500,
          tools: [
            {
              id: "call-abc",
              name: "Bash",
              input: "ls",
              output: "file.txt",
              status: "ok",
              durationMs: 200,
            },
          ],
        },
      ],
    }),
  );
  const pre = byHook(events, "pre_tool_call");
  const post = byHook(events, "post_tool_call");
  assert.equal(pre.length, 1);
  assert.equal(post.length, 1);
  assert.equal(pre[0].tool_call_id, "call-abc");
  assert.equal(post[0].tool_call_id, "call-abc");
  assert.equal(pre[0].tool_name, "Bash");
  assert.equal(pre[0].args, "ls");
  assert.equal(pre[0].tool_input, "ls");
  assert.equal(post[0].tool_name, "Bash");
  assert.equal(post[0].result, "file.txt");
  assert.equal(post[0].tool_output, "file.txt");
  assert.equal(post[0].is_error, false);
  assert.equal(post[0].duration_ms, 200);
  // post ts = pre ts + durationMs
  assert.equal(pre[0].ts, "2026-07-04T10:00:01.000Z");
  assert.equal(post[0].ts, "2026-07-04T10:00:01.200Z");
});

test("only observed outcomes become post-tool events", () => {
  const events = conversationToHfrEvents(
    baseConversation({
      turns: [
        {
          id: "t1",
          role: "assistant",
          text: "x",
          createdAt: "2026-07-04T10:00:01.000Z",
          tools: [
            { id: "c1", name: "A", status: "error" },
            { id: "c2", name: "B", status: "running" },
            { id: "c3", name: "C", status: "ok" },
            { id: "c4", name: "D", status: "requested" },
            { id: "c5", name: "E", status: "unknown" },
          ],
        },
      ],
    }),
  );
  const post = byHook(events, "post_tool_call");
  assert.deepEqual(
    post.map((p) => p.is_error),
    [true, false],
  );
});

test("post_llm_call carries snake_cased usage and cost", () => {
  const events = conversationToHfrEvents(
    baseConversation({
      turns: [
        {
          id: "t1",
          role: "assistant",
          text: "hi",
          createdAt: "2026-07-04T10:00:01.000Z",
          durationMs: 1000,
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            cacheReadTokens: 5,
          },
          costUsd: 0.0012,
        },
      ],
    }),
  );
  const [llm] = byHook(events, "post_llm_call");
  assert.ok(llm);
  // Raw events keep undefined-valued keys; the shipped JSONL prunes them, so
  // assert against the serialized form that HFR actually ingests.
  const shipped = JSON.parse(serializeHfrJsonl([llm]).trimEnd());
  assert.deepEqual(shipped.usage, {
    input_tokens: 10,
    output_tokens: 20,
    cache_read_tokens: 5,
  });
  assert.equal(shipped.assistant_response, "hi");
  assert.equal(shipped.output, "hi");
  assert.equal(shipped.cost_usd, 0.0012);
  assert.equal(shipped.ts, "2026-07-04T10:00:02.000Z");
});

test("valid assistant text emits post_llm_call even without usage or cost", () => {
  const events = conversationToHfrEvents(
    baseConversation({
      turns: [
        {
          id: "t1",
          role: "assistant",
          text: "hi",
          createdAt: "2026-07-04T10:00:01.000Z",
        },
      ],
    }),
  );
  const [llm] = byHook(events, "post_llm_call");
  assert.equal(llm.assistant_response, "hi");
  assert.equal(llm.output, "hi");
});

test("final answer text lives on the last valid post_llm_call hook", () => {
  const events = conversationToHfrEvents(
    baseConversation({
      turns: [
        {
          id: "t1",
          role: "assistant",
          text: "first",
          createdAt: "2026-07-04T10:00:01.000Z",
        },
        {
          id: "t2",
          role: "assistant",
          text: "cancelled draft",
          createdAt: "2026-07-04T10:00:02.000Z",
          cancelled: true,
        },
        {
          id: "t3",
          role: "assistant",
          text: "final",
          createdAt: "2026-07-04T10:00:03.000Z",
        },
      ],
    }),
  );
  const llms = byHook(events, "post_llm_call");
  assert.equal(llms.length, 2);
  assert.equal(llms[0].assistant_response, "first");
  assert.equal(llms[1].assistant_response, "final");
  assert.equal(events.some((event) => String(event.hook) === "final_answer"), false);
});

test("a cancelled-only conversation has no assistant_response output", () => {
  const events = conversationToHfrEvents(
    baseConversation({
      turns: [
        {
          id: "t1",
          role: "assistant",
          text: "stopped",
          createdAt: "2026-07-04T10:00:01.000Z",
          cancelled: true,
        },
      ],
    }),
  );
  assert.equal(byHook(events, "post_llm_call").length, 0);
});

test("user turns become user_message events", () => {
  const events = conversationToHfrEvents(
    baseConversation({
      turns: [
        {
          id: "u1",
          role: "user",
          text: "please fix",
          createdAt: "2026-07-04T10:00:00.500Z",
        },
      ],
    }),
  );
  const [msg] = byHook(events, "user_message");
  assert.equal(msg.text, "please fix");
  assert.equal(msg.ts, "2026-07-04T10:00:00.500Z");
});

test("only subagent links parented by this session are emitted", () => {
  const links: HfrSubagentLink[] = [
    {
      parentSessionId: "sess-1",
      childSessionId: "child-a",
      familiarId: "nova",
      status: "completed",
      startedAt: "2026-07-04T10:00:04.000Z",
      endedAt: "2026-07-04T10:00:09.000Z",
    },
    {
      parentSessionId: "other-session",
      childSessionId: "child-b",
      status: "completed",
    },
  ];
  const events = conversationToHfrEvents(baseConversation(), {
    subagentLinks: links,
  });
  const starts = byHook(events, "subagent_start");
  const stops = byHook(events, "subagent_stop");
  assert.equal(starts.length, 1);
  assert.equal(stops.length, 1);
  assert.equal(starts[0].child_session_id, "child-a");
  assert.equal(starts[0].familiar_id, "nova");
  assert.equal(stops[0].status, "completed");
});

test("field truncation keeps head for args, tail for tool results", () => {
  // Prose-like values exercise clipping without resembling credential blobs.
  const longIn = "a ".repeat(25);
  const longOut = "b ".repeat(25);
  const events = conversationToHfrEvents(
    baseConversation({
      turns: [
        {
          id: "t1",
          role: "assistant",
          text: "ok",
          createdAt: "2026-07-04T10:00:01.000Z",
          tools: [
            {
              id: "c1",
              name: "Bash",
              input: longIn,
              output: longOut,
              status: "ok",
            },
          ],
        },
      ],
    }),
    { maxFieldChars: 10 },
  );
  const [pre] = byHook(events, "pre_tool_call");
  const [post] = byHook(events, "post_tool_call");
  assert.equal(pre.args, "a a a a a …[+40 chars]");
  assert.equal(pre.tool_input, "a a a a a …[+40 chars]");
  assert.equal(post.result, "…[+40 chars]b b b b b ");
  assert.equal(post.tool_output, "…[+40 chars]b b b b b ");
});

test("serializeHfrJsonl emits one compact JSON object per line, trailing newline", () => {
  const jsonl = conversationToHfrJsonl(
    baseConversation({
      turns: [
        {
          id: "u1",
          role: "user",
          text: "hi",
          createdAt: "2026-07-04T10:00:00.500Z",
        },
      ],
    }),
  );
  assert.ok(jsonl.endsWith("\n"));
  const lines = jsonl.trimEnd().split("\n");
  // session + user_message
  assert.equal(lines.length, 2);
  for (const line of lines) {
    const parsed = JSON.parse(line);
    assert.equal(typeof parsed.hook, "string");
    assert.equal(parsed.type, undefined);
    assert.equal(parsed.session_id, "sess-1");
    // undefined-valued keys are pruned, not serialized as null.
    assert.ok(!Object.values(parsed).includes(null));
  }
});

test("malformed timestamps never throw and fall back to the start ts", () => {
  const events = conversationToHfrEvents(
    baseConversation({
      turns: [
        {
          id: "t1",
          role: "assistant",
          text: "ok",
          createdAt: "not-a-date",
          durationMs: 500,
          tools: [{ id: "c1", name: "A", status: "ok", durationMs: 200 }],
        },
      ],
    }),
  );
  const [post] = byHook(events, "post_tool_call");
  assert.equal(post.ts, "not-a-date");
});

test("empty serialize is a single newline", () => {
  assert.equal(serializeHfrJsonl([]), "\n");
});

test("rejected requests cannot become completed execution receipts", () => {
  const events = conversationToHfrEvents(baseConversation({ turns: [{
    id: "denied", role: "assistant", text: "Request declined", createdAt: "2026-07-04T10:00:00.000Z",
    tools: [{ id: "call", name: "Bash", status: "rejected" }],
  }] }));
  assert.equal(byHook(events, "pre_tool_call").length, 1);
  assert.equal(byHook(events, "post_tool_call").length, 0);
});

test("exports per-turn native identity without promoting saved or legacy model intent", () => {
  const claude = { schemaVersion: 1, harness: "claude", version: "2.1.288", model: "claude-opus-5-5" };
  const copilot = { schemaVersion: 1, harness: "copilot", version: "1.0.82", model: "claude-sonnet-5" };
  const turns = [
    { harness: "claude", runtimeIdentity: claude },
    { harness: "copilot", runtimeIdentity: copilot },
    { harness: "copilot", confirmedModel: "legacy-inferred-model" },
    { harness: "copilot", runtimeIdentity: { ...copilot, schemaVersion: 99 } },
    { harness: "codex", runtimeIdentity: copilot },
    { harness: "copilot", runtimeIdentity: { ...copilot, model: null } },
  ].map((responseMetadata, index) => ({
    id: `turn-${index}`, role: "assistant" as const, text: `answer-${index}`,
    createdAt: "2026-10-03T16:00:00.000Z", responseMetadata,
    tools: [{ id: `call-${index}`, name: "Read", status: "ok" as const, output: "read" }],
  }));
  const events = conversationToHfrEvents(baseConversation({ model: "saved-intent", turns }));
  assert.equal(events[0].model, undefined, "a session header cannot establish a model for every turn");
  assert.equal(events[0].recorded_model, "saved-intent");
  const llms = byHook(events, "post_llm_call");
  assert.deepEqual(llms.map((event) => event.model), [claude.model, copilot.model, undefined, undefined, undefined, undefined]);
  assert.deepEqual(llms.slice(0, 2).map((event) => event.runtime_identity), [claude, copilot]);
  assert.equal((llms[5].runtime_identity as { model: null }).model, null);
  for (const hook of ["pre_tool_call", "post_tool_call"]) {
    const calls = byHook(events, hook);
    assert.equal(calls[1].turn_id, "turn-1");
    assert.deepEqual(calls[1].runtime_identity, copilot, "tool observations retain their turn's runtime");
    assert.equal(calls[4].runtime_identity, undefined, "mismatched runtime claims stay unavailable");
  }
});

test("projects historical tool payloads and legacy assistant reasoning before export clipping", () => {
  const signedUrl = `https://example.com/${"x".repeat(100)}?signature=PRIVATE_SIGNED_URL`;
  const conv = baseConversation({ turns: [
    { id: "user", role: "user", text: "User example: <thinking>keep</thinking>", createdAt: "2026-10-03T16:00:00.000Z" },
    { id: "token=PRIVATE_TURN_ID", role: "assistant", text: "Visible<thinking>PRIVATE_REASONING</thinking> answer.", createdAt: "2026-10-03T16:00:01.000Z",
      tools: [
        { id: "reader@example.com", name: "Read reader@example.com token=PRIVATE_CREDENTIAL", input: signedUrl, output: JSON.stringify({ text: "safe", _meta: { signature: "PRIVATE_PROVIDER_STATE" } }), status: "ok" },
        { id: "pending", name: "Read", status: "running", output: "PRIVATE_PARTIAL_OUTPUT" },
        { id: "already:opaque-" + "a".repeat(64), name: "Read", status: "ok", output: "safe" },
      ] },
  ] });
  const original = JSON.stringify(conv);
  const events = conversationToHfrEvents(conv);
  const wire = serializeHfrJsonl(events);
  for (const sentinel of ["PRIVATE_SIGNED_URL", "PRIVATE_REASONING", "PRIVATE_PROVIDER_STATE", "PRIVATE_PARTIAL_OUTPUT", "PRIVATE_CREDENTIAL", "PRIVATE_TURN_ID", "reader@example.com"]) {
    assert.ok(!wire.includes(sentinel), sentinel);
  }
  assert.equal(byHook(events, "user_message")[0].text, "User example: <thinking>keep</thinking>");
  assert.equal(byHook(events, "post_llm_call")[0].output, "Visible answer.");
  const pre = byHook(events, "pre_tool_call");
  const post = byHook(events, "post_tool_call");
  assert.equal(pre[0].turn_id, byHook(events, "post_llm_call")[0].turn_id);
  assert.equal(pre[0].args, "[redacted signed URL]");
  assert.equal(pre[0].tool_call_id, post[0].tool_call_id);
  assert.equal(pre[2].tool_call_id, "already:opaque-" + "a".repeat(64), "historical projected IDs remain stable");
  assert.equal(post.length, 2);
  assert.ok(String(post[0].result).includes("[withheld provider state]"));
  const clipped = byHook(conversationToHfrEvents(conv, { maxFieldChars: 10 }), "pre_tool_call")[0];
  assert.ok(!String(clipped.args).includes("https://"), "signing parameters beyond the clip limit still withhold the whole URL");
  assert.doesNotMatch(conversationToHfrJsonl(conv, { maxFieldChars: 0 }), /PRIVATE_|reader@example\.com/,
    "disabling optional clipping cannot bypass disclosure projection");
  assert.equal(JSON.stringify(conv), original, "export does not rewrite execution history");
});
