import {
  fail,
  isOpaqueId,
  isRecord,
  isSha256,
  isUtcTimestamp,
  pass,
  type ProtocolParseResult,
  type UnknownFields,
} from "./common.ts";
import {
  parseContextSelectorV1,
  type ContextSelectorV1,
} from "./context-pack.ts";

const TOPIC_DISCOVERY_JOB_SCHEMA = "opencoven.topic-discovery-job/v1";
const TOPIC_DISCOVERY_JOB_SCHEMA_RE = /^opencoven\.topic-discovery-job\/v(\d+)$/;
const TOPIC_PROPOSAL_SCHEMA = "opencoven.topic-proposal/v1";
const TOPIC_PROPOSAL_SCHEMA_RE = /^opencoven\.topic-proposal\/v(\d+)$/;
const JOB_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;
const MODEL_SOURCES = [
  "next-message",
  "session",
  "familiar-default",
  "runtime-default",
  "global-default",
] as const;
const SUGGESTED_MODES = ["brief", "sweep", "paper", "autoresearch"] as const;
const SCORE_KEYS = [
  "groundability",
  "decisionValue",
  "unresolvedness",
  "recurrence",
  "novelty",
  "timeliness",
  "familiarFit",
  "feasibility",
  "humanResonance",
] as const;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

export type TopicEvidenceRefV1 = {
  resourceId: string;
  selector: ContextSelectorV1;
  excerpt: string;
  excerptDigest: string;
} & UnknownFields;

export type ResearchModelUsageV1 = {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  reportedByRuntime: boolean;
} & UnknownFields;

export type ResearchModelReceiptV1 = {
  familiarId: string;
  runtime: string;
  effectiveModel: string | null;
  modelSource: "next-message" | "session" | "familiar-default" | "runtime-default" | "global-default";
  providerBilling: "user-connected";
  usage: ResearchModelUsageV1;
} & UnknownFields;

export type TopicDiscoveryFailureV1 = {
  code: string;
  message: string;
  retryable: boolean;
} & UnknownFields;

export type TopicDiscoveryJobV1 = {
  schema: "opencoven.topic-discovery-job/v1";
  id: string;
  contextPackId: string;
  contextPackDigest: string;
  familiarId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  requestedAt: string;
  startedAt?: string;
  finishedAt?: string;
  proposalIds: string[];
  modelReceipt?: ResearchModelReceiptV1;
  failure?: TopicDiscoveryFailureV1;
} & UnknownFields;

export type TopicProposalScoresV1 = {
  groundability: number;
  decisionValue: number;
  unresolvedness: number;
  recurrence: number;
  novelty: number;
  timeliness: number;
  familiarFit: number;
  feasibility: number;
  humanResonance: number;
  riskPenalty: number;
  visibleTotal: number;
} & UnknownFields;

export type TopicProposalSuggestedV1 = {
  mode: "brief" | "sweep" | "paper" | "autoresearch";
  deliverable: string;
  sourceTarget: number;
  wallClockMinutes: number;
} & UnknownFields;

export type TopicProposalV1 = {
  schema: "opencoven.topic-proposal/v1";
  id: string;
  discoveryJobId: string;
  contextPackId: string;
  title: string;
  question: string;
  whyNow: string;
  evidence: TopicEvidenceRefV1[];
  counterevidence: TopicEvidenceRefV1[];
  scores: TopicProposalScoresV1;
  suggested: TopicProposalSuggestedV1;
  uncertainty: string;
  relatedMissionIds: string[];
  createdAt: string;
} & UnknownFields;

type JobStatusV1 = TopicDiscoveryJobV1["status"];
type ModelSourceV1 = ResearchModelReceiptV1["modelSource"];
type SuggestedModeV1 = TopicProposalSuggestedV1["mode"];
type ScoreKey = (typeof SCORE_KEYS)[number];

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

function parseNullableSafeInteger(
  value: unknown,
  path: string,
  label: string,
): ProtocolParseResult<number | null> {
  if (value === null) {
    return pass(null);
  }
  return parseSafeIntegerInRange(value, path, label, 0, MAX_SAFE_INTEGER);
}

function parseNullableNonNegativeFiniteNumber(
  value: unknown,
  path: string,
  label: string,
): ProtocolParseResult<number | null> {
  if (value === null) {
    return pass(null);
  }
  if (typeof value !== "number") {
    return fail("invalid_type", path, `${label} must be a number or null`);
  }
  if (!Number.isFinite(value) || value < 0) {
    return fail("invalid_value", path, `${label} must be a finite number >= 0 or null`);
  }
  return pass(value);
}

