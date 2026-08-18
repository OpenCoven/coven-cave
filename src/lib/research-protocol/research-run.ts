import {
  compareUtcTimestamps,
  copyProtocolJsonValue,
  fail,
  isOpaqueId,
  isRecord,
  isUtcTimestamp,
  parseResearchContextBindingV1,
  pass,
  retentionDoesNotExceed,
  type ProtocolParseResult,
  type ResearchContextBindingV1,
  type RetentionPolicyV1,
  type UnknownFields,
} from "./common.ts";
import type { ContextPackV1 } from "./context-pack.ts";
import { canonicalJson } from "./digest.ts";
import {
  parseRunManifestV1,
  validateRunManifestRevision,
  type RunManifestV1,
} from "./run-manifest.ts";

const RESEARCH_RUN_SCHEMA = "opencoven.research-run/v1";
const RESEARCH_RUN_SCHEMA_RE = /^opencoven\.research-run\/v(\d+)$/;
const RUN_EVENT_SCHEMA = "opencoven.run-event/v1";
const RUN_EVENT_SCHEMA_RE = /^opencoven\.run-event\/v(\d+)$/;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

const EXECUTION_LOCATIONS = ["local", "hosted"] as const;
const MODEL_EXECUTIONS = ["cave-device", "user-hosted-executor"] as const;
const MODEL_SELECTIONS = ["resolve-at-run-start", "pinned"] as const;
const EXECUTION_STRATEGIES = ["single-agent", "orchestrator-workers"] as const;
const RETENTION_POLICIES = ["run-only", "7-days", "project"] as const;
const RUN_STATUSES = [
  "queued",
  "scoping",
  "gathering_public_sources",
  "waiting_for_executor",
  "challenging",
  "synthesizing",
  "controlling",
  "awaiting_checkpoint",
  "publishing",
  "completed",
  "failed",
  "cancelled",
  "expired",
] as const;
const WAITING_REASONS = ["executor", "checkpoint", "provider-attention"] as const;
const WAITING_PHASES = ["scope", "challenge", "synthesize", "control"] as const;
const CHECKPOINT_WAITING_STATUSES = new Set([
  "scoping",
  "gathering_public_sources",
  "challenging",
  "synthesizing",
  "controlling",
  "awaiting_checkpoint",
  "publishing",
]);
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled", "expired"]);
const RUN_EVENT_TYPES = [
  "run.created",
  "run.status",
  "phase.started",
  "phase.completed",
  "model-task.available",
  "model-task.leased",
  "model-task.completed",
  "checkpoint.required",
  "artifact.registered",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "retention.changed",
  "content.deleted",
] as const;

type ResearchModelBindingV1 = {
  familiarId: string;
  selection: "resolve-at-run-start" | "pinned";
  model?: string;
} & UnknownFields;

type ResearchAcceptedTopicV1 = {
  proposalId?: string;
  question: string;
  editedByUser: boolean;
} & UnknownFields;

type ResearchRunFailureV1 = {
  code: string;
  message: string;
  retryable: boolean;
} & UnknownFields;

export type ResearchExecutionProfileV1 = {
  location: "local" | "hosted";
  modelExecution: "cave-device" | "user-hosted-executor";
  modelBinding: ResearchModelBindingV1;
  strategy: "single-agent" | "orchestrator-workers";
} & UnknownFields;

export type ResearchPrivacyPolicyV1 = {
  remoteQueries: boolean;
  remoteContent: boolean;
  artifactContentSync: boolean;
  retention: "run-only" | "7-days" | "project";
  allowMemoryPromotion: false;
} & UnknownFields;

export type ResearchBounds = {
  wallClockMinutes: number;
  maxIterations: number;
  sourceTarget: number;
  maxSpendUsd?: number;
  checkpointEvery: number;
  stopWhenCostUnavailable: boolean;
} & UnknownFields;

export type ResearchRunStatusV1 = (typeof RUN_STATUSES)[number];
type WaitingReasonV1 = (typeof WAITING_REASONS)[number];
type WaitingForPhaseV1 = (typeof WAITING_PHASES)[number];
type RunEventTypeV1 = (typeof RUN_EVENT_TYPES)[number];

export type ResearchRunV1 = {
  schema: "opencoven.research-run/v1";
  id: string;
  tenantOpaqueId?: string;
  context?: ResearchContextBindingV1;
  acceptedTopic: ResearchAcceptedTopicV1;
  execution: ResearchExecutionProfileV1;
  privacy: ResearchPrivacyPolicyV1;
  bounds: ResearchBounds;
  status: ResearchRunStatusV1;
  waitingReason?: WaitingReasonV1;
  waitingForPhase?: WaitingForPhaseV1;
  createdAt: string;
  updatedAt: string;
  nextEventSequence: number;
  artifactManifest?: RunManifestV1;
  failure?: ResearchRunFailureV1;
} & UnknownFields;

type RunEventBaseV1 = {
  schema: "opencoven.run-event/v1";
  id: string;
  runId: string;
  sequence: number;
  at: string;
};

export type ContentDeletedEventDataV1 = {
  deletedObjectCount: number;
  manifestStatus: "deleted";
};

export type RunEventV1 =
  | (RunEventBaseV1 & {
      type: "content.deleted";
      data: ContentDeletedEventDataV1;
    })
  | (RunEventBaseV1 & {
      type: Exclude<RunEventTypeV1, "content.deleted">;
      data: Record<string, unknown>;
    } & UnknownFields);

export type ResearchRunCompositionOptionsV1 = {
  /** Complete ordered revisions 1..tip when an artifactManifest is embedded. */
  manifestHistory?: readonly RunManifestV1[];
  /** External authorizations, in transition order, consumed exactly once. */
  authorizedFreshConsentAt?: readonly string[];
};

function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function indexPath(path: string, index: number): string {
  return `${path}[${index}]`;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function validateClosedObjectKeys(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  path: string,
  label: string,
): ProtocolParseResult<void> {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      return fail(
        "semantic_conflict",
        childPath(path, key),
        `${label} does not allow extension field ${key}`,
      );
    }
  }
  return pass(undefined);
}

const CONTENT_DELETED_EVENT_KEYS = new Set([
  "schema",
  "id",
  "runId",
  "sequence",
  "at",
  "type",
  "data",
]);
const CONTENT_DELETED_DATA_KEYS = new Set([
  "deletedObjectCount",
  "manifestStatus",
]);

function contextBindingsMatch(
  runContext: ResearchContextBindingV1 | undefined,
  manifestContext: ResearchContextBindingV1 | undefined,
): boolean {
  if (runContext === undefined || manifestContext === undefined) {
    return runContext === manifestContext;
  }
  return (
    runContext.contextPackId === manifestContext.contextPackId &&
    runContext.contextPackDigest === manifestContext.contextPackDigest &&
    runContext.topicProposalId === manifestContext.topicProposalId
  );
}

