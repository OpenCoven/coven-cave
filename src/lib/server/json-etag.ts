import { createHash } from "node:crypto";

/**
 * Serialize a cached JSON payload once and tag it with a strong content ETag.
 *
 * Memoized on the value's identity: an SWR cache hands the same result object
 * to every request inside its window, so the body is stringified and hashed
 * once per compute rather than once per poll (#5571).
 */
const serialized = new WeakMap<object, { body: string; etag: string }>();

export function serializeJsonWithEtag(value: object): { body: string; etag: string } {
  const existing = serialized.get(value);
  if (existing) return existing;
  const body = JSON.stringify(value);
  const etag = `"${createHash("sha1").update(body).digest("base64url")}"`;
  const entry = { body, etag };
  serialized.set(value, entry);
  return entry;
}

/** Whether an If-None-Match header names `etag` (list, weak prefix, or `*`). */
export function ifNoneMatchIncludes(header: string | null, etag: string): boolean {
  if (!header) return false;
  const bare = etag.replace(/^W\//, "");
  return header.split(",").some((candidate) => {
    const trimmed = candidate.trim();
    return trimmed === "*" || trimmed.replace(/^W\//, "") === bare;
  });
}
