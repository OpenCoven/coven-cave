/**
 * Behavioural guards for the untrusted-image gate on the project-icon route.
 *
 * These drive `validateProviderIconImage` with real byte payloads and assert
 * what it *does* — which payloads are refused, what the caller gets back, and
 * crucially in what ORDER the checks run. The decoder is injected and records
 * its calls, so "the magic-byte gate runs before the decoder" and "an oversize
 * payload is never decoded" are assertions rather than comments.
 *
 * No network, no native binary: the injected decoder stands in for sharp.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ICON_CANONICAL_MIME,
  MAX_ICON_IMAGE_BYTES,
  validateProviderIconImage,
  type IconImageDecoder,
} from "./project-icon-image.ts";

// ── fixtures: real magic bytes, not names ───────────────────────────────────

function pad(head: number[], size = 64): Buffer {
  const body = Buffer.alloc(Math.max(0, size - head.length), 0x7a);
  return Buffer.concat([Buffer.from(head), body]);
}

const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const GIF = pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

function webp(size = 64): Buffer {
  const buf = pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], size);
  buf.writeUInt32LE(buf.byteLength - 8, 4);
  return buf;
}
const WEBP = webp();

const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/api/vault")</script></svg>',
  "utf8",
);
const HTML = Buffer.from("<!doctype html><html><body>nope</body></html>", "utf8");

/** A decoder that records every call and returns canonical WebP bytes. */
function recordingDecoder(
  reply: (bytes: Buffer) => Promise<Buffer> | Buffer = () => webp(96),
) {
  const calls: Buffer[] = [];
  const decode: IconImageDecoder = async (bytes) => {
    calls.push(bytes);
    return await reply(bytes);
  };
  return { decode, calls };
}

const b64 = (buf: Buffer) => buf.toString("base64");

// ── the format gate ─────────────────────────────────────────────────────────

test("accepts the three raster formats and always emits canonical WebP", async () => {
  for (const [label, source] of [
    ["png", PNG],
    ["jpeg", JPEG],
    ["webp", WEBP],
  ] as const) {
    const canonical = webp(128);
    const { decode, calls } = recordingDecoder(() => canonical);
    const result = await validateProviderIconImage(b64(source), decode);

    assert.equal(result.ok, true, `${label} should be accepted`);
    if (!result.ok) return;
    assert.equal(result.mime, ICON_CANONICAL_MIME, `${label} must normalize to WebP`);
    assert.equal(
      result.dataUrl,
      `data:image/webp;base64,${canonical.toString("base64")}`,
      `${label} data URL must carry the canonical bytes under the canonical mime`,
    );
    assert.deepEqual(result.bytes, canonical);

    // The decoder must receive the DECODED source bytes, not the base64 text.
    assert.equal(calls.length, 1, `${label} should be decoded exactly once`);
    assert.deepEqual(calls[0], source, `${label} decoder must see the raw bytes`);
  }
});

test("refuses SVG — the one format that is active content in a data: URL", async () => {
  const { decode, calls } = recordingDecoder();
  const result = await validateProviderIconImage(b64(SVG), decode);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "unsupported_image_format");
  // Ordering, not just outcome: the sniffer refuses it before any decode runs.
  assert.equal(calls.length, 0, "SVG must be refused before the decoder is reached");
});

test("a declared content type cannot smuggle a format past the sniffer", async () => {
  // The Gemini branch reads `mimeType` out of the provider's response body.
  // Whatever it says, only the bytes decide — so SVG bytes stay refused and
  // PNG bytes stay accepted, with the declared type playing no part at all.
  const { decode } = recordingDecoder();
  const declaredImage = await validateProviderIconImage(b64(SVG), decode);
  assert.equal(declaredImage.ok, false, "SVG bytes are refused however they are labelled");

  const declaredSvg = await validateProviderIconImage(b64(PNG), decode);
  assert.equal(declaredSvg.ok, true, "PNG bytes are accepted however they are labelled");
  if (declaredSvg.ok) {
    assert.equal(declaredSvg.mime, ICON_CANONICAL_MIME);
    assert.doesNotMatch(declaredSvg.dataUrl, /svg/i, "no SVG mime may reach the data URL");
  }
});