function validateEmbeddedManifestOccurrenceClock(
  manifest: RunManifestV1,
  runCreatedAt: string,
  runUpdatedAt: string,
  manifestPath: string,
): ProtocolParseResult<void> {
  if (compareUtcTimestamps(manifest.createdAt, runCreatedAt) < 0) {
    return fail(
      "semantic_conflict",
      childPath(manifestPath, "createdAt"),
      "artifact manifest creation must not precede the enclosing run creation",
    );
  }

  const occurrences: Array<{ timestamp: string; path: string; message: string }> = [
    {
      timestamp: manifest.createdAt,
      path: childPath(manifestPath, "createdAt"),
      message: "artifact manifest creation must not follow the enclosing run update",
    },
    ...(manifest.state === "final" && typeof manifest.finalizedAt === "string"
      ? [{
          timestamp: manifest.finalizedAt,
          path: childPath(manifestPath, "finalizedAt"),
          message: "artifact manifest finalization must not follow the enclosing run update",
        }]
      : []),
    {
      timestamp: manifest.retention.updatedAt,
      path: childPath(childPath(manifestPath, "retention"), "updatedAt"),
      message: "artifact manifest retention update must not follow the enclosing run update",
    },
  ];

  for (const [index, artifact] of manifest.artifacts.entries()) {
    occurrences.push({
      timestamp: artifact.createdAt,
      path: childPath(indexPath(childPath(manifestPath, "artifacts"), index), "createdAt"),
      message: "artifact createdAt must not follow the enclosing run update",
    });
  }
  for (const [index, source] of manifest.sources.entries()) {
    if (source.kind !== "public-evidence") continue;
    occurrences.push({
      timestamp: source.fetchedAt,
      path: childPath(indexPath(childPath(manifestPath, "sources"), index), "fetchedAt"),
      message: "public-evidence fetchedAt must not follow the enclosing run update",
    });
  }
  if (typeof manifest.deletion.requestedAt === "string") {
    occurrences.push({
      timestamp: manifest.deletion.requestedAt,
      path: childPath(childPath(manifestPath, "deletion"), "requestedAt"),
      message: "deletion requestedAt must not follow the enclosing run update",
    });
  }
  if (typeof manifest.deletion.completedAt === "string") {
    occurrences.push({
      timestamp: manifest.deletion.completedAt,
      path: childPath(childPath(manifestPath, "deletion"), "completedAt"),
      message: "deletion completedAt must not follow the enclosing run update",
    });
  }

  for (const occurrence of occurrences) {
    if (compareUtcTimestamps(occurrence.timestamp, runUpdatedAt) > 0) {
      return fail("semantic_conflict", occurrence.path, occurrence.message);
    }
  }
  return pass(undefined);
}

function validateArtifactContentSyncConsent(
  run: Pick<ResearchRunV1, "privacy">,
  manifest: RunManifestV1,
  manifestPath: string,
): ProtocolParseResult<void> {
  const requestedSyncIndex = manifest.artifacts.findIndex(
    (artifact) => artifact.contentSync !== "not-requested",
  );
  if (requestedSyncIndex >= 0 && !run.privacy.artifactContentSync) {
    return fail(
      "semantic_conflict",
      childPath(
        indexPath(childPath(manifestPath, "artifacts"), requestedSyncIndex),
        "contentSync",
      ),
      "requested artifact content synchronization requires run artifactContentSync consent",
    );
  }
  return pass(undefined);
}

function validateEmbeddedManifestAgainstRun(
  run: Pick<
    ResearchRunV1,
    "id" | "context" | "privacy" | "status" | "createdAt" | "updatedAt"
  >,
  manifest: RunManifestV1,
  contextConsent: RetentionPolicyV1 | undefined,
  manifestPath: string,
  position: "history" | "tip",
): ProtocolParseResult<void> {
  if (manifest.runId !== run.id) {
    return fail(
      "semantic_conflict",
      childPath(manifestPath, "runId"),
      "artifact manifest runId must match the enclosing run id",
    );
  }
  if (!contextBindingsMatch(run.context, manifest.context)) {
    return fail(
      "semantic_conflict",
      childPath(manifestPath, "context"),
      "artifact manifest context must match the enclosing run context",
    );
  }
  if (manifest.retention.policy !== run.privacy.retention) {
    return fail(
      "semantic_conflict",
      childPath(childPath(manifestPath, "retention"), "policy"),
      "artifact manifest retention policy must match run privacy retention",
    );
  }

  const effectiveRetentionCeiling = contextConsent ?? (
    run.context === undefined ? run.privacy.retention : undefined
  );
  if (
    effectiveRetentionCeiling !== undefined
    && !retentionDoesNotExceed(
      manifest.retention.effectivePolicy,
      effectiveRetentionCeiling,
    )
  ) {
    return fail(
      "semantic_conflict",
      childPath(childPath(manifestPath, "retention"), "effectivePolicy"),
      contextConsent === undefined
        ? "artifact manifest effective retention must not exceed run privacy retention"
        : "artifact manifest effective retention exceeds Context Pack consent",
    );
  }

  const contentSync = validateArtifactContentSyncConsent(run, manifest, manifestPath);
  if (!contentSync.ok) return contentSync;

  if (position === "tip") {
    if (TERMINAL_RUN_STATUSES.has(run.status) && manifest.state !== "final") {
      return fail(
        "semantic_conflict",
        childPath(manifestPath, "state"),
        "Terminal runs require a final artifactManifest",
      );
    }
    if (!TERMINAL_RUN_STATUSES.has(run.status) && manifest.state === "final") {
      return fail(
        "semantic_conflict",
        childPath(manifestPath, "state"),
        "Nonterminal runs must not include a final artifactManifest",
      );
    }
  }

  return validateEmbeddedManifestOccurrenceClock(
    manifest,
    run.createdAt,
    run.updatedAt,
    manifestPath,
  );
}

