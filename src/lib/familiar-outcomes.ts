// Familiar outcomes: what actually happened to a familiar's work, as opposed
// to what the familiar said about it in a thread self-report.
//
// Pure and deterministic. Outcomes are derived on read from Board cards and
// from thumbs votes in chat, so there is no second store that can drift. Only
// machine-recorded fields or explicit human verdicts decide an outcome: the card
// lifecycle, the PR state the Board refreshes from the GitHub API (see
// enrich-steps `refreshGitHubStates`), and a thumbs vote.
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
// - accepted / strong  thumbs up on a familiar's chat message (latest vote)
// - rejected / strong  thumbs down on a familiar's chat message (latest vote)
//
// Corrections are deliberately NOT inferred from chat wording or Stop presses.
// Measured on 8,372 stored replies (2026-09-28): matching pushback phrases was
// about half false positives ("No worries", "Stop the dev server"), a strict
// pattern found 1, and 63 of 88 stopped replies were a thread's last turn with
// no follow-up. An explicit vote is the only trustworthy correction signal.
//
// Calibration compares a familiar's self-reported confidence with those
// outcomes, joined by thread id. A familiar that is getting better should see
// its outcome rate rise and its calibration gap shrink.

import type { Card, CardGitHubLink } from "./cave-board-types.ts";
import { feedbackReasonLabel, isFeedbackReason } from "./message-feedback.ts";
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
  source: "board" | "github-pr" | "chat-feedback";
  /** Board outcomes only. */
  cardId?: string;
  cardTitle?: string;
  /** Chat-feedback outcomes only: the voted assistant message. */
  messageId?: string;
  /** PR URLs that decided the outcome; empty when the Board alone decided it. */
  refs: string[];
  at: string;
  /** Display only: the Board's lifecycle reason, or a thumbs-down's reason. */
  detail?: string;
};

/** The fields of a stored thumbs vote this module reads (see message-feedback-store). */
export type FeedbackVoteRecord = {
  messageId: string;
  vote: "up" | "down";
  cleared: boolean;
  familiarId?: string;
  sessionId?: string;
  /** One-tap reason given with a thumbs-down, when the user chose one. */
  reason?: string;
  at: string;
};

export type FamiliarCalibration = {
  /** Threads with both a self-report and at least one outcome. Each thread
   *  counts once, scored by the share of its outcomes that were accepted. */
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
    /** The same split per source, so Board work and chat votes read apart. */
    bySource: Record<FamiliarOutcome["source"], { accepted: number; rejected: number }>;
  };
  calibration: FamiliarCalibration | null;
};

/**
 * A timestamp as an instant, for ordering. Timestamps may carry an offset
 * (`+02:00`) or a `Z`, so their text does not sort chronologically; compare
 * parsed instants instead. An unparseable value sorts as the oldest possible,
 * never as NaN, which would break any comparator it reaches.
 */
