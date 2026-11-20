import { extractLinks } from "@/lib/link-extractor";
import { arxivIdFromUrl, hfPaperUrl, parseHfPaperReferences } from "@/lib/hf-papers";

/**
 * Merge explicit URLs, URLs found in pasted text, and paper references.
 *
 * Paper ids are resolved to their canonical HF URL and placed FIRST, so that
 * when the same paper also appears as a raw arXiv URL the canonical form is
 * the one that survives the caller's dedupe.
 *
 * `urls[]` entries arrive already-as-URLs, so they are classified with
 * arxivIdFromUrl rather than scanned as text: a paper URL pasted into chat
 * canonicalizes and dedupes like a `hf papers read` of the same id, while a
 * wrapper that merely embeds one is neither rewritten nor dropped.
 */
export function collectIngestUrls(input: { urls?: unknown; text?: unknown }): string[] {
  const out: string[] = [];
  const text = typeof input.text === "string" ? input.text : "";

  for (const id of parseHfPaperReferences(text)) out.push(hfPaperUrl(id));

  if (Array.isArray(input.urls)) {
    for (const raw of input.urls) {
      if (typeof raw !== "string" || !raw.trim()) continue;
      const trimmed = raw.trim();
      const id = arxivIdFromUrl(trimmed);
      out.push(id ? hfPaperUrl(id) : trimmed);
    }
  }
  if (text.trim()) out.push(...extractLinks(text));

  // Drop any raw arXiv/HF URL for a paper already represented canonically.
  const paperIds = new Set(parseHfPaperReferences(text));
  return [...new Set(out)].filter((url) => {
    if (url.startsWith("https://huggingface.co/papers/")) return true;
    const id = arxivIdFromUrl(url);
    return !id || !paperIds.has(id);
  });
}