function canonicalValuesMatch(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function prefixManifestHistoryError<T>(
  result: ProtocolParseResult<T>,
  index: number,
): ProtocolParseResult<T> {
  if (result.ok) return result;
  return fail(
    result.error.code,
    result.error.path === "$"
      ? `$.manifestHistory[${index}]`
      : `$.manifestHistory[${index}]${result.error.path.slice(1)}`,
    result.error.message,
  );
}

function validateEmbeddedManifestHistory(
  run: ResearchRunV1,
  contextPack: ContextPackV1 | undefined,
  options: ResearchRunCompositionOptionsV1,
): ProtocolParseResult<void> {
  const manifest = run.artifactManifest;
  const history = options.manifestHistory;
  const authorizations = options.authorizedFreshConsentAt ?? [];

  if (history !== undefined && !Array.isArray(history)) {
    return fail(
      "invalid_type",
      "$.manifestHistory",
      "manifestHistory must be an array",
    );
  }
  if (!Array.isArray(authorizations)) {
    return fail(
      "invalid_type",
      "$.authorizedFreshConsentAt",
      "authorizedFreshConsentAt must be an array",
    );
  }
  for (const [index, authorizedAt] of authorizations.entries()) {
    if (!isUtcTimestamp(authorizedAt)) {
      return fail(
        "invalid_value",
        `$.authorizedFreshConsentAt[${index}]`,
        "fresh-consent authorizations must be exact UTC timestamps",
      );
    }
  }

  if (!manifest) {
    if (history !== undefined) {
      return fail(
        "semantic_conflict",
        "$.manifestHistory",
        "manifestHistory must not be supplied without an embedded artifactManifest",
      );
    }
    if (authorizations.length > 0) {
      return fail(
        "semantic_conflict",
        "$.authorizedFreshConsentAt[0]",
        "fresh-consent authorization is unused",
      );
    }
    return pass(undefined);
  }

  const tipComposition = validateEmbeddedManifestAgainstRun(
    run,
    manifest,
    contextPack?.consent.retention,
    "$.artifactManifest",
    "tip",
  );
  if (!tipComposition.ok) return tipComposition;

  if (history === undefined) {
    if (manifest.revision > 1) {
      return fail(
        "semantic_conflict",
        "$.manifestHistory",
        "embedded manifest revisions after 1 require their complete rooted history",
      );
    }
    if (authorizations.length > 0) {
      return fail(
        "semantic_conflict",
        "$.authorizedFreshConsentAt[0]",
        "fresh-consent authorization is unused",
      );
    }
    return pass(undefined);
  }

  if (history.length !== manifest.revision) {
    return fail(
      "semantic_conflict",
      "$.manifestHistory",
      `manifestHistory must contain exactly revisions 1 through ${manifest.revision}`,
    );
  }

  for (const [index, item] of history.entries()) {
    const itemPath = `$.manifestHistory[${index}]`;
    if (item.revision !== index + 1) {
      return fail(
        "semantic_conflict",
        `${itemPath}.revision`,
        `manifest history revision must equal ${index + 1}`,
      );
    }
    if (item.id !== manifest.id) {
      return fail(
        "semantic_conflict",
        `${itemPath}.id`,
        "manifest history id must match the embedded tip",
      );
    }
    const itemComposition = validateEmbeddedManifestAgainstRun(
      run,
      item,
      contextPack?.consent.retention,
      itemPath,
      index === history.length - 1 ? "tip" : "history",
    );
    if (!itemComposition.ok) return itemComposition;
    if (!contextBindingsMatch(item.context, manifest.context)) {
      return fail(
        "semantic_conflict",
        `${itemPath}.context`,
        "manifest history context must match the embedded tip",
      );
    }
  }

  const tipIndex = history.length - 1;
  const historyTip = history[tipIndex]!;
  if (
    historyTip.digest !== manifest.digest
    || !canonicalValuesMatch(historyTip, manifest)
  ) {
    return fail(
      "semantic_conflict",
      `$.manifestHistory[${tipIndex}]`,
      "final manifest history item must exactly equal the embedded artifactManifest",
    );
  }

  let authorizationIndex = 0;
  for (let index = 1; index < history.length; index += 1) {
    const previous = history[index - 1]!;
    const next = history[index]!;
    const changedFreshConsentAt =
      next.retention.freshConsentAt !== undefined
      && next.retention.freshConsentAt !== previous.retention.freshConsentAt;
    const revisionOptions = {
      ...(contextPack === undefined
        ? {}
        : { contextConsent: contextPack.consent.retention }),
      ...(changedFreshConsentAt
        ? {
            freshConsent: true as const,
            freshConsentAt: next.retention.freshConsentAt,
          }
        : {}),
    };

    if (changedFreshConsentAt) {
      const authorizedAt = authorizations[authorizationIndex];
      if (authorizedAt === undefined) {
        return fail(
          "semantic_conflict",
          "$.authorizedFreshConsentAt",
          "manifest freshConsentAt requires an exact external authorization",
        );
      }
      if (authorizedAt !== next.retention.freshConsentAt) {
        return fail(
          "semantic_conflict",
          `$.authorizedFreshConsentAt[${authorizationIndex}]`,
          "fresh-consent authorization must exactly match the manifest transition",
        );
      }
      authorizationIndex += 1;
    }

    const revision = prefixManifestHistoryError(
      validateRunManifestRevision(previous, next, revisionOptions),
      index,
    );
    if (!revision.ok) return revision;
  }

  if (authorizationIndex !== authorizations.length) {
    return fail(
      "semantic_conflict",
      `$.authorizedFreshConsentAt[${authorizationIndex}]`,
      "fresh-consent authorization is unused",
    );
  }
  return pass(undefined);
}

/**
 * Validates two already-parsed objects. Run-field errors use run JSON paths;
 * pack-only policy errors use the synthetic `$.contextPack` path.
 * Parsing a context-bound run is provisional; callers must compose it with its
 * parsed Context Pack here before use. Embedded manifest revisions after 1 are
 * also provisional until this boundary receives their complete rooted history
 * and the exact external fresh-consent authorization receipts.
 */
export function validateResearchRunContextPackV1(
  run: ResearchRunV1,
  contextPack?: ContextPackV1,
  options: ResearchRunCompositionOptionsV1 = {},
): ProtocolParseResult<ResearchRunV1> {
  if (run.artifactManifest) {
    const artifactContentSync = validateArtifactContentSyncConsent(
      run,
      run.artifactManifest,
      "$.artifactManifest",
    );
    if (!artifactContentSync.ok) return artifactContentSync;
  }

  if (!run.context) {
    if (contextPack !== undefined) {
      return fail(
        "semantic_conflict",
        "$.context",
        "A Context Pack must not be supplied when the run has no context binding",
      );
    }
    const history = validateEmbeddedManifestHistory(run, undefined, options);
    if (!history.ok) return history;
    return pass(run);
  }
  if (contextPack === undefined) {
    return fail(
      "semantic_conflict",
      "$.context",
      "A run context binding requires its parsed Context Pack",
    );
  }
  if (run.context.contextPackId !== contextPack.id) {
    return fail(
      "semantic_conflict",
      "$.context.contextPackId",
      "Run contextPackId must match the Context Pack id",
    );
  }
  if (run.context.contextPackDigest !== contextPack.digest) {
    return fail(
      "semantic_conflict",
      "$.context.contextPackDigest",
      "Run contextPackDigest must match the Context Pack digest",
    );
  }
  if (contextPack.purpose !== "research-run") {
    return fail(
      "semantic_conflict",
      "$.contextPack.purpose",
      "Context Pack purpose must be research-run",
    );
  }
  if (!contextPack.policy.allowedPurposes.includes("research-run")) {
    return fail(
      "semantic_conflict",
      "$.contextPack.policy.allowedPurposes",
      "Context Pack allowedPurposes must include research-run",
    );
  }

  for (const [runKey, consentKey] of [
    ["remoteQueries", "allowRemoteQueries"],
    ["remoteContent", "allowRemoteContent"],
    ["artifactContentSync", "artifactContentSync"],
  ] as const) {
    if (run.privacy[runKey] && !contextPack.consent[consentKey]) {
      return fail(
        "semantic_conflict",
        `$.privacy.${runKey}`,
        `${runKey} exceeds Context Pack consent`,
      );
    }
  }
  if (!retentionDoesNotExceed(run.privacy.retention, contextPack.consent.retention)) {
    return fail(
      "semantic_conflict",
      "$.privacy.retention",
      "Run retention exceeds Context Pack consent",
    );
  }
  const history = validateEmbeddedManifestHistory(run, contextPack, options);
  if (!history.ok) return history;
  return pass(run);
}

function parseObject(value: unknown, path: string): ProtocolParseResult<Record<string, unknown>> {
  if (!isRecord(value)) {
    return fail("invalid_type", path, "Expected an object");
  }
  return pass(value);
}

function parseRequiredField(
  record: Record<string, unknown>,
  key: string,
  path: string,
): ProtocolParseResult<unknown> {
  if (!hasOwn(record, key)) {
    return fail("missing_field", childPath(path, key), `Missing required field ${key}`);
  }
  return pass(record[key]);
}

function parseString(value: unknown, path: string, label: string): ProtocolParseResult<string> {
  if (typeof value !== "string") {
    return fail("invalid_type", path, `${label} must be a string`);
  }
  return pass(value);
}

function parseBoolean(value: unknown, path: string, label: string): ProtocolParseResult<boolean> {
  if (typeof value !== "boolean") {
    return fail("invalid_type", path, `${label} must be a boolean`);
  }
  return pass(value);
}

function parseEnumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
  label: string,
): ProtocolParseResult<T[number]> {
  if (typeof value !== "string") {
    return fail("invalid_type", path, `${label} must be a string`);
  }
  if (!allowed.includes(value as T[number])) {
    return fail("invalid_value", path, `${label} must be one of ${allowed.join(", ")}`);
  }
  return pass(value as T[number]);
}

