// Familiar outcomes: what actually happened to a familiar's work, as opposed
// to what the familiar said about it in a thread self-report.
//
// Pure and deterministic. Outcomes are derived on read from Board cards, so
// there is no second store that can drift from the Board. Only machine-recorded
// fields decide an outcome: the card lifecycle, and the PR state that the Board
// refreshes from the GitHub API (see enrich-steps `refreshGitHubStates`).
// `lifecycleReason` is prose written by a familiar, so it is carried as detail
// but never decides anything; grading familiars on their own words is exactly
// what this module exists to avoid.
//
// Scoring rules:
// - accepted / strong  completed card with at least one linked PR merged
// - accepted / weak    completed card with no merged PR (Board state only)
// - rejected / strong  unfinished card whose linked PRs include one closed
//                      without merging and none merged
// - no outcome         cancelled with no PR evidence (usually superseded,
//                      obsolete, or a duplicate), or still open
//
// Calibration compares a familiar's self-reported confidence with those
// outcomes, joined by thread id. A familiar that is getting better should see
// its outcome rate rise and its calibration gap shrink.

import type { Card, CardGitHubLink } from "./cave-board-types.ts";
import type { ThreadSelfReport } from "./thread-self-report.ts";

export type FamiliarOutcomeKind = "accepted" | "rejected";
export type FamiliarOutcomeEvidence = "strong" | "weak";

export type FamiliarOutcome = {
  /** Stable per card: one outcome per card at a time. */
  id: string;
  familiarId: string;
  /** The thread the work ran in, when the card recorded one. */
  sessionId: string | null;
  kind: FamiliarOutcomeKind;
  evidence: FamiliarOutcomeEvidence;
  source: "board" | "github-pr";
  cardId: string;
  cardTitle: string;
  /** PR URLs that decided the outcome; empty when the Board alone decided it. */
  refs: string[];
  at: string;
  /** The Board's lifecycle reason, for display only. */
  detail?: string;
};

export type FamiliarCalibration = {
  /** Threads with both a self-report and an outcome. */
  samples: number;
  /** Mean squared error of confidence/100 against the outcome (0 best, 1 worst). */
  brier: number;
  /** Mean of confidence/100 minus the outcome: positive is overconfident. */
  meanGap: number;
};

export type FamiliarOutcomeSummary = {
  familiarId: string;
  outcomes: FamiliarOutcome[];
  counts: {
    accepted: number;
    acceptedStrong: number;
    rejected: number;
    /** Share of outcomes that were accepted, or null with no outcomes. */
    acceptRate: number | null;
  };
  calibration: FamiliarCalibration | null;
};

function isMergedPr(link: CardGitHubLink): boolean {
  return link.kind === "pr" && link.state === "merged";
}

function isClosedUnmergedPr(link: CardGitHubLink): boolean {
  return link.kind === "pr" && link.state === "closed";
}

/** The outcome one Board card currently records, or null when it has none. */
export function outcomeFromCard(card: Card): FamiliarOutcome | null {
  if (!card.familiarId) return null;
  const links = Array.isArray(card.github) ? card.github : [];
  const merged = links.filter(isMergedPr);
  const closedUnmerged = links.filter(isClosedUnmergedPr);
  const base = {
    id: `board:${card.id}`,
    familiarId: card.familiarId,
    sessionId: card.sessionId ?? null,
    cardId: card.id,
    cardTitle: card.title,
    at: card.lifecycleAt || card.updatedAt,
    ...(card.lifecycleReason ? { detail: card.lifecycleReason } : {}),
  };

  if (card.lifecycle === "completed") {
    return merged.length > 0
      ? { ...base, kind: "accepted", evidence: "strong", source: "github-pr", refs: merged.map((link) => link.url) }
      : { ...base, kind: "accepted", evidence: "weak", source: "board", refs: [] };
  }
  if (merged.length === 0 && closedUnmerged.length > 0) {
    const latest = closedUnmerged
      .map((link) => link.updatedAt)
      .filter((value): value is string => typeof value === "string")
      .sort()
      .at(-1);
    return {
      ...base,
      kind: "rejected",
      evidence: "strong",
      source: "github-pr",
      refs: closedUnmerged.map((link) => link.url),
      at: latest ?? base.at,
    };
  }
  return null;
}

/** The newest self-report per thread, so a re-reflected thread counts once. */
function latestReportBySession(reports: readonly ThreadSelfReport[]): Map<string, ThreadSelfReport> {
  const bySession = new Map<string, ThreadSelfReport>();
  for (const report of reports) {
    const current = bySession.get(report.sessionId);
    if (!current || report.reportedAt > current.reportedAt) bySession.set(report.sessionId, report);
  }
  return bySession;
}

export function calibrate(
  outcomes: readonly FamiliarOutcome[],
  reports: readonly ThreadSelfReport[],
): FamiliarCalibration | null {
  const bySession = latestReportBySession(reports);
  let samples = 0;
  let squared = 0;
  let signed = 0;
  for (const outcome of outcomes) {
    if (!outcome.sessionId) continue;
    const report = bySession.get(outcome.sessionId);
    if (!report || !Number.isFinite(report.overallConfidence)) continue;
    const predicted = Math.min(100, Math.max(0, report.overallConfidence)) / 100;
    const actual = outcome.kind === "accepted" ? 1 : 0;
    samples += 1;
    squared += (predicted - actual) ** 2;
    signed += predicted - actual;
  }
  if (samples === 0) return null;
  return { samples, brier: squared / samples, meanGap: signed / samples };
}

/** Outcomes and calibration for one familiar, newest outcome first. */
export function summarizeFamiliarOutcomes(
  familiarId: string,
  cards: readonly Card[],
  reports: readonly ThreadSelfReport[],
): FamiliarOutcomeSummary {
  const outcomes = cards
    .filter((card) => card.familiarId === familiarId)
    .map(outcomeFromCard)
    .filter((outcome): outcome is FamiliarOutcome => outcome !== null)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id.localeCompare(b.id)));
  const accepted = outcomes.filter((outcome) => outcome.kind === "accepted");
  const rejected = outcomes.length - accepted.length;
  return {
    familiarId,
    outcomes,
    counts: {
      accepted: accepted.length,
      acceptedStrong: accepted.filter((outcome) => outcome.evidence === "strong").length,
      rejected,
      acceptRate: outcomes.length > 0 ? accepted.length / outcomes.length : null,
    },
    calibration: calibrate(
      outcomes,
      reports.filter((report) => report.familiarId === familiarId),
    ),
  };
}
