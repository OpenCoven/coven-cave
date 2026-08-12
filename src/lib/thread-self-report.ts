export type ContextPressure = "adequate" | "tight" | "excess" | "critical";
export type CapabilityState = "available" | "degraded" | "missing";
export type BlockerCategory = "auth" | "tooling" | "permission" | "infra" | "context" | "skill" | "other";
export type BlockerImpact = "low" | "medium" | "high" | "blocking";
export type CapabilityImportance = "nice-to-have" | "important" | "blocking";

/** One settled turn of a thread, condensed for the reflection prompt. */
export type ReflectTranscriptTurn = { role: "user" | "assistant" | "system"; text: string };

const REFLECT_MAX_TURNS = 36;
const REFLECT_MAX_CHARS_PER_TURN = 900;

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
    : `No transcript was captured for the thread just completed (session: ${opts.sessionId}). Judge only what you can actually establish; do not treat the missing transcript as a finding about the thread.\n\n`;
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

Scope rule for "contextPressure": rate the THREAD ABOVE, not this reflection run.
This is a separate, deliberately minimal run whose transcript is condensed and
may be clipped or missing entirely. That is normal and expected — it is a
property of how reflection works, never evidence about the thread. So:
- Do NOT rate pressure on how much of the transcript you can see here.
- Do NOT cite this prompt's own size, injected reference material, or a
  truncated/absent transcript as a cause of pressure.
- Rate "critical" or "excess" only for pressure the thread itself actually hit:
  the thread compacted, state had to be re-derived, work was dropped, or the
  thread was given far more material than its task required.
- If the transcript is too thin to judge, use "adequate" and say so in
  "contextNotes" — an honest "not enough evidence" beats an inflated rating.

Delivery evidence rule:
- Do NOT infer completion from plans, narration, or intent ("I will push", "about
  to schedule", "finishing the artifact").
- A concrete deliverable is verified only when the transcript contains its
  remote ref, artifact path, receipt, message id, or equivalent checkable proof.
- If that evidence is absent, describe the work as incomplete or unverified and
  put the exact remaining proof gap in persistentBlockers.

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
    "4. Before the final response, classify every requested deliverable as verified with exact evidence, incomplete, or blocked. Do not infer delivery from plans or narration.",
  ].join("\n");
}

/**
 * Seed prompt that launches ONE working thread to resolve several review-queue
 * items at once — the card's "Fix N critical in one thread" action. A single
 * primed thread beats N threads racing each other over the same prompt/skill
 * files, which is what one-tap-per-signal produced when every critical signal
 * shared a root cause.
 */
export function buildThreadSignalBatchResolutionPrompt(items: readonly ThreadSignalReviewItem[]): string {
  if (items.length === 1) return buildThreadSignalResolutionPrompt(items[0]);
  return [
    `Resolve these ${items.length} signals surfaced by your thread self-reports:`,
    "",
    ...items.map((item, index) => `${index + 1}. **${item.title}** (${REVIEW_KIND_LABEL[item.kind]}) — ${item.detail}`),
    "",
    "This thread exists to fix the signals, not just discuss them:",
    "1. Diagnose each root cause, and say so if several share one.",
    "2. Apply the concrete fixes now — update the prompt, memory, skill, config, or workflow at fault. If a fix needs something only I can grant (credentials, permissions, a product decision), stop and tell me exactly what to provide.",
    "3. Verify each fix and summarize what changed, so future threads stop reporting these signals.",
    "4. Before the final response, classify every requested deliverable as verified with exact evidence, incomplete, or blocked. Do not infer delivery from plans or narration.",
  ].join("\n");
}

export const THREAD_SIGNALS_EMPTY_STATE = "No thread reports yet. Use 'Reflect on this thread' to generate the first one.";

// ── In-chat Thread Signal card ────────────────────────────────────────────
// The chat card reports on ONE settled thread, so it cannot use the aggregate
// helpers above: `aggregateThreadSignals([report])` scores every blocker
// `crit` (frequency / total is always 1 > 0.5) and averages a single sample.
// These builders read the report directly and grade it on its own terms.

export type SignalTone = "ok" | "neutral" | "warn" | "crit";