function parseSafeIntegerInRange(
  value: unknown,
  path: string,
  label: string,
  minimum: number,
  maximum: number,
): ProtocolParseResult<number> {
  if (typeof value !== "number") {
    return fail("invalid_type", path, `${label} must be a number`);
  }
  if (!Number.isSafeInteger(value)) {
    return fail("invalid_value", path, `${label} must be a safe integer`);
  }
  if (value < minimum || value > maximum) {
    return fail("invalid_value", path, `${label} must be between ${minimum} and ${maximum}`);
  }
  return pass(value);
}

function parsePositiveSafeInteger(value: unknown, path: string, label: string): ProtocolParseResult<number> {
  return parseSafeIntegerInRange(value, path, label, 1, MAX_SAFE_INTEGER);
}

function parseNonNegativeFiniteNumber(
  value: unknown,
  path: string,
  label: string,
): ProtocolParseResult<number> {
  if (typeof value !== "number") {
    return fail("invalid_type", path, `${label} must be a number`);
  }
  if (!Number.isFinite(value) || value < 0) {
    return fail("invalid_value", path, `${label} must be a finite number >= 0`);
  }
  return pass(value);
}

function parseSchema<const T extends string>(
  value: unknown,
  exact: T,
  re: RegExp,
  path: string,
  label: string,
): ProtocolParseResult<T> {
  if (typeof value !== "string") {
    return fail("invalid_type", path, `${label} must be a string`);
  }
  if (value === exact) {
    return pass(exact);
  }
  const match = re.exec(value);
  if (match) {
    return fail("unknown_major", path, `Unsupported ${label} major v${match[1]}`);
  }
  return fail("invalid_value", path, `${label} must equal ${exact}`);
}

function parseUtc(value: unknown, path: string, label: string): ProtocolParseResult<string> {
  if (typeof value !== "string") {
    return fail("invalid_type", path, `${label} must be a string`);
  }
  if (!isUtcTimestamp(value)) {
    return fail("invalid_value", path, `${label} must be a UTC RFC 3339 timestamp`);
  }
  return pass(value);
}

function parseOpaqueIdentifier(
  value: unknown,
  prefix: string,
  path: string,
  label: string,
): ProtocolParseResult<string> {
  if (typeof value !== "string") {
    return fail("invalid_type", path, `${label} must be a string`);
  }
  if (!isOpaqueId(value, prefix)) {
    return fail("invalid_value", path, `${label} must match ${prefix}_...`);
  }
  return pass(value);
}

function parseAcceptedTopic(value: unknown, path: string): ProtocolParseResult<ResearchAcceptedTopicV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  let proposalId: string | undefined;
  if (hasOwn(object.value, "proposalId")) {
    const parsedProposalId = parseOpaqueIdentifier(
      object.value.proposalId,
      "proposal",
      childPath(path, "proposalId"),
      "proposalId",
    );
    if (!parsedProposalId.ok) return parsedProposalId;
    proposalId = parsedProposalId.value;
  }

  const questionField = parseRequiredField(object.value, "question", path);
  if (!questionField.ok) return questionField;
  const question = parseString(questionField.value, childPath(path, "question"), "question");
  if (!question.ok) return question;

  const editedByUserField = parseRequiredField(object.value, "editedByUser", path);
  if (!editedByUserField.ok) return editedByUserField;
  const editedByUser = parseBoolean(
    editedByUserField.value,
    childPath(path, "editedByUser"),
    "editedByUser",
  );
  if (!editedByUser.ok) return editedByUser;

  return pass({
    ...object.value,
    ...(typeof proposalId === "string" ? { proposalId } : {}),
    question: question.value,
    editedByUser: editedByUser.value,
  });
}

function parseModelBinding(value: unknown, path: string): ProtocolParseResult<ResearchModelBindingV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const familiarIdField = parseRequiredField(object.value, "familiarId", path);
  if (!familiarIdField.ok) return familiarIdField;
  const familiarId = parseString(familiarIdField.value, childPath(path, "familiarId"), "familiarId");
  if (!familiarId.ok) return familiarId;

  const selectionField = parseRequiredField(object.value, "selection", path);
  if (!selectionField.ok) return selectionField;
  const selection = parseEnumValue(
    selectionField.value,
    MODEL_SELECTIONS,
    childPath(path, "selection"),
    "selection",
  );
  if (!selection.ok) return selection;

  let model: string | undefined;
  if (selection.value === "pinned") {
    if (!hasOwn(object.value, "model")) {
      return fail("missing_field", childPath(path, "model"), "pinned model selection requires model");
    }
    const parsedModel = parseString(object.value.model, childPath(path, "model"), "model");
    if (!parsedModel.ok) return parsedModel;
    model = parsedModel.value;
  } else if (hasOwn(object.value, "model")) {
    return fail(
      "semantic_conflict",
      childPath(path, "model"),
      "resolve-at-run-start model selection must not include model",
    );
  }

  return pass({
    ...object.value,
    familiarId: familiarId.value,
    selection: selection.value,
    ...(typeof model === "string" ? { model } : {}),
  });
}

