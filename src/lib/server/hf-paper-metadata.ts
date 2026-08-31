import { isArxivPaperId } from "@/lib/hf-papers";

export type HfPaperMetadata = {
  title: string;
  authors: string[];
  abstract: string;
  publishedAt: string;
};

/**
 * Ingest is an interactive paste: the budget is how long a person will wait
 * for it to land, not how long HF might take.
 */
const TIMEOUT_MS = 5_000;

/**
 * A paper's title/authors/abstract JSON is a few KB; this is generous
 * headroom against a hostile or accidentally-huge HF response rather than a
 * realistic ceiling. Unbounded, the title alone could land verbatim in the
 * links store and be rendered in the resource row (cave-gnvfa).
 */
const MAX_RESPONSE_BYTES = 1 * 1024 * 1024;

/**
 * Reads and parses the response body without ever buffering past
 * `maxBytes` — `response.json()` has no such cap and would hold the whole
 * body in memory before this function got a chance to reject it.
 */
async function readBoundedJson(
  response: Response,
  maxBytes: number,
): Promise<Record<string, unknown> | null> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) return null;

  const reader = response.body?.getReader();
  if (!reader) {
    // No streamable body (e.g. some fetch mocks) — still bounded by
    // TIMEOUT_MS above, just not by byte count.
    return (await response.json()) as Record<string, unknown>;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  return JSON.parse(text) as Record<string, unknown>;
}

export async function fetchHfPaperMetadata(
  arxivId: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<HfPaperMetadata | null> {
  if (!isArxivPaperId(arxivId)) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(`https://huggingface.co/api/papers/${arxivId}`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = await readBoundedJson(response, MAX_RESPONSE_BYTES);
    if (!body) return null;
    const title = typeof body.title === "string" ? body.title : "";
    if (!title) return null;
    const authors = Array.isArray(body.authors)
      ? body.authors
          .map((a) => (a && typeof a === "object" ? (a as { name?: unknown }).name : null))
          .filter((n): n is string => typeof n === "string" && n.length > 0)
      : [];
    return {
      title,
      authors,
      abstract: typeof body.summary === "string" ? body.summary : "",
      publishedAt: typeof body.publishedAt === "string" ? body.publishedAt : "",
    };
  } catch {
    // A flaky third party must not cost the user their paste; the caller keeps
    // the derived title instead.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
