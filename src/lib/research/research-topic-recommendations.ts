import {
  AGENTIC_EVIDENCE_KINDS,
  contextFingerprint,
  rankAgenticRecommendations,
  type AgenticEvidenceKind,
  type AgenticEvidenceRef,
  type AgenticPayload,
  type AgenticRecommendation,
  type RankedAgenticRecommendation,
} from "../agentic-recommendations.ts";
import type { SavedLink } from "../link-organizer.ts";
import { allowedResearchActions, type ResearchMission } from "./research-missions.ts";
import { containsSecretText } from "../secret-redaction.ts";
import type { KnowledgeEntry } from "../server/knowledge-vault.ts";
import type { SavedXSource } from "../server/x-sources.ts";

export const MAX_RESEARCH_TOPIC_RECOMMENDATIONS = 12;
export const MAX_RESEARCH_TOPIC_MISSIONS = 12;
export const MAX_RESEARCH_TOPIC_SAVED_LINKS = 12;
export const MAX_RESEARCH_TOPIC_X_SOURCES = 12;
export const MAX_RESEARCH_TOPIC_VAULT_ENTRIES = 8;

export type ResearchRecommendationKind =
  | "start-mission"
  | "refine-mission"
  | "review-mission"
  | "add-to-prompt"
  | "investigate-evidence-gap";

export type ResearchTopicRecommendationPayload = AgenticPayload & {
  recommendationKind: ResearchRecommendationKind;
  topic: string;
  targetMissionId?: string;
  sourceId?: string;
};

export type ResearchTopicRecommendation = RankedAgenticRecommendation<ResearchTopicRecommendationPayload>;

export type ResearchTopicRecommendationContext = {
  familiarId: string;
  missions: readonly ResearchMission[];
  savedLinks: readonly SavedLink[];
  xSources: readonly SavedXSource[];
  vaultEntries: readonly KnowledgeEntry[];
  /**
   * True only when the route could not retrieve the optional Vault snapshot.
   * Desk evidence remains usable and every returned card labels this limitation.
   */
  reducedContext: boolean;
};

export type ResearchTopicRecommendationResult = {
  recommendations: ResearchTopicRecommendation[];
  contextFingerprint: string;
  reducedContext: boolean;
  context: {
    missions: number;
    savedLinks: number;
    xSources: number;
    vaultEntries: number;
  };
};

export type ResearchTopicContextRevision = {
  contextFingerprint: string;
  reducedContext: boolean;
  context: {
    missions: number;
    savedLinks: number;
    xSources: number;
    vaultEntries: number;
  };
};

type SafeMission = {
  id: string;
  title: string;
  intent: string;
  sourceCount: number;
  needsEvidence: boolean;
  status: ResearchMission["status"];
  updatedAt: string;
};

type SafeSavedLink = {
  id: string;
  title: string;
  addedAt: string;
};

type SafeXSource = {
  id: string;
  postId: string;
  note: string;
  updatedAt: string;
};

type SafeVaultEntry = {
  id: string;
  collection: string;
  title: string;
  tags: string[];
  body: string;
  modified: string;
};

type SafeContext = {
  familiarId: string;
  missions: SafeMission[];
  savedLinks: SafeSavedLink[];
  xSources: SafeXSource[];
  vaultEntries: SafeVaultEntry[];
  reducedContext: boolean;
};

type Candidate = {
  priority: number;
  tieBreaker: string;
  recommendation: AgenticRecommendation<ResearchTopicRecommendationPayload>;
};

const SAFE_ID = /^[A-Za-z][A-Za-z0-9._:/-]*$/;
const RECORD_ID = /^[A-Za-z0-9._:/-]+$/;
const MAX_LABEL_CHARS = 180;
const MAX_VAULT_BODY_CHARS = 800;
const DECISION_WORDS = /\b(choose|compare|decide|decision|evaluate|select|trade-?off|validate)\b/i;
const EVIDENCE_GAP_MISSION_STATUSES = new Set<ResearchMission["status"]>([
  "queued",
  "planning",
  "running",
  "checkpoint",
  "paused",
  "failed",
]);