/**
 * Tone for one contributing metric. Only the extremes earn a color — a middling
 * memory-recall score inside an otherwise healthy thread is information, not an
 * alarm, and coloring it would spend the card's attention budget on noise.
 * The 40/60 thresholds are the ones {@link buildThreadSignalReviewQueue}
 * already uses to promote a low score into the review queue.
 */
export function metricTone(score: number): SignalTone {
  if (score < 40) return "crit";
  if (score < 60) return "warn";
  if (score >= 90) return "ok";
  return "neutral";
}

/**
 * Tone for the composite. Graded harder than its inputs on purpose: it is the
 * headline number in the card header, so a 60 thread reads as a warning even
 * though a 60 on any single input does not.
 */
export function compositeTone(score: number): SignalTone {
  if (score < 40) return "crit";
  if (score < 70) return "warn";
  return "ok";
}

export type ThreadSignalScoreTile = {
  id: "score" | "confidence" | "tools" | "memory" | "files" | "context";
  label: string;
  /** Display value — a number for scored metrics, a word for context pressure. */
  value: string;
  tone: SignalTone;
  /** 0-100 fill for the rationale bar. */
  percent: number;
  /** Contribution to the composite, or why it is not part of it. */
  weight: string;
  /** Why the value is what it is, taken from the report's own notes. */
  rationale: string;
  /** Only the composite carries the formula line. */
  formula?: string;
};

const SCORE_FORMULA = "conf x .35 + tools x .25 + memory x .20 + files x .20";

function toolRationale(report: ThreadSelfReport): string {
  const tools = report.toolReliability;
  if (tools.notes?.trim()) return tools.notes.trim();
  const parts: string[] = [];
  if (tools.failedTools.length > 0) parts.push(`Failed: ${tools.failedTools.join(", ")}.`);
  if (tools.unreliableTools.length > 0) parts.push(`Unreliable: ${tools.unreliableTools.join(", ")}.`);
  if (parts.length > 0) return parts.join(" ");
  return "No failed or unreliable tools reported this thread.";
}

/**
 * The six tiles across the card's score grid. Every rationale is quoted from the
 * report rather than generated, so tapping a tile shows what the familiar
 * actually said; the composite's rationale names its own strongest and weakest
 * input, which is the one thing no single field records.
 */
export function buildThreadSignalScoreTiles(report: ThreadSelfReport): ThreadSignalScoreTile[] {
  const composite = deriveThreadScore(report);
  const context = contextPressureLabel(report.contextPressure);
  const scored: { label: string; score: number }[] = [
    { label: "Confidence", score: report.overallConfidence },
    { label: "Tools", score: report.toolReliability.score },
    { label: "Memory", score: report.memoryRecallScore },
    { label: "Files", score: report.fileLocatabilityScore },
  ];
  const ranked = [...scored].sort((a, b) => a.score - b.score);
  const weakest = ranked[0];
  const strongest = ranked[ranked.length - 1];

  return [
    {
      id: "score",
      label: "Score",
      value: String(composite),
      tone: compositeTone(composite),
      percent: composite,
      weight: "weighted blend",
      rationale: `Composite thread score. Strongest input ${strongest.label.toLowerCase()} at ${Math.round(strongest.score)}, weakest ${weakest.label.toLowerCase()} at ${Math.round(weakest.score)}.`,
      formula: SCORE_FORMULA,
    },
    {
      id: "confidence",
      label: "Confidence",
      value: String(Math.round(report.overallConfidence)),
      tone: metricTone(report.overallConfidence),
      percent: report.overallConfidence,
      weight: "x .35",
      rationale: report.overallConfidenceReason?.trim() || "No confidence reason reported.",
    },
    {
      id: "tools",
      label: "Tools",
      value: String(Math.round(report.toolReliability.score)),
      tone: metricTone(report.toolReliability.score),
      percent: report.toolReliability.score,
      weight: "x .25",
      rationale: toolRationale(report),
    },
    {
      id: "memory",
      label: "Memory",
      value: String(Math.round(report.memoryRecallScore)),
      tone: metricTone(report.memoryRecallScore),
      percent: report.memoryRecallScore,
      weight: "x .20",
      rationale: report.memoryRecallNotes?.trim() || "No memory-recall notes reported.",
    },
    {
      id: "files",
      label: "Files",
      value: String(Math.round(report.fileLocatabilityScore)),
      tone: metricTone(report.fileLocatabilityScore),
      percent: report.fileLocatabilityScore,
      weight: "x .20",
      rationale: report.fileLocatabilityNotes?.trim() || "No file-locatability notes reported.",
    },
    {
      id: "context",
      label: "Context",
      value: context.label,
      tone: context.severity === "ok" ? "ok" : context.severity === "warn" ? "warn" : "crit",
      percent: 100,
      weight: "not scored",
      rationale: report.contextNotes?.trim() || `Context pressure reported as ${context.label.toLowerCase()}.`,
    },
  ];
}

