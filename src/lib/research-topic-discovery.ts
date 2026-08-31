// Cave-private Topic Discovery contracts (Unit 2, cave-6sles.11).
//
// Client-safe (no node:fs, no fetch). Mirrors the Unit 1 research-context-pack.ts
// style: version-pinned objects, strict allowlists, detached outputs. The
// portable job/proposal objects live in research-protocol/topic-discovery.ts;
// this module owns the Cave-side job-create input, the operational lease
// sidecar, the accept handoff draft, the budgets, and the pure evidence-
// resolution + id-mapping helpers the runner and store share.

import {
  fail,
  isOpaqueId,
  isRecord,
  isSha256,
  isUtcTimestamp,
  pass,
  type ProtocolParseResult,
  type UnknownFields,
} from "./research-protocol/common.ts";
import {
  type ContextPackResourceV1,
  type ContextSelectorV1,
} from "./research-protocol/context-pack.ts";
import { canonicalJson, sha256Digest } from "./research-protocol/digest.ts";
import type { TopicProposalV1 } from "./research-protocol/topic-discovery.ts";

// ── Budget constants (single source of truth) ───────────────────────────────

export const TOPIC_DISCOVERY_BUDGET = {
  maxCandidateTopics: 20, // design §10.1 "up to 20"
  minProposals: 3, // parser-enforced for completed jobs
  maxProposals: 7,
  maxPackResources: 100, // normalize stage bound
  maxResourceWindowBytes: 16 * 1024, // per-resource excerpt window
  maxMissionMetadataItems: 12, // matches MAX_RESEARCH_TOPIC_MISSIONS
  maxMissionSummaryBytes: 8 * 1024,
  maxInputBytes: 96 * 1024, // total model input (pack windows + missions + instruction)
  maxOutputBytes: 48 * 1024, // total model output (raw JSON)
  maxExcerptChars: 512, // matches preview finding excerpt cap
} as const;

// ── Job create input (API/UI → runner) ──────────────────────────────────────

export type TopicDiscoveryJobCreateInputV1 = {
  version: 1;
  contextPackId: string; // ^ctx_… (validated against the pack store)
  familiarId: string; // 1..=64 chars (mirror selection.familiarId)
} & UnknownFields;

// ── Operational lease sidecar (Cave-private, excluded from backup) ──────────

export type TopicDiscoveryJobStateV1 = {
  version: 1;
  owner: string;
  attempt: number;
  leaseExpiresAt: string;
} & UnknownFields;

// ── Accept handoff draft (proposal → composer) ──────────────────────────────

const SUGGESTED_MODES = ["brief", "sweep", "paper", "autoresearch"] as const;

export type TopicProposalDraftV1 = {
  version: 1;
  proposalId: string; // proposal_…
  contextPackId: string; // ctx_…
  contextPackDigest: string; // lowercase sha256
  title: string; // proposal.title (bounded copy)
  question: string; // proposal.question (bounded copy)
  mode: TopicProposalV1["suggested"]["mode"]; // brief|sweep|paper|autoresearch
  deliverable: string;
  sourceTarget: number;
  wallClockMinutes: number;
  relatedMissionIds: string[]; // LOCAL ids (portable → local, resolved server-side)
} & UnknownFields;

// ── Normalize-stage window (runner-internal, typed here for tests) ──────────

export type DiscoveryResourceWindowV1 = {
  resourceId: string; // portable resource_… id from the pack
  selector: Extract<ContextSelectorV1, { type: "text-span" } | { type: "whole-resource" }>;
  text: string; // utf8(bytes[selector]) — bounded
  kind: ContextPackResourceV1["kind"];
  trust: ContextPackResourceV1["trust"];
  sensitivity: ContextPackResourceV1["sensitivity"];
  title?: string;
};

// ── Local ↔ portable mission id mapping (pure, round-trippable) ─────────────

// Local ResearchMission.id -> portable proposal relatedMissionIds entry.
// Local ids are already ^[a-z0-9][a-z0-9-]{0,63}$ (research-missions.ts), so
// "mission_" + id satisfies the portable ^mission_[A-Za-z0-9_-]+$ grammar.
const LOCAL_MISSION_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function portableMissionId(localMissionId: string): string {
  if (!LOCAL_MISSION_ID_RE.test(localMissionId)) {
    throw new TypeError(
      `portableMissionId requires a local mission id matching ^[a-z0-9][a-z0-9-]{0,63}$`,
    );
  }
  return `mission_${localMissionId}`;
}

