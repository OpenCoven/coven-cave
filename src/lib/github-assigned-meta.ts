// Pure completeness model for /api/github/assigned (cave-amx2m).
//
// The endpoint stitches three capped GitHub sources into one list: assigned
// issues (REST, per_page=50), review-requested PRs and authored PRs (search,
// per_page=30). Before this, a cap was silent and ANY source failing failed
// the whole response — so the task picker rendered "nothing assigned to you"
// over lists that were truncated or half-missing. This module derives honest
// per-source metadata the route returns and the picker discloses. Kept free
// of fetch/Next so caps and partial failures are unit-testable with bare node.

export type AssignedSourceMeta = {
  ok: boolean;
  /** True when GitHub has more than this source returned. */
  truncated: boolean;
  /** Items this source actually contributed. */
  count: number;
  /** GitHub's own total (search sources only — REST /issues reports none). */
  total?: number;
  /** Present only when ok=false: why the source is missing from the list. */
  error?: string;
};

export type AssignedSourcesMeta = {
  assigned: AssignedSourceMeta;
  reviewRequested: AssignedSourceMeta;
  authored: AssignedSourceMeta;
};

/** A failed source: contributes nothing, says so. */
export function failedSource(error: string): AssignedSourceMeta {
  return { ok: false, truncated: false, count: 0, error };
}

/**
 * REST list sources (no total_count): truncation shows in the Link header's
 * rel="next" page; a full page WITHOUT the header is still flagged, because a
 * result exactly at the cap is indistinguishable from an overflowing one and
 * "maybe more" must never render as "that's everything".
 */
export function restSource(count: number, perPage: number, linkHeader: string | null): AssignedSourceMeta {
  const hasNext = typeof linkHeader === "string" && /rel="next"/.test(linkHeader);
  return { ok: true, truncated: hasNext || count >= perPage, count };
}

/** Search sources report total_count — truncation is exact. */
export function searchSource(count: number, totalCount: number | undefined): AssignedSourceMeta {
  const total = Number.isFinite(totalCount) ? Math.max(totalCount as number, count) : undefined;
  return {
    ok: true,
    truncated: total != null ? total > count : false,
    count,
    ...(total != null ? { total } : {}),
  };
}

/** Any source failed → the aggregate list is PARTIAL, not empty-and-done. */
export function isPartial(sources: AssignedSourcesMeta): boolean {
  return Object.values(sources).some((s) => !s.ok);
}

/** Any source capped → the aggregate list is a newest-first WINDOW. */
export function isTruncated(sources: AssignedSourcesMeta): boolean {
  return Object.values(sources).some((s) => s.ok && s.truncated);
}

/**
 * One quiet sentence for the picker's disclosure line. Failure outranks
 * truncation: a missing source makes counts unreliable, so "may be
 * incomplete" wins over the more precise "newest N" phrasing.
 */
export function assignedDisclosure(sources: AssignedSourcesMeta, shown: number): string | null {
  if (isPartial(sources)) {
    const failed = Object.values(sources).filter((s) => !s.ok).length;
    return `${failed} GitHub source${failed === 1 ? "" : "s"} didn't load — this list may be incomplete.`;
  }
  if (isTruncated(sources)) {
    const known = Object.values(sources).reduce(
      (n, s) => (s.total != null ? n + s.total : n),
      0,
    );
    const hasUnknownCap = Object.values(sources).some((s) => s.truncated && s.total == null);
    return known > shown && !hasUnknownCap
      ? `Showing the newest ${shown} of ${known} — search to narrow, or open GitHub for the rest.`
      : `Showing the newest ${shown} — more exists on GitHub than fits here.`;
  }
  return null;
}