/** Short kind label for the card's queue rows; {@link REVIEW_KIND_LABEL} reads as a phrase mid-sentence. */
export const REVIEW_KIND_SHORT_LABEL: Record<ThreadSignalReviewItem["kind"], string> = {
  blocker: "Blocker",
  "skill-access": "Skill access",
  "skill-clarity": "Skill clarity",
  capability: "Capability",
  "context-pressure": "Context",
  "low-score": "Low score",
};

export type ThreadSignalRow = ThreadSignalReviewItem & {
  kindLabel: string;
  /** Provenance line above the detail — category, impact, or state. */
  meta: string;
  /** What the report suggested doing about it; empty when it suggested nothing. */
  resolution: string;
};

const MAX_SIGNAL_ROWS = 6;

/**
 * The card's ranked signal queue for a single report. Ordering matches the
 * analytics review queue — severity tier first, then rank, then title — so the
 * same signal sits in the same place on both surfaces.
 */
export function buildThreadSignalRows(report: ThreadSelfReport): ThreadSignalRow[] {
  const rows: (ThreadSignalRow & { rank: number })[] = [];
  const push = (row: Omit<ThreadSignalRow, "kindLabel"> & { rank: number }) => {
    rows.push({ ...row, kindLabel: REVIEW_KIND_SHORT_LABEL[row.kind] });
  };

  for (const blocker of report.persistentBlockers) {
    const critical = blocker.impact === "blocking" || blocker.impact === "high";
    push({
      kind: "blocker",
      severity: critical ? "critical" : "warning",
      sourceId: blocker.id,
      title: blocker.title,
      meta: `${blocker.category} · ${blocker.impact} impact`,
      detail: blocker.detail,
      resolution: blocker.suggestedResolution?.trim() ?? "",
      rank: critical ? 100 : 70,
    });
  }

  for (const capability of report.capabilitiesLacking) {
    if (capability.importance === "nice-to-have") continue;
    const critical = capability.importance === "blocking";
    push({
      kind: "capability",
      severity: critical ? "critical" : "warning",
      sourceId: capability.name,
      title: capability.name,
      meta: `${capability.importance} · missing`,
      detail: capability.detail,
      resolution: "",
      rank: critical ? 90 : 60,
    });
  }

  for (const skill of report.skillsNeedingAccess) {
    push({
      kind: "skill-access",
      severity: "critical",
      sourceId: skill.skillId,
      title: skill.skillId,
      meta: "access gap",
      detail: skill.reason,
      resolution: "",
      rank: 85,
    });
  }

  if (report.contextPressure !== "adequate") {
    const context = contextPressureLabel(report.contextPressure);
    push({
      kind: "context-pressure",
      severity: report.contextPressure === "critical" ? "critical" : "warning",
      sourceId: "context-pressure",
      title: `Context ${context.label.toLowerCase()}`,
      meta: "this thread",
      detail: report.contextNotes?.trim() || `Context pressure reported as ${context.label.toLowerCase()}.`,
      resolution: "",
      rank: report.contextPressure === "critical" ? 75 : 55,
    });
  }

  const lowScores: [string, string, number, string][] = [
    ["confidence", "Confidence", report.overallConfidence, report.overallConfidenceReason?.trim() ?? ""],
    ["tool-reliability", "Tool reliability", report.toolReliability.score, toolRationale(report)],
    ["memory-recall", "Memory recall", report.memoryRecallScore, report.memoryRecallNotes?.trim() ?? ""],
    ["file-locatability", "File locatability", report.fileLocatabilityScore, report.fileLocatabilityNotes?.trim() ?? ""],
  ];
  for (const [sourceId, label, score, note] of lowScores) {
    if (score <= 0 || score >= 60) continue;
    push({
      kind: "low-score",
      severity: score < 40 ? "critical" : "warning",
      sourceId,
      title: `${label} ${Math.round(score)}/100`,
      meta: "this thread",
      detail: note || `Scored ${Math.round(score)}/100 this thread.`,
      resolution: "",
      rank: score < 40 ? 72 : 42,
    });
  }

  for (const skill of report.skillsNeedingClarity) {
    push({
      kind: "skill-clarity",
      severity: "warning",
      sourceId: skill.skillId,
      title: skill.skillId,
      meta: "doc gap",
      detail: skill.reason,
      resolution: "",
      rank: 45,
    });
  }

  return rows
    .sort(
      (a, b) =>
        REVIEW_SEVERITY_ORDER[a.severity] - REVIEW_SEVERITY_ORDER[b.severity] ||
        b.rank - a.rank ||
        a.title.localeCompare(b.title),
    )
    .slice(0, MAX_SIGNAL_ROWS)
    .map(({ rank: _rank, ...row }) => row);
}

