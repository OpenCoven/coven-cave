// Day-in-review facts for the daily report: what actually happened today —
// merged PRs, sessions grouped by project, board cards completed — frozen
// into the daily-summary item's `media.report` on each refresh. Pure (no
// node: imports, no fetches) so the builder, the report page, and loaderless
// tests can all share it. The GitHub search itself is server-only and lives
// in server/github-merged.ts.

import { sanitizeSessionTitle } from "./cave-chat-titles.ts";
import type { SessionRow } from "./types";

export type MergedPr = {
  /** "owner/name" */
  repo: string;
  number: number;
  title: string;
  url: string;
  mergedAt: string;
};

export type CompletedCard = {
  id: string;
  title: string;
  projectId?: string | null;
  familiarId?: string | null;
  completedAt: string;
};

export type ReportSession = {
  id: string;
  title: string;
  familiarId?: string | null;
  additions?: number;
  deletions?: number;
  pr?: { repo?: string; number?: number; url?: string; state?: string } | null;
};

export type SessionGroup = {
  /** Grouping key — the session's project_root. */
  key: string;
  /** Human label — the project directory's basename. */
  label: string;
  sessions: ReportSession[];
  additions: number;
  deletions: number;
};

export type DailyReportPayload = {
  /** Absent (not empty) when neither GitHub nor session PR data is available. */
  prsMerged?: MergedPr[];
  /** Absent when the board could not be read. */
  cardsCompleted?: CompletedCard[];
  sessionGroups?: SessionGroup[];
  /** Stable hash of the facts — the narrative layer regenerates on change. */
  factsHash: string;
  refreshedAt: string;
};

const REPORT_TITLE_MAX = 64;

// Session titles come from harness transcripts and can leak raw markdown
// ("## Prior conversation **User:** Merge PR #26 **"). Report surfaces render
// plain text, so markdown syntax must be stripped, not rendered.
const MD_HEADING_RE = /^#{1,6}\s+/;
const MD_EMPHASIS_RE = /(\*\*|__|[*_`])/g;
const PRIOR_CONVERSATION_LEAK_RE = /^prior conversation\b/i;

/** Session title as it should appear in the daily report: sanitized of
 *  harness-preamble leaks (via sanitizeSessionTitle), stripped of markdown
 *  syntax, truncated to a report-sized string. Falls back to "Untitled
 *  session" when nothing survives. */
export function reportSessionTitle(session: Pick<SessionRow, "title">): string {
  const sanitized = sanitizeSessionTitle(session.title);
  if (!sanitized) return "Untitled session";
  const stripped = sanitized
    .replace(MD_HEADING_RE, "")
    .replace(MD_EMPHASIS_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped || PRIOR_CONVERSATION_LEAK_RE.test(stripped)) return "Untitled session";
  if (stripped.length <= REPORT_TITLE_MAX) return stripped;
  return `${stripped.slice(0, REPORT_TITLE_MAX - 1).trimEnd()}…`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function isSameLocalDay(iso: string | null | undefined, day: Date): boolean {
  if (!iso) return false;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return false;
  const start = startOfLocalDay(day).getTime();
  return value.getTime() >= start && value.getTime() < start + 24 * 60 * 60 * 1000;
}

function projectLabel(root: string): string {
  const segments = root.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? root;
}

const MAX_GROUPS = 6;
const MAX_SESSIONS_PER_GROUP = 5;

/**
 * Today's non-archived sessions grouped by project, newest activity first.
 * Titles are report-sanitized and deduped within a group; per-group diff
 * totals sum every session in the group (not just the listed ones).
 */
export function buildSessionGroups(sessions: SessionRow[], now: Date): SessionGroup[] {
  const today = sessions
    .filter((session) => !session.archived_at && isSameLocalDay(session.updated_at, now))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const groups = new Map<string, SessionGroup & { seen: Set<string> }>();
  for (const session of today) {
    const key = session.project_root || "(no project)";
    let group = groups.get(key);
    if (!group) {
      group = { key, label: projectLabel(key), sessions: [], additions: 0, deletions: 0, seen: new Set() };
      groups.set(key, group);
    }
    group.additions += session.diff?.additions ?? 0;
    group.deletions += session.diff?.deletions ?? 0;
    const title = reportSessionTitle(session);
    const titleKey = title.toLowerCase();
    if (group.seen.has(titleKey) || group.sessions.length >= MAX_SESSIONS_PER_GROUP) continue;
    group.seen.add(titleKey);
    group.sessions.push({
      id: session.id,
      title,
      familiarId: session.familiarId ?? null,
      additions: session.diff?.additions,
      deletions: session.diff?.deletions,
      pr: session.pullRequest
        ? {
            repo: session.pullRequest.repo,
            number: session.pullRequest.number,
            url: session.pullRequest.url,
            state: session.pullRequest.state,
          }
        : null,
    });
  }

  // Busiest groups first (by session count, then diff volume), capped.
  return [...groups.values()]
    .sort(
      (a, b) =>
        b.sessions.length - a.sessions.length ||
        b.additions + b.deletions - (a.additions + a.deletions),
    )
    .slice(0, MAX_GROUPS)
    .map(({ seen: _seen, ...group }) => group);
}

/**
 * Merge the GitHub search results with PRs already attached to today's
 * sessions (SessionRow.pullRequest, state "merged"), deduped by repo#number —
 * GitHub data wins (it has the real title and merge time). Returns undefined
 * when neither source has anything to say (PAT unconfigured and no session
 * PRs), so the section is absent rather than an empty claim.
 */
export function unionMergedPrs(
  fromGitHub: MergedPr[] | null,
  sessions: SessionRow[],
  now: Date,
): MergedPr[] | undefined {
  const byKey = new Map<string, MergedPr>();
  for (const session of sessions) {
    const pr = session.pullRequest;
    if (!pr || pr.state !== "merged" || typeof pr.number !== "number") continue;
    if (!isSameLocalDay(session.updated_at, now)) continue;
    byKey.set(`${pr.repo}#${pr.number}`, {
      repo: pr.repo,
      number: pr.number,
      title: reportSessionTitle(session),
      url: pr.url ?? `https://github.com/${pr.repo}/pull/${pr.number}`,
      mergedAt: session.updated_at,
    });
  }
  for (const pr of fromGitHub ?? []) {
    byKey.set(`${pr.repo}#${pr.number}`, pr);
  }
  if (fromGitHub === null && byKey.size === 0) return undefined;
  return [...byKey.values()].sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
}

