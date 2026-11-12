import assert from "node:assert/strict";
import test from "node:test";
import { ConversationLoadError, clearConversationCache, loadConversation } from "../conversation-cache.ts";
import { chatHistorySources } from "./history-sources.ts";
import { readOfflineCache, writeOfflineCache } from "../offline-cache.ts";

test("uncached authoritative absence purges durable history without revoking a new live stream", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: new EventTarget() });
  const { subscribeChatAccessInvalidation } = await import("../chat-access-invalidation.ts");
  let revoked = false;
  const unsubscribe = subscribeChatAccessInvalidation(() => { revoked = true; });
  let disk: string | null = null;
  let finishPurge!: () => void;
  const purged = new Promise<void>((resolve) => { finishPurge = resolve; });
  const invoke = async (command: string, args: { payload?: string }) => {
    if (command === "offline_cache_write") disk = args.payload ?? null;
    if (command === "offline_cache_delete") { disk = null; finishPurge(); }
    if (command === "offline_cache_read") return { purged: false, entry: disk === null ? null : { payload: disk, revision: "r1", updatedAtUnixMs: 1, readOnly: true } };
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), { __TAURI_INTERNALS__: { invoke } }) });
  try {
    clearConversationCache();
    await writeOfflineCache("conversation", "durable-absent", { ok: true, conversation: { turns: [] } }, "r1");
    assert.notEqual(disk, null);
    globalThis.fetch = async () => Response.json({ error: "Missing" }, { status: 404 });
    await assert.rejects(chatHistorySources.loadNetwork("durable-absent"), (error: unknown) => error instanceof ConversationLoadError && error.status === 404);
    assert.equal(await readOfflineCache("conversation", "durable-absent"), null);
    await purged;
    assert.equal(disk, null, "missing history cannot return on an offline reopen");
    assert.equal(revoked, false, "uncached absence is not authority to abort an unsaved live stream");
  } finally {
    unsubscribe();
    clearConversationCache();
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

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