function libAvg(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}
function libIncrement(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function aggregateThreadSignals(reports: ThreadSelfReport[]): ThreadSignalsAggregate {
  const contextCounts: Record<ContextPressure, number> = { adequate: 0, tight: 0, excess: 0, critical: 0 };
  const skillsUsed = new Map<string, number>();
  const clarity = new Map<string, { skillId: string; reason: string }>();
  const access = new Map<string, { skillId: string; reason: string }>();
  const accessDecided = new Set<string>();
  const capVital = new Map<string, { name: string; currentState: CapabilityState; notes?: string }>();
  const capLacking = new Map<string, { name: string; importance: CapabilityImportance; detail: string }>();
  const blockerFreq = new Map<string, number>();
  const blockerData = new Map<string, ThreadSelfReport["persistentBlockers"][number]>();

  const sorted = [...reports].sort(
    (a, b) =>
      new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime() ||
      b.id.localeCompare(a.id),
  );
  const newest = sorted[0] ?? null;
  // Stale-signal clearing: these lists are "current issues". If the newest
  // report no longer carries an item, treat it as resolved and keep it out of
  // the aggregate/queue even if older reports still mention it.
  const activeCapabilityLacking = new Set((newest?.capabilitiesLacking ?? []).map((item) => item.name));
  const activeBlockers = new Set((newest?.persistentBlockers ?? []).map((item) => item.id));

  for (const r of sorted) {
    contextCounts[r.contextPressure]++;
    for (const s of r.skillsUsed) libIncrement(skillsUsed, s);
    for (const s of r.skillsNeedingClarity) if (!clarity.has(s.skillId)) clarity.set(s.skillId, s);
    // Latest report wins per skillId: an access gap is a *current* state, not
    // complaint history. The newest report mentioning a skill decides — either
    // it re-files the complaint, or it lists the skill in `skillsUsed` without
    // one, which clears the row. Without the clearing rule, one old "not
    // installed" report pinned `status: blocked` for the whole window even
    // after later threads used the skill successfully (skill-creator; same bug
    // class as the capabilitiesVital fix below, cave-hdkx). Within a single
    // report the complaint wins over its own `skillsUsed` mention: threads can
    // use a skill through a fallback path while access is still broken.
    for (const s of r.skillsNeedingAccess) {
      if (!accessDecided.has(s.skillId)) {
        accessDecided.add(s.skillId);
        access.set(s.skillId, s);
      }
    }
    for (const skillId of r.skillsUsed) accessDecided.add(skillId);
    for (const c of r.capabilitiesVital) {
      // Latest report wins: `currentState` is a *current* observation, and
      // reports iterate newest-first. Letting an older, worse state override
      // (the old STATE_WEIGHT behavior) pinned long-fixed capabilities at
      // "missing" for the whole report window (cave-hdkx).
      if (!capVital.has(c.name)) capVital.set(c.name, c);
    }
    for (const c of r.capabilitiesLacking) {
      if (!activeCapabilityLacking.has(c.name)) continue;
      // Latest report wins per capability: once a capability is no longer in
      // the newest "lacking" list, older complaints stay resolved.
      if (!capLacking.has(c.name)) capLacking.set(c.name, c);
    }
    for (const b of r.persistentBlockers) {
      if (!activeBlockers.has(b.id)) continue;
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
