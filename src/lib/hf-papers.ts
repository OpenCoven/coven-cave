/**
 * Recognise Hugging Face paper references in free text.
 *
 * A bare `2401.12345` is deliberately NOT matched: pasted prose is full of
 * decimal numbers and version strings, and manufacturing resources from them
 * is worse than missing one. The `hf papers read` command or a URL is the
 * signal that the number is a paper.
 */

/** arXiv ids are `YYMM.NNNNN`, optionally with a `vN` revision suffix. */
const ARXIV_ID = String.raw`(\d{4}\.\d{4,5})(?:v\d+)?`;

const PATTERNS = [
  new RegExp(String.raw`\bhf\s+papers?\s+read\s+${ARXIV_ID}\b`, "gi"),
  new RegExp(String.raw`https?://(?:www\.)?huggingface\.co/papers/${ARXIV_ID}\b`, "gi"),
  new RegExp(String.raw`https?://(?:www\.)?arxiv\.org/(?:abs|pdf)/${ARXIV_ID}(?:\.pdf)?\b`, "gi"),
];

/** Canonical ids, deduped, in first-seen order. The `vN` suffix is dropped. */
export function parseHfPaperReferences(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) seen.add(match[1]);
  }
  return [...seen];
}

export function hfPaperUrl(arxivId: string): string {
  return `https://huggingface.co/papers/${arxivId}`;
}

/** Guard for anything that interpolates an id into a URL or a path. */
export function isArxivPaperId(value: string): boolean {
  return /^\d{4}\.\d{4,5}$/.test(value);
}
