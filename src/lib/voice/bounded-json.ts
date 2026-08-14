export class JsonBodyTooLargeError extends Error {}

/**
 * Parse a small JSON request without allowing a chunked request to bypass the
 * caller's byte limit. `Request.json()` buffers the complete body first.
 */
export async function parseBoundedJsonBody(
  req: Request,
  maxBytes: number,
): Promise<unknown> {
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isSafeInteger(declaredBytes) && declaredBytes > maxBytes) {
      throw new JsonBodyTooLargeError();
    }
  }

  const reader = req.body?.getReader();
  if (!reader) throw new SyntaxError("Request body is empty");
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        throw new JsonBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
