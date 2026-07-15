export type ContextPressure = "adequate" | "tight" | "excess" | "critical";
export type CapabilityState = "available" | "degraded" | "missing";
export type BlockerCategory = "auth" | "tooling" | "permission" | "infra" | "context" | "skill" | "other";
export type BlockerImpact = "low" | "medium" | "high" | "blocking";
export type CapabilityImportance = "nice-to-have" | "important" | "blocking";
export type ResponseConfidenceFactorKey =
  | "toolUse"
  | "context"
  | "skills"
  | "permissions"
  | "memory"
  | "instructionFit"
  | "evidence";

export type ResponseConfidenceFactor = {
  score: number;
  weight: number;
  reason: string;
  signals: string[];
};

export type ResponseConfidenceEvent = {
  id: string;
  familiarId: string;
  sessionId: string;
  responseId: string;
  turnId?: string;
  threadTitle?: string;
  responseAt: string;
  reportedAt: string;
  overallConfidence: number;
  factors: Record<ResponseConfidenceFactorKey, ResponseConfidenceFactor>;
  diagnosticTags: string[];
  calibrationNotes?: string;
  rubricVersion: string;
};

export type ResponseConfidenceRollup = {
  eventCount: number;
  averageConfidence: number;
  lowConfidenceCount: number;
  factorAverages: Record<ResponseConfidenceFactorKey, number>;
  topDiagnosticTags: { tag: string; count: number }[];
  newestEvent: ResponseConfidenceEvent | null;
};

export const RESPONSE_CONFIDENCE_FACTOR_KEYS: ResponseConfidenceFactorKey[] = [
  "toolUse",
  "context",
  "skills",
  "permissions",
  "memory",
  "instructionFit",
  "evidence",
];

export const RESPONSE_CONFIDENCE_EMPTY_STATE =
  "No response confidence events yet. Enable response self-reporting to build confidence trends.";

const DEFAULT_RESPONSE_CONFIDENCE_RUBRIC = "2026-06-28.v1";

/** One settled turn of a thread, condensed for the reflection prompt. */
export type ReflectTranscriptTurn = { role: "user" | "assistant" | "system"; text: string };

const REFLECT_MAX_TURNS = 24;
const REFLECT_MAX_CHARS_PER_TURN = 600;

/** Render a compact, size-bounded transcript for embedding in the reflect prompt. */
export function buildReflectTranscript(turns: readonly ReflectTranscriptTurn[]): string {
  const lines = turns
    .filter((t) => (t.role === "user" || t.role === "assistant") && t.text.trim())
    .slice(-REFLECT_MAX_TURNS)
    .map((t) => {
      const body = t.text.trim().replace(/\s+/g, " ");
      const clipped = body.length > REFLECT_MAX_CHARS_PER_TURN
        ? `${body.slice(0, REFLECT_MAX_CHARS_PER_TURN)}…`
        : body;
      return `${t.role}: ${clipped}`;
    });
  return lines.join("\n");
}

/**
 * Build the thread self-report ("reflect") prompt. Generation runs client-side
 * through the chat bridge (there is no server LLM route), so the prompt — and the
 * exact JSON shape the route validates — lives here, shared by the caller and the
 * persistence route. `transcript` (from {@link buildReflectTranscript}) grounds an
 * ephemeral run that does not resume/pollute the original thread.
 */