function safeText(value: unknown, maximum = MAX_LABEL_CHARS): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || containsSecretText(normalized)) return null;
  return normalized.slice(0, maximum);
}

function safeRecordId(value: unknown): string | null {
  if (typeof value !== "string" || !value || containsSecretText(value)) return null;
  const normalized = value.trim();
  return normalized && RECORD_ID.test(normalized) ? normalized : null;
}

/**
 * Evidence IDs are namespaced with their contract kind, so they always satisfy
 * the shared first-letter constraint without changing the stored record ID.
 */
export function researchEvidenceRefIdFor(
  kind: AgenticEvidenceKind,
  sourceId: string,
): string | null {
  const source = safeRecordId(sourceId);
  if (!source) return null;
  const mapped = `${kind}:${source}`;
  return SAFE_ID.test(mapped) ? mapped : null;
}

/** Recover the exact storage ID from a typed evidence reference. */
export function resolveResearchEvidenceRefId(evidenceId: string): string | null {
  for (const kind of AGENTIC_EVIDENCE_KINDS) {
    const prefix = `${kind}:`;
    if (!evidenceId.startsWith(prefix)) continue;
    return safeRecordId(evidenceId.slice(prefix.length));
  }
  return null;
}

function safeSourceUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:")
      && !url.username
      && !url.password
      && !containsSecretText(url.search)
      && !containsSecretText(url.hash)
    );
  } catch {
    return false;
  }
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function tokenize(value: string): string[] {
  return [...new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2),
  )];
}

function normalizedTopic(value: string): string {
  return tokenize(value).sort().join(" ");
}

function safeMissions(missions: readonly ResearchMission[]): SafeMission[] {
  return missions
    .filter((mission) => mission.status !== "archived")
    .map((mission) => {
      const id = safeRecordId(mission.id);
      const title = safeText(mission.title);
      const intent = safeText(mission.intent, 400);
      if (!id || !title || !intent) return null;
      return {
        id,
        title,
        intent,
        sourceCount: usableResearchSourceCount(mission.sources),
        needsEvidence: EVIDENCE_GAP_MISSION_STATUSES.has(mission.status),
        status: mission.status,
        updatedAt: safeText(mission.updatedAt, 64) ?? "",
      };
    })
    .filter((mission): mission is SafeMission => mission !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .slice(0, MAX_RESEARCH_TOPIC_MISSIONS);
}

function usableResearchSourceCount(sources: unknown): number {
  if (!Array.isArray(sources)) return 0;
  return sources.filter((source) =>
    source !== null
    && typeof source === "object"
    && ((source as { status?: unknown }).status === "used"
      || (source as { status?: unknown }).status === "conflicting")
  ).length;
}

function safeSavedLinks(links: readonly SavedLink[]): SafeSavedLink[] {
  return links
    .map((link) => {
      const id = safeRecordId(link.id);
      const title = safeText(link.title);
      if (!id || !title || !safeSourceUrl(link.url)) return null;
      return { id, title, addedAt: safeText(link.addedAt, 64) ?? "" };
    })
    .filter((link): link is SafeSavedLink => link !== null)
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, MAX_RESEARCH_TOPIC_SAVED_LINKS);
}

function safeXSources(sources: readonly SavedXSource[]): SafeXSource[] {
  return sources
    .filter((source) => source.availability === "available")
    .map((source) => {
      const id = safeRecordId(source.id);
      const postId = safeText(source.postId, 64);
      const note = safeText(source.note, 400);
      if (
        !id
        || !postId
        || !note
        || !safeSourceUrl(source.canonicalUrl)
        || !safeSourceUrl(source.originalUrl)
        || source.tags.some((tag) => containsSecretText(tag))
      ) {
        return null;
      }
      return { id, postId, note, updatedAt: safeText(source.updatedAt, 64) ?? "" };
    })
    .filter((source): source is SafeXSource => source !== null)
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, MAX_RESEARCH_TOPIC_X_SOURCES);
}

