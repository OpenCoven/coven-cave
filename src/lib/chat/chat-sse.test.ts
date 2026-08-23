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

  it("ignores duplicate and stale numbered events", async () => {
    const seen: string[] = [];
    const result = await consumeChatSse(
      stream([
        'id: 4\ndata: {"kind":"assistant_chunk","text":"one"}\n\n',
        'id: 4\ndata: {"kind":"assistant_chunk","text":"duplicate"}\n\n',
        'id: 3\ndata: {"kind":"assistant_chunk","text":"stale"}\n\n',
        'id: 5\ndata: {"kind":"done"}\n\n',
      ]),
      (event) => seen.push(event.kind === "assistant_chunk" ? event.text : event.kind),
    );

    assert.deepEqual(seen, ["one", "done"]);
    assert.equal(result.cursor, 5);
    assert.equal(result.sawDone, true);
  });

  it("rejects overlap at the start of a resumed response", async () => {
    const seen: string[] = [];
    const result = await consumeChatSse(
      stream([
        'id: 8\ndata: {"kind":"assistant_chunk","text":"replayed"}\n\n',
        'id: 9\ndata: {"kind":"assistant_chunk","text":"new"}\n\n',
      ]),
      (event) => {
        if (event.kind === "assistant_chunk") seen.push(event.text);
      },
      8,
    );

    assert.deepEqual(seen, ["new"]);
    assert.equal(result.cursor, 9);
  });
});
