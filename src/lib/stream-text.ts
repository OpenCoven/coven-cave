// Append a streamed chunk to an assistant turn's text while collapsing runs of
// 3+ newlines to 2 — WITHOUT re-scanning the whole (growing) buffer each chunk.
//
// The transcript did `(t.text + chunk).replace(/\n{3,}/g, "\n\n")` per
// assistant_chunk, which is O(total) per chunk → O(n²) over a long response.
// Because `prev` is already collapsed (this function maintains that invariant),
// a new run of 3+ newlines can only form within `chunk` or straddle the seam,
// so we only need to re-collapse the last couple chars of `prev` plus `chunk`.
export function appendCollapsingNewlines(prev: string, chunk: string): string {
  if (!chunk) return prev;
  // A straddling run touches at most the final 2 newlines already allowed in
  // `prev`; keep a 2-char seam so the regex can see across the junction.
  const seam = 2;
  const head = prev.slice(0, Math.max(0, prev.length - seam));
  const tail = (prev.slice(Math.max(0, prev.length - seam)) + chunk).replace(/\n{3,}/g, "\n\n");
  return head + tail;
}
