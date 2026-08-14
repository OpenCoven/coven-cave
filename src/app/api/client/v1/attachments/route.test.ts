// @ts-nocheck
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

import sharp from "sharp";

import { CLIENT_V1_LOCAL_HEADER } from "@/proxy-helpers";

const root = await mkdtemp(path.join(process.cwd(), ".test-tmp-client-v1-attachments-route-"));
const caveRoot = path.join(root, "cave");
const attachmentRoot = path.join(caveRoot, "chat-attachments");
process.env.COVEN_CAVE_HOME = caveRoot;
process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR = attachmentRoot;
process.env.COVEN_CAVE_CLIENT_ATTACHMENT_STORE_PATH = path.join(caveRoot, "client-v1-attachments.json");
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(root, "credentials.json");
process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = path.join(root, "operations.json");
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = "client-v1-attachments-secret";
await mkdir(attachmentRoot, { recursive: true });

const { POST } = await import("./route.ts");
const { CLIENT_ATTACHMENT_MAX_REQUEST_BYTES } = await import("@/lib/server/client-v1/attachment-service.ts");
const { issueCredential } = await import("@/lib/server/client-v1/credential-store.ts");
const { resetRateLimitsForTest } = await import("@/lib/server/client-v1/rate-limit.ts");

const pngBytes = await sharp({
  create: {
    width: 1,
    height: 1,
    channels: 4,
    background: { r: 255, g: 0, b: 0, alpha: 1 },
  },
}).png().toBuffer();
const textBytes = Buffer.from("hello from the desktop client\n", "utf8");

after(() => rm(root, { recursive: true, force: true }));
beforeEach(async () => {
  resetRateLimitsForTest();
  await rm(process.env.COVEN_CAVE_CLIENT_ATTACHMENT_STORE_PATH!, { force: true });
  await rm(process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH!, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_ATTACHMENT_STORE_PATH}.lock.sqlite3`, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_ATTACHMENT_STORE_PATH}.lock.sqlite3-shm`, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_ATTACHMENT_STORE_PATH}.lock.sqlite3-wal`, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH}.lock.sqlite3`, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH}.lock.sqlite3-shm`, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH}.lock.sqlite3-wal`, { force: true });
  await rm(process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH!, { force: true });
  await rm(attachmentRoot, { recursive: true, force: true });
  await mkdir(attachmentRoot, { recursive: true });
});

async function token(scopes = ["attachments:write"]) {
  return (await issueCredential({
    appName: "OpenCoven Chat",
    installationId: crypto.randomUUID(),
    scopes,
  })).token;
}

function uploadForm(files: Array<{ name: string; type: string; bytes: Buffer }>): FormData {
  const form = new FormData();
  for (const file of files) {
    form.append("files", new File([file.bytes], file.name, { type: file.type }));
  }
  return form;
}

function request(
  form: FormData,
  opts: { bearer?: string | null; marker?: string | null; idempotencyKey?: string | null } = {},
) {
  const headers = new Headers();
  if (opts.marker !== null) {
    headers.set(CLIENT_V1_LOCAL_HEADER, opts.marker ?? process.env.COVEN_CAVE_LOCAL_PEER_SECRET!);
  }
  if (opts.bearer !== undefined && opts.bearer !== null) {
    headers.set("authorization", "Bearer " + opts.bearer);
  }
  if (opts.idempotencyKey !== null) {
    headers.set("idempotency-key", opts.idempotencyKey ?? crypto.randomUUID());
  }
  return new Request("http://localhost/api/client/v1/attachments", {
    method: "POST",
    headers,
    body: form,
  });
}

async function rawMultipartRequest(
  files: Array<{ name: string; type: string; bytes: Buffer }>,
  opts: {
    bearer?: string | null;
    marker?: string | null;
    idempotencyKey?: string | null;
    contentLength?: number | null;
    streamed?: boolean;
  } = {},
) {
  const source = request(uploadForm(files), opts);
  const body = new Uint8Array(await source.arrayBuffer());
  const headers = new Headers();
  headers.set("content-type", source.headers.get("content-type") ?? "");
  if (opts.marker !== null) {
    headers.set(CLIENT_V1_LOCAL_HEADER, opts.marker ?? process.env.COVEN_CAVE_LOCAL_PEER_SECRET!);
  }
  if (opts.bearer !== undefined && opts.bearer !== null) {
    headers.set("authorization", "Bearer " + opts.bearer);
  }
  if (opts.idempotencyKey !== null) {
    headers.set("idempotency-key", opts.idempotencyKey ?? crypto.randomUUID());
  }
  if (opts.contentLength !== null && opts.contentLength !== undefined) {
    headers.set("content-length", String(opts.contentLength));
  }
  const finalBody = opts.streamed
    ? new ReadableStream({
        start(controller) {
          const chunkSize = 64 * 1024;
          for (let offset = 0; offset < body.byteLength; offset += chunkSize) {
            controller.enqueue(body.subarray(offset, Math.min(body.byteLength, offset + chunkSize)));
          }
          controller.close();
        },
      })
    : body;
  return {
    req: new Request("http://localhost/api/client/v1/attachments", {
      method: "POST",
      headers,
      body: finalBody,
      ...(opts.streamed ? { duplex: "half" } : {}),
    }),
    bodyLength: body.byteLength,
  };
}