function parseNullableString(value: unknown, path: string, label: string): ProtocolParseResult<string | null> {
  if (value === null) {
    return pass(null);
  }
  return parseString(value, path, label);
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

function parseSha256(value: unknown, path: string, label: string): ProtocolParseResult<string> {
  if (typeof value !== "string") {
    return fail("invalid_type", path, `${label} must be a string`);
  }
  if (!isSha256(value)) {
    return fail("invalid_value", path, `${label} must be a lowercase SHA-256 digest`);
  }
  return pass(value);
}

function parseUtc(value: unknown, path: string, label: string): ProtocolParseResult<string> {
  if (typeof value !== "string") {
    return fail("invalid_type", path, `${label} must be a string`);
  }
  if (!isUtcTimestamp(value)) {
    return fail("invalid_value", path, `${label} must be a canonical UTC timestamp with milliseconds`);
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

function parseTopicEvidenceRefV1(value: unknown, path: string): ProtocolParseResult<TopicEvidenceRefV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const resourceIdField = parseRequiredField(object.value, "resourceId", path);
  if (!resourceIdField.ok) return resourceIdField;
  const resourceId = parseOpaqueIdentifier(resourceIdField.value, "resource", childPath(path, "resourceId"), "resourceId");
  if (!resourceId.ok) return resourceId;

  const selectorField = parseRequiredField(object.value, "selector", path);
  if (!selectorField.ok) return selectorField;
  const selector = parseContextSelectorV1(selectorField.value, childPath(path, "selector"));
  if (!selector.ok) return selector;

  const excerptField = parseRequiredField(object.value, "excerpt", path);
  if (!excerptField.ok) return excerptField;
  const excerpt = parseString(excerptField.value, childPath(path, "excerpt"), "excerpt");
  if (!excerpt.ok) return excerpt;

  const excerptDigestField = parseRequiredField(object.value, "excerptDigest", path);
  if (!excerptDigestField.ok) return excerptDigestField;
  const excerptDigest = parseSha256(excerptDigestField.value, childPath(path, "excerptDigest"), "excerptDigest");
  if (!excerptDigest.ok) return excerptDigest;

  return pass({
    ...object.value,
    resourceId: resourceId.value,
    selector: selector.value,
    excerpt: excerpt.value,
    excerptDigest: excerptDigest.value,
  });
}

function parseEvidenceArray(
  value: unknown,
  path: string,
  { minimum = 0 }: { minimum?: number } = {},
): ProtocolParseResult<TopicEvidenceRefV1[]> {
  if (!Array.isArray(value)) {
    return fail("invalid_type", path, "Expected an array");
  }
  if (value.length < minimum) {
    return fail("invalid_value", path, `Expected at least ${minimum} item${minimum === 1 ? "" : "s"}`);
  }
  const items: TopicEvidenceRefV1[] = [];
  for (const [index, item] of value.entries()) {
    const parsed = parseTopicEvidenceRefV1(item, indexPath(path, index));
    if (!parsed.ok) return parsed;
    items.push(parsed.value);
  }
  return pass(items);
}

function parseUniqueIdArray(
  value: unknown,
  path: string,
  prefix: string,
  label: string,
): ProtocolParseResult<string[]> {
  if (!Array.isArray(value)) {
    return fail("invalid_type", path, `${label} must be an array`);
  }
  const parsed: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    const id = parseOpaqueIdentifier(item, prefix, indexPath(path, index), `${label} item`);
    if (!id.ok) return id;
    if (seen.has(id.value)) {
      return fail("semantic_conflict", indexPath(path, index), `Duplicate ${label} item ${id.value}`);
    }
    seen.add(id.value);
    parsed.push(id.value);
  }
  return pass(parsed);
}

export function topicProposalVisibleTotal(scores: TopicProposalV1["scores"]): number {
  let total = 0;
  for (const key of SCORE_KEYS) {
    total += scores[key];
  }
  return total - scores.riskPenalty;
}

function parseScores(value: unknown, path: string): ProtocolParseResult<TopicProposalScoresV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const parsedScores = {} as Record<ScoreKey, number>;
  for (const key of SCORE_KEYS) {
    const field = parseRequiredField(object.value, key, path);
    if (!field.ok) return field;
    const parsed = parseSafeIntegerInRange(field.value, childPath(path, key), key, 0, 4);
    if (!parsed.ok) return parsed;
    parsedScores[key] = parsed.value;
  }

  const riskPenaltyField = parseRequiredField(object.value, "riskPenalty", path);
  if (!riskPenaltyField.ok) return riskPenaltyField;
  const riskPenalty = parseSafeIntegerInRange(riskPenaltyField.value, childPath(path, "riskPenalty"), "riskPenalty", 0, 4);
  if (!riskPenalty.ok) return riskPenalty;

  const visibleTotalField = parseRequiredField(object.value, "visibleTotal", path);
  if (!visibleTotalField.ok) return visibleTotalField;
  const visibleTotal = parseSafeIntegerInRange(
    visibleTotalField.value,
    childPath(path, "visibleTotal"),
    "visibleTotal",
    -4,
    36,
  );
  if (!visibleTotal.ok) return visibleTotal;

  const scores = {
    ...object.value,
    ...parsedScores,
    riskPenalty: riskPenalty.value,
    visibleTotal: visibleTotal.value,
  } as TopicProposalScoresV1;
  const expectedVisibleTotal = topicProposalVisibleTotal(scores);
  if (visibleTotal.value !== expectedVisibleTotal) {
    return fail(
      "semantic_conflict",
      childPath(path, "visibleTotal"),
      `visibleTotal must equal recomputed total ${expectedVisibleTotal}`,
    );
  }

  return pass(scores);
}

