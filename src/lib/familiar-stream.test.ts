import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createAttentionSafeTextAccumulator } from "./chat-attention-stream.ts";
import { scanChatResultProtocol } from "./chat-result-markers.ts";
import { streamFamiliarText } from "./familiar-stream.ts";
import type { ChatResponseMetadata } from "./chat-response-metadata.ts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** Build a Response-like object whose body streams the given SSE frame strings. */
function sseResponse(frames: string[], init: { ok?: boolean } = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return { ok: init.ok ?? true, body } as unknown as Response;
}

function frame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

describe("streamFamiliarText", () => {
  it("concatenates assistant_chunk text across frames", async () => {
    globalThis.fetch = (async () => sseResponse([
      frame({ kind: "assistant_chunk", text: "Hel" }),
      frame({ kind: "assistant_chunk", text: "lo " }),
      frame({ kind: "assistant_chunk", text: "world" }),
      frame({ kind: "done" }),
    ])) as typeof fetch;

    const { text, error } = await streamFamiliarText({ familiarId: "nova", prompt: "hi" });
    assert.equal(text, "Hello world");
    assert.equal(error, null);
  });

  it("includes sessionId in the request body only when provided", async () => {
    const bodies: string[] = [];
    globalThis.fetch = (async (_url: unknown, init: { body?: string }) => {
      bodies.push(init.body ?? "");
      return sseResponse([frame({ kind: "done" })]);
    }) as typeof fetch;

    await streamFamiliarText({ familiarId: "nova", prompt: "p" });
    await streamFamiliarText({ familiarId: "nova", prompt: "p", sessionId: "sess-9" });

    assert.equal(JSON.parse(bodies[0]).sessionId, undefined, "ephemeral run omits sessionId");
    assert.equal(JSON.parse(bodies[1]).sessionId, "sess-9", "resume run includes sessionId");
  });

  it("includes projectRoot in the request body only when provided", async () => {
    const bodies: string[] = [];
    globalThis.fetch = (async (_url: unknown, init: { body?: string }) => {
      bodies.push(init.body ?? "");
      return sseResponse([frame({ kind: "done" })]);
    }) as typeof fetch;

    await streamFamiliarText({ familiarId: "nova", prompt: "p" });
    await streamFamiliarText({ familiarId: "nova", prompt: "p", projectRoot: "/tmp/project" });

    assert.equal(JSON.parse(bodies[0]).projectRoot, undefined, "default quick chat omits projectRoot");
    assert.equal(JSON.parse(bodies[1]).projectRoot, "/tmp/project", "project-scoped quick chat includes projectRoot");
  });

  it("forwards command controls and model override fields when provided", async () => {
    let body = "";
    globalThis.fetch = (async (_url: unknown, init: { body?: string }) => {
      body = init.body ?? "";
      return sseResponse([frame({ kind: "done" })]);
    }) as typeof fetch;

    await streamFamiliarText({
      familiarId: "nova",
      prompt: "p",
      runId: "run-123",
      permissionMode: "read",
      reasoningEffort: "low",
      responseSpeed: "careful",
      modelOverride: "gpt-test",
      modelOverrideScope: "next-message",
    });

    assert.deepEqual(
      JSON.parse(body),
      {
        familiarId: "nova",
        prompt: "p",
        runId: "run-123",
        permissionMode: "read",
        reasoningEffort: "low",
        responseSpeed: "careful",
        modelOverride: "gpt-test",
        modelOverrideScope: "next-message",
      },
      "provided compact controls and model override fields are forwarded",
    );
  });

  it("forwards read-only permission mode when provided", async () => {
    let body = "";
    globalThis.fetch = (async (_url: unknown, init: { body?: string }) => {
      body = init.body ?? "";
      return sseResponse([frame({ kind: "done" })]);
    }) as typeof fetch;

    await streamFamiliarText({ familiarId: "nova", prompt: "p", permissionMode: "read" });

    assert.equal(JSON.parse(body).permissionMode, "read");
  });

  it("returns the created session id from stream frames", async () => {
    globalThis.fetch = (async () => sseResponse([
      frame({ kind: "session", sessionId: "sess-created" }),
      frame({ kind: "assistant_chunk", text: "saved" }),
      frame({ kind: "done", sessionId: "sess-created" }),
    ])) as typeof fetch;

    const { text, sessionId, error } = await streamFamiliarText({ familiarId: "nova", prompt: "hi" });
    assert.equal(text, "saved");
    assert.equal(sessionId, "sess-created");
    assert.equal(error, null);
  });

  it("returns and publishes requested-versus-applied response metadata", async () => {
    globalThis.fetch = (async () => sseResponse([
      frame({
        kind: "done",
        responseMetadata: {
          familiarId: "nova",
          harness: "claude",
          model: "anthropic/claude-sonnet-5",
          runtime: "local:/tmp",
          requestedModel: "anthropic/claude-sonnet-5",
          forwardedModel: "claude-sonnet-5",
          requestedControls: { reasoning: "high" },
          forwardedControls: { reasoning: "high" },
        },
      }),
    ])) as typeof fetch;

    let published: ChatResponseMetadata | undefined;
    const result = await streamFamiliarText({
      familiarId: "nova",
      prompt: "hi",
      onResponseMetadata: (metadata) => { published = metadata; },
    });
    assert.equal(result.responseMetadata?.forwardedModel, "claude-sonnet-5");
    assert.equal(published?.requestedControls?.reasoning, "high");
  });

  it("surfaces an error frame", async () => {
    globalThis.fetch = (async () => sseResponse([
      frame({ kind: "assistant_chunk", text: "Useful text.<coven:atten" }),
      frame({ kind: "error", message: "boom" }),
    ])) as typeof fetch;

    const { text, error } = await streamFamiliarText({ familiarId: "nova", prompt: "hi" });
    assert.equal(text, "Useful text.");
    assert.equal(error, "boom");
  });

  it("removes a partial attention marker after a failed done frame", async () => {
    globalThis.fetch = (async () => sseResponse([
      frame({ kind: "assistant_chunk", text: "Useful text.<coven:atten" }),
      frame({ kind: "done", isError: true }),
    ])) as typeof fetch;

    const { text, error } = await streamFamiliarText({ familiarId: "nova", prompt: "hi" });
    assert.equal(text, "Useful text.");
    assert.equal(error, "the familiar reported an error");
  });

  it("returns terminally stripped text when an aborted reader rejects", async () => {
    const abortController = new AbortController();
    const encoder = new TextEncoder();
    let pulls = 0;
    globalThis.fetch = (async () => ({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) {
            controller.enqueue(encoder.encode(frame({ kind: "assistant_chunk", text: "Useful text.<coven:atten" })));
            abortController.abort();
            return;
          }
          controller.error(new Error("request aborted"));
        },
      }),
    }) as unknown as Response) as typeof fetch;

    const { text, error } = await streamFamiliarText({
      familiarId: "nova",
      prompt: "hi",
      signal: abortController.signal,
    });
    assert.equal(text, "Useful text.");
    assert.equal(error, "cancelled");
  });

  it("reports a non-ok HTTP status as an error", async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 502, body: null }) as unknown as Response) as typeof fetch;
    const { error } = await streamFamiliarText({ familiarId: "nova", prompt: "hi" });
    assert.match(error ?? "", /chat bridge 502/);
  });

  it("fires onSession as soon as the session frame arrives, before the stream completes", async () => {
    globalThis.fetch = (async () => sseResponse([
      frame({ kind: "session", sessionId: "sess-early" }),
      frame({ kind: "assistant_chunk", text: "hi" }),
      frame({ kind: "done", sessionId: "sess-early" }),
    ])) as typeof fetch;

    const seen: Array<{ id: string; textSoFar: string }> = [];
    let textSoFar = "";
    const { sessionId } = await streamFamiliarText({
      familiarId: "nova",
      prompt: "hi",
      onText: (t) => { textSoFar = t; },
      onSession: (id) => seen.push({ id, textSoFar }),
    });

    assert.equal(sessionId, "sess-early");
    assert.ok(seen.length >= 1, "onSession fired");
    assert.equal(seen[0].id, "sess-early");
    assert.equal(seen[0].textSoFar, "", "the first onSession fired before any text streamed (a Stop mid-stream still knows its session)");
  });

  it("processes a final frame that arrives without its trailing blank line", async () => {
    globalThis.fetch = (async () => sseResponse([
      frame({ kind: "assistant_chunk", text: "tail" }),
      `data: ${JSON.stringify({ kind: "done", sessionId: "sess-tail" })}\n`,
    ])) as typeof fetch;

    const { text, sessionId } = await streamFamiliarText({ familiarId: "nova", prompt: "hi" });
    assert.equal(text, "tail");
    assert.equal(sessionId, "sess-tail", "the unterminated done frame is still processed");
  });

  it("decodes multi-byte characters split across stream chunks", async () => {
    const bytes = new TextEncoder().encode(frame({ kind: "assistant_chunk", text: "héllo" }) + frame({ kind: "done" }));
    // Split exactly between the two bytes of "é" (0xC3 0xA9).
    const splitAt = bytes.indexOf(0xc3) + 1;
    assert.ok(splitAt > 0, "test setup: the é byte pair is present");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitAt));
        controller.enqueue(bytes.slice(splitAt));
        controller.close();
      },
    });
    globalThis.fetch = (async () => ({ ok: true, body }) as unknown as Response) as typeof fetch;

    const { text, error } = await streamFamiliarText({ familiarId: "nova", prompt: "hi" });
    assert.equal(text, "héllo");
    assert.equal(error, null);
  });

  it("preserves the runtime-default sentinel and typed controls", async () => {
    let body = "";
    globalThis.fetch = (async (_url: unknown, init: { body?: string }) => {
      body = init.body ?? "";
      return sseResponse([frame({ kind: "done" })]);
    }) as typeof fetch;

    await streamFamiliarText({
      familiarId: "nova",
      prompt: "p",
      modelOverride: "",
      modelOverrideScope: "runtime-default",
      modelControls: { reasoning: "medium" },
    });

    assert.deepEqual(JSON.parse(body), {
      familiarId: "nova",
      prompt: "p",
      modelOverride: "",
      modelOverrideScope: "runtime-default",
      modelControls: { reasoning: "medium" },
    });
  });

  // Attention-marker leak coverage (holistic review: the directive applies to
  // every chat send, so every direct familiar-stream consumer — quick chat,
  // voice, prompt enhance, review draft — must never see raw `<coven:attention
  // …>` markup, complete or partial, through onText or the returned text).
  it("hides a complete attention marker from onText and the returned text", async () => {
    globalThis.fetch = (async () => sseResponse([
      frame({ kind: "assistant_chunk", text: 'Choose a channel.\n<coven:attention reason="decision" />' }),
      frame({ kind: "done" }),
    ])) as typeof fetch;

    const seen: string[] = [];
    const { text, error } = await streamFamiliarText({
      familiarId: "nova",
      prompt: "hi",
      onText: (t) => seen.push(t),
    });
    assert.equal(error, null);
    assert.equal(text, "Choose a channel.\n", "returned text has the marker stripped");
    for (const t of seen) {
      assert.doesNotMatch(t, /<coven:attention/, "onText never sees the raw marker");
    }
  });

  it("hides a chunked/partial attention marker tail while streaming", async () => {
    // The marker's opening tag arrives split across several chunks — a real
    // streaming boundary can land anywhere, including mid-tag.
    globalThis.fetch = (async () => sseResponse([
      frame({ kind: "assistant_chunk", text: "Pick one.\n<cov" }),
      frame({ kind: "assistant_chunk", text: "en:atten" }),
      frame({ kind: "assistant_chunk", text: 'tion reason="input"' }),
      frame({ kind: "assistant_chunk", text: " />" }),
      frame({ kind: "done" }),
    ])) as typeof fetch;

    const seen: string[] = [];
    const { text, error } = await streamFamiliarText({
      familiarId: "nova",
      prompt: "hi",
      onText: (t) => seen.push(t),
    });
    assert.equal(error, null);
    for (const t of seen) {
      assert.doesNotMatch(t, /<cov/, "no partial marker prefix ever flashes mid-stream");
    }
    assert.equal(text, "Pick one.\n", "the completed marker is stripped from the final text");
  });

  it("hides a possible marker tail while streaming but preserves it after settlement", async () => {
    globalThis.fetch = (async () => sseResponse([
      frame({ kind: "assistant_chunk", text: "Still useful.\n<coven:attention rea" }),
      frame({ kind: "done" }),
    ])) as typeof fetch;

    const seen: string[] = [];
    const { text, error } = await streamFamiliarText({
      familiarId: "nova",
      prompt: "hi",
      onText: (value) => seen.push(value),
    });
    assert.equal(error, null);
    assert.equal(text, "Still useful.\n<coven:attention rea");
    assert.ok(seen.every((value) => !value.includes("<coven:")));
  });

  it("preserves prose after malformed quoted attention markup", async () => {
    globalThis.fetch = (async () => sseResponse([
      frame({ kind: "assistant_chunk", text: '<coven:attention" reason="decision">' }),
      frame({ kind: "assistant_chunk", text: "AFTER" }),
      frame({ kind: "done" }),
    ])) as typeof fetch;

    const { text, error } = await streamFamiliarText({ familiarId: "nova", prompt: "hi" });
    assert.equal(error, null);
    assert.equal(text, "AFTER");
  });

  it("keeps a fenced literal attention marker visible (never a live request)", async () => {
    const literal = 'Example: `<coven:attention reason="decision" />`';
    globalThis.fetch = (async () => sseResponse([
      frame({ kind: "assistant_chunk", text: literal }),
      frame({ kind: "done" }),
    ])) as typeof fetch;

    const { text, error } = await streamFamiliarText({ familiarId: "nova", prompt: "hi" });
    assert.equal(error, null);
    assert.equal(text, literal, "a marker inside an inline code span is left untouched");
  });

  it("hides an attention marker delivered via assistant_replace", async () => {
    globalThis.fetch = (async () => sseResponse([
      frame({ kind: "assistant_chunk", text: "draft" }),
      frame({ kind: "assistant_replace", text: 'Final answer.\n<coven:attention reason="approval" />' }),
      frame({ kind: "done" }),
    ])) as typeof fetch;

    const seen: string[] = [];
    const { text, error } = await streamFamiliarText({
      familiarId: "nova",
      prompt: "hi",
      onText: (t) => seen.push(t),
    });
    assert.equal(error, null);
    assert.equal(text, "Final answer.\n");
    for (const t of seen) {
      assert.doesNotMatch(t, /<coven:attention/, "the replace event's marker never reaches onText raw");
    }
  });

  it("lets Quick Chat project each exact raw snapshot through result-aware attention ranges", async () => {
    const label = "Literal <coven:attention /> and <coven:atten stay exact";
    const resultMarker = `<coven:result id="quick-stream" state="passed" label="${label}" />`;
    const partialAttentionBoundary =
      resultMarker.indexOf("<coven:attention") + "<coven:atten".length;
    globalThis.fetch = (async () => sseResponse([
      frame({ kind: "assistant_chunk", text: resultMarker.slice(0, partialAttentionBoundary) }),
      frame({ kind: "assistant_chunk", text: resultMarker.slice(partialAttentionBoundary) }),
      frame({ kind: "assistant_chunk", text: '\n<coven:attention reason="decision" />' }),
      frame({ kind: "done" }),
    ])) as typeof fetch;

    const attentionText = createAttentionSafeTextAccumulator();
    const rawSnapshots: string[] = [];
    const seen: string[] = [];
    const { text, error } = await streamFamiliarText({
      familiarId: "nova",
      prompt: "hi",
      projectAssistantText: (rawText, phase) => {
        rawSnapshots.push(rawText);
        const resultProtocol = scanChatResultProtocol(rawText);
        attentionText.replace(
          rawText,
          resultProtocol.markdownRangeSource,
          resultProtocol.protectedRanges,
        );
        if (phase === "terminal") return attentionText.terminal();
        if (phase === "settled") return attentionText.settled();
        return attentionText.visible();
      },
      onText: (value) => seen.push(value),
    });

    assert.equal(error, null);
    assert.equal(text, `${resultMarker}\n`);
    assert.equal(
      seen[0],
      resultMarker.slice(0, partialAttentionBoundary),
      "a partial attention prefix at the end of an unfinished result stays byte-exact",
    );
    assert.equal(seen.at(-1), `${resultMarker}\n`);
    assert.ok(
      rawSnapshots.some((snapshot) => snapshot.endsWith('<coven:attention reason="decision" />')),
      "the projector receives the unmodified accumulated assistant bytes",
    );
  });
});