export function buildThreadReflectPrompt(opts: { sessionId: string; transcript?: string }): string {
  const context = opts.transcript?.trim()
    ? `Here is the thread you just completed (session: ${opts.sessionId}), oldest to newest:\n\n${opts.transcript}\n\n`
    : `Reflect on the thread just completed (session: ${opts.sessionId}).\n\n`;
  return `${context}Reflect honestly on how that thread went for you as the familiar.
Return ONLY a valid JSON object matching this exact shape - no prose, no markdown fences:

{
  "overallConfidence": <0-100>,
  "overallConfidenceReason": "<brief explanation>",
  "toolReliability": {
    "score": <0-100>,
    "failedTools": ["<tool name>", ...],
    "unreliableTools": ["<tool name>", ...],
    "notes": "<optional>"
  },
  "contextPressure": "<adequate|tight|excess|critical>",
  "contextNotes": "<optional>",
  "skillsUsed": ["<skill id>", ...],
  "skillsNeedingClarity": [{ "skillId": "<id>", "reason": "<why>" }],
  "skillsNeedingAccess": [{ "skillId": "<id>", "reason": "<why>" }],
  "capabilitiesLacking": [{ "name": "<name>", "importance": "<nice-to-have|important|blocking>", "detail": "<detail>" }],
  "capabilitiesVital": [{ "name": "<name>", "currentState": "<available|degraded|missing>", "notes": "<optional>" }],
  "memoryRecallScore": <0-100>,
  "memoryRecallNotes": "<optional>",
  "fileLocatabilityScore": <0-100>,
  "fileLocatabilityNotes": "<optional>",
  "persistentBlockers": [{ "id": "<slug>", "title": "<title>", "category": "<auth|tooling|permission|infra|context|skill|other>", "impact": "<low|medium|high|blocking>", "detail": "<detail>", "suggestedResolution": "<optional>" }]
}

Be honest. Underconfidence is more useful than overconfidence. Only report what you actually experienced.`;
}

export type ThreadSelfReport = {
  id: string;
  familiarId: string;
  sessionId: string;
  threadTitle?: string;
  reportedAt: string;

  overallConfidence: number;
  overallConfidenceReason?: string;

  toolReliability: {
    score: number;
    failedTools: string[];
    unreliableTools: string[];
    notes?: string;
  };

  contextPressure: ContextPressure;
  contextNotes?: string;

  skillsUsed: string[];
  skillsNeedingClarity: { skillId: string; reason: string }[];
  skillsNeedingAccess: { skillId: string; reason: string }[];

  capabilitiesLacking: {
    name: string;
    importance: CapabilityImportance;
    detail: string;
  }[];
  capabilitiesVital: {
    name: string;
    currentState: CapabilityState;
    notes?: string;
  }[];

  memoryRecallScore: number;
  memoryRecallNotes?: string;
  fileLocatabilityScore: number;
  fileLocatabilityNotes?: string;

  persistentBlockers: {
    id: string;
    title: string;
    category: BlockerCategory;
    firstSeenAt?: string;
    impact: BlockerImpact;
    detail: string;
    suggestedResolution?: string;
  }[];
};

export function deriveThreadScore(report: ThreadSelfReport): number {
  return Math.round(
    report.overallConfidence * 0.35 +
    report.toolReliability.score * 0.25 +
    report.memoryRecallScore * 0.2 +
    report.fileLocatabilityScore * 0.2,
  );
}

export function contextPressureLabel(pressure: ContextPressure): { label: string; severity: "ok" | "warn" | "crit" } {
  if (pressure === "critical") return { label: "Critical", severity: "crit" };
  if (pressure === "tight") return { label: "Tight", severity: "warn" };
  if (pressure === "excess") return { label: "Excess", severity: "warn" };
  return { label: "Adequate", severity: "ok" };
}

// ── Pure logic helpers (used by components + tests without JSX) ────────────

const IMPACT_WEIGHT_LIB: Record<BlockerImpact, number> = { low: 1, medium: 2, high: 3, blocking: 4 };

export function topPersistentBlocker(
  report: ThreadSelfReport,
): ThreadSelfReport["persistentBlockers"][number] | null {
  return (
    [...report.persistentBlockers].sort(
      (a, b) => IMPACT_WEIGHT_LIB[b.impact] - IMPACT_WEIGHT_LIB[a.impact],
    )[0] ?? null
  );
}

export type RankedBlocker = ThreadSelfReport["persistentBlockers"][number] & {
  frequency: number;
  rankScore: number;
  crit: boolean;
};

