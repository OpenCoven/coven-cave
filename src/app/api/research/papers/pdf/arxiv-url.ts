import { isArxivPaperId } from "@/lib/hf-papers";

/**
 * The id is validated and then interpolated into a hard-coded arXiv URL. It
 * never composes a host, a scheme or a path prefix, so there is no SSRF
 * surface here.
 */
export function arxivPdfUrl(arxivId: string): string | null {
  if (!isArxivPaperId(arxivId)) return null;
  return `https://arxiv.org/pdf/${arxivId}`;
}