function parseSuggested(value: unknown, path: string): ProtocolParseResult<TopicProposalSuggestedV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const modeField = parseRequiredField(object.value, "mode", path);
  if (!modeField.ok) return modeField;
  const mode = parseEnumValue(modeField.value, SUGGESTED_MODES, childPath(path, "mode"), "mode");
  if (!mode.ok) return mode;

  const deliverableField = parseRequiredField(object.value, "deliverable", path);
  if (!deliverableField.ok) return deliverableField;
  const deliverable = parseString(deliverableField.value, childPath(path, "deliverable"), "deliverable");
  if (!deliverable.ok) return deliverable;

  const sourceTargetField = parseRequiredField(object.value, "sourceTarget", path);
  if (!sourceTargetField.ok) return sourceTargetField;
  const sourceTarget = parsePositiveSafeInteger(sourceTargetField.value, childPath(path, "sourceTarget"), "sourceTarget");
  if (!sourceTarget.ok) return sourceTarget;

  const wallClockMinutesField = parseRequiredField(object.value, "wallClockMinutes", path);
  if (!wallClockMinutesField.ok) return wallClockMinutesField;
  const wallClockMinutes = parsePositiveSafeInteger(
    wallClockMinutesField.value,
    childPath(path, "wallClockMinutes"),
    "wallClockMinutes",
  );
  if (!wallClockMinutes.ok) return wallClockMinutes;

  return pass({
    ...object.value,
    mode: mode.value as SuggestedModeV1,
    deliverable: deliverable.value,
    sourceTarget: sourceTarget.value,
    wallClockMinutes: wallClockMinutes.value,
  });
}

function parseTopicDiscoveryFailureV1(
  value: unknown,
  path: string,
): ProtocolParseResult<TopicDiscoveryFailureV1> {
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

function parseModelUsage(value: unknown, path: string): ProtocolParseResult<ResearchModelUsageV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const inputTokensField = parseRequiredField(object.value, "inputTokens", path);
  if (!inputTokensField.ok) return inputTokensField;
  const inputTokens = parseNullableSafeInteger(inputTokensField.value, childPath(path, "inputTokens"), "inputTokens");
  if (!inputTokens.ok) return inputTokens;

  const outputTokensField = parseRequiredField(object.value, "outputTokens", path);
  if (!outputTokensField.ok) return outputTokensField;
  const outputTokens = parseNullableSafeInteger(outputTokensField.value, childPath(path, "outputTokens"), "outputTokens");
  if (!outputTokens.ok) return outputTokens;

  const costUsdField = parseRequiredField(object.value, "costUsd", path);
  if (!costUsdField.ok) return costUsdField;
  const costUsd = parseNullableNonNegativeFiniteNumber(costUsdField.value, childPath(path, "costUsd"), "costUsd");
  if (!costUsd.ok) return costUsd;

  const reportedByRuntimeField = parseRequiredField(object.value, "reportedByRuntime", path);
  if (!reportedByRuntimeField.ok) return reportedByRuntimeField;
  const reportedByRuntime = parseBoolean(
    reportedByRuntimeField.value,
    childPath(path, "reportedByRuntime"),
    "reportedByRuntime",
  );
  if (!reportedByRuntime.ok) return reportedByRuntime;

  const anyNonNull = inputTokens.value !== null || outputTokens.value !== null || costUsd.value !== null;
  if (!reportedByRuntime.value && anyNonNull) {
    return fail(
      "semantic_conflict",
      path,
      "reportedByRuntime false requires inputTokens, outputTokens, and costUsd to all be null",
    );
  }
  if (reportedByRuntime.value && !anyNonNull) {
    return fail(
      "semantic_conflict",
      path,
      "reportedByRuntime true requires at least one of inputTokens, outputTokens, or costUsd to be non-null",
    );
  }

  return pass({
    ...object.value,
    inputTokens: inputTokens.value,
    outputTokens: outputTokens.value,
    costUsd: costUsd.value,
    reportedByRuntime: reportedByRuntime.value,
  });
}

