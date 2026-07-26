/**
 * Pure derivation of the familiar inline card's insight layer (cave-ck70).
 *
 * The analytics surface already computes confidence, growth signals, heal
 * requests, feedback rollups and session activity per familiar — this module
 * reduces that `FamiliarAnalyticsModel` to the handful of judgment aids the
 * avatar popover can show: a one-line trust/health read, live workload,
 * feedback reliability, the top attention signal, and state-driven actions.
 * No React, no fetch — unit-tested in familiar-card-insights.test.ts.
 */

import type { FamiliarAnalyticsModel } from "@/components/familiar-analytics-data";
import { deriveAnalyticsInsight, type AnalyticsInsight } from "@/lib/familiar-analytics-insight";
import type { GrowthSignal } from "@/lib/familiar-growth-signals";

export type CardRunningSession = {
  id: string;
  title: string;
  updatedAt: string;
};

export type CardActionKind = "resume-session" | "fix-contract" | "review-heals" | "refresh-memory";

export type CardAction = {
  kind: CardActionKind;
  label: string;
  /** Present only for resume-session. */
  sessionId?: string;
};

export type CardFeedback = {
  /** up / total over the user's final per-message verdicts, 0..1. */
  approval: number;
  total: number;
  /** Most-voted model bucket, when votes carry a model stamp. */
  topModel: string | null;
};

export type FamiliarCardInsights = {
  insight: AnalyticsInsight;
  confidenceLabel: string;
  confidenceScore: number;
  /** Most severe non-healthy growth signal, or null when all clear. */
  topSignal: GrowthSignal | null;
  sessionsLast7d: number;
  runningSessions: CardRunningSession[];
  /** null when no thumbs votes exist for this familiar. */
  feedback: CardFeedback | null;
  actions: CardAction[];
};

const SEVERITY_RANK: Record<GrowthSignal["severity"], number> = { crit: 0, warn: 1, info: 2 };

/** Cap so the popover stays a peek, not a session browser. */
const RUNNING_SESSIONS_CAP = 2;
/** Cap so contextual actions augment the static row without drowning it. */
const ACTIONS_CAP = 2;

function pickTopSignal(model: FamiliarAnalyticsModel): GrowthSignal | null {
  const signals = (model.growthReport?.signals ?? []).filter((s) => s.kind !== "healthy");
  if (signals.length === 0) return null;
  return [...signals].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0];
}

function pickRunningSessions(model: FamiliarAnalyticsModel): CardRunningSession[] {
  return model.recentSessions
    .filter((s) => s.status === "running" && !s.archived_at)
    .slice(0, RUNNING_SESSIONS_CAP)
    .map((s) => ({ id: s.id, title: s.title, updatedAt: s.updated_at }));
}

function pickFeedback(model: FamiliarAnalyticsModel): CardFeedback | null {
  const rollup = model.modelFeedback;
  if (!rollup || rollup.total === 0) return null;
  return {
    approval: rollup.up / rollup.total,
    total: rollup.total,
    topModel: rollup.models[0]?.key ?? null,
  };
}

/**
 * State-driven quick actions, most urgent first, capped at ACTIONS_CAP:
 * resume a live session, fix a failing contract, review open heal requests,
 * refresh stale/missing memory. All map to affordances the card already has
 * targets for (session open event, studio tabs, analytics page).
 */
function deriveActions(model: FamiliarAnalyticsModel, running: CardRunningSession[]): CardAction[] {
  const actions: CardAction[] = [];
  if (running[0]) {
    actions.push({ kind: "resume-session", label: "Resume session", sessionId: running[0].id });
  }
  const contract = model.contractReport;
  if (contract && contract.properties.length > 0 && !contract.pass) {
    actions.push({ kind: "fix-contract", label: "Fix contract" });
  } else if (model.healRequests.some((r) => !r.resolved)) {
    // Contract violations already surface as heal requests — only show the
    // generic reviewer when the contract action didn't claim the slot.
    actions.push({ kind: "review-heals", label: "Review heal requests" });
  }
  const topSignal = pickTopSignal(model);
  if (topSignal && (topSignal.kind === "stale-memory" || topSignal.kind === "no-memory")) {
    actions.push({ kind: "refresh-memory", label: "Refresh memory" });
  }
  return actions.slice(0, ACTIONS_CAP);
}

export function deriveFamiliarCardInsights(model: FamiliarAnalyticsModel): FamiliarCardInsights {
  const runningSessions = pickRunningSessions(model);
  const openHeals = model.healRequests.filter((r) => !r.resolved).length;
  return {
    insight: deriveAnalyticsInsight(model, openHeals),
    confidenceLabel: model.confidence.label,
    confidenceScore: model.confidence.score,
    topSignal: pickTopSignal(model),
    sessionsLast7d: model.growthReport?.sessionsLast7d ?? 0,
    runningSessions,
    feedback: pickFeedback(model),
    actions: deriveActions(model, runningSessions),
  };
}