export function parseResearchExecutionProfileV1(
  value: unknown,
  path: string,
): ProtocolParseResult<ResearchExecutionProfileV1> {
  const wireValue = copyProtocolJsonValue(value, path);
  if (!wireValue.ok) return wireValue;

  const object = parseObject(wireValue.value, path);
  if (!object.ok) return object;

  const locationField = parseRequiredField(object.value, "location", path);
  if (!locationField.ok) return locationField;
  const location = parseEnumValue(
    locationField.value,
    EXECUTION_LOCATIONS,
    childPath(path, "location"),
    "location",
  );
  if (!location.ok) return location;

  const modelExecutionField = parseRequiredField(object.value, "modelExecution", path);
  if (!modelExecutionField.ok) return modelExecutionField;
  const modelExecution = parseEnumValue(
    modelExecutionField.value,
    MODEL_EXECUTIONS,
    childPath(path, "modelExecution"),
    "modelExecution",
  );
  if (!modelExecution.ok) return modelExecution;

  const modelBindingField = parseRequiredField(object.value, "modelBinding", path);
  if (!modelBindingField.ok) return modelBindingField;
  const modelBinding = parseModelBinding(modelBindingField.value, childPath(path, "modelBinding"));
  if (!modelBinding.ok) return modelBinding;

  const strategyField = parseRequiredField(object.value, "strategy", path);
  if (!strategyField.ok) return strategyField;
  const strategy = parseEnumValue(
    strategyField.value,
    EXECUTION_STRATEGIES,
    childPath(path, "strategy"),
    "strategy",
  );
  if (!strategy.ok) return strategy;

  return pass({
    ...object.value,
    location: location.value,
    modelExecution: modelExecution.value,
    modelBinding: modelBinding.value,
    strategy: strategy.value,
  });
}

export function parseResearchPrivacyPolicyV1(
  value: unknown,
  path: string,
): ProtocolParseResult<ResearchPrivacyPolicyV1> {
  const wireValue = copyProtocolJsonValue(value, path);
  if (!wireValue.ok) return wireValue;

  const object = parseObject(wireValue.value, path);
  if (!object.ok) return object;

  const remoteQueriesField = parseRequiredField(object.value, "remoteQueries", path);
  if (!remoteQueriesField.ok) return remoteQueriesField;
  const remoteQueries = parseBoolean(
    remoteQueriesField.value,
    childPath(path, "remoteQueries"),
    "remoteQueries",
  );
  if (!remoteQueries.ok) return remoteQueries;

  const remoteContentField = parseRequiredField(object.value, "remoteContent", path);
  if (!remoteContentField.ok) return remoteContentField;
  const remoteContent = parseBoolean(
    remoteContentField.value,
    childPath(path, "remoteContent"),
    "remoteContent",
  );
  if (!remoteContent.ok) return remoteContent;

  const artifactContentSyncField = parseRequiredField(object.value, "artifactContentSync", path);
  if (!artifactContentSyncField.ok) return artifactContentSyncField;
  const artifactContentSync = parseBoolean(
    artifactContentSyncField.value,
    childPath(path, "artifactContentSync"),
    "artifactContentSync",
  );
  if (!artifactContentSync.ok) return artifactContentSync;

  const retentionField = parseRequiredField(object.value, "retention", path);
  if (!retentionField.ok) return retentionField;
  const retention = parseEnumValue(
    retentionField.value,
    RETENTION_POLICIES,
    childPath(path, "retention"),
    "retention",
  );
  if (!retention.ok) return retention;

  const allowMemoryPromotionField = parseRequiredField(object.value, "allowMemoryPromotion", path);
  if (!allowMemoryPromotionField.ok) return allowMemoryPromotionField;
  const allowMemoryPromotion = parseBoolean(
    allowMemoryPromotionField.value,
    childPath(path, "allowMemoryPromotion"),
    "allowMemoryPromotion",
  );
  if (!allowMemoryPromotion.ok) return allowMemoryPromotion;
  if (allowMemoryPromotion.value !== false) {
    return fail(
      "invalid_value",
      childPath(path, "allowMemoryPromotion"),
      "allowMemoryPromotion must equal false",
    );
  }

  return pass({
    ...object.value,
    remoteQueries: remoteQueries.value,
    remoteContent: remoteContent.value,
    artifactContentSync: artifactContentSync.value,
    retention: retention.value,
    allowMemoryPromotion: false,
  });
}

function parseResearchBounds(value: unknown, path: string): ProtocolParseResult<ResearchBounds> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const wallClockMinutesField = parseRequiredField(object.value, "wallClockMinutes", path);
  if (!wallClockMinutesField.ok) return wallClockMinutesField;
  const wallClockMinutes = parsePositiveSafeInteger(
    wallClockMinutesField.value,
    childPath(path, "wallClockMinutes"),
    "wallClockMinutes",
  );
  if (!wallClockMinutes.ok) return wallClockMinutes;

  const maxIterationsField = parseRequiredField(object.value, "maxIterations", path);
  if (!maxIterationsField.ok) return maxIterationsField;
  const maxIterations = parsePositiveSafeInteger(
    maxIterationsField.value,
    childPath(path, "maxIterations"),
    "maxIterations",
  );
  if (!maxIterations.ok) return maxIterations;

  const sourceTargetField = parseRequiredField(object.value, "sourceTarget", path);
  if (!sourceTargetField.ok) return sourceTargetField;
  const sourceTarget = parsePositiveSafeInteger(
    sourceTargetField.value,
    childPath(path, "sourceTarget"),
    "sourceTarget",
  );
  if (!sourceTarget.ok) return sourceTarget;

  let maxSpendUsd: number | undefined;
  if (hasOwn(object.value, "maxSpendUsd")) {
    const parsedMaxSpendUsd = parseNonNegativeFiniteNumber(
      object.value.maxSpendUsd,
      childPath(path, "maxSpendUsd"),
      "maxSpendUsd",
    );
    if (!parsedMaxSpendUsd.ok) return parsedMaxSpendUsd;
    maxSpendUsd = parsedMaxSpendUsd.value;
  }

  const checkpointEveryField = parseRequiredField(object.value, "checkpointEvery", path);
  if (!checkpointEveryField.ok) return checkpointEveryField;
  const checkpointEvery = parsePositiveSafeInteger(
    checkpointEveryField.value,
    childPath(path, "checkpointEvery"),
    "checkpointEvery",
  );
  if (!checkpointEvery.ok) return checkpointEvery;

  const stopWhenCostUnavailableField = parseRequiredField(object.value, "stopWhenCostUnavailable", path);
  if (!stopWhenCostUnavailableField.ok) return stopWhenCostUnavailableField;
  const stopWhenCostUnavailable = parseBoolean(
    stopWhenCostUnavailableField.value,
    childPath(path, "stopWhenCostUnavailable"),
    "stopWhenCostUnavailable",
  );
  if (!stopWhenCostUnavailable.ok) return stopWhenCostUnavailable;

  return pass({
    ...object.value,
    wallClockMinutes: wallClockMinutes.value,
    maxIterations: maxIterations.value,
    sourceTarget: sourceTarget.value,
    ...(typeof maxSpendUsd === "number" ? { maxSpendUsd } : {}),
    checkpointEvery: checkpointEvery.value,
    stopWhenCostUnavailable: stopWhenCostUnavailable.value,
  });
}