export type ThreadSignalsAggregate = {
  averageConfidence: number;
  averageToolReliability: number;
  averageMemoryRecall: number;
  averageFileLocatability: number;
  contextCounts: Record<ContextPressure, number>;
  skillsUsedMost: { skillId: string; count: number }[];
  skillsNeedingClarity: ThreadSelfReport["skillsNeedingClarity"];
  skillsNeedingAccess: ThreadSelfReport["skillsNeedingAccess"];
  capabilitiesVital: ThreadSelfReport["capabilitiesVital"];
  capabilitiesLacking: ThreadSelfReport["capabilitiesLacking"];
  persistentBlockers: RankedBlocker[];
};

export type ThreadSignalReviewItem = {
  kind: "blocker" | "skill-access" | "skill-clarity" | "capability" | "context-pressure" | "low-score";
  severity: "critical" | "warning" | "info";
  /** Stable upstream identity within the kind (blocker id, skill id,
   *  capability name, metric label) — titles are display-only and are not
   *  enforced unique, so dismissal keys and React keys hang off this. */
  sourceId: string;
  title: string;
  detail: string;
};

export const REVIEW_SEVERITY_ORDER: Record<ThreadSignalReviewItem["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export const REVIEW_KIND_LABEL: Record<ThreadSignalReviewItem["kind"], string> = {
  blocker: "persistent blocker",
  "skill-access": "skill access gap",
  "skill-clarity": "skill clarity gap",
  capability: "capability gap",
  "context-pressure": "context pressure issue",
  "low-score": "low signal score",
};

/**
 * Seed prompt that launches a working thread to RESOLVE one review-queue item.
 * Selecting a signal in the Thread Signals review queue (or a table row) opens
 * a new chat with the familiar primed with this; the initialPrompt auto-sends,
 * so the thread starts working the fix immediately rather than idling on a
 * blank composer.
 */
export function buildThreadSignalResolutionPrompt(item: ThreadSignalReviewItem): string {
  return [
    `Resolve this ${REVIEW_KIND_LABEL[item.kind]} surfaced by your thread self-reports:`,
    "",
    `**${item.title}**`,
    item.detail,
    "",
    "This thread exists to fix the signal, not just discuss it:",
    "1. Diagnose the root cause.",
    "2. Apply the concrete fix now — update the prompt, memory, skill, config, or workflow at fault. If the fix needs something only I can grant (credentials, permissions, a product decision), stop and tell me exactly what to provide.",
    "3. Verify the fix and summarize what changed, so future threads stop reporting this signal.",
  ].join("\n");
}

export const THREAD_SIGNALS_EMPTY_STATE = "No thread reports yet. Use 'Reflect on this thread' to generate the first one.";

const IMPORTANCE_WEIGHT: Record<CapabilityImportance, number> = { "nice-to-have": 1, important: 2, blocking: 3 };

function libAvg(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}
function libIncrement(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(100, Math.round(value)));
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function normalizeResponseConfidenceEvent(event: ResponseConfidenceEvent): ResponseConfidenceEvent {
  const factors = {} as Record<ResponseConfidenceFactorKey, ResponseConfidenceFactor>;
  for (const key of RESPONSE_CONFIDENCE_FACTOR_KEYS) {
    const factor = event.factors[key];
    factors[key] = {
      score: clampConfidence(factor.score),
      weight: Math.max(0, Number.isFinite(factor.weight) ? factor.weight : 0),
      reason: factor.reason,
      signals: dedupeStrings(factor.signals),
    };
  }
  return {
    ...event,
    overallConfidence: clampConfidence(event.overallConfidence),
    factors,
    diagnosticTags: dedupeStrings(event.diagnosticTags),
    rubricVersion: event.rubricVersion || DEFAULT_RESPONSE_CONFIDENCE_RUBRIC,
  };
}