test("upload requires the loopback marker, attachments:write, and a UUID Idempotency-Key", async () => {
  const body = uploadForm([{ name: "pixel.png", type: "image/png", bytes: pngBytes }]);
  assert.equal((await POST(request(body, { marker: null, bearer: null, idempotencyKey: null }))).status, 403);

  const wrongScope = await POST(request(body, {
    bearer: await token(["chat:read"]),
    idempotencyKey: null,
  }));
  assert.equal(wrongScope.status, 403);
  assert.equal((await wrongScope.json()).error.code, "scope_denied");

  const missingKey = await POST(request(body, { bearer: await token(), idempotencyKey: null }));
  assert.equal(missingKey.status, 400);
  assert.equal((await missingKey.json()).error.code, "invalid_request");
});

test("upload persists deterministic bounded receipts and exact multipart replays are idempotent", async () => {
  const bearer = await token();
  const idempotencyKey = "9f4145de-9b43-4abc-876d-81ef63de60e0";
  const files = [
    { name: "pixel.png", type: "image/png", bytes: pngBytes },
    { name: "notes.txt", type: "text/plain", bytes: textBytes },
  ];

  const first = await POST(request(uploadForm(files), { bearer, idempotencyKey }));
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.deepEqual(firstBody, {
    ok: true,
    attachments: [
      {
        id: firstBody.attachments[0].id,
        name: "pixel.png",
        mimeType: "image/png",
        sizeBytes: pngBytes.byteLength,
      },
      {
        id: firstBody.attachments[1].id,
        name: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: textBytes.byteLength,
      },
    ],
  });
  assert.ok(firstBody.attachments[0].id.endsWith(".png"));
  assert.ok(firstBody.attachments[1].id.endsWith(".txt"));
  assert.equal(
    (await readdir(attachmentRoot)).length,
    4,
    "the canonical store lands the files plus their immutable name sidecars",
  );

  const replay = await POST(request(uploadForm(files), { bearer, idempotencyKey }));
  assert.equal(replay.status, 201);
  assert.deepEqual(await replay.json(), firstBody);

  const conflict = await POST(request(uploadForm([
    { name: "pixel.png", type: "image/png", bytes: pngBytes },
    { name: "notes.txt", type: "text/plain", bytes: Buffer.from("different body\n", "utf8") },
  ]), { bearer, idempotencyKey }));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "conflict");
});

test("upload rejects a multipart body whose raw request bytes exceed 25 MiB even when file bytes stay under the cap", async () => {
  const bearer = await token();
  const files = [
    { name: "a.txt", type: "text/plain", bytes: Buffer.alloc(6 * 1024 * 1024, 0x61) },
    { name: "b.txt", type: "text/plain", bytes: Buffer.alloc(6 * 1024 * 1024, 0x62) },
    { name: "c.txt", type: "text/plain", bytes: Buffer.alloc(6 * 1024 * 1024, 0x63) },
    {
      name: "d.txt",
      type: "text/plain",
      bytes: Buffer.alloc(CLIENT_ATTACHMENT_MAX_REQUEST_BYTES - (18 * 1024 * 1024) - 512, 0x64),
    },
  ];
  const measured = await rawMultipartRequest(files, { bearer, contentLength: null });
  const { bodyLength } = measured;
  assert.ok(bodyLength > CLIENT_ATTACHMENT_MAX_REQUEST_BYTES, `fixture must exceed the raw-body cap; got ${bodyLength}`);
  const { req } = await rawMultipartRequest(files, { bearer, contentLength: bodyLength });
  const response = await POST(req);
  assert.equal(response.status, 413, await response.clone().text());
  assert.equal((await response.json()).error.code, "invalid_request");
});

test("upload rejects a streamed multipart body over 25 MiB even without Content-Length", async () => {
  const bearer = await token();
  const files = [
    { name: "a.txt", type: "text/plain", bytes: Buffer.alloc(6 * 1024 * 1024, 0x61) },
    { name: "b.txt", type: "text/plain", bytes: Buffer.alloc(6 * 1024 * 1024, 0x62) },
    { name: "c.txt", type: "text/plain", bytes: Buffer.alloc(6 * 1024 * 1024, 0x63) },
    {
      name: "d.txt",
      type: "text/plain",
      bytes: Buffer.alloc(CLIENT_ATTACHMENT_MAX_REQUEST_BYTES - (18 * 1024 * 1024) - 512, 0x64),
    },
  ];
  const { req, bodyLength } = await rawMultipartRequest(files, {
    bearer,
    contentLength: null,
    streamed: true,
  });
  assert.ok(bodyLength > CLIENT_ATTACHMENT_MAX_REQUEST_BYTES, `fixture must exceed the raw-body cap; got ${bodyLength}`);
  const response = await POST(req);
  assert.equal(response.status, 413, await response.clone().text());
  assert.equal((await response.json()).error.code, "invalid_request");
});
