import { createHash } from "node:crypto";

type RawRecord = Record<string, unknown>;

export type ProposalApprovalPathVariantView =
  | "auto-regression"
  | "familiar-coherence"
  | "human-approval"
  | "human-approval-with-rationale";

export type ProposalLifecycleView = "awaiting-human-approval" | "veto-window-open" | "ready-for-replay" | "blocked";

export type ProposalAuthorityBlockedWhy =
  | "daemon-unavailable"
  | "daemon-proposal-missing"
  | "daemon-unparseable"
  | "daemon-mismatch"
  | "unknown-lifecycle";

export type ProposalAuthorityVerifiedView = {
  state: "verified";
  proposalRevision: string;
  familiarUuid: string;
  approvalPath: {
    variant: ProposalApprovalPathVariantView;
    label: string;
    vetoDeadline: string | null;
    affectedSurfaces: string[];
  };
  lifecycle: ProposalLifecycleView;
  blockedReason: string | null;
  earliestClose: string | null;
  affectedRegions: string[];
  availableDecisions: Array<"approve" | "reject">;
};

export type ProposalAuthorityLegacyView = {
  state: "legacy";
  reviewKind: "authority";
};

export type ProposalAuthorityBlockedView = {
  state: "blocked";
  why: ProposalAuthorityBlockedWhy;
};

export type ProposalAuthorityView = ProposalAuthorityVerifiedView | ProposalAuthorityLegacyView | ProposalAuthorityBlockedView;

type ProposalPayloadLike = {
  id: string;
  familiarId?: string;
  familiarUuid?: string | null;
  writer: string;
  edits: Array<{ surface: string }>;
};

type DaemonProposalSummary = {
  proposalId: string;
  familiarUuid: string;
  writer: string;
  stagedAt: string;
  targets: string[];
  proposalRevision: string;
  approvalPath: ProposalAuthorityVerifiedView["approvalPath"];
  lifecycle: ProposalLifecycleView;
  blockedReason: string | null;
  earliestClose: string | null;
  affectedRegions: string[];
};

const APPROVAL_PATH_VARIANTS = new Map<string, ProposalApprovalPathVariantView>([
  ["auto_regression", "auto-regression"],
  ["familiar_coherence", "familiar-coherence"],
  ["human_approval", "human-approval"],
  ["human_approval_with_rationale", "human-approval-with-rationale"],
]);

const LIFECYCLE_VALUES = new Map<string, ProposalLifecycleView>([
  ["awaiting_human_approval", "awaiting-human-approval"],
  ["veto_window_open", "veto-window-open"],
  ["ready_for_replay", "ready-for-replay"],
  ["blocked", "blocked"],
]);

const DAEMON_SUMMARY_FIELDS = new Set([
  "proposalId",
  "familiarId",
  "familiarUuid",
  "writer",
  "stagedAt",
  "targets",
  "proposalRevision",
  "approvalPath",
  "lifecycle",
  "blockedReason",
  "earliestClose",
  "affectedRegions",
]);
const PHASE5_DAEMON_SUMMARY_FIELDS = new Set([
  "familiarUuid",
  "familiar_uuid",
  "proposalRevision",
  "proposal_revision",
  "approvalPath",
  "lifecycle",
  "blockedReason",
  "earliestClose",
  "affectedRegions",
]);
const APPROVAL_PATH_FIELDS = new Set(["variant", "label", "veto_deadline", "affected_surfaces"]);
const SCHEDULED_ENVELOPE_FIELDS = [
  "schema",
  "pending",
  "classification",
  "materialized_diff",
  "region_evidence",
  "lifecycle",
  "staged_at",
  "veto_deadline",
  "earliest_close",
] as const;
const SCHEDULED_ENVELOPE_ALLOWED_FIELDS = new Set([
  ...SCHEDULED_ENVELOPE_FIELDS,
  "decisionRequest",
  "decisionState",
]);
const PENDING_FIELDS = [
  "id",
  "familiar_id",
  "writer",
  "channel",
  "thread_id",
  "fray",
  "edits",
  "staged_at",
] as const;
const CLASSIFICATION_FIELDS = [
  "proposal_id",
  "familiar_id",
  "channel",
  "affected_surfaces",
  "affected_regions",
  "path_tier_floor",
  "approval_path",
  "evidence_replay_hash",
  "classified_at",
] as const;
const PENDING_EDIT_FIELDS = ["surface", "contents"] as const;
const STAGED_CONTENTS_FIELDS = ["encoding", "data"] as const;
const VETO_WINDOW_FIELDS = ["duration", "min_visible"] as const;
const DURATION_FIELDS = ["secs", "nanos"] as const;
const MATERIALIZED_DIFF_FIELDS = ["surfaces"] as const;
const MATERIALIZED_SURFACE_FIELDS = ["surface", "before", "after"] as const;
const REGION_EVIDENCE_FIELDS = [
  "region_id",
  "affected_surfaces",
  "min_path_tier",
  "replay_bytes",
  "rationale",
] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_64_RE = /^[0-9a-f]{64}$/;
const RFC3339_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasOnlyKeys(source: RawRecord, allowed: Set<string>): boolean {
  return Object.keys(source).every((key) => allowed.has(key));
}