export function parseResearchModelReceiptV1(
  value: unknown,
  path: string,
): ProtocolParseResult<ResearchModelReceiptV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const familiarIdField = parseRequiredField(object.value, "familiarId", path);
  if (!familiarIdField.ok) return familiarIdField;
  const familiarId = parseString(familiarIdField.value, childPath(path, "familiarId"), "familiarId");
  if (!familiarId.ok) return familiarId;

  const runtimeField = parseRequiredField(object.value, "runtime", path);
  if (!runtimeField.ok) return runtimeField;
  const runtime = parseString(runtimeField.value, childPath(path, "runtime"), "runtime");
  if (!runtime.ok) return runtime;

  const effectiveModelField = parseRequiredField(object.value, "effectiveModel", path);
  if (!effectiveModelField.ok) return effectiveModelField;
  const effectiveModel = parseNullableString(
    effectiveModelField.value,
    childPath(path, "effectiveModel"),
    "effectiveModel",
  );
  if (!effectiveModel.ok) return effectiveModel;

  const modelSourceField = parseRequiredField(object.value, "modelSource", path);
  if (!modelSourceField.ok) return modelSourceField;
  const modelSource = parseEnumValue(modelSourceField.value, MODEL_SOURCES, childPath(path, "modelSource"), "modelSource");
  if (!modelSource.ok) return modelSource;

  const providerBillingField = parseRequiredField(object.value, "providerBilling", path);
  if (!providerBillingField.ok) return providerBillingField;
  const providerBilling = parseString(
    providerBillingField.value,
    childPath(path, "providerBilling"),
    "providerBilling",
  );
  if (!providerBilling.ok) return providerBilling;
  if (providerBilling.value !== "user-connected") {
    return fail("invalid_value", childPath(path, "providerBilling"), "providerBilling must be user-connected");
  }

  const usageField = parseRequiredField(object.value, "usage", path);
  if (!usageField.ok) return usageField;
  const usage = parseModelUsage(usageField.value, childPath(path, "usage"));
  if (!usage.ok) return usage;

  return pass({
    ...object.value,
    familiarId: familiarId.value,
    runtime: runtime.value,
    effectiveModel: effectiveModel.value,
    modelSource: modelSource.value as ModelSourceV1,
    providerBilling: "user-connected",
    usage: usage.value,
  });
}

