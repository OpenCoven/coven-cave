// @ts-nocheck
// Behavioral tests for GET /api/chat/attachment — the durable half of
// "attached images survive a reload" (cave-cysu4). The store root is read at
// call time from COVEN_CAVE_CHAT_ATTACHMENTS_DIR, but route.ts pulls in the
// api-security gate at module load, so the env is set before the dynamic
// import to keep every path inside the temp dir.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = mkdtempSync(join(tmpdir(), "chat-attachment-route-"));
const OUTSIDE = mkdtempSync(join(tmpdir(), "chat-attachment-route-outside-"));
process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR = ROOT;

const { GET } = await import("./route.ts");
const { saveChatImageAttachment, saveChatMediaAttachment } = await import("@/lib/server/chat-attachment-store");

after(() => {
  rmSync(ROOT, { recursive: true, force: true });
  rmSync(OUTSIDE, { recursive: true, force: true });
});

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** A loopback request, which is what the local-origin gate expects. */
function localRequest(query: string): Request {
  return new Request(`http://127.0.0.1:3000/api/chat/attachment?${query}`, {
    headers: { host: "127.0.0.1:3000" },
  });
}

test("a stored image is served with its own bytes and mime type", async () => {
  const storedId = await saveChatImageAttachment(
    `data:image/png;base64,${PIXEL.toString("base64")}`,
    "image/png",
  );
  assert.ok(storedId, "the store minted an id");

  const res = await GET(localRequest(`id=${encodeURIComponent(storedId)}`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("content-length"), String(PIXEL.byteLength));
  assert.match(res.headers.get("cache-control") ?? "", /private/);
  // User-supplied bytes must not be able to pull subresources if the URL is
  // ever opened directly (an SVG attachment is still markup).
  assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'none'/);

  const body = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(body, PIXEL, "the served bytes are the stored bytes");
});

test("a stored media attachment is served for inline playback", async () => {
  // Bigger than the 5MB image cap — proves the read path uses the media cap.
  const clip = Buffer.alloc(6 * 1024 * 1024, 9);
  const storedId = await saveChatMediaAttachment(
    `data:video/mp4;base64,${clip.toString("base64")}`,
    "video/mp4",
  );
  assert.ok(storedId, "the store minted a media id");

  const res = await GET(localRequest(`id=${encodeURIComponent(storedId)}`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "video/mp4");
  assert.equal(res.headers.get("content-length"), String(clip.byteLength));
  const body = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(body, clip, "the served bytes are the stored bytes");
});

test("a non-local request is refused before the store is touched", async () => {
  const res = await GET(
    new Request("http://cave.example.com/api/chat/attachment?id=x", {
      headers: { host: "cave.example.com", origin: "http://evil.example.com" },
    }),
  );
  assert.equal(res.status, 403);
});

test("ids the store could not have minted are a path-deny", async () => {
  for (const bad of ["", "..%2F..%2Fetc%2Fpasswd", "not-a-uuid.png", "x".repeat(200)]) {
    const res = await GET(localRequest(`id=${bad}`));
    assert.equal(res.status, 403, `rejects ${JSON.stringify(bad)}`);
    assert.match((await res.json()).error, /path not allowed/);
  }
});

test("a well-formed id with nothing behind it is a 404", async () => {
  const res = await GET(localRequest("id=11111111-2222-4333-8444-555555555555.png"));
  assert.equal(res.status, 404);
});

test("a symlink planted in the store is not served", async () => {
  const secret = join(OUTSIDE, "secret.png");
  writeFileSync(secret, "not yours");
  const linkId = "5b1f0e64-6b0e-4b6b-9f3a-0d1c2e3f4a5b.png";
  symlinkSync(secret, join(ROOT, linkId));
  const res = await GET(localRequest(`id=${linkId}`));
  assert.equal(res.status, 404, "a symlinked entry is refused, not dereferenced");
  const body = await res.text();
  assert.ok(!body.includes("not yours"), "the linked file's contents never leave the store");
});

console.log("chat/attachment route.test.ts: ok");