function safeVaultEntries(entries: readonly KnowledgeEntry[]): SafeVaultEntry[] {
  return entries
    .filter((entry) => entry.enabled)
    .map((entry) => {
      const collection = entry.collection ? safeText(entry.collection, 64) : "";
      const id = safeRecordId(
        collection ? `${collection}/${entry.id}` : entry.id,
      );
      const title = safeText(entry.title);
      const tags = entry.tags.map((tag) => safeText(tag, 64));
      const body = safeText(entry.body, MAX_VAULT_BODY_CHARS);
      if (
        !id
        || !title
        || !body
        || tags.some((tag) => tag === null)
        || (entry.collection !== undefined && !collection)
      ) {
        return null;
      }
      return {
        id,
        collection,
        title,
        tags: tags as string[],
        body,
        modified: safeText(entry.modified, 64) ?? "",
      };
    })
    .filter((entry): entry is SafeVaultEntry => entry !== null)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function toSafeContext(context: ResearchTopicRecommendationContext): SafeContext {
  const missions = safeMissions(context.missions);
  const savedLinks = safeSavedLinks(context.savedLinks);
  const xSources = safeXSources(context.xSources);
  const topicTokens = researchTopicTokens({ missions, savedLinks, xSources });
  return {
    familiarId: safeRecordId(context.familiarId) ?? "research",
    missions,
    savedLinks,
    xSources,
    vaultEntries: relevantVaultEntries(safeVaultEntries(context.vaultEntries), topicTokens),
    reducedContext: context.reducedContext === true,
  };
}

function evidence(sourceId: string, kind: AgenticEvidenceRef["kind"], label: string): AgenticEvidenceRef {
  const id = researchEvidenceRefIdFor(kind, sourceId);
  if (!id) throw new Error("invalid resolved research evidence");
  return { id, kind, label };
}

function reducedContextReason(reducedContext: boolean): string[] {
  return reducedContext
    ? ["Vault context was unavailable, so this ranking uses Research Desk evidence only."]
    : [];
}

function candidate(
  contextFingerprintValue: string,
  reducedContext: boolean,
  input: {
    key: string;
    priority: number;
    recommendationKind: ResearchRecommendationKind;
    topic: string;
    rationale: string;
    inferredGoal: string;
    rankReasons: string[];
    evidenceRefs: AgenticEvidenceRef[];
    targetMissionId?: string;
    sourceId?: string;
  },
): Candidate {
  const payload: ResearchTopicRecommendationPayload = {
    recommendationKind: input.recommendationKind,
    topic: input.topic,
    ...(input.targetMissionId ? { targetMissionId: input.targetMissionId } : {}),
    ...(input.sourceId ? { sourceId: input.sourceId } : {}),
  };
  return {
    priority: input.priority,
    tieBreaker: input.key,
    recommendation: {
      id: `research-topic-${stableHash(input.key)}`,
      surface: "research",
      kind: "topic",
      payload,
      rationale: input.rationale,
      inferredGoal: input.inferredGoal,
      rankReasons: [...input.rankReasons, ...reducedContextReason(reducedContext)],
      evidenceRefs: input.evidenceRefs,
      contextFingerprint: contextFingerprintValue,
      verification: {
        status: "proposal",
        checks: [{
          id: "evidence-resolved",
          state: "passed",
          detail: "Every cited Research Desk or Vault record resolved in the bounded snapshot.",
        }],
      },
      application: {
        mode: "review",
        requiresApproval: true,
        reversible: false,
      },
    },
  };
}

function duplicateMissionGroups(missions: readonly SafeMission[]): SafeMission[][] {
  const groups = new Map<string, SafeMission[]>();
  for (const mission of missions) {
    const key = normalizedTopic(mission.title);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(mission);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function canRefineMission(mission: SafeMission): boolean {
  return allowedResearchActions(mission).includes("refine");
}

function vaultRelevance(entry: SafeVaultEntry, topicTokens: readonly string[]): number {
  const searchable = new Set(tokenize(`${entry.title} ${entry.tags.join(" ")} ${entry.body}`));
  return topicTokens.reduce((score, token) => score + (searchable.has(token) ? 1 : 0), 0);
}

function researchTopicTokens(context: Pick<SafeContext, "missions" | "savedLinks" | "xSources">): string[] {
  return tokenize([
    ...context.missions.map((mission) => `${mission.title} ${mission.intent}`),
    ...context.savedLinks.map((link) => link.title),
    ...context.xSources.map((source) => source.note),
  ].join(" "));
}

function relevantVaultEntries(
  entries: readonly SafeVaultEntry[],
  topicTokens: readonly string[],
): SafeVaultEntry[] {
  const scored = entries.map((entry) => ({ entry, score: vaultRelevance(entry, topicTokens) }));
  return scored
    .filter(({ score }) => topicTokens.length === 0 || score > 0)
    .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id))
    .slice(0, MAX_RESEARCH_TOPIC_VAULT_ENTRIES)
    .map(({ entry }) => entry);
}

function matchingMissionsForTopic(
  missions: readonly SafeMission[],
  topic: string,
): SafeMission[] {
  const normalized = normalizedTopic(topic);
  return missions.filter((mission) => normalizedTopic(mission.title) === normalized);
}

function topicMissionAction(
  missions: readonly SafeMission[],
  topic: string,
): { target: SafeMission | undefined; kind: "start-mission" | "refine-mission" | "review-mission" } {
  const matches = matchingMissionsForTopic(missions, topic);
  const refinementTarget = matches.find(canRefineMission);
  if (refinementTarget) return { target: refinementTarget, kind: "refine-mission" };
  if (matches[0]) return { target: matches[0], kind: "review-mission" };
  return { target: undefined, kind: "start-mission" };
}

/**
 * The shared fingerprint intentionally sees compact identities rather than
 * every bounded excerpt/tag. Its 256-entry structural budget must accommodate
 * all advertised context limits, while each digest still changes when a safe
 * source snapshot changes.
 */
function fingerprintContext(context: SafeContext): Record<string, unknown> {
  return {
    version: "research-topic-recommendations-v2",
    familiarId: context.familiarId,
    missions: context.missions.map((mission) => [
      mission.id,
      mission.updatedAt,
      stableHash(`${mission.status}\0${mission.title}\0${mission.intent}\0${mission.sourceCount}`),
    ]),
    savedLinks: context.savedLinks.map((link) => [
      link.id,
      link.addedAt,
      stableHash(link.title),
    ]),
    xSources: context.xSources.map((source) => [
      source.id,
      source.updatedAt,
      stableHash(`${source.postId}\0${source.note}`),
    ]),
    vaultEntries: context.vaultEntries.map((entry) => [
      entry.id,
      entry.modified,
      stableHash(`${entry.title}\0${entry.tags.join("\0")}\0${entry.body}`),
    ]),
    reducedContext: context.reducedContext,
  };
}

function contextRevision(context: SafeContext): ResearchTopicContextRevision {
  return {
    contextFingerprint: contextFingerprint(fingerprintContext(context)),
    reducedContext: context.reducedContext,
    context: {
      missions: context.missions.length,
      savedLinks: context.savedLinks.length,
      xSources: context.xSources.length,
      vaultEntries: context.vaultEntries.length,
    },
  };
}

/** Bounded server-side evidence revision for foreground/focus freshness checks.
 * It intentionally avoids generating or ranking topic proposals. */
export function researchTopicContextRevision(
  input: ResearchTopicRecommendationContext,
): ResearchTopicContextRevision {
  return contextRevision(toSafeContext(input));
}

/**
 * Produces only reviewable, evidence-resolved Research topic proposals.
 * The input is normalized, bounded, secret-filtered, and sorted before its
 * fingerprint and ranking are derived, so equivalent Desk snapshots stay stable.
 */
export function recommendResearchTopics(
  input: ResearchTopicRecommendationContext,
): ResearchTopicRecommendationResult {
  const context = toSafeContext(input);
  const revision = contextRevision(context);
  const fingerprint = revision.contextFingerprint;
  const candidates: Candidate[] = [];
  const duplicateMissionIds = new Set<string>();

  for (const group of duplicateMissionGroups(context.missions)) {
    const canonical = group.find(canRefineMission) ?? group[0]!;
    const canRefine = canRefineMission(canonical);
    for (const mission of group) duplicateMissionIds.add(mission.id);
    candidates.push(candidate(fingerprint, context.reducedContext, {
      key: `duplicate:${group.map((mission) => mission.id).join(",")}`,
      priority: 1,
      recommendationKind: canRefine ? "refine-mission" : "review-mission",
      topic: canonical.title,
      targetMissionId: canonical.id,
      rationale: canRefine
        ? "These active missions cover the same outcome. Refine the existing mission instead of starting another duplicate."
        : "These missions cover the same outcome, but none can be refined in its current lifecycle state. Review them before any follow-up.",
      inferredGoal: canRefine
        ? `Consolidate work on ${canonical.title}.`
        : `Review the existing work on ${canonical.title}.`,
      rankReasons: [
        "Avoids duplicating active Research Desk work.",
        canRefine
          ? "Combines evidence already attached to the matching missions."
          : "Preserves the existing missions' lifecycle boundaries.",
      ],
      evidenceRefs: group.map((mission) => evidence(mission.id, "mission", mission.title)),
    }));
  }

  for (const mission of context.missions) {
    if (
      duplicateMissionIds.has(mission.id)
      || mission.sourceCount > 0
      || !mission.needsEvidence
    ) continue;
    const decisionValue = DECISION_WORDS.test(`${mission.title} ${mission.intent}`);
    candidates.push(candidate(fingerprint, context.reducedContext, {
      key: `gap:${mission.id}`,
      priority: decisionValue ? 0 : 2,
      recommendationKind: "investigate-evidence-gap",
      topic: `Resolve the evidence gap for ${mission.title}`,
      targetMissionId: mission.id,
      rationale: `The mission has no recorded sources yet, so its outcome is not grounded enough to advance.`,
      inferredGoal: mission.intent,
      rankReasons: [
        decisionValue
          ? "Targets an unresolved evidence gap for a decision already in the Desk."
          : "Targets an unresolved evidence gap in active Research Desk work.",
        "Uses the mission record as a resolved evidence reference.",
      ],
      evidenceRefs: [evidence(mission.id, "mission", mission.title)],
    }));
  }

  for (const link of context.savedLinks) {
    const action = topicMissionAction(context.missions, link.title);
    const existing = action.target;
    candidates.push(candidate(fingerprint, context.reducedContext, {
      key: `saved-link:${link.id}`,
      priority: existing ? 2 : 4,
      recommendationKind: action.kind,
      topic: existing?.title ?? link.title,
      ...(existing ? { targetMissionId: existing.id } : { sourceId: link.id }),
      rationale: action.kind === "refine-mission"
        ? `This saved source matches active mission "${existing!.title}", so it should refine that mission rather than start a duplicate.`
        : action.kind === "review-mission"
          ? `This saved source matches "${existing!.title}", but that mission cannot be refined in its current lifecycle state. Review it instead of starting a duplicate.`
        : "This saved source supplies a concrete, unresolved topic for a new research mission.",
      inferredGoal: action.kind === "refine-mission"
        ? `Strengthen the evidence for ${existing!.title}.`
        : action.kind === "review-mission"
          ? `Review the existing work on ${existing!.title}.`
        : `Investigate the question raised by ${link.title}.`,
      rankReasons: [
        action.kind === "refine-mission"
          ? "Avoids duplicating an existing Research Desk mission."
          : action.kind === "review-mission"
            ? "Keeps the existing mission reviewable without bypassing its lifecycle boundary."
          : "Grounded in a saved source that is not yet represented by a mission.",
        "Ranks after unresolved active-mission evidence gaps.",
      ],
      evidenceRefs: [
        ...(existing ? [evidence(existing.id, "mission", existing.title)] : []),
        evidence(link.id, "saved-link", link.title),
      ],
    }));
  }

  for (const source of context.xSources) {
    const action = topicMissionAction(context.missions, source.note);
    const existing = action.target;
    candidates.push(candidate(fingerprint, context.reducedContext, {
      key: `x-source:${source.id}`,
      priority: existing ? 2 : 4,
      recommendationKind: action.kind,
      topic: existing?.title ?? source.note,
      ...(existing ? { targetMissionId: existing.id } : { sourceId: source.id }),
      rationale: action.kind === "refine-mission"
        ? `This X Article snapshot matches active mission "${existing!.title}", so it is a refine direction instead of a duplicate.`
        : action.kind === "review-mission"
          ? `This X Article snapshot matches "${existing!.title}", which cannot be refined in its current lifecycle state. Review it instead of starting a duplicate.`
        : "This durable X Article snapshot supplies a bounded, saved research direction.",
      inferredGoal: action.kind === "refine-mission"
        ? `Strengthen the evidence for ${existing!.title}.`
        : action.kind === "review-mission"
          ? `Review the existing work on ${existing!.title}.`
        : `Investigate the question captured in X Article ${source.postId}.`,
      rankReasons: [
        action.kind === "refine-mission"
          ? "Avoids duplicating an existing Research Desk mission."
          : action.kind === "review-mission"
            ? "Keeps the existing mission reviewable without bypassing its lifecycle boundary."
          : "Grounded in a durable X Article snapshot.",
        "Ranks after unresolved active-mission evidence gaps.",
      ],
      evidenceRefs: [
        ...(existing ? [evidence(existing.id, "mission", existing.title)] : []),
        evidence(source.id, "saved-link", `X Article ${source.postId}`),
      ],
    }));
  }

  const topicTokens = researchTopicTokens(context);
  for (const entry of [...context.vaultEntries].sort(
    (left, right) => vaultRelevance(right, topicTokens) - vaultRelevance(left, topicTokens)
      || left.id.localeCompare(right.id),
  )) {
    const action = topicMissionAction(context.missions, entry.title);
    const existing = action.target;
    const recommendationKind = existing ? action.kind : "add-to-prompt";
    candidates.push(candidate(fingerprint, context.reducedContext, {
      key: `vault:${entry.id}`,
      priority: existing ? 2 : 5,
      recommendationKind,
      topic: existing?.title ?? entry.title,
      ...(existing ? { targetMissionId: existing.id } : { sourceId: entry.id }),
      rationale: action.kind === "refine-mission"
        ? `This relevant Vault entry supports active mission "${existing!.title}", so it is a refine direction.`
        : action.kind === "review-mission"
          ? `This relevant Vault entry matches "${existing!.title}", which cannot be refined in its current lifecycle state. Review it instead.`
        : "This relevant Vault entry is durable context that can sharpen the next research prompt.",
      inferredGoal: action.kind === "refine-mission"
        ? `Strengthen the evidence for ${existing!.title}.`
        : action.kind === "review-mission"
          ? `Review the existing work on ${existing!.title}.`
        : `Use durable context from ${entry.title} before starting new work.`,
      rankReasons: [
        action.kind === "refine-mission"
          ? "Avoids duplicating an existing Research Desk mission."
          : action.kind === "review-mission"
            ? "Keeps the existing mission reviewable without bypassing its lifecycle boundary."
          : "Grounded in a relevant, bounded Vault entry.",
        "Ranks after active decision evidence gaps and saved Desk sources.",
      ],
      evidenceRefs: [
        ...(existing ? [evidence(existing.id, "mission", existing.title)] : []),
        evidence(entry.id, "vault", entry.title),
      ],
    }));
  }

  const deduplicated = new Map<string, Candidate>();
  for (const item of candidates) {
    if (item.recommendation.evidenceRefs.length === 0) continue;
    const existing = deduplicated.get(item.recommendation.id);
    if (!existing || item.priority < existing.priority || (
      item.priority === existing.priority && item.tieBreaker < existing.tieBreaker
    )) {
      deduplicated.set(item.recommendation.id, item);
    }
  }

  const ordered = [...deduplicated.values()]
    .sort((left, right) => left.priority - right.priority || left.tieBreaker.localeCompare(right.tieBreaker))
    .slice(0, MAX_RESEARCH_TOPIC_RECOMMENDATIONS)
    .map((item) => item.recommendation);

  return {
    recommendations: rankAgenticRecommendations(ordered),
    ...revision,
  };
}