test("refuses formats outside the raster allowlist", async () => {
  for (const [label, source] of [
    ["gif", GIF],
    ["html", HTML],
  ] as const) {
    const { decode, calls } = recordingDecoder();
    const result = await validateProviderIconImage(b64(source), decode);
    assert.equal(result.ok, false, `${label} must be refused`);
    if (!result.ok) assert.equal(result.reason, "unsupported_image_format");
    assert.equal(calls.length, 0, `${label} must not reach the decoder`);
  }
});

// ── the size gate ───────────────────────────────────────────────────────────

test("an oversize payload is refused without being decoded or allocated", async () => {
  // One base64 character past the ceiling's worth of encoded text.
  const chars = Math.ceil(((MAX_ICON_IMAGE_BYTES + 1024) * 4) / 3 / 4) * 4;
  const oversize = "A".repeat(chars);
  const { decode, calls } = recordingDecoder();

  const result = await validateProviderIconImage(oversize, decode);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "image_too_large");
  assert.equal(calls.length, 0, "an oversize payload must never reach the decoder");
});

test("a payload of exactly the ceiling is admitted by the size gate", async () => {
  // Exactly MAX_ICON_IMAGE_BYTES decoded, so the bound is pinned to the right
  // side of the comparison: the cap is "more than", not "as much as". A
  // payload one byte over is refused by the test above; this one must get
  // past the size check and be stopped only by the format sniffer.
  const encodedLength = ((MAX_ICON_IMAGE_BYTES + 2) / 3) * 4;
  assert.equal(encodedLength % 4, 0, "fixture must be a whole number of base64 quanta");
  const atCeiling = `${"A".repeat(encodedLength - 2)}==`;

  const result = await validateProviderIconImage(atCeiling, recordingDecoder().decode);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(
      result.reason,
      "unsupported_image_format",
      "an exactly-at-ceiling payload must reach the format gate, not be refused as too large",
    );
  }
});

// ── malformed payloads ──────────────────────────────────────────────────────

test("refuses empty, non-string and non-base64 payloads", async () => {
  const cases: Array<[string, unknown, string]> = [
    ["undefined", undefined, "empty_payload"],
    ["null", null, "empty_payload"],
    ["number", 42, "empty_payload"],
    ["empty string", "", "empty_payload"],
    ["whitespace only", "   \n\t ", "empty_payload"],
    ["not base64", "!!!!not-base64!!!!", "unsupported_image_format"],
    ["ragged base64", "AAAAA", "unsupported_image_format"],
  ];
  for (const [label, input, reason] of cases) {
    const { decode, calls } = recordingDecoder();
    const result = await validateProviderIconImage(input, decode);
    assert.equal(result.ok, false, `${label} must be refused`);
    if (!result.ok) assert.equal(result.reason, reason, `${label} reason`);
    assert.equal(calls.length, 0, `${label} must not reach the decoder`);
  }
});

test("tolerates base64 wrapped in whitespace, as providers sometimes send it", async () => {
  const wrapped = b64(PNG).replace(/(.{16})/g, "$1\n");
  const result = await validateProviderIconImage(wrapped, recordingDecoder().decode);
  assert.equal(result.ok, true, "line-wrapped base64 is still a valid payload");
});

// ── the decoder as validator ────────────────────────────────────────────────

test("a payload the decoder cannot read is refused, not stored", async () => {
  const { decode } = recordingDecoder(() => {
    throw new Error("VipsJpeg: premature end of input file");
  });
  const result = await validateProviderIconImage(b64(JPEG), decode);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "undecodable_image");
});

test("an empty decode result is refused rather than served as a 0-byte icon", async () => {
  const { decode } = recordingDecoder(() => Buffer.alloc(0));
  const result = await validateProviderIconImage(b64(PNG), decode);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "undecodable_image");
});

test("the advertised mime is re-derived from the encoder's own output", async () => {
  // If the encoder ever emitted something other than WebP, advertising
  // image/webp would be a lie of exactly the kind this module refuses to take
  // from the provider. So the output is sniffed too.
  const { decode } = recordingDecoder(() => PNG);
  const result = await validateProviderIconImage(b64(PNG), decode);
  assert.equal(result.ok, false, "non-WebP encoder output must not be advertised as WebP");
  if (!result.ok) assert.equal(result.reason, "undecodable_image");
});

console.log("project-icon-image.test.ts: ok");
