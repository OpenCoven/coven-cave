import assert from "node:assert/strict";
import test from "node:test";
import { ConversationLoadError, clearConversationCache, loadConversation } from "../conversation-cache.ts";
import { chatHistorySources } from "./history-sources.ts";

test("only a conversation HTTP 404 is authoritative absence", () => {
  assert.equal(chatHistorySources.isMissingError(new ConversationLoadError("Missing", 404)), true);
  for (const error of [new ConversationLoadError("Denied", 403), new ConversationLoadError("Unavailable", 503), new Error("404"), { status: 404 }, null]) {
    assert.equal(chatHistorySources.isMissingError(error), false);
  }
});

test("flow transcript transport preserves encoded session identity, no-store and response validation", async () => {
  const original = globalThis.fetch;
  try {
    const calls: { url: string; cache: unknown }[] = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), cache: options?.cache });
      return Response.json({ ok: true, transcript: "  Saved flow  " });
    };
    assert.equal(await chatHistorySources.loadFlowTranscript("a/b &c"), "Saved flow");
    const request = new URL(calls[0].url, "http://localhost");
    assert.equal(request.pathname, "/api/flows/session-transcript");
    assert.equal(request.searchParams.get("sessionId"), "a/b &c");
    assert.equal(calls[0].cache, "no-store");
    for (const body of [{ ok: false, transcript: "Denied" }, { ok: true, transcript: "  " }, { ok: true, transcript: 42 }, {}]) {
      globalThis.fetch = async () => Response.json(body);
      assert.equal(await chatHistorySources.loadFlowTranscript("chat"), null);
    }
    globalThis.fetch = async () => new Response("Gone", { status: 404 });
    assert.equal(await chatHistorySources.loadFlowTranscript("chat"), null);
    globalThis.fetch = async () => new Response("invalid json");
    assert.equal(await chatHistorySources.loadFlowTranscript("chat"), null);
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.equal(await chatHistorySources.loadFlowTranscript("chat"), null);
  } finally {
    globalThis.fetch = original;
  }
});

test("history transport joins the existing prefetch and paints that same cached payload", async () => {
  const original = globalThis.fetch;
  clearConversationCache();
  try {
    let requests = 0;
    let respond!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => { respond = resolve; });
    globalThis.fetch = async () => { requests += 1; return response; };
    const prefetched = loadConversation("shared-history");
    const loaded = chatHistorySources.loadNetwork("shared-history");
    assert.equal(loaded, prefetched);
    const payload = { ok: true, conversation: { activeLeafId: "answer", turns: [] } };
    respond(Response.json(payload));
    const result = await loaded;
    assert.equal(requests, 1);
    assert.equal(chatHistorySources.readMemory("shared-history"), result);
  } finally {
    globalThis.fetch = original;
    clearConversationCache();
  }
});
