/**
 * Validation for the image bytes an external provider returns for a project
 * icon.
 *
 * The bytes on this path are untrusted: they arrive from api.openai.com or
 * generativelanguage.googleapis.com, and the route hands them straight to the
 * browser as a `data:` URL that `setProjectImage` persists and `ProjectAvatar`
 * renders. Two things therefore must not happen.
 *
 * 1. The provider's *declared* content type must never decide what we store.
 *    The Gemini branch reads a `mimeType` string out of the response body, and
 *    `setProjectImage` accepts `image/svg+xml`. A declared-type passthrough
 *    would let a compromised or misbehaving upstream put SVG — the one image
 *    format that is active content once it reaches a document context — into
 *    the avatar store. Nothing here reads the declared type at all: the format
 *    is decided by magic bytes, through the same `detectBackdropMime` sniffer
 *    the backdrop store uses, so SVG/XML is refused by construction rather
 *    than by an easily-dropped denylist entry.
 *
 * 2. A pathological payload must not be materialised before it is bounded.
 *    The size ceiling is applied to the *encoded* length first, so an oversize
 *    response is refused without ever allocating the decoded buffer.
 *
 * Beyond sniffing, the bytes are re-encoded through a real decoder (sharp in
 * production, the same decode-as-validator the familiar-avatar upload path
 * uses): anything that survives the magic-byte gate but is not actually a
 * decodable image throws there and is refused. The output is canonical — one
 * format, bounded dimensions — so what we store never depends on what the
 * provider chose to send.
 *
 * The decoder is a parameter rather than a hard import so the policy above is
 * testable without a native dependency and without a network call: tests
 * inject a decoder and assert the ordering and the refusals directly.
 */

import { detectBackdropMime } from "./backdrop-store.ts";

/**
 * Icons render at 16–44px (`ProjectAvatar`'s PX map). 4MB of source is already
 * far more than any icon needs, and it stays under the 2MB *data URL* ceiling
 * `setProjectImage` enforces once the canonical re-encode has shrunk it.
 */
export const MAX_ICON_IMAGE_BYTES = 4 * 1024 * 1024;

/** The only format this module ever emits, regardless of what came in. */
export const ICON_CANONICAL_MIME = "image/webp";

/** Longest edge of the canonical icon — crisp at 44px up to ~4x DPR. */
export const ICON_MAX_DIM = 256;

export type IconImageRejection =
  | "empty_payload"
  | "image_too_large"
  | "unsupported_image_format"
  | "undecodable_image";

/** Decode-and-normalize. Throws, or returns non-canonical bytes, to reject. */
export type IconImageDecoder = (bytes: Buffer) => Promise<Buffer>;

export type ValidatedIconImage =
  | { ok: true; mime: typeof ICON_CANONICAL_MIME; dataUrl: string; bytes: Buffer }
  | { ok: false; reason: IconImageRejection };

/**
 * Strict base64. `Buffer.from(s, "base64")` silently skips characters it does
 * not recognise, so a payload that is not base64 at all would otherwise decode
 * to plausible-looking garbage instead of being refused.
 */
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Decoded byte length of a well-formed base64 string, without decoding it. */
function decodedLengthOf(compact: string): number {
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  return (compact.length / 4) * 3 - padding;
}

/**
 * Turn a provider's base64 image payload into canonical, storable icon bytes,
 * or say why it was refused.
 *
 * @param b64 the provider's base64 payload, exactly as parsed from its JSON.
 * @param decode the decode-as-validator. Defaults to sharp in production.
 */
export async function validateProviderIconImage(
  b64: unknown,
  decode: IconImageDecoder = sharpIconDecoder,
): Promise<ValidatedIconImage> {
  if (typeof b64 !== "string") return { ok: false, reason: "empty_payload" };
  const compact = b64.replace(/\s+/g, "");
  if (compact.length === 0) return { ok: false, reason: "empty_payload" };

  // Bound from the ENCODED length, before any allocation: 4 base64 characters
  // carry 3 bytes. A 100MB response is refused here, not after it is decoded.
  if (compact.length % 4 !== 0 || !BASE64_RE.test(compact)) {
    return { ok: false, reason: "unsupported_image_format" };
  }
  if (decodedLengthOf(compact) > MAX_ICON_IMAGE_BYTES) {
    return { ok: false, reason: "image_too_large" };
  }

  const raw = Buffer.from(compact, "base64");
  if (raw.byteLength === 0) return { ok: false, reason: "empty_payload" };

  // The provider's declared content type is deliberately not consulted — not
  // here and not by the caller. Only these magic bytes decide the format, so
  // SVG/XML (which has no magic number in this sniffer) can never pass.
  if (detectBackdropMime(raw) === null) {
    return { ok: false, reason: "unsupported_image_format" };
  }

  let canonical: Buffer;
  try {
    canonical = await decode(raw);
  } catch {
    return { ok: false, reason: "undecodable_image" };
  }
  if (!canonical || canonical.byteLength === 0) {
    return { ok: false, reason: "undecodable_image" };
  }

  // Re-sniff the encoder's OWN output. The mime we advertise has to be the
  // format the bytes actually are; taking the encoder's word for it would
  // reintroduce exactly the declared-type trust this module exists to remove.
  if (detectBackdropMime(canonical) !== ICON_CANONICAL_MIME) {
    return { ok: false, reason: "undecodable_image" };
  }

  return {
    ok: true,
    mime: ICON_CANONICAL_MIME,
    bytes: canonical,
    dataUrl: `data:${ICON_CANONICAL_MIME};base64,${canonical.toString("base64")}`,
  };
}

/**
 * Production decoder: sharp, imported lazily so that merely loading this
 * module (a unit test, the API-contract sweep) does not require the native
 * binary to be present.
 */
export const sharpIconDecoder: IconImageDecoder = async (bytes: Buffer) => {
  const { default: sharp } = await import("sharp");
  return await sharp(bytes)
    .resize(ICON_MAX_DIM, ICON_MAX_DIM, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
};