export function localMissionIdFromPortable(portableId: string): string | null {
  if (typeof portableId !== "string" || !portableId.startsWith("mission_")) return null;
  const local = portableId.slice("mission_".length);
  return LOCAL_MISSION_ID_RE.test(local) ? local : null;
}

// ── Evidence resolution — THE hard gate ─────────────────────────────────────

export type EvidenceResolution =
  | { ok: true; resourceId: string; selector: ContextSelectorV1; excerpt: string; excerptDigest: string }
  | {
      ok: false;
      code:
        | "unknown-resource"
        | "unsupported-selector"
        | "range-out-of-bounds"
        | "excerpt-mismatch"
        | "digest-mismatch";
      message: string;
    };

// Resolve one evidence ref against a digest-verified pack blob (Uint8Array).
export function resolveEvidence(
  resourceId: string,
  selector: ContextSelectorV1,
  excerpt: string,
  excerptDigest: string,
  resourcesById: ReadonlyMap<string, ContextPackResourceV1>,
  blobsById: ReadonlyMap<string, Uint8Array>,
): EvidenceResolution {
  if (!resourcesById.has(resourceId)) {
    return {
      ok: false,
      code: "unknown-resource",
      message: `resource ${resourceId} is not present in the pack`,
    };
  }
  const blob = blobsById.get(resourceId);
  if (blob === undefined) {
    return {
      ok: false,
      code: "unknown-resource",
      message: `resource ${resourceId} has no verified blob`,
    };
  }

  if (selector.type === "whole-resource") {
    if (blob.byteLength > TOPIC_DISCOVERY_BUDGET.maxExcerptChars) {
      return {
        ok: false,
        code: "range-out-of-bounds",
        message: `whole-resource excerpt exceeds the ${TOPIC_DISCOVERY_BUDGET.maxExcerptChars} character cap`,
      };
    }
    const decoded = new TextDecoder().decode(blob);
    if (decoded !== excerpt) {
      return {
        ok: false,
        code: "excerpt-mismatch",
        message: "whole-resource excerpt does not equal the decoded blob",
      };
    }
    if (sha256Digest(new TextEncoder().encode(excerpt)) !== excerptDigest) {
      return {
        ok: false,
        code: "digest-mismatch",
        message: "excerpt digest does not match the excerpt bytes",
      };
    }
    return { ok: true, resourceId, selector, excerpt, excerptDigest };
  }

  if (selector.type !== "text-span") {
    return {
      ok: false,
      code: "unsupported-selector",
      message: `selector type ${selector.type} is not supported over a Unit 1 pack blob`,
    };
  }

  if (selector.start < 0 || selector.start >= selector.end || selector.end > blob.byteLength) {
    return {
      ok: false,
      code: "range-out-of-bounds",
      message: `text-span ${selector.start}..${selector.end} is out of bounds for a ${blob.byteLength}-byte blob`,
    };
  }

  const decoded = new TextDecoder().decode(blob.subarray(selector.start, selector.end));
  if (decoded !== excerpt) {
    return {
      ok: false,
      code: "excerpt-mismatch",
      message: "excerpt does not equal the selected blob bytes",
    };
  }
  if (sha256Digest(new TextEncoder().encode(excerpt)) !== excerptDigest) {
    return {
      ok: false,
      code: "digest-mismatch",
      message: "excerpt digest does not match the excerpt bytes",
    };
  }
  return { ok: true, resourceId, selector, excerpt, excerptDigest };
}

// ── Deterministic dedupe/diversity key ──────────────────────────────────────

export function proposalDedupeKey(title: string, question: string): string {
  const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");
  return sha256Digest(canonicalJson([normalize(title), normalize(question)]));
}

// ── Parsers ─────────────────────────────────────────────────────────────────

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function parseBoundedText(
  value: unknown,
  path: string,
  label: string,
  maxChars: number,
): ProtocolParseResult<string> {
  if (typeof value !== "string" || value.length === 0 || value.length > maxChars) {
    return fail("invalid_value", path, `${label} must be a 1..=${maxChars} character string`);
  }
  return pass(value);
}

export function parseTopicDiscoveryJobCreateInputV1(
  value: unknown,
): ProtocolParseResult<TopicDiscoveryJobCreateInputV1> {
  if (!isRecord(value)) return fail("invalid_type", "job", "Expected an object");
  if (value.version !== 1) return fail("unknown_major", "job.version", "version must be 1");
  if (typeof value.contextPackId !== "string" || !isOpaqueId(value.contextPackId, "ctx")) {
    return fail("invalid_value", "job.contextPackId", "contextPackId must match ctx_…");
  }
  const familiarId = parseBoundedText(value.familiarId, "job.familiarId", "familiarId", 64);
  if (!familiarId.ok) return familiarId;
  return pass({
    version: 1,
    contextPackId: value.contextPackId,
    familiarId: familiarId.value,
  });
}