export function parseTopicDiscoveryJobV1(value: unknown): ProtocolParseResult<TopicDiscoveryJobV1> {
  const object = parseObject(value, "$");
  if (!object.ok) return object;

  const schemaField = parseRequiredField(object.value, "schema", "$");
  if (!schemaField.ok) return schemaField;
  const schema = parseSchema(
    schemaField.value,
    TOPIC_DISCOVERY_JOB_SCHEMA,
    TOPIC_DISCOVERY_JOB_SCHEMA_RE,
    "$.schema",
    "schema",
  );
  if (!schema.ok) return schema;

  const idField = parseRequiredField(object.value, "id", "$");
  if (!idField.ok) return idField;
  const id = parseOpaqueIdentifier(idField.value, "topicjob", "$.id", "id");
  if (!id.ok) return id;

  const contextPackIdField = parseRequiredField(object.value, "contextPackId", "$");
  if (!contextPackIdField.ok) return contextPackIdField;
  const contextPackId = parseOpaqueIdentifier(contextPackIdField.value, "ctx", "$.contextPackId", "contextPackId");
  if (!contextPackId.ok) return contextPackId;

  const contextPackDigestField = parseRequiredField(object.value, "contextPackDigest", "$");
  if (!contextPackDigestField.ok) return contextPackDigestField;
  const contextPackDigest = parseSha256(contextPackDigestField.value, "$.contextPackDigest", "contextPackDigest");
  if (!contextPackDigest.ok) return contextPackDigest;

  const familiarIdField = parseRequiredField(object.value, "familiarId", "$");
  if (!familiarIdField.ok) return familiarIdField;
  const familiarId = parseString(familiarIdField.value, "$.familiarId", "familiarId");
  if (!familiarId.ok) return familiarId;

  const statusField = parseRequiredField(object.value, "status", "$");
  if (!statusField.ok) return statusField;
  const status = parseEnumValue(statusField.value, JOB_STATUSES, "$.status", "status");
  if (!status.ok) return status;

  const requestedAtField = parseRequiredField(object.value, "requestedAt", "$");
  if (!requestedAtField.ok) return requestedAtField;
  const requestedAt = parseUtc(requestedAtField.value, "$.requestedAt", "requestedAt");
  if (!requestedAt.ok) return requestedAt;

  let startedAt: string | undefined;
  if (hasOwn(object.value, "startedAt")) {
    const parsedStartedAt = parseUtc(object.value.startedAt, "$.startedAt", "startedAt");
    if (!parsedStartedAt.ok) return parsedStartedAt;
    startedAt = parsedStartedAt.value;
  }

  let finishedAt: string | undefined;
  if (hasOwn(object.value, "finishedAt")) {
    const parsedFinishedAt = parseUtc(object.value.finishedAt, "$.finishedAt", "finishedAt");
    if (!parsedFinishedAt.ok) return parsedFinishedAt;
    finishedAt = parsedFinishedAt.value;
  }

  const proposalIdsField = parseRequiredField(object.value, "proposalIds", "$");
  if (!proposalIdsField.ok) return proposalIdsField;
  const proposalIds = parseUniqueIdArray(proposalIdsField.value, "$.proposalIds", "proposal", "proposalIds");
  if (!proposalIds.ok) return proposalIds;

  let modelReceipt: ResearchModelReceiptV1 | undefined;
  if (hasOwn(object.value, "modelReceipt")) {
    const parsedModelReceipt = parseResearchModelReceiptV1(object.value.modelReceipt, "$.modelReceipt");
    if (!parsedModelReceipt.ok) return parsedModelReceipt;
    modelReceipt = parsedModelReceipt.value;
  }

  let failure: TopicDiscoveryFailureV1 | undefined;
  if (hasOwn(object.value, "failure")) {
    const parsedFailure = parseTopicDiscoveryFailureV1(object.value.failure, "$.failure");
    if (!parsedFailure.ok) return parsedFailure;
    failure = parsedFailure.value;
  }

  if (status.value === "running" && typeof startedAt === "undefined") {
    return fail("missing_field", "$.startedAt", "running jobs require startedAt");
  }
  if (["completed", "failed", "cancelled"].includes(status.value) && typeof finishedAt === "undefined") {
    return fail("missing_field", "$.finishedAt", `${status.value} jobs require finishedAt`);
  }
  if (status.value === "completed" && typeof failure !== "undefined") {
    return fail("semantic_conflict", "$.failure", "completed jobs must not include failure");
  }
  if (status.value === "failed" && typeof failure === "undefined") {
    return fail("missing_field", "$.failure", "failed jobs require failure");
  }

  return pass({
    ...object.value,
    schema: TOPIC_DISCOVERY_JOB_SCHEMA,
    id: id.value,
    contextPackId: contextPackId.value,
    contextPackDigest: contextPackDigest.value,
    familiarId: familiarId.value,
    status: status.value as JobStatusV1,
    requestedAt: requestedAt.value,
    ...(typeof startedAt === "string" ? { startedAt } : {}),
    ...(typeof finishedAt === "string" ? { finishedAt } : {}),
    proposalIds: proposalIds.value,
    ...(modelReceipt ? { modelReceipt } : {}),
    ...(failure ? { failure } : {}),
  });
}

