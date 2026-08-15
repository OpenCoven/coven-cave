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

const HF_HOSTS = new Set(["huggingface.co", "www.huggingface.co"]);
const ARXIV_HOSTS = new Set(["arxiv.org", "www.arxiv.org"]);
const HF_PAPER_PATH = new RegExp(String.raw`^/papers/${ARXIV_ID}$`);
const ARXIV_PAPER_PATH = new RegExp(String.raw`^/(?:abs|pdf)/${ARXIV_ID}(?:\.pdf)?$`);

/**
 * Classify a value that ALREADY IS a URL — the counterpart to the scanner
 * above, for entries that arrive through `urls[]` rather than inside prose.
 *
 * The scanner finds a reference ANYWHERE in a blob, which is right for text
 * and wrong for a URL: `google.com/url?q=https://arxiv.org/abs/<id>` or
 * `r.jina.ai/https://arxiv.org/abs/<id>` merely embeds a paper URL, and
 * treating the wrapper as the paper stamps a foreign title and a `paper` block
 * onto somebody else's page. So this matches on the PARSED host and pathname,
 * and returns null for everything else, unparseable input included.
 */
export function arxivIdFromUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // `host`, not `hostname`: a non-default port is not one of these sites.
  const pattern = HF_HOSTS.has(url.host)
    ? HF_PAPER_PATH
    : ARXIV_HOSTS.has(url.host)
      ? ARXIV_PAPER_PATH
      : null;
  const id = pattern?.exec(url.pathname)?.[1];
  return id && isArxivPaperId(id) ? id : null;
}

export function hfPaperUrl(arxivId: string): string {
  return `https://huggingface.co/papers/${arxivId}`;
}

/** Guard for anything that interpolates an id into a URL or a path. */
export function isArxivPaperId(value: string): boolean {
  return /^\d{4}\.\d{4,5}$/.test(value);
}