function hasRequiredKeys(source: RawRecord, required: readonly string[]): boolean {
  return required.every((key) => key in source);
}

function hasExactKeys(source: RawRecord, expected: readonly string[]): boolean {
  return Object.keys(source).length === expected.length && hasRequiredKeys(source, expected);
}

function compareStrings(a: string, b: string): number {
  const left = Array.from(a, (character) => character.codePointAt(0)!);
  const right = Array.from(b, (character) => character.codePointAt(0)!);
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return left.length < right.length ? -1 : left.length > right.length ? 1 : 0;
}

function normalizeCanonicalUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const lower = value.toLowerCase();
  return UUID_RE.test(lower) ? lower : null;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isStrictRfc3339(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = RFC3339_RE.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offset] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }
  if (offset !== "Z") {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return true;
}

function padNumber(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function canonicalRfc3339(value: unknown): string | null {
  if (!isStrictRfc3339(value)) return null;
  const match = RFC3339_RE.exec(value)!;
  const [, year, month, day, hour, minute, second, fraction, rawOffset] = match;
  const canonicalFraction = fraction?.replace(/0+$/, "");
  const offset = rawOffset === "+00:00" || rawOffset === "-00:00" ? "Z" : rawOffset;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${
    canonicalFraction ? `.${canonicalFraction}` : ""
  }${offset}`;
}

function ordinalToMonthDay(year: number, ordinal: number): [number, number] | null {
  const maxOrdinal = isLeapYear(year) ? 366 : 365;
  if (ordinal < 1 || ordinal > maxOrdinal) return null;
  let remaining = ordinal;
  for (let month = 1; month <= 12; month += 1) {
    const days = daysInMonth(year, month);
    if (remaining <= days) return [month, remaining];
    remaining -= days;
  }
  return null;
}

function canonicalStagedInstant(value: unknown): string | null {
  if (typeof value === "string") return canonicalRfc3339(value);
  if (!Array.isArray(value) || value.length !== 9 || !value.every(Number.isInteger)) return null;
  const [year, ordinal, hour, minute, second, nanosecond, offsetHour, offsetMinute, offsetSecond] = value;
  const monthDay = ordinalToMonthDay(year, ordinal);
  if (
    year < 0 ||
    year > 9999 ||
    !monthDay ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59 ||
    nanosecond < 0 ||
    nanosecond > 999_999_999 ||
    Math.abs(offsetHour) > 23 ||
    Math.abs(offsetMinute) > 59 ||
    offsetSecond !== 0
  ) {
    return null;
  }
  const offsetParts = [offsetHour, offsetMinute].filter((part) => part !== 0);
  if (offsetParts.some((part) => part < 0) && offsetParts.some((part) => part > 0)) return null;

  const [month, day] = monthDay;
  const fraction = nanosecond === 0 ? "" : `.${padNumber(nanosecond, 9).replace(/0+$/, "")}`;
  const offset =
    offsetHour === 0 && offsetMinute === 0
      ? "Z"
      : `${offsetParts.some((part) => part < 0) ? "-" : "+"}${padNumber(Math.abs(offsetHour), 2)}:${padNumber(
          Math.abs(offsetMinute),
          2,
        )}`;
  return `${padNumber(year, 4)}-${padNumber(month, 2)}-${padNumber(day, 2)}T${padNumber(hour, 2)}:${padNumber(
    minute,
    2,
  )}:${padNumber(second, 2)}${fraction}${offset}`;
}

function isByteArray(value: unknown, length?: number): value is number[] {
  return (
    Array.isArray(value) &&
    (length === undefined || value.length === length) &&
    Array.from(value).every((item) => Number.isInteger(item) && item >= 0 && item <= 255)
  );
}

function isNullableByteArray(value: unknown): boolean {
  return value === null || isByteArray(value);
}

function isNullableStagedInstant(value: unknown): boolean {
  return value === null || canonicalStagedInstant(value) !== null;
}

function isDurationShape(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, DURATION_FIELDS)) return false;
  return (
    Number.isSafeInteger(value.secs) &&
    Number(value.secs) >= 0 &&
    Number.isInteger(value.nanos) &&
    Number(value.nanos) >= 0 &&
    Number(value.nanos) < 1_000_000_000
  );
}

function isDurationAtMost(left: RawRecord, right: RawRecord): boolean {
  const leftSecs = Number(left.secs);
  const rightSecs = Number(right.secs);
  return leftSecs < rightSecs || (leftSecs === rightSecs && Number(left.nanos) <= Number(right.nanos));
}

function isVetoWindowShape(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, VETO_WINDOW_FIELDS) ||
    !isDurationShape(value.duration) ||
    !isDurationShape(value.min_visible)
  ) {
    return false;
  }
  return isDurationAtMost(value.min_visible as RawRecord, value.duration as RawRecord);
}

function isApprovalPathShape(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "auto_regression":
      return hasExactKeys(value, ["kind", "veto"]) && (value.veto === null || isVetoWindowShape(value.veto));
    case "familiar_coherence":
      return hasExactKeys(value, ["kind", "veto"]) && isVetoWindowShape(value.veto);
    case "human_approval":
    case "human_approval_with_rationale":
      return hasExactKeys(value, ["kind"]);
    default:
      return false;
  }
}

function isFrayShape(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).length !== 1) return false;
  if (isRecord(value.NotCovered)) {
    return hasExactKeys(value.NotCovered, ["channel"]) && typeof value.NotCovered.channel === "string";
  }
  if (isRecord(value.Frayed)) {
    return (
      hasExactKeys(value.Frayed, ["strand", "channel", "reason"]) &&
      (value.Frayed.strand === null || typeof value.Frayed.strand === "string") &&
      typeof value.Frayed.channel === "string"
    );
  }
  if (isRecord(value.Snapped)) {
    return hasExactKeys(value.Snapped, ["channel", "reason"]) && typeof value.Snapped.channel === "string";
  }
  return false;
}

function isStagedContentsShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, STAGED_CONTENTS_FIELDS) &&
    (value.encoding === "utf8" || value.encoding === "base64") &&
    typeof value.data === "string"
  );
}

function isPendingShape(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, PENDING_FIELDS) || !Array.isArray(value.edits)) return false;
  if (
    typeof value.id !== "string" ||
    typeof value.familiar_id !== "string" ||
    typeof value.writer !== "string" ||
    typeof value.channel !== "string" ||
    typeof value.thread_id !== "string" ||
    !isFrayShape(value.fray) ||
    canonicalStagedInstant(value.staged_at) === null
  ) {
    return false;
  }
  return Array.from(value.edits).every(
    (edit) =>
      isRecord(edit) &&
      hasExactKeys(edit, PENDING_EDIT_FIELDS) &&
      typeof edit.surface === "string" &&
      isStagedContentsShape(edit.contents),
  );
}

function isClassificationShape(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, CLASSIFICATION_FIELDS)) return false;
  return (
    typeof value.proposal_id === "string" &&
    typeof value.familiar_id === "string" &&
    typeof value.channel === "string" &&
    isStringArray(value.affected_surfaces) &&
    isStringArray(value.affected_regions) &&
    Number.isInteger(value.path_tier_floor) &&
    Number(value.path_tier_floor) >= 0 &&
    Number(value.path_tier_floor) <= 255 &&
    isApprovalPathShape(value.approval_path) &&
    isByteArray(value.evidence_replay_hash, 32) &&
    canonicalStagedInstant(value.classified_at) !== null
  );
}

function isMaterializedDiffShape(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, MATERIALIZED_DIFF_FIELDS) || !Array.isArray(value.surfaces)) {
    return false;
  }
  return Array.from(value.surfaces).every(
    (surface) =>
      isRecord(surface) &&
      hasExactKeys(surface, MATERIALIZED_SURFACE_FIELDS) &&
      typeof surface.surface === "string" &&
      isNullableByteArray(surface.before) &&
      isNullableByteArray(surface.after),
  );
}

function isRegionEvidenceShape(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return Array.from(value).every(
    (evidence) =>
      isRecord(evidence) &&
      hasExactKeys(evidence, REGION_EVIDENCE_FIELDS) &&
      typeof evidence.region_id === "string" &&
      isStringArray(evidence.affected_surfaces) &&
      Number.isInteger(evidence.min_path_tier) &&
      Number(evidence.min_path_tier) >= 0 &&
      Number(evidence.min_path_tier) <= 255 &&
      isByteArray(evidence.replay_bytes) &&
      typeof evidence.rationale === "string",
  );
}

function isLifecycleShape(value: unknown): boolean {
  if (!isRecord(value) || typeof value.state !== "string") return false;
  switch (value.state) {
    case "awaiting_human_approval":
    case "veto_window_open":
    case "ready_for_replay":
      return hasExactKeys(value, ["state"]);
    case "blocked":
      return (
        hasExactKeys(value, ["state", "reason"]) &&
        typeof value.reason === "string" &&
        value.reason.trim() !== ""
      );
    default:
      return false;
  }
}

function hasConsistentScheduledEnvelopeBindings(raw: RawRecord): boolean {
  if (!isRecord(raw.pending) || !isRecord(raw.classification)) return false;
  const pendingStagedAt = canonicalStagedInstant(raw.pending.staged_at);
  const classifiedAt = canonicalStagedInstant(raw.classification.classified_at);
  const envelopeStagedAt = canonicalStagedInstant(raw.staged_at);
  return (
    raw.classification.proposal_id === raw.pending.id &&
    raw.classification.familiar_id === raw.pending.familiar_id &&
    raw.classification.channel === raw.pending.channel &&
    classifiedAt !== null &&
    classifiedAt === pendingStagedAt &&
    classifiedAt === envelopeStagedAt
  );
}

function isCompleteScheduledEnvelope(raw: RawRecord): boolean {
  return (
    hasRequiredKeys(raw, SCHEDULED_ENVELOPE_FIELDS) &&
    hasOnlyKeys(raw, SCHEDULED_ENVELOPE_ALLOWED_FIELDS) &&
    raw.schema === "phase5_v1" &&
    isPendingShape(raw.pending) &&
    isClassificationShape(raw.classification) &&
    isMaterializedDiffShape(raw.materialized_diff) &&
    isRegionEvidenceShape(raw.region_evidence) &&
    isLifecycleShape(raw.lifecycle) &&
    canonicalStagedInstant(raw.staged_at) !== null &&
    isNullableStagedInstant(raw.veto_deadline) &&
    isNullableStagedInstant(raw.earliest_close) &&
    hasConsistentScheduledEnvelopeBindings(raw)
  );
}

function daemonIso(value: unknown): string | null {
  return isStrictRfc3339(value) ? value : null;
}

function daemonNullableIso(value: unknown): { valid: boolean; value: string | null } {
  if (value === null) return { valid: true, value: null };
  const normalized = daemonIso(value);
  return { valid: normalized !== null, value: normalized };
}

function serializeCanonicalJson(value: unknown, root = true): string | undefined {
  if (Array.isArray(value)) {
    const entries = Array.from(value, (item) => serializeCanonicalJson(item, false) ?? "null");
    return `[${entries.join(",")}]`;
  }
  if (!isRecord(value)) return JSON.stringify(value);

  const members: string[] = [];
  const keys = Object.keys(value)
    .filter((key) => !root || (key !== "decisionRequest" && key !== "decisionState"))
    .sort(compareStrings);
  for (const key of keys) {
    const child = serializeCanonicalJson(value[key], false);
    if (child !== undefined) members.push(`${JSON.stringify(key)}:${child}`);
  }
  return `{${members.join(",")}}`;
}

function canonicalStringSet(values: string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function sameStringSet(left: string[], right: string[]): boolean {
  const normalizedLeft = canonicalStringSet(left);
  const normalizedRight = canonicalStringSet(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function findPendingCandidate(raw: RawRecord): RawRecord {
  return isRecord(raw.pending) ? raw.pending : raw;
}

function normalizePayloadLike(raw: unknown): ProposalPayloadLike | null {
  if (!isRecord(raw)) return null;
  const candidate = findPendingCandidate(raw);
  const id = typeof candidate.id === "string" ? candidate.id : null;
  const writer = typeof candidate.writer === "string" ? candidate.writer : null;
  if (!id || !writer || !Array.isArray(candidate.edits)) return null;
  const edits: Array<{ surface: string }> = [];
  for (const edit of candidate.edits) {
    if (!isRecord(edit) || typeof edit.surface !== "string") return null;
    edits.push({ surface: edit.surface });
  }
  return {
    id,
    familiarUuid: normalizeCanonicalUuid(candidate.familiar_id ?? candidate.familiarUuid),
    writer,
    edits,
  };
}

function hasScheduledEnvelopeMarkers(raw: RawRecord): boolean {
  return [
    "schema",
    "pending",
    "classification",
    "materialized_diff",
    "region_evidence",
    "lifecycle",
    "veto_deadline",
    "earliest_close",
  ].some((field) => field in raw);
}

function hasDaemonPhase5Markers(raw: RawRecord): boolean {
  return Object.keys(raw).some((field) => PHASE5_DAEMON_SUMMARY_FIELDS.has(field));
}

function normalizeApprovalPath(source: RawRecord): ProposalAuthorityVerifiedView["approvalPath"] | null {
  if (!hasOnlyKeys(source, APPROVAL_PATH_FIELDS)) return null;
  if (
    typeof source.variant !== "string" ||
    typeof source.label !== "string" ||
    !("veto_deadline" in source) ||
    !isStringArray(source.affected_surfaces)
  ) {
    return null;
  }
  const variant = APPROVAL_PATH_VARIANTS.get(source.variant);
  if (!variant) return null;
  const vetoDeadline = daemonNullableIso(source.veto_deadline);
  if (!vetoDeadline.valid) return null;
  return {
    variant,
    label: source.label,
    vetoDeadline: vetoDeadline.value,
    affectedSurfaces: source.affected_surfaces,
  };
}

function normalizeDaemonSummary(raw: RawRecord): DaemonProposalSummary | null {
  if (!hasOnlyKeys(raw, DAEMON_SUMMARY_FIELDS)) return null;
  if (
    typeof raw.proposalId !== "string" ||
    typeof raw.familiarId !== "string" ||
    typeof raw.writer !== "string" ||
    typeof raw.proposalRevision !== "string" ||
    !HEX_64_RE.test(raw.proposalRevision) ||
    !isStringArray(raw.targets) ||
    !isStringArray(raw.affectedRegions) ||
    !isRecord(raw.approvalPath) ||
    typeof raw.lifecycle !== "string" ||
    !("earliestClose" in raw)
  ) {
    return null;
  }
  const familiarUuid = normalizeCanonicalUuid(raw.familiarUuid);
  const stagedAt = daemonIso(raw.stagedAt);
  const approvalPath = normalizeApprovalPath(raw.approvalPath);
  const lifecycle = LIFECYCLE_VALUES.get(raw.lifecycle);
  const earliestClose = daemonNullableIso(raw.earliestClose);
  if (!familiarUuid || !stagedAt || !approvalPath || !lifecycle || !earliestClose.valid) return null;

  const blockedReason = raw.blockedReason;
  if (blockedReason !== undefined && blockedReason !== null && typeof blockedReason !== "string") return null;

  return {
    proposalId: raw.proposalId,
    familiarUuid,
    writer: raw.writer,
    stagedAt,
    targets: raw.targets,
    proposalRevision: raw.proposalRevision,
    approvalPath,
    lifecycle,
    blockedReason: typeof blockedReason === "string" ? blockedReason : null,
    earliestClose: earliestClose.value,
    affectedRegions: raw.affectedRegions,
  };
}

function normalizeAvailableDecisions(
  summary: DaemonProposalSummary,
): Array<"approve" | "reject"> | null {
  const { approvalPath, lifecycle } = summary;
  switch (lifecycle) {
    case "awaiting-human-approval":
      return approvalPath.variant === "human-approval" ||
        approvalPath.variant === "human-approval-with-rationale"
        ? ["approve", "reject"]
        : null;
    case "veto-window-open":
      return approvalPath.vetoDeadline !== null ? ["reject"] : null;
    case "ready-for-replay":
    case "blocked":
      return [];
    default:
      return null;
  }
}

function stagedTargetSet(payload: ProposalPayloadLike): string[] {
  return payload.edits.map((edit) => edit.surface);
}

function normalizeVerifiedAuthority(
  stagedEnvelope: RawRecord,
  payload: ProposalPayloadLike,
  daemonSummary: DaemonProposalSummary,
  availableDecisions: Array<"approve" | "reject">,
): ProposalAuthorityView | null {
  const stagedFamiliarUuid = normalizeCanonicalUuid(payload.familiarUuid ?? payload.familiarId);
  if (!stagedFamiliarUuid || daemonSummary.familiarUuid !== stagedFamiliarUuid) return null;
  if (daemonSummary.proposalId !== payload.id || daemonSummary.writer !== payload.writer) return null;

  const envelopeStagedAt = canonicalStagedInstant(stagedEnvelope.staged_at);
  const pendingStagedAt = canonicalStagedInstant(findPendingCandidate(stagedEnvelope).staged_at);
  if (
    !envelopeStagedAt ||
    !pendingStagedAt ||
    pendingStagedAt !== envelopeStagedAt ||
    daemonSummary.stagedAt !== envelopeStagedAt
  ) {
    return null;
  }

  const targets = stagedTargetSet(payload);
  if (!sameStringSet(targets, daemonSummary.targets)) return null;
  if (!sameStringSet(targets, daemonSummary.approvalPath.affectedSurfaces)) return null;
  if (canonicalProposalRevision(stagedEnvelope) !== daemonSummary.proposalRevision) return null;

  return {
    state: "verified",
    proposalRevision: daemonSummary.proposalRevision,
    familiarUuid: daemonSummary.familiarUuid,
    approvalPath: daemonSummary.approvalPath,
    lifecycle: daemonSummary.lifecycle,
    blockedReason: daemonSummary.blockedReason,
    earliestClose: daemonSummary.earliestClose,
    affectedRegions: daemonSummary.affectedRegions,
    availableDecisions,
  };
}

function blocked(why: ProposalAuthorityBlockedWhy): ProposalAuthorityBlockedView {
  return { state: "blocked", why };
}

export function canonicalProposalRevision(input: unknown): string {
  const json = serializeCanonicalJson(input) ?? "null";
  return createHash("sha256").update(json, "utf8").digest("hex");
}

export function normalizeProposalAuthority(
  stagedRaw: unknown,
  daemonRaw?: unknown,
  payloadOverride?: ProposalPayloadLike | null,
): ProposalAuthorityView {
  if (payloadOverride === null || !isRecord(stagedRaw)) return blocked("daemon-unparseable");
  const payload = payloadOverride ?? normalizePayloadLike(stagedRaw);
  if (!payload) return blocked("daemon-unparseable");

  const scheduled = hasScheduledEnvelopeMarkers(stagedRaw);
  if (!scheduled) return { state: "legacy", reviewKind: "authority" };
  if (!isCompleteScheduledEnvelope(stagedRaw)) return blocked("daemon-mismatch");

  if (daemonRaw === undefined) return blocked("daemon-proposal-missing");
  if (daemonRaw === null) return blocked("daemon-unavailable");
  if (!isRecord(daemonRaw)) return blocked("daemon-unparseable");
  if (!hasDaemonPhase5Markers(daemonRaw)) return blocked("daemon-proposal-missing");

  const unknownLifecycle = hasUnknownDaemonLifecycle(daemonRaw);
  const daemonSummary = normalizeDaemonSummary(daemonRaw);
  if (!daemonSummary) return blocked(unknownLifecycle ? "unknown-lifecycle" : "daemon-unparseable");
  const availableDecisions = normalizeAvailableDecisions(daemonSummary);
  if (availableDecisions === null) return blocked("unknown-lifecycle");

  return normalizeVerifiedAuthority(stagedRaw, payload, daemonSummary, availableDecisions) ?? blocked("daemon-mismatch");
}

function hasUnknownDaemonLifecycle(raw: RawRecord): boolean {
  let candidate = raw;
  let hasUnknownValue = false;
  if (
    isRecord(raw.approvalPath) &&
    typeof raw.approvalPath.variant === "string" &&
    !APPROVAL_PATH_VARIANTS.has(raw.approvalPath.variant)
  ) {
    candidate = {
      ...candidate,
      approvalPath: { ...raw.approvalPath, variant: "human_approval" },
    };
    hasUnknownValue = true;
  }
  if (typeof raw.lifecycle === "string" && !LIFECYCLE_VALUES.has(raw.lifecycle)) {
    candidate = { ...candidate, lifecycle: "awaiting_human_approval" };
    hasUnknownValue = true;
  }
  return hasUnknownValue && normalizeDaemonSummary(candidate) !== null;
}