export function parseTopicProposalV1(value: unknown): ProtocolParseResult<TopicProposalV1> {
  const object = parseObject(value, "$");
  if (!object.ok) return object;

  const schemaField = parseRequiredField(object.value, "schema", "$");
  if (!schemaField.ok) return schemaField;
  const schema = parseSchema(
    schemaField.value,
    TOPIC_PROPOSAL_SCHEMA,
    TOPIC_PROPOSAL_SCHEMA_RE,
    "$.schema",
    "schema",
  );
  if (!schema.ok) return schema;

  const idField = parseRequiredField(object.value, "id", "$");
  if (!idField.ok) return idField;
  const id = parseOpaqueIdentifier(idField.value, "proposal", "$.id", "id");
  if (!id.ok) return id;

  const discoveryJobIdField = parseRequiredField(object.value, "discoveryJobId", "$");
  if (!discoveryJobIdField.ok) return discoveryJobIdField;
  const discoveryJobId = parseOpaqueIdentifier(
    discoveryJobIdField.value,
    "topicjob",
    "$.discoveryJobId",
    "discoveryJobId",
  );
  if (!discoveryJobId.ok) return discoveryJobId;

  const contextPackIdField = parseRequiredField(object.value, "contextPackId", "$");
  if (!contextPackIdField.ok) return contextPackIdField;
  const contextPackId = parseOpaqueIdentifier(contextPackIdField.value, "ctx", "$.contextPackId", "contextPackId");
  if (!contextPackId.ok) return contextPackId;

  const titleField = parseRequiredField(object.value, "title", "$");
  if (!titleField.ok) return titleField;
  const title = parseString(titleField.value, "$.title", "title");
  if (!title.ok) return title;

  const questionField = parseRequiredField(object.value, "question", "$");
  if (!questionField.ok) return questionField;
  const question = parseString(questionField.value, "$.question", "question");
  if (!question.ok) return question;

  const whyNowField = parseRequiredField(object.value, "whyNow", "$");
  if (!whyNowField.ok) return whyNowField;
  const whyNow = parseString(whyNowField.value, "$.whyNow", "whyNow");
  if (!whyNow.ok) return whyNow;

  const evidenceField = parseRequiredField(object.value, "evidence", "$");
  if (!evidenceField.ok) return evidenceField;
  const evidence = parseEvidenceArray(evidenceField.value, "$.evidence", { minimum: 1 });
  if (!evidence.ok) return evidence;

  const counterevidenceField = parseRequiredField(object.value, "counterevidence", "$");
  if (!counterevidenceField.ok) return counterevidenceField;
  const counterevidence = parseEvidenceArray(counterevidenceField.value, "$.counterevidence");
  if (!counterevidence.ok) return counterevidence;

  const scoresField = parseRequiredField(object.value, "scores", "$");
  if (!scoresField.ok) return scoresField;
  const scores = parseScores(scoresField.value, "$.scores");
  if (!scores.ok) return scores;

  const suggestedField = parseRequiredField(object.value, "suggested", "$");
  if (!suggestedField.ok) return suggestedField;
  const suggested = parseSuggested(suggestedField.value, "$.suggested");
  if (!suggested.ok) return suggested;

  const uncertaintyField = parseRequiredField(object.value, "uncertainty", "$");
  if (!uncertaintyField.ok) return uncertaintyField;
  const uncertainty = parseString(uncertaintyField.value, "$.uncertainty", "uncertainty");
  if (!uncertainty.ok) return uncertainty;

  const relatedMissionIdsField = parseRequiredField(object.value, "relatedMissionIds", "$");
  if (!relatedMissionIdsField.ok) return relatedMissionIdsField;
  const relatedMissionIds = parseUniqueIdArray(
    relatedMissionIdsField.value,
    "$.relatedMissionIds",
    "mission",
    "relatedMissionIds",
  );
  if (!relatedMissionIds.ok) return relatedMissionIds;

  const createdAtField = parseRequiredField(object.value, "createdAt", "$");
  if (!createdAtField.ok) return createdAtField;
  const createdAt = parseUtc(createdAtField.value, "$.createdAt", "createdAt");
  if (!createdAt.ok) return createdAt;

  return pass({
    ...object.value,
    schema: TOPIC_PROPOSAL_SCHEMA,
    id: id.value,
    discoveryJobId: discoveryJobId.value,
    contextPackId: contextPackId.value,
    title: title.value,
    question: question.value,
    whyNow: whyNow.value,
    evidence: evidence.value,
    counterevidence: counterevidence.value,
    scores: scores.value,
    suggested: suggested.value,
    uncertainty: uncertainty.value,
    relatedMissionIds: relatedMissionIds.value,
    createdAt: createdAt.value,
  });
}