function parseResearchRunFailureV1(
  value: unknown,
  path: string,
): ProtocolParseResult<ResearchRunFailureV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const codeField = parseRequiredField(object.value, "code", path);
  if (!codeField.ok) return codeField;
  const code = parseString(codeField.value, childPath(path, "code"), "code");
  if (!code.ok) return code;

  const messageField = parseRequiredField(object.value, "message", path);
  if (!messageField.ok) return messageField;
  const message = parseString(messageField.value, childPath(path, "message"), "message");
  if (!message.ok) return message;

  const retryableField = parseRequiredField(object.value, "retryable", path);
  if (!retryableField.ok) return retryableField;
  const retryable = parseBoolean(retryableField.value, childPath(path, "retryable"), "retryable");
  if (!retryable.ok) return retryable;

  return pass({
    ...object.value,
    code: code.value,
    message: message.value,
    retryable: retryable.value,
  });
}

function parseContentDeletedEventData(
  value: Record<string, unknown>,
  path: string,
): ProtocolParseResult<ContentDeletedEventDataV1> {
  const closedKeys = validateClosedObjectKeys(
    value,
    CONTENT_DELETED_DATA_KEYS,
    path,
    "content.deleted data",
  );
  if (!closedKeys.ok) return closedKeys;

  const deletedObjectCountField = parseRequiredField(
    value,
    "deletedObjectCount",
    path,
  );
  if (!deletedObjectCountField.ok) return deletedObjectCountField;
  const deletedObjectCount = parseSafeIntegerInRange(
    deletedObjectCountField.value,
    childPath(path, "deletedObjectCount"),
    "deletedObjectCount",
    0,
    MAX_SAFE_INTEGER,
  );
  if (!deletedObjectCount.ok) return deletedObjectCount;

  const manifestStatusField = parseRequiredField(value, "manifestStatus", path);
  if (!manifestStatusField.ok) return manifestStatusField;
  const manifestStatus = parseEnumValue(
    manifestStatusField.value,
    ["deleted"] as const,
    childPath(path, "manifestStatus"),
    "manifestStatus",
  );
  if (!manifestStatus.ok) return manifestStatus;

  return pass({
    deletedObjectCount: deletedObjectCount.value,
    manifestStatus: manifestStatus.value,
  });
}

/**
 * Parses the Research Run wire shape. An embedded manifest remains provisional
 * until `validateResearchRunContextPackV1` validates its revision history.
 */
