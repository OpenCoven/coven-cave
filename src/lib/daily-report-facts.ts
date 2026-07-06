// Pure day-in-review facts for the daily report: merged PRs, completed board
// cards, and today's sessions grouped by project. Shared by the daily-summary
// route (which freezes a payload into `media.report`) and the report/dashboard
// surfaces that render it. Kept free of `node:`/server imports so tests and
// client bundles can use it directly.

import type { SessionRow } from "./types";
import { reportSessionTitle } from "./daily-summary-notifications.ts";

export type MergedPr = {
  repo: string;
  number: number;
  title: string;
  url: string;
  /** ISO timestamp; session-derived entries fall back to the session's updated_at. */
  mergedAt: string;
};

export type CompletedCard = {
  id: string;
  title: string;
  completedAt: string;
};

export type ReportSession = {
  id: string;
  title: string;
  familiarId: string | null;
  additions: number;
  deletions: number;
  pr: { repo: string; number?: number; url?: string } | null;
};

export type SessionGroup = {
  /** Raw project_root (dedupe key). */
  key: string;
  /** Display label — the root's basename. */
  label: string;
  additions: number;
  deletions: number;
  sessions: ReportSession[];
};

export type DailyReportPayload = {
  prsMerged?: MergedPr[];
  cardsCompleted?: CompletedCard[];
  sessionGroups?: SessionGroup[];
  /** Stable content hash (no timestamps) — feeds narrative staleness in Phase C. */
  factsHash: string;
  refreshedAt: string;
};

const MAX_GROUPS = 6;
const MAX_SESSIONS_PER_GROUP = 5;

function sameLocalDay(iso: string | null | undefined, day: Date): boolean {
  if (!iso) return false;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return false;
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  return value.getTime() >= start && value.getTime() < start + 24 * 60 * 60 * 1000;
}

function basename(root: string): string {
  // Trim trailing slashes without a regex — /\/+$/ backtracks polynomially on
  // long slash runs (CodeQL js/polynomial-redos).
  let end = root.length;
  while (end > 0 && root.charCodeAt(end - 1) === 47 /* "/" */) end--;
  const trimmed = root.slice(0, end);
  const last = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return last || trimmed || "unknown";
}

/** Today's non-archived sessions grouped by project_root, newest activity
 *  first, with per-group diff totals. Caps at 6 groups × 5 sessions so a busy
 *  day freezes to a bounded payload. */
export function buildSessionGroups(sessions: SessionRow[], now = new Date()): SessionGroup[] {
  const today = sessions
    .filter((session) => !session.archived_at && sameLocalDay(session.updated_at, now))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const groups = new Map<string, SessionGroup & { dropped: number }>();
  for (const session of today) {
    const key = session.project_root || "unknown";
    let group = groups.get(key);
    if (!group) {
      if (groups.size >= MAX_GROUPS) continue;
      group = { key, label: basename(key), additions: 0, deletions: 0, sessions: [], dropped: 0 };
      groups.set(key, group);
    }
    group.additions += session.diff?.additions ?? 0;
    group.deletions += session.diff?.deletions ?? 0;
    if (group.sessions.length >= MAX_SESSIONS_PER_GROUP) {
      group.dropped += 1;
      continue;
    }
    group.sessions.push({
      id: session.id,
      title: reportSessionTitle(session),
      familiarId: session.familiarId ?? null,
      additions: session.diff?.additions ?? 0,
      deletions: session.diff?.deletions ?? 0,
      pr: session.pullRequest?.repo
        ? {
            repo: session.pullRequest.repo,
            ...(typeof session.pullRequest.number === "number"
              ? { number: session.pullRequest.number }
              : {}),
            ...(session.pullRequest.url ? { url: session.pullRequest.url } : {}),
          }
        : null,
    });
  }
  return [...groups.values()].map(({ dropped: _dropped, ...group }) => group);
}

/** Union the PAT search results with PRs linked from today's sessions whose
 *  state is already "merged" — so a PAT-less setup still reports partial data.
 *  Returns null when neither source produced anything (section stays absent,
 *  distinct from a zero-merge day with a working PAT). */
export function unionMergedPrs(
  github: MergedPr[] | null,
  sessions: SessionRow[],
  now = new Date(),
): MergedPr[] | null {
  const fromSessions: MergedPr[] = sessions
    .filter(
      (session) =>
        !session.archived_at &&
        sameLocalDay(session.updated_at, now) &&
        session.pullRequest?.state === "merged" &&
        typeof session.pullRequest.number === "number",
    )
    .map((session) => ({
      repo: session.pullRequest!.repo,
      number: session.pullRequest!.number!,
      title: reportSessionTitle(session),
      url:
        session.pullRequest!.url ??
        `https://github.com/${session.pullRequest!.repo}/pull/${session.pullRequest!.number}`,
      mergedAt: session.updated_at,
    }));

  if (!github && fromSessions.length === 0) return null;

  const byKey = new Map<string, MergedPr>();
  // Session entries first so richer GitHub search results overwrite them.
  for (const pr of fromSessions) byKey.set(`${pr.repo}#${pr.number}`, pr);
  for (const pr of github ?? []) byKey.set(`${pr.repo}#${pr.number}`, pr);
  return [...byKey.values()].sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
}

/** Minimal structural slice of a board card — keeps this module decoupled
 *  from the board types (and their import graph). */
export type CompletableCard = {
  id: string;
  title: string;
  lifecycle?: string;
  lifecycleAt?: string;
  status?: string;
  updatedAt?: string;
};

/** Cards finished today: lifecycle "completed" stamped today, plus legacy
 *  cards (pre-lifecycle) sitting in "done" that were touched today. */
export function completedCardsForDay(cards: CompletableCard[], now = new Date()): CompletedCard[] {
  return cards
    .filter((card) =>
      card.lifecycle === "completed"
        ? sameLocalDay(card.lifecycleAt, now)
        : card.status === "done" && !card.lifecycle && sameLocalDay(card.updatedAt, now),
    )
    .map((card) => ({
      id: card.id,
      title: card.title,
      completedAt: (card.lifecycle === "completed" ? card.lifecycleAt : card.updatedAt) ?? "",
    }))
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Stable hash over the day's facts, excluding timestamps and diff churn, so
 *  Phase C's narrative can tell "the story changed" from "the clock moved". */
export function dailyFactsHash({
  prsMerged,
  cardsCompleted,
  sessionGroups,
}: {
  prsMerged?: MergedPr[] | null;
  cardsCompleted?: CompletedCard[] | null;
  sessionGroups?: SessionGroup[] | null;
}): string {
  const parts = [
    ...(prsMerged ?? []).map((pr) => `pr:${pr.repo}#${pr.number}`),
    ...(cardsCompleted ?? []).map((card) => `card:${card.id}`),
    ...(sessionGroups ?? []).flatMap((group) => group.sessions.map((s) => `s:${group.key}:${s.id}`)),
  ].sort();
  return fnv1a(parts.join("|"));
}