function instant(value: string | undefined): number {
  const ms = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

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
      .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
      .reduce<string | undefined>((newest, value) => (newest === undefined || instant(value) > instant(newest) ? value : newest), undefined);
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

/**
 * One outcome per voted message: its latest vote, unless that vote was
 * toggled off. Votes without a familiar are skipped; votes recorded before the
 * thread id existed still count, they just cannot join calibration.
 */
export function outcomesFromFeedback(entries: readonly FeedbackVoteRecord[]): FamiliarOutcome[] {
  const latest = new Map<string, FeedbackVoteRecord>();
  for (const entry of entries) {
    const current = latest.get(entry.messageId);
    if (!current || instant(entry.at) >= instant(current.at)) latest.set(entry.messageId, entry);
  }
  const outcomes: FamiliarOutcome[] = [];
  for (const entry of latest.values()) {
    if (entry.cleared || !entry.familiarId) continue;
    outcomes.push({
      id: `feedback:${entry.messageId}`,
      familiarId: entry.familiarId,
      sessionId: entry.sessionId ?? null,
      kind: entry.vote === "up" ? "accepted" : "rejected",
      evidence: "strong",
      source: "chat-feedback",
      messageId: entry.messageId,
      refs: [],
      at: entry.at,
      ...(entry.vote === "down" && isFeedbackReason(entry.reason) ? { detail: feedbackReasonLabel(entry.reason) } : {}),
    });
  }
  return outcomes;
}

/** The newest self-report per thread, so a re-reflected thread counts once. */
function latestReportBySession(reports: readonly ThreadSelfReport[]): Map<string, ThreadSelfReport> {
  const bySession = new Map<string, ThreadSelfReport>();
  for (const report of reports) {
    const current = bySession.get(report.sessionId);
    if (!current || instant(report.reportedAt) > instant(current.reportedAt)) bySession.set(report.sessionId, report);
  }
  return bySession;
}

export function calibrate(
  outcomes: readonly FamiliarOutcome[],
  reports: readonly ThreadSelfReport[],
): FamiliarCalibration | null {
  const bySession = latestReportBySession(reports);
  const perThread = new Map<string, { accepted: number; total: number }>();
  for (const outcome of outcomes) {
    if (!outcome.sessionId) continue;
    const tally = perThread.get(outcome.sessionId) ?? { accepted: 0, total: 0 };
    tally.total += 1;
    if (outcome.kind === "accepted") tally.accepted += 1;
    perThread.set(outcome.sessionId, tally);
  }
  let samples = 0;
  let squared = 0;
  let signed = 0;
  for (const [sessionId, tally] of perThread) {
    const report = bySession.get(sessionId);
    if (!report || !Number.isFinite(report.overallConfidence)) continue;
    const predicted = Math.min(100, Math.max(0, report.overallConfidence)) / 100;
    const actual = tally.accepted / tally.total;
    samples += 1;
    squared += (predicted - actual) ** 2;
    signed += predicted - actual;
  }
  if (samples === 0) return null;
  return { samples, brier: squared / samples, meanGap: signed / samples };
}

export type FamiliarOutcomeCounts = FamiliarOutcomeSummary["counts"];

/**
 * Accepted/rejected totals, the accept rate, and the same split per source.
 * The one definition both the route's summary and the analytics page's
 * window-scoped recount use, so a tile never disagrees with the API.
 */
export function countOutcomes(outcomes: readonly FamiliarOutcome[]): FamiliarOutcomeCounts {
  const accepted = outcomes.filter((outcome) => outcome.kind === "accepted");
  const bySource: FamiliarOutcomeCounts["bySource"] = {
    board: { accepted: 0, rejected: 0 },
    "github-pr": { accepted: 0, rejected: 0 },
    "chat-feedback": { accepted: 0, rejected: 0 },
  };
  for (const outcome of outcomes) bySource[outcome.source][outcome.kind] += 1;
  return {
    accepted: accepted.length,
    acceptedStrong: accepted.filter((outcome) => outcome.evidence === "strong").length,
    rejected: outcomes.length - accepted.length,
    acceptRate: outcomes.length > 0 ? accepted.length / outcomes.length : null,
    bySource,
  };
}

/**
 * How well self-reported confidence predicted outcomes, as card copy: a
 * `headline` verdict (the mean gap in points; over = claimed more than it
 * delivered) and a `detail` sentence with the sample size and Brier score.
 * Null calibration means no thread has both a self-report and an outcome yet.
 */
export function describeCalibration(calibration: FamiliarCalibration | null): { headline: string; detail: string } {
  if (!calibration) {
    return { headline: "Not calibrated yet", detail: "No thread has both a self-report and an outcome yet." };
  }
  const points = Math.round(calibration.meanGap * 100);
  const pts = (n: number) => `${n} pt${n === 1 ? "" : "s"}`;
  const headline =
    points >= 1 ? `${pts(points)} overconfident` : points <= -1 ? `${pts(-points)} underconfident` : "On target";
  const threads = `${calibration.samples} thread${calibration.samples === 1 ? "" : "s"}`;
  return {
    headline,
    detail: `Across ${threads} with both a self-report and an outcome. Brier ${calibration.brier.toFixed(2)}; 0 is perfect.`,
  };
}

/** Outcomes and calibration for one familiar, newest outcome first. */
export function summarizeFamiliarOutcomes(
  familiarId: string,
  cards: readonly Card[],
  reports: readonly ThreadSelfReport[],
  feedback: readonly FeedbackVoteRecord[] = [],
): FamiliarOutcomeSummary {
  const outcomes = [
    ...cards
      .filter((card) => card.familiarId === familiarId)
      .map(outcomeFromCard)
      .filter((outcome): outcome is FamiliarOutcome => outcome !== null),
    ...outcomesFromFeedback(feedback).filter((outcome) => outcome.familiarId === familiarId),
  ].sort((a, b) => instant(b.at) - instant(a.at) || a.id.localeCompare(b.id));
  return {
    familiarId,
    outcomes,
    counts: countOutcomes(outcomes),
    calibration: calibrate(
      outcomes,
      reports.filter((report) => report.familiarId === familiarId),
    ),
  };
}