/** Structural card shape — keeps this module decoupled from the board store. */
type CardLike = {
  id: string;
  title: string;
  status?: string;
  lifecycle?: string;
  lifecycleAt?: string | null;
  updatedAt?: string;
  projectId?: string | null;
  familiarId?: string | null;
};

const MAX_COMPLETED_CARDS = 10;

/**
 * Board cards finished today: primarily lifecycle "completed" stamped today,
 * plus cards manually dragged to "done" today (their only timestamp is
 * updatedAt). Newest first, capped.
 */
export function completedCardsForDay(cards: CardLike[], now: Date): CompletedCard[] {
  const out: CompletedCard[] = [];
  for (const card of cards) {
    const completedAt =
      card.lifecycle === "completed" && isSameLocalDay(card.lifecycleAt, now)
        ? (card.lifecycleAt as string)
        : card.status === "done" && isSameLocalDay(card.updatedAt, now)
          ? (card.updatedAt as string)
          : null;
    if (!completedAt) continue;
    out.push({
      id: card.id,
      title: card.title,
      projectId: card.projectId ?? null,
      familiarId: card.familiarId ?? null,
      completedAt,
    });
  }
  return out.sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, MAX_COMPLETED_CARDS);
}

function djb2Hex(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

/**
 * Stable hash of the day's facts. Deliberately excludes timestamps
 * (refreshedAt, mergedAt) so a mere refresh with unchanged facts never
 * invalidates the narrative built on top of them.
 */
export function dailyFactsHash(input: {
  stats: { reminders: number; responses: number; familiars: number; sessions: number };
  prsMerged?: MergedPr[];
  cardsCompleted?: CompletedCard[];
  sessionGroups?: SessionGroup[];
}): string {
  const parts: string[] = [
    `r:${input.stats.reminders}`,
    `q:${input.stats.responses}`,
    `f:${input.stats.familiars}`,
    `s:${input.stats.sessions}`,
  ];
  for (const pr of input.prsMerged ?? []) parts.push(`pr:${pr.repo}#${pr.number}`);
  for (const card of input.cardsCompleted ?? []) parts.push(`card:${card.id}`);
  for (const group of input.sessionGroups ?? []) {
    parts.push(`g:${group.key}:${group.sessions.map((s) => s.id).join(",")}`);
  }
  parts.sort();
  return djb2Hex(parts.join("|"));
}
