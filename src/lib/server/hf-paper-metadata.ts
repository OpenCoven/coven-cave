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
    const body = (await response.json()) as Record<string, unknown>;
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
