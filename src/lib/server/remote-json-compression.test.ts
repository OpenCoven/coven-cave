// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, request } from "node:http";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
import {
  createRemoteJsonCompression,
  shouldCompressRemoteRequest,
} from "./remote-json-compression.ts";

const require = createRequire(import.meta.url);
// The same bundled middleware server.ts uses.
const compression = createRemoteJsonCompression(require("next/dist/compiled/compression"));
const bigJson = JSON.stringify({ ok: true, sessions: Array.from({ length: 200 }, (_, i) => ({ id: `s${i}`, title: "Chat about compression" })) });

async function withServer(directLoopback, handler, run) {
  const server = createServer((req, res) => {
    if (shouldCompressRemoteRequest(req, directLoopback)) compression(req, res, () => handler(req, res));
    else handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function get(port, path, onFirstChunk) {
  return new Promise((resolve, reject) => {
    const req = request({ port, path, headers: { "accept-encoding": "gzip, br" } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => {
        if (chunks.length === 0) onFirstChunk?.();
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

const json = (body) => (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(body);
};

test("remote API JSON is gzipped and decodes to the same body", async () => {
  await withServer(false, json(bigJson), async (port) => {
    const response = await get(port, "/api/sessions/list");
    assert.equal(response.headers["content-encoding"], "gzip");
    assert.ok(response.body.length < bigJson.length / 3, "compresses well below the raw size");
    assert.equal(gunzipSync(response.body).toString(), bigJson);
  });
});

test("small JSON is left alone", async () => {
  await withServer(false, json('{"ok":true}'), async (port) => {
    const response = await get(port, "/api/health");
    assert.equal(response.headers["content-encoding"], undefined);
  });
});

test("a remote event stream is never buffered or compressed", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await withServer(false, async (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${"x".repeat(2048)}\n\n`);
    await gate;
    res.end("data: done\n\n");
  }, async (port) => {
    let firstChunkBeforeEnd = false;
    const response = await get(port, "/api/chat/send", () => {
      firstChunkBeforeEnd = true;
      release();
    });
    assert.equal(firstChunkBeforeEnd, true, "the first event arrives while the stream is still open");
    assert.equal(response.headers["content-encoding"], undefined);
  });
});

test("the desktop's direct loopback requests are not compressed", async () => {
  await withServer(true, json(bigJson), async (port) => {
    const response = await get(port, "/api/sessions/list");
    assert.equal(response.headers["content-encoding"], undefined);
    assert.equal(response.body.toString(), bigJson);
  });
});

test("only /api/ requests are eligible, and never an upgrade", () => {
  const req = (url, headers = {}) => ({ url, headers });
  assert.equal(shouldCompressRemoteRequest(req("/api/sessions/list"), false), true);
  assert.equal(shouldCompressRemoteRequest(req("/api?x=1"), false), true);
  assert.equal(shouldCompressRemoteRequest(req("/_next/static/chunk.js"), false), false);
  assert.equal(shouldCompressRemoteRequest(req("/apix"), false), false);
  assert.equal(shouldCompressRemoteRequest(req("/api/pty-ws", { upgrade: "websocket" }), false), false);
  assert.equal(shouldCompressRemoteRequest(req("/api/sessions/list"), true), false);
});
