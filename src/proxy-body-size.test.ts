import assert from "node:assert/strict";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import test from "node:test";
import { NextRequest } from "next/server";
import { getCloneableBody } from "next/dist/server/body-streams.js";
import nextConfig from "../next.config.ts";
import { proxy } from "./proxy.ts";
import {
  MAX_ATTACHMENT_IMAGE_BYTES, MAX_ATTACHMENT_MEDIA_BYTES,
  MAX_CHAT_ATTACHMENTS, MAX_CHAT_NON_IMAGE_ATTACHMENTS,
} from "./lib/chat-attachments.ts";
import { MAX_PROXY_BODY_BYTES } from "./lib/request-body-limit.ts";

// Exercise Next's real clone/finalize path: this is where an otherwise valid
// attachment request used to lose its JSON tail before reaching the route.
async function roundTrip(sizes: number[], mime = "image/png") {
  const attachments = sizes.map((size, index) => ({
    name: `reference-${index}`, type: mime, size,
    dataUrl: `data:${mime};base64,${Buffer.alloc(size, index + 1).toString("base64")}`,
  }));
  const body = JSON.stringify({ prompt: "Inspect these references", attachments });
  const input = new IncomingMessage(new Socket());
  let offset = 0;
  input._read = () => {
    if (offset >= body.length) {
      input.push(null);
      return;
    }
    const chunk = body.slice(offset, offset + 64 * 1024);
    offset += chunk.length;
    input.push(Buffer.from(chunk));
  };
  const limit = nextConfig.experimental?.proxyClientMaxBodySize;
  const cloned = getCloneableBody(input, typeof limit === "number" ? limit : undefined);
  for await (const chunk of cloned.cloneBodyStream()) void chunk;
  await cloned.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(chunk);
  const forwarded = Buffer.concat(chunks);
  assert.equal(forwarded.length, Buffer.byteLength(body), "proxy must forward the complete JSON body");
  const received = JSON.parse(forwarded.toString());
  assert.deepEqual(received.attachments, attachments);
}

test("six ordinary PNGs survive the proxy before JSON parsing", async () => {
  await roundTrip([2613897, 2004049, 1941930, 1833776, 2029888, 1991769]);
});

test("ten maximum-size images survive base64 expansion", async () => {
  await roundTrip(Array(10).fill(MAX_ATTACHMENT_IMAGE_BYTES));
});

test("fifty images survive the proxy before JSON parsing", async () => {
  await roundTrip(Array(MAX_CHAT_ATTACHMENTS).fill(1024 * 1024));
});

test("one maximum-size media attachment survives base64 expansion", async () => {
  await roundTrip([MAX_ATTACHMENT_MEDIA_BYTES], "video/mp4");
});

test("the proxy budget fits the largest allowed mix", () => {
  const encodedMediaBytes = Math.ceil(MAX_ATTACHMENT_MEDIA_BYTES / 3) * 4;
  const encodedImageBytes = Math.ceil(MAX_ATTACHMENT_IMAGE_BYTES / 3) * 4;
  const maxEncodedAttachments = MAX_CHAT_NON_IMAGE_ATTACHMENTS * encodedMediaBytes
    + (MAX_CHAT_ATTACHMENTS - MAX_CHAT_NON_IMAGE_ATTACHMENTS) * encodedImageBytes;
  assert.ok(maxEncodedAttachments + 64 * 1024 * 1024 < MAX_PROXY_BODY_BYTES);
});

test("an oversized declared chat body gets an actionable 413", async () => {
  const old = process.env.COVEN_CAVE_AUTH_TOKEN;
  process.env.COVEN_CAVE_AUTH_TOKEN = "body-size-test-token";
  try {
    const response = await proxy(new NextRequest("http://localhost/api/chat/send", {
      method: "POST",
      headers: {
        host: "localhost", origin: "http://localhost", "content-type": "application/json",
        "x-coven-cave-token": "body-size-test-token",
        "content-length": String(MAX_PROXY_BODY_BYTES + 1),
      },
    }));
    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /fewer attachments/i);
  } finally {
    if (old === undefined) delete process.env.COVEN_CAVE_AUTH_TOKEN;
    else process.env.COVEN_CAVE_AUTH_TOKEN = old;
  }
});

test("body-size refusal preserves authentication and the inclusive boundary", async () => {
  const oldToken = process.env.COVEN_CAVE_AUTH_TOKEN;
  const oldPeer = process.env.COVEN_CAVE_LOCAL_PEER_SECRET;
  process.env.COVEN_CAVE_AUTH_TOKEN = "body-size-test-token";
  process.env.COVEN_CAVE_LOCAL_PEER_SECRET = "body-size-local-peer";
  try {
    for (const [length, token, expected] of [
      [MAX_PROXY_BODY_BYTES, "body-size-test-token", 200],
      [MAX_PROXY_BODY_BYTES + 1, "wrong-token", 401],
    ] as const) {
      const response = await proxy(new NextRequest("http://localhost/api/chat/send", {
        method: "POST",
        headers: {
          host: "localhost", origin: "http://localhost", "content-type": "application/json",
          "x-coven-cave-token": token, "content-length": String(length),
        },
      }));
      assert.equal(response.status, expected);
    }
  } finally {
    if (oldToken === undefined) delete process.env.COVEN_CAVE_AUTH_TOKEN;
    else process.env.COVEN_CAVE_AUTH_TOKEN = oldToken;
    if (oldPeer === undefined) delete process.env.COVEN_CAVE_LOCAL_PEER_SECRET;
    else process.env.COVEN_CAVE_LOCAL_PEER_SECRET = oldPeer;
  }
});
