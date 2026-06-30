import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { streamFamiliarText } from "./familiar-stream.ts";

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

  it("forwards command controls and model override fields when provided", async () => {
    let body = "";
    globalThis.fetch = (async (_url: unknown, init: { body?: string }) => {
      body = init.body ?? "";
      return sseResponse([frame({ kind: "done" })]);
    }) as typeof fetch;

    await streamFamiliarText({
      familiarId: "nova",
      prompt: "p",
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
        reasoningEffort: "low",
        responseSpeed: "careful",
        modelOverride: "gpt-test",
        modelOverrideScope: "next-message",
      },
      "provided compact controls and model override fields are forwarded",
    );
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

  it("surfaces an error frame", async () => {
    globalThis.fetch = (async () => sseResponse([
      frame({ kind: "assistant_chunk", text: "partial" }),
      frame({ kind: "error", message: "boom" }),
    ])) as typeof fetch;

    const { text, error } = await streamFamiliarText({ familiarId: "nova", prompt: "hi" });
    assert.equal(text, "partial");
    assert.equal(error, "boom");
  });

  it("reports a non-ok HTTP status as an error", async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 502, body: null }) as unknown as Response) as typeof fetch;
    const { error } = await streamFamiliarText({ familiarId: "nova", prompt: "hi" });
    assert.match(error ?? "", /chat bridge 502/);
  });
});
