// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchToolOutput, ToolOutputFetchError } from "./tool-output-fetch.ts";

const response = (status, body) => Response.json(body, { status });

test("each read rechecks access and the url is encoded", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return response(200, { ok: true, output: "full output" });
  };
  const [a, b] = await Promise.all([
    fetchToolOutput("s 1", "tool/1", fetchImpl),
    fetchToolOutput("s 1", "tool/1", fetchImpl),
  ]);
  assert.equal(a, "full output");
  assert.equal(b, "full output");
  assert.deepEqual(urls, Array(2).fill("/api/chat/conversation/s%201/tool-output?toolId=tool%2F1"));
});

test("a failure is reported and forgotten so Retry asks again", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1 ? response(404, { ok: false, error: "not found" }) : response(200, { ok: true, output: "later" });
  };
  await assert.rejects(fetchToolOutput("s", "t", fetchImpl), (error) => error instanceof ToolOutputFetchError && error.status === 404);
  assert.equal(await fetchToolOutput("s", "t", fetchImpl), "later");
  assert.equal(calls, 2);
});


test("a settled success cannot survive access revocation", async () => {
  let calls = 0;
  const fetchImpl = async () => ++calls === 1
    ? response(200, { ok: true, output: "AUTHORIZED_ONCE" })
    : response(403, { ok: false, error: "PRIVATE_ERROR_SENTINEL" });
  assert.equal(await fetchToolOutput("revoked", "t", fetchImpl), "AUTHORIZED_ONCE");
  await assert.rejects(fetchToolOutput("revoked", "t", fetchImpl), (error) =>
    error instanceof ToolOutputFetchError && error.status === 403 && !error.message.includes("PRIVATE_ERROR_SENTINEL"));
  assert.equal(calls, 2);
});

test("invalid targets never reach the network", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return response(200, { ok: true, output: "wrong" }); };
  for (const [session, tool] of [["..", "t"], ["a/b", "t"], [" padded", "t"], ["s", " t"], ["s", ""], ["s", "x".repeat(257)]]) {
    await assert.rejects(fetchToolOutput(session, tool, fetchImpl), ToolOutputFetchError);
  }
  assert.equal(calls, 0);
});

test("strict envelopes and byte limits refuse unbounded output", async () => {
  for (const body of [{ ok: 1, output: "wrong" }, { ok: true, output: 3 }, { ok: true, output: "😀".repeat(65537) }]) {
    await assert.rejects(fetchToolOutput("s", "bounded", async () => response(200, body)), ToolOutputFetchError);
  }
  assert.equal(await fetchToolOutput("s", "empty", async () => response(200, { ok: true, output: "" })), "");
});

test("reads stay same-origin, refuse redirects and propagate cancellation", async () => {
  const controller = new AbortController();
  let seenSignal;
  const promise = fetchToolOutput("s", "cancel", async (_url, options) => {
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.mode, "same-origin");
    assert.equal(options.redirect, "error");
    seenSignal = options.signal;
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  }, controller.signal);
  controller.abort();
  await assert.rejects(promise);
  assert.equal(seenSignal.aborted, true);
});


test("the byte ceiling cancels oversized envelopes before JSON parsing", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(fetchToolOutput("s", "huge-envelope", async () => new Response(body)), ToolOutputFetchError);
  assert.equal(cancelled, true);
});

test("invalid UTF-8 and unexpected success status never supply output", async () => {
  await assert.rejects(fetchToolOutput("s", "utf8", async () => new Response(new Uint8Array([0xff]))), ToolOutputFetchError);
  await assert.rejects(fetchToolOutput("s", "created", async () => response(201, { ok: true, output: "wrong" })), ToolOutputFetchError);
  assert.equal(await fetchToolOutput("s", "limit", async () => response(200, { ok: true, output: "a".repeat(256 * 1024) })), "a".repeat(256 * 1024));
});


test("a response from another origin, chat or tool cannot supply a result", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { configurable: true, value: { href: "https://cave.example/chat" } });
  try {
    for (const url of ["https://other.example/api/chat/conversation/s/tool-output?toolId=t", "https://cave.example/api/chat/conversation/other/tool-output?toolId=t", "https://cave.example/api/chat/conversation/s/tool-output?toolId=other"]) {
      const res = response(200, { ok: true, output: "WRONG_SCOPE" });
      Object.defineProperty(res, "url", { value: url });
      await assert.rejects(fetchToolOutput("s", "t", async () => res), ToolOutputFetchError);
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "location", descriptor);
    else delete globalThis.location;
  }
});