export function parseResearchRunV1(value: unknown): ProtocolParseResult<ResearchRunV1> {
  const wireValue = copyProtocolJsonValue(value);
  if (!wireValue.ok) return wireValue;

  const object = parseObject(wireValue.value, "$");
  if (!object.ok) return object;

  const schemaField = parseRequiredField(object.value, "schema", "$");
  if (!schemaField.ok) return schemaField;
  const schema = parseSchema(
    schemaField.value,
    RESEARCH_RUN_SCHEMA,
    RESEARCH_RUN_SCHEMA_RE,
    "$.schema",
    "schema",
  );
  if (!schema.ok) return schema;

  const idField = parseRequiredField(object.value, "id", "$");
  if (!idField.ok) return idField;
  const id = parseOpaqueIdentifier(idField.value, "run", "$.id", "id");
  if (!id.ok) return id;

  let context: ResearchContextBindingV1 | undefined;
  if (hasOwn(object.value, "context")) {
    const parsedContext = parseResearchContextBindingV1(object.value.context, "$.context");
    if (!parsedContext.ok) return parsedContext;
    context = parsedContext.value;
  }

  const acceptedTopicField = parseRequiredField(object.value, "acceptedTopic", "$");
  if (!acceptedTopicField.ok) return acceptedTopicField;
  const acceptedTopic = parseAcceptedTopic(acceptedTopicField.value, "$.acceptedTopic");
  if (!acceptedTopic.ok) return acceptedTopic;

  if (typeof acceptedTopic.value.proposalId === "string") {
    if (!context) {
      return fail(
        "missing_field",
        "$.context",
        "Proposal-backed accepted topics require a context binding",
      );
    }
    if (typeof context.topicProposalId !== "string") {
      return fail(
        "missing_field",
        "$.context.topicProposalId",
        "Proposal-backed accepted topics require context.topicProposalId",
      );
    }
    if (context.topicProposalId !== acceptedTopic.value.proposalId) {
      return fail(
        "semantic_conflict",
        "$.context.topicProposalId",
        "context.topicProposalId must equal acceptedTopic.proposalId",
      );
    }
  } else if (typeof context?.topicProposalId === "string") {
    return fail(
      "missing_field",
      "$.acceptedTopic.proposalId",
      "context.topicProposalId requires acceptedTopic.proposalId",
    );
  }

  const executionField = parseRequiredField(object.value, "execution", "$");
  if (!executionField.ok) return executionField;
  const execution = parseResearchExecutionProfileV1(executionField.value, "$.execution");
  if (!execution.ok) return execution;

  let tenantOpaqueId: string | undefined;
  if (hasOwn(object.value, "tenantOpaqueId")) {
    if (execution.value.location === "local") {
      return fail(
        "semantic_conflict",
        "$.tenantOpaqueId",
        "local runs must not include tenantOpaqueId",
      );
    }
    const parsedTenantOpaqueId = parseOpaqueIdentifier(
      object.value.tenantOpaqueId,
      "tenant",
      "$.tenantOpaqueId",
      "tenantOpaqueId",
    );
    if (!parsedTenantOpaqueId.ok) return parsedTenantOpaqueId;
    tenantOpaqueId = parsedTenantOpaqueId.value;
  }

  const privacyField = parseRequiredField(object.value, "privacy", "$");
  if (!privacyField.ok) return privacyField;
  const privacy = parseResearchPrivacyPolicyV1(privacyField.value, "$.privacy");
  if (!privacy.ok) return privacy;

  const boundsField = parseRequiredField(object.value, "bounds", "$");
  if (!boundsField.ok) return boundsField;
  const bounds = parseResearchBounds(boundsField.value, "$.bounds");
  if (!bounds.ok) return bounds;

  const statusField = parseRequiredField(object.value, "status", "$");
  if (!statusField.ok) return statusField;
  const status = parseEnumValue(statusField.value, RUN_STATUSES, "$.status", "status");
  if (!status.ok) return status;

  let waitingReason: WaitingReasonV1 | undefined;
  if (hasOwn(object.value, "waitingReason")) {
    const parsedWaitingReason = parseEnumValue(
      object.value.waitingReason,
      WAITING_REASONS,
      "$.waitingReason",
      "waitingReason",
    );
    if (!parsedWaitingReason.ok) return parsedWaitingReason;
    waitingReason = parsedWaitingReason.value;
  }

  let waitingForPhase: WaitingForPhaseV1 | undefined;
  if (status.value === "waiting_for_executor") {
    if (!hasOwn(object.value, "waitingForPhase")) {
      return fail("missing_field", "$.waitingForPhase", "waiting_for_executor runs require waitingForPhase");
    }
    const parsedWaitingForPhase = parseEnumValue(
      object.value.waitingForPhase,
      WAITING_PHASES,
      "$.waitingForPhase",
      "waitingForPhase",
    );
    if (!parsedWaitingForPhase.ok) return parsedWaitingForPhase;
    waitingForPhase = parsedWaitingForPhase.value;
  } else if (hasOwn(object.value, "waitingForPhase")) {
    return fail(
      "semantic_conflict",
      "$.waitingForPhase",
      "waitingForPhase is only valid with waiting_for_executor",
    );
  }

  if (
    waitingReason === "checkpoint" &&
    !CHECKPOINT_WAITING_STATUSES.has(status.value)
  ) {
    return fail(
      "semantic_conflict",
      "$.waitingReason",
      "waitingReason checkpoint is only valid while an active phase is paused or awaiting a checkpoint",
    );
  }
  if (
    (waitingReason === "executor" || waitingReason === "provider-attention") &&
    status.value !== "waiting_for_executor"
  ) {
    return fail(
      "semantic_conflict",
      "$.waitingReason",
      "waitingReason executor/provider-attention is only valid with waiting_for_executor",
    );
  }

  const createdAtField = parseRequiredField(object.value, "createdAt", "$");
  if (!createdAtField.ok) return createdAtField;
  const createdAt = parseUtc(createdAtField.value, "$.createdAt", "createdAt");
  if (!createdAt.ok) return createdAt;

  const updatedAtField = parseRequiredField(object.value, "updatedAt", "$");
  if (!updatedAtField.ok) return updatedAtField;
  const updatedAt = parseUtc(updatedAtField.value, "$.updatedAt", "updatedAt");
  if (!updatedAt.ok) return updatedAt;
  if (compareUtcTimestamps(createdAt.value, updatedAt.value) > 0) {
    return fail(
      "semantic_conflict",
      "$.updatedAt",
      "updatedAt must not precede createdAt",
    );
  }

  const nextEventSequenceField = parseRequiredField(object.value, "nextEventSequence", "$");
  if (!nextEventSequenceField.ok) return nextEventSequenceField;
  const nextEventSequence = parsePositiveSafeInteger(
    nextEventSequenceField.value,
    "$.nextEventSequence",
    "nextEventSequence",
  );
  if (!nextEventSequence.ok) return nextEventSequence;

  let artifactManifest: RunManifestV1 | undefined;
  if (hasOwn(object.value, "artifactManifest")) {
    const parsedArtifactManifest = parseRunManifestV1(object.value.artifactManifest);
    if (!parsedArtifactManifest.ok) {
      return {
        ok: false,
        error: {
          ...parsedArtifactManifest.error,
          path:
            parsedArtifactManifest.error.path === "$"
              ? "$.artifactManifest"
              : `$.artifactManifest${parsedArtifactManifest.error.path.slice(1)}`,
        },
      };
    }
    artifactManifest = parsedArtifactManifest.value;
  }

  let failure: ResearchRunFailureV1 | undefined;
  if (status.value === "failed") {
    if (!hasOwn(object.value, "failure")) {
      return fail("missing_field", "$.failure", "failed runs require failure");
    }
    const parsedFailure = parseResearchRunFailureV1(object.value.failure, "$.failure");
    if (!parsedFailure.ok) return parsedFailure;
    failure = parsedFailure.value;
  } else if (hasOwn(object.value, "failure")) {
    return fail("semantic_conflict", "$.failure", "failure is only valid with failed");
  }

  if (TERMINAL_RUN_STATUSES.has(status.value)) {
    if (!artifactManifest) {
      return fail(
        "missing_field",
        "$.artifactManifest",
        "Terminal runs require an embedded final artifactManifest",
      );
    }
  }

  if (artifactManifest) {
    const manifestComposition = validateEmbeddedManifestAgainstRun(
      {
        id: id.value,
        ...(context ? { context } : {}),
        privacy: privacy.value,
        status: status.value,
        createdAt: createdAt.value,
        updatedAt: updatedAt.value,
      },
      artifactManifest,
      undefined,
      "$.artifactManifest",
      "tip",
    );
    if (!manifestComposition.ok) return manifestComposition;
  }

  return pass({
    ...object.value,
    schema: schema.value,
    id: id.value,
    ...(typeof tenantOpaqueId === "string" ? { tenantOpaqueId } : {}),
    ...(context ? { context } : {}),
    acceptedTopic: acceptedTopic.value,
    execution: execution.value,
    privacy: privacy.value,
    bounds: bounds.value,
    status: status.value,
    ...(typeof waitingReason === "string" ? { waitingReason } : {}),
    ...(typeof waitingForPhase === "string" ? { waitingForPhase } : {}),
    createdAt: createdAt.value,
    updatedAt: updatedAt.value,
    nextEventSequence: nextEventSequence.value,
    ...(artifactManifest ? { artifactManifest } : {}),
    ...(failure ? { failure } : {}),
  });
}