export function parseTopicDiscoveryJobStateV1(
  value: unknown,
): ProtocolParseResult<TopicDiscoveryJobStateV1> {
  if (!isRecord(value)) return fail("invalid_type", "state", "Expected an object");
  if (value.version !== 1) return fail("unknown_major", "state.version", "version must be 1");
  const owner = parseBoundedText(value.owner, "state.owner", "owner", 128);
  if (!owner.ok) return owner;
  if (typeof value.attempt !== "number" || !Number.isSafeInteger(value.attempt) || value.attempt < 1) {
    return fail("invalid_value", "state.attempt", "attempt must be a positive integer");
  }
  if (typeof value.leaseExpiresAt !== "string" || !isUtcTimestamp(value.leaseExpiresAt)) {
    return fail("invalid_value", "state.leaseExpiresAt", "leaseExpiresAt must be a UTC RFC 3339 timestamp");
  }
  return pass({
    version: 1,
    owner: owner.value,
    attempt: value.attempt,
    leaseExpiresAt: value.leaseExpiresAt,
  });
}

export function parseTopicProposalDraftV1(
  value: unknown,
): ProtocolParseResult<TopicProposalDraftV1> {
  if (!isRecord(value)) return fail("invalid_type", "draft", "Expected an object");
  if (value.version !== 1) return fail("unknown_major", "draft.version", "version must be 1");
  if (typeof value.proposalId !== "string" || !isOpaqueId(value.proposalId, "proposal")) {
    return fail("invalid_value", "draft.proposalId", "proposalId must match proposal_…");
  }
  if (typeof value.contextPackId !== "string" || !isOpaqueId(value.contextPackId, "ctx")) {
    return fail("invalid_value", "draft.contextPackId", "contextPackId must match ctx_…");
  }
  if (typeof value.contextPackDigest !== "string" || !isSha256(value.contextPackDigest)) {
    return fail("invalid_value", "draft.contextPackDigest", "contextPackDigest must be a lowercase SHA-256 digest");
  }
  const title = parseBoundedText(value.title, "draft.title", "title", 512);
  if (!title.ok) return title;
  const question = parseBoundedText(value.question, "draft.question", "question", 4096);
  if (!question.ok) return question;
  if (
    typeof value.mode !== "string" ||
    !(SUGGESTED_MODES as readonly string[]).includes(value.mode)
  ) {
    return fail("invalid_value", "draft.mode", `mode must be one of ${SUGGESTED_MODES.join(", ")}`);
  }
  const deliverable = parseBoundedText(value.deliverable, "draft.deliverable", "deliverable", 512);
  if (!deliverable.ok) return deliverable;
  if (
    typeof value.sourceTarget !== "number" ||
    !Number.isSafeInteger(value.sourceTarget) ||
    value.sourceTarget < 1
  ) {
    return fail("invalid_value", "draft.sourceTarget", "sourceTarget must be a positive integer");
  }
  if (
    typeof value.wallClockMinutes !== "number" ||
    !Number.isSafeInteger(value.wallClockMinutes) ||
    value.wallClockMinutes < 1
  ) {
    return fail("invalid_value", "draft.wallClockMinutes", "wallClockMinutes must be a positive integer");
  }
  if (!Array.isArray(value.relatedMissionIds)) {
    return fail("invalid_type", "draft.relatedMissionIds", "relatedMissionIds must be an array");
  }
  const relatedMissionIds: string[] = [];
  for (let index = 0; index < value.relatedMissionIds.length; index += 1) {
    const id = value.relatedMissionIds[index];
    if (typeof id !== "string" || !LOCAL_MISSION_ID_RE.test(id)) {
      return fail(
        "invalid_value",
        `draft.relatedMissionIds[${index}]`,
        "relatedMissionIds items must be local mission ids",
      );
    }
    relatedMissionIds.push(id);
  }
  return pass({
    version: 1,
    proposalId: value.proposalId,
    contextPackId: value.contextPackId,
    contextPackDigest: value.contextPackDigest,
    title: title.value,
    question: question.value,
    mode: value.mode as TopicProposalDraftV1["mode"],
    deliverable: deliverable.value,
    sourceTarget: value.sourceTarget,
    wallClockMinutes: value.wallClockMinutes,
    relatedMissionIds,
  });
}

export { hasOwn };
