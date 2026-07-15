// PR triage patrol (cave-hlv.7) — the twice-daily sweep over the PR lanes the
// bridge classifies. Pure: callers inject the clock, so digests are
// deterministic and testable. The patrol never merges anything; it orders
// work and flags gaps (stale PRs, PRs with no linked bead).
import type { PrLane, PullRequestSummary } from "./beads-pr-management.ts";

export type PatrolWindow = "morning" | "evening";

export type PatrolSectionKey = "fix-first" | "land" | "review" | "waiting";

export type PatrolSection = {
  key: PatrolSectionKey;
  title: string;
  prs: PullRequestSummary[];
};

export type PatrolDigest = {
  window: PatrolWindow;
  sections: PatrolSection[];
  /** PR numbers with no activity within the stale window. */
  stale: number[];
  /** PR numbers mentioning no bead id — invisible to the Beads queue. */
  unlinked: number[];
  /** PRs a familiar can act on right now (fix-first + land + review). */
  actionable: number;
  total: number;
  staleAfterHours: number;
};

const SECTION_LANES: Record<PatrolSectionKey, PrLane[]> = {
  "fix-first": ["checks-failing", "changes-requested"],
  land: ["ready-to-merge"],
  review: ["needs-review"],
  waiting: ["checks-pending", "blocked", "draft"],
};

const SECTION_TITLES: Record<PatrolSectionKey, string> = {
  "fix-first": "Fix first — failing checks / requested changes",
  land: "Ready to land (merge gate still applies)",
  review: "Needs review",
  waiting: "Waiting — pending checks, blocked, drafts",
};

// Morning unblocks the day (fix, then get reviews moving, then land);
// evening lands what's ready before close, then clears blockers for
// tomorrow. Waiting lanes always trail.
const WINDOW_ORDER: Record<PatrolWindow, PatrolSectionKey[]> = {
  morning: ["fix-first", "review", "land", "waiting"],
  evening: ["land", "fix-first", "review", "waiting"],
};

const ACTIONABLE_SECTIONS: ReadonlySet<PatrolSectionKey> = new Set(["fix-first", "land", "review"]);

export function isStalePr(
  summary: PullRequestSummary,
  nowMs: number,
  staleAfterHours: number,
): boolean {
  const updated = Date.parse(summary.updatedAt);
  if (!Number.isFinite(updated)) return true; // unknown activity reads as stale
  return nowMs - updated > staleAfterHours * 3_600_000;
}

export function buildPatrolDigest(
  summaries: PullRequestSummary[],
  opts: { window: PatrolWindow; nowMs: number; staleAfterHours?: number },
): PatrolDigest {
  const staleAfterHours = opts.staleAfterHours ?? 24;
  const byLane = new Map<PrLane, PullRequestSummary[]>();
  for (const summary of summaries) {
    const bucket = byLane.get(summary.lane) ?? [];
    bucket.push(summary);
    byLane.set(summary.lane, bucket);
  }

  const sections: PatrolSection[] = WINDOW_ORDER[opts.window].map((key) => ({
    key,
    title: SECTION_TITLES[key],
    prs: SECTION_LANES[key]
      .flatMap((lane) => byLane.get(lane) ?? [])
      .sort((a, b) => a.number - b.number),
  }));

  const actionable = sections
    .filter((section) => ACTIONABLE_SECTIONS.has(section.key))
    .reduce((count, section) => count + section.prs.length, 0);

  return {
    window: opts.window,
    sections,
    stale: summaries
      .filter((summary) => isStalePr(summary, opts.nowMs, staleAfterHours))
      .map((summary) => summary.number)
      .sort((a, b) => a - b),
    unlinked: summaries
      .filter((summary) => summary.beadIds.length === 0)
      .map((summary) => summary.number)
      .sort((a, b) => a - b),
    actionable,
    total: summaries.length,
    staleAfterHours,
  };
}

export function renderPatrolDigest(digest: PatrolDigest): string {
  if (digest.total === 0) {
    return `PR triage patrol — ${digest.window} window: no open PRs. Patrol clear.`;
  }
  const lines = [
    `PR triage patrol — ${digest.window} window · ${digest.total} open PR${
      digest.total === 1 ? "" : "s"
    } · ${digest.actionable} actionable`,
  ];
  for (const section of digest.sections) {
    if (section.prs.length === 0) continue;
    lines.push(`${section.title}:`);
    for (const pr of section.prs) {
      const beads = pr.beadIds.length > 0 ? pr.beadIds.join(", ") : "no bead";
      const staleFlag = digest.stale.includes(pr.number) ? " · STALE" : "";
      lines.push(`  #${pr.number} ${pr.lane} [${beads}] ${pr.title}${staleFlag}`);
    }
  }
  if (digest.unlinked.length > 0) {
    lines.push(
      `Unlinked (no bead — invisible to the queue): ${digest.unlinked
        .map((n) => `#${n}`)
        .join(", ")}`,
    );
  }
  if (digest.stale.length > 0) {
    lines.push(
      `Stale (>${digest.staleAfterHours}h without update): ${digest.stale
        .map((n) => `#${n}`)
        .join(", ")}`,
    );
  }
  return lines.join("\n");
}