export function parseRunEventV1(value: unknown): ProtocolParseResult<RunEventV1> {
  const wireValue = copyProtocolJsonValue(value);
  if (!wireValue.ok) return wireValue;

  const object = parseObject(wireValue.value, "$");
  if (!object.ok) return object;

  const schemaField = parseRequiredField(object.value, "schema", "$");
  if (!schemaField.ok) return schemaField;
  const schema = parseSchema(
    schemaField.value,
    RUN_EVENT_SCHEMA,
    RUN_EVENT_SCHEMA_RE,
    "$.schema",
    "schema",
  );
  if (!schema.ok) return schema;

  const idField = parseRequiredField(object.value, "id", "$");
  if (!idField.ok) return idField;
  const id = parseOpaqueIdentifier(idField.value, "event", "$.id", "id");
  if (!id.ok) return id;

  const runIdField = parseRequiredField(object.value, "runId", "$");
  if (!runIdField.ok) return runIdField;
  const runId = parseOpaqueIdentifier(runIdField.value, "run", "$.runId", "runId");
  if (!runId.ok) return runId;

  const sequenceField = parseRequiredField(object.value, "sequence", "$");
  if (!sequenceField.ok) return sequenceField;
  const sequence = parsePositiveSafeInteger(sequenceField.value, "$.sequence", "sequence");
  if (!sequence.ok) return sequence;

  const typeField = parseRequiredField(object.value, "type", "$");
  if (!typeField.ok) return typeField;
  const type = parseEnumValue(typeField.value, RUN_EVENT_TYPES, "$.type", "type");
  if (!type.ok) return type;

  if (type.value === "content.deleted") {
    const closedEvent = validateClosedObjectKeys(
      object.value,
      CONTENT_DELETED_EVENT_KEYS,
      "$",
      "content.deleted event",
    );
    if (!closedEvent.ok) return closedEvent;
  }

  const atField = parseRequiredField(object.value, "at", "$");
  if (!atField.ok) return atField;
  const at = parseUtc(atField.value, "$.at", "at");
  if (!at.ok) return at;

  const dataField = parseRequiredField(object.value, "data", "$");
  if (!dataField.ok) return dataField;
  const data = parseObject(dataField.value, "$.data");
  if (!data.ok) return data;
  if (type.value === "content.deleted") {
    const parsedData = parseContentDeletedEventData(data.value, "$.data");
    if (!parsedData.ok) return parsedData;
    return pass({
      schema: schema.value,
      id: id.value,
      runId: runId.value,
      sequence: sequence.value,
      type: type.value,
      at: at.value,
      data: parsedData.value,
    });
  }

  return pass({
    ...object.value,
    schema: schema.value,
    id: id.value,
    runId: runId.value,
    sequence: sequence.value,
    type: type.value,
    at: at.value,
    data: { ...data.value },
  });
}

export function validateRunEventSequence(
  events: readonly RunEventV1[],
): ProtocolParseResult<readonly RunEventV1[]> {
  if (events.length === 0) {
    return fail("semantic_conflict", "$", "At least one event is required");
  }

  const first = events[0];
  if (!Number.isSafeInteger(first.sequence) || first.sequence < 1) {
    return fail("semantic_conflict", "$[0].sequence", "Event sequence must be a safe integer >= 1");
  }
  if (first.sequence !== 1) {
    return fail("semantic_conflict", "$[0].sequence", "First event sequence must equal 1");
  }

  const runId = first.runId;
  for (const [index, event] of events.entries()) {
    const eventPath = indexPath("$", index);
    if (event.runId !== runId) {
      return fail("semantic_conflict", childPath(eventPath, "runId"), `Event runId must equal ${runId}`);
    }
    if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) {
      return fail(
        "semantic_conflict",
        childPath(eventPath, "sequence"),
        "Event sequence must be a safe integer >= 1",
      );
    }
    const expectedSequence = index + 1;
    if (event.sequence !== expectedSequence) {
      return fail(
        "semantic_conflict",
        childPath(eventPath, "sequence"),
        `Event sequence must equal ${expectedSequence}`,
      );
    }
  }

  return pass(events);
}

/**
 * Validates an already-parsed run's deletion receipt against its complete event
 * stream. Runs without a manifest or completed deletion still validate stream
 * order and completeness, but do not require a content.deleted event.
 */
export function validateRunManifestDeletionEventV1(
  run: ResearchRunV1,
  events: readonly RunEventV1[],
): ProtocolParseResult<ResearchRunV1> {
  if (events.length > 0) {
    const orderedEvents = validateRunEventSequence(events);
    if (!orderedEvents.ok) return orderedEvents;
    if (events[0].runId !== run.id) {
      return fail(
        "semantic_conflict",
        "$[0].runId",
        "Event stream runId must match the enclosing run id",
      );
    }
  }

  const expectedEventCount = run.nextEventSequence - 1;
  if (events.length !== expectedEventCount) {
    return fail(
      "semantic_conflict",
      "$",
      `Complete event stream must contain exactly ${expectedEventCount} events`,
    );
  }

  const manifest = run.artifactManifest;
  if (!manifest || manifest.deletion.status !== "completed") {
    return pass(run);
  }
  if (manifest.runId !== run.id) {
    return fail(
      "semantic_conflict",
      "$.artifactManifest.runId",
      "artifactManifest.runId must match the enclosing run id",
    );
  }
  if (manifest.state !== "final") {
    return fail(
      "semantic_conflict",
      "$.artifactManifest.state",
      "Completed deletion requires a final artifactManifest",
    );
  }

  const eventSequence = manifest.deletion.eventSequence;
  if (eventSequence === undefined || !Number.isSafeInteger(eventSequence) || eventSequence < 1) {
    return fail(
      "semantic_conflict",
      "$.artifactManifest.deletion.eventSequence",
      "Completed deletion requires a valid eventSequence",
    );
  }
  const eventIndex = eventSequence - 1;
  const event = events[eventIndex];
  if (!event || event.sequence !== eventSequence || event.runId !== run.id) {
    return fail(
      "semantic_conflict",
      "$.artifactManifest.deletion.eventSequence",
      "Deletion eventSequence must identify an event in the complete run stream",
    );
  }
  if (event.type !== "content.deleted") {
    return fail(
      "semantic_conflict",
      `$[${eventIndex}].type`,
      "Deletion eventSequence must identify content.deleted",
    );
  }
  const requestedAt = manifest.deletion.requestedAt;
  const completedAt = manifest.deletion.completedAt;
  if (requestedAt === undefined || completedAt === undefined) {
    return fail(
      "semantic_conflict",
      "$.artifactManifest.deletion",
      "Completed deletion requires request and completion timestamps",
    );
  }
  if (compareUtcTimestamps(event.at, run.createdAt) < 0) {
    return fail(
      "semantic_conflict",
      `$[${eventIndex}].at`,
      "content.deleted must not precede run creation",
    );
  }
  if (compareUtcTimestamps(event.at, manifest.createdAt) < 0) {
    return fail(
      "semantic_conflict",
      `$[${eventIndex}].at`,
      "content.deleted must not precede manifest creation",
    );
  }
  if (
    compareUtcTimestamps(event.at, requestedAt) < 0
    || compareUtcTimestamps(event.at, completedAt) > 0
  ) {
    return fail(
      "semantic_conflict",
      `$[${eventIndex}].at`,
      "content.deleted must occur between deletion request and completion",
    );
  }
  if (event.data.deletedObjectCount !== manifest.deletion.deletedObjectCount) {
    return fail(
      "semantic_conflict",
      `$[${eventIndex}].data.deletedObjectCount`,
      "content.deleted object count must match the deletion receipt",
    );
  }
  if (event.data.manifestStatus !== "deleted") {
    return fail(
      "semantic_conflict",
      `$[${eventIndex}].data.manifestStatus`,
      "content.deleted manifestStatus must equal deleted",
    );
  }

  return pass(run);
}