export function aggregateResponseConfidenceEvents(events: ResponseConfidenceEvent[]): ResponseConfidenceRollup {
  const normalized = events.map(normalizeResponseConfidenceEvent);
  const sorted = [...normalized].sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime());
  const factorAverages = {} as Record<ResponseConfidenceFactorKey, number>;
  const tagCounts = new Map<string, number>();

  for (const key of RESPONSE_CONFIDENCE_FACTOR_KEYS) {
    let weightedScore = 0;
    let totalWeight = 0;
    for (const event of normalized) {
      const factor = event.factors[key];
      weightedScore += factor.score * factor.weight;
      totalWeight += factor.weight;
    }
    factorAverages[key] = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0;
  }

  for (const event of normalized) {
    for (const tag of event.diagnosticTags) libIncrement(tagCounts, tag);
  }

  return {
    eventCount: normalized.length,
    averageConfidence: libAvg(normalized.map((event) => event.overallConfidence)),
    lowConfidenceCount: normalized.filter((event) => event.overallConfidence < 60).length,
    factorAverages,
    topDiagnosticTags: [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([tag, count]) => ({ tag, count })),
    newestEvent: sorted[0] ?? null,
  };
}

export function aggregateThreadSignals(reports: ThreadSelfReport[]): ThreadSignalsAggregate {
  const contextCounts: Record<ContextPressure, number> = { adequate: 0, tight: 0, excess: 0, critical: 0 };
  const skillsUsed = new Map<string, number>();
  const clarity = new Map<string, { skillId: string; reason: string }>();
  const access = new Map<string, { skillId: string; reason: string }>();
  const capVital = new Map<string, { name: string; currentState: CapabilityState; notes?: string }>();
  const capLacking = new Map<string, { name: string; importance: CapabilityImportance; detail: string }>();
  const blockerFreq = new Map<string, number>();
  const blockerData = new Map<string, ThreadSelfReport["persistentBlockers"][number]>();

  const sorted = [...reports].sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime());

  for (const r of sorted) {
    contextCounts[r.contextPressure]++;
    for (const s of r.skillsUsed) libIncrement(skillsUsed, s);
    for (const s of r.skillsNeedingClarity) if (!clarity.has(s.skillId)) clarity.set(s.skillId, s);
    for (const s of r.skillsNeedingAccess) if (!access.has(s.skillId)) access.set(s.skillId, s);
    for (const c of r.capabilitiesVital) {
      // Latest report wins: `currentState` is a *current* observation, and
      // reports iterate newest-first. Letting an older, worse state override
      // (the old STATE_WEIGHT behavior) pinned long-fixed capabilities at
      // "missing" for the whole report window (cave-hdkx).
      if (!capVital.has(c.name)) capVital.set(c.name, c);
    }
    for (const c of r.capabilitiesLacking) {
      const prev = capLacking.get(c.name);
      if (!prev || IMPORTANCE_WEIGHT[c.importance] > IMPORTANCE_WEIGHT[prev.importance]) capLacking.set(c.name, c);
    }
    for (const b of r.persistentBlockers) {
      libIncrement(blockerFreq, b.id);
      if (!blockerData.has(b.id)) blockerData.set(b.id, b);
    }
  }

  const total = reports.length || 1;
  const rankedBlockers: RankedBlocker[] = [...blockerFreq.entries()]
    .map(([id, frequency]) => {
      const data = blockerData.get(id)!;
      return { ...data, frequency, rankScore: frequency * IMPACT_WEIGHT_LIB[data.impact], crit: frequency / total > 0.5 };
    })
    .sort((a, b) => b.rankScore - a.rankScore);

  return {
    averageConfidence: libAvg(reports.map((r) => r.overallConfidence)),
    averageToolReliability: libAvg(reports.map((r) => r.toolReliability.score)),
    averageMemoryRecall: libAvg(reports.map((r) => r.memoryRecallScore)),
    averageFileLocatability: libAvg(reports.map((r) => r.fileLocatabilityScore)),
    contextCounts,
    skillsUsedMost: [...skillsUsed.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([skillId, count]) => ({ skillId, count })),
    skillsNeedingClarity: [...clarity.values()],
    skillsNeedingAccess: [...access.values()],
    capabilitiesVital: [...capVital.values()],
    capabilitiesLacking: [...capLacking.values()],
    persistentBlockers: rankedBlockers,
  };
}

