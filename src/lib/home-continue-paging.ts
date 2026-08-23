// Pure paging model for Home's "Continue where you left off" carousel
// (cave-9oi1s).
//
// The strip used to render `sessions.slice(0, 3)` and drop the rest with no
// affordance and no count. It now pages through every resumable session in
// sets of three, so the model has to answer three questions the component
// must not answer twice: which page is really showing (a requested page can
// outrun a list that just shrank), which 1-based positions that page covers,
// and what to say about it — the same sentence labels the deck for assistive
// technology and is announced when the page turns, so the two can never
// disagree.

/** Cards per page. The design's three-across row is the page. */
export const HOME_CONTINUE_PAGE_SIZE = 3;

export type ContinuePage = {
  /** Clamped 0-based page index — never past the last page. */
  index: number;
  /** Total pages; at least 1, so `index` is always addressable. */
  count: number;
  /** 1-based position of this page's first item; 0 when there is nothing. */
  from: number;
  /** 1-based position of this page's last item; 0 when there is nothing. */
  to: number;
  /** Resumable sessions behind the whole carousel. */
  total: number;
};

/** Non-negative integer, or `fallback` for NaN/Infinity. */
function whole(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
}

/**
 * Resolve a requested page against the live item count.
 *
 * `requested` is deliberately forgiving: the component holds it in state, and
 * the session list underneath can shrink between renders (a thread archived in
 * another pane). Clamping here rather than in an effect means the carousel
 * never renders an empty page it would have to correct afterwards.
 */
export function continuePage(
  total: number,
  requested: number,
  pageSize: number = HOME_CONTINUE_PAGE_SIZE,
): ContinuePage {
  const requestedSize = whole(pageSize, HOME_CONTINUE_PAGE_SIZE);
  const size = requestedSize > 0 ? requestedSize : HOME_CONTINUE_PAGE_SIZE;
  const safeTotal = whole(total, 0);
  const count = Math.max(1, Math.ceil(safeTotal / size));
  const index = Math.min(whole(requested, 0), count - 1);
  return {
    index,
    count,
    from: safeTotal === 0 ? 0 : index * size + 1,
    to: Math.min(safeTotal, (index + 1) * size),
    total: safeTotal,
  };
}

/**
 * The one sentence describing what a page shows. Used as the deck's
 * `aria-label` and as the live-region announcement on a page turn, so a
 * screen-reader user hears their position in the same words both times.
 */
export function continuePageLabel(page: ContinuePage): string {
  if (page.total === 0) return "No sessions to continue";
  if (page.from === page.to) return `Session ${page.from} of ${page.total}`;
  return `Sessions ${page.from} to ${page.to} of ${page.total}`;
}
