// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route.ts";

const originalFetch = globalThis.fetch;
const encoder = new TextEncoder();

function sseResponse(events: unknown[]): Response {
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  }), { status: 200 });
}

test("Salem strips complete and partial attention directives from local synthesis", async () => {
  try {
    for (const chunks of [
      ["Grounded answer.\n", '<coven:attention reason="decision" />'],
      ["Grounded answer.\n<cov", "en:attention rea"],
    ]) {
      globalThis.fetch = (async (input: string | URL) => {
        const url = String(input);
        if (url.includes("salem.opencoven.ai/api/chat")) {
          return Response.json({ mode: "context", context: "Retrieved docs." });
        }
        if (new URL(url).pathname === "/api/chat/send") {
          return sseResponse([
            ...chunks.map((text) => ({ kind: "assistant_chunk", text })),
            { kind: "done" },
          ]);
        }
        throw new Error(`unexpected fetch: ${url}`);
      }) as typeof fetch;

      const response = await POST(new Request("http://localhost/api/salem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "How do permissions work?",
          familiarId: "sage",
        }),
      }));
      const json = await response.json();
      assert.equal(response.status, 200);
      assert.equal(json.source, "local-familiar");
      assert.equal(json.reply, "Grounded answer.");
      assert.doesNotMatch(json.reply, /<cov/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Salem preserves fenced attention marker literals", async () => {
  const literal = '`<coven:attention reason="decision" />`';
  try {
    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes("salem.opencoven.ai/api/chat")) {
        return Response.json({ mode: "context", context: "Retrieved docs." });
      }
      return sseResponse([
        { kind: "assistant_chunk", text: literal },
        { kind: "done" },
      ]);
    }) as typeof fetch;

    const response = await POST(new Request("http://localhost/api/salem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Show the protocol literally.", familiarId: "sage" }),
    }));
    assert.equal((await response.json()).reply, literal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