export function buildThreadSignalReviewQueue(aggregate: ThreadSignalsAggregate): ThreadSignalReviewItem[] {
  const items: (ThreadSignalReviewItem & { rank: number })[] = [];

  for (const blocker of aggregate.persistentBlockers.slice(0, 5)) {
    items.push({
      kind: "blocker",
      severity: blocker.crit || blocker.impact === "blocking" ? "critical" : "warning",
      sourceId: blocker.id,
      title: blocker.title,
      detail: `${blocker.frequency}x - ${blocker.impact}${blocker.suggestedResolution ? ` - ${blocker.suggestedResolution}` : ""}`,
      rank: blocker.crit || blocker.impact === "blocking" ? 100 + blocker.rankScore : 70 + blocker.rankScore,
    });
  }

  for (const skill of aggregate.skillsNeedingAccess.slice(0, 4)) {
    items.push({
      kind: "skill-access",
      severity: "critical",
      sourceId: skill.skillId,
      title: skill.skillId,
      detail: skill.reason,
      rank: 85,
    });
  }

  for (const capability of aggregate.capabilitiesLacking.filter((item) => item.importance === "blocking").slice(0, 4)) {
    items.push({
      kind: "capability",
      severity: "critical",
      sourceId: capability.name,
      title: capability.name,
      detail: capability.detail,
      rank: 80,
    });
  }

  if (aggregate.contextCounts.critical > 0 || aggregate.contextCounts.tight > 0 || aggregate.contextCounts.excess > 0) {
    items.push({
      kind: "context-pressure",
      severity: aggregate.contextCounts.critical > 0 ? "critical" : "warning",
      sourceId: "context-pressure",
      title: "Context pressure",
      detail: `${aggregate.contextCounts.critical} critical, ${aggregate.contextCounts.tight} tight, ${aggregate.contextCounts.excess} excess`,
      rank: aggregate.contextCounts.critical > 0 ? 75 : 55,
    });
  }

  for (const skill of aggregate.skillsNeedingClarity.slice(0, 4)) {
    items.push({
      kind: "skill-clarity",
      severity: "warning",
      sourceId: skill.skillId,
      title: skill.skillId,
      detail: skill.reason,
      rank: 45,
    });
  }

  const lowScores: [string, ThreadSignalReviewItem["title"], number][] = [
    ["confidence", "Confidence", aggregate.averageConfidence],
    ["tool-reliability", "Tool reliability", aggregate.averageToolReliability],
    ["memory-recall", "Memory recall", aggregate.averageMemoryRecall],
    ["file-locatability", "File locatability", aggregate.averageFileLocatability],
  ];
  for (const [sourceId, title, score] of lowScores) {
    if (score > 0 && score < 60) {
      items.push({
        kind: "low-score",
        severity: score < 40 ? "critical" : "warning",
        sourceId,
        title,
        detail: `Average ${score}/100`,
        rank: score < 40 ? 72 : 42,
      });
    }
  }

  return items
    // Severity first — a stack of warnings must never outrank a critical
    // (rankScore-boosted warning blockers previously could). Rank breaks ties
    // within a severity tier; title keeps the order stable.
    .sort(
      (a, b) =>
        REVIEW_SEVERITY_ORDER[a.severity] - REVIEW_SEVERITY_ORDER[b.severity] ||
        b.rank - a.rank ||
        a.title.localeCompare(b.title),
    )
    .slice(0, 8)
    .map(({ rank: _rank, ...item }) => item);
}
