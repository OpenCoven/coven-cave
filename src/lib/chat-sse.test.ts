import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { consumeChatSse } from "./chat-sse.ts";

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("consumeChatSse", () => {
  it("returns the SSE cursor and accepts CRLF frames split across reads", async () => {
    const seen: string[] = [];
    const result = await consumeChatSse(
      stream([
        "id: 7\r\ndata: {\"kind\":\"assistant_chunk\",\"text\":\"hi\"}\r\n\r",
        "\nid: 8\r\ndata: {\"kind\":\"done\"}\r\n\r\n",
      ]),
      (event) => seen.push(event.kind),
    );

    assert.deepEqual(seen, ["assistant_chunk", "done"]);
    assert.equal(result.cursor, 8);
    assert.equal(result.sawDone, true);
  });

  it("does not treat a transport end without done as a completed run", async () => {
    const result = await consumeChatSse(
      stream(['id: 3\ndata: {"kind":"progress","id":"start","label":"Starting","status":"running"}\n\n']),
      () => {},
    );

    assert.equal(result.cursor, 3);
    assert.equal(result.sawDone, false);
  });
});
