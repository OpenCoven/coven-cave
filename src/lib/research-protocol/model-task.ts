import {
  copyProtocolJsonValue,
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
  parseResearchModelReceiptV1,
  type ResearchModelReceiptV1,
} from "./topic-discovery.ts";
import { canonicalJson, sha256Digest } from "./digest.ts";

const MODEL_TASK_SCHEMA = "opencoven.model-task/v1";
const MODEL_TASK_SCHEMA_RE = /^opencoven\.model-task\/v(\d+)$/;
const MODEL_TASK_RESULT_SCHEMA = "opencoven.model-task-result/v1";
const MODEL_TASK_RESULT_SCHEMA_RE = /^opencoven\.model-task-result\/v(\d+)$/;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const CANONICAL_JSON_ERROR_RE = /^Value at (.+) is not canonical JSON: (.+)$/;

const TASK_PHASES = ["scope", "challenge", "synthesize", "control"] as const;
const MODEL_SELECTIONS = ["resolve-at-run-start", "pinned"] as const;
const DEVICE_LOCAL_AVAILABILITY = ["device-local"] as const;

type ModelTaskInputContextPackV1 = {
  id: string;
  digest: string;
  availability: "device-local";
} & UnknownFields;

type ModelTaskInputV1 = {
  topicProposalId?: string;
  contextPack: ModelTaskInputContextPackV1;
  publicEvidenceRefs: string[];
} & UnknownFields;

type ModelTaskModelBindingV1 = {
  familiarId: string;
  selection: "resolve-at-run-start" | "pinned";
  model?: string;
} & UnknownFields;

type ModelTaskPolicyV1 = {
  permissionMode: "read";
  allowedOutputs: string[];
  allowRemoteQueries: boolean;
  maxOutputTokens: number;
} & UnknownFields;

export type ModelTaskV1 = {
  schema: "opencoven.model-task/v1";
  id: string;
  runId: string;
  phase: "scope" | "challenge" | "synthesize" | "control";
  attempt: number;
  inputDigest: string;
  input: ModelTaskInputV1;
  modelBinding: ModelTaskModelBindingV1;
  policy: ModelTaskPolicyV1;
  outputSchema: string;
  leaseExpiresAt: string;
} & UnknownFields;

export type ModelTaskResultV1 = {
  schema: "opencoven.model-task-result/v1";
  taskId: string;
  runId: string;
  attempt: number;
  inputDigest: string;
  output: Record<string, unknown>;
  outputDigest: string;
  executorDeviceId: string;
  modelReceipt: ResearchModelReceiptV1;
  completedAt: string;
  signature: string;
} & UnknownFields;

export type ModelTaskResultSignaturePayloadV1 = Pick<
  ModelTaskResultV1,
  | "taskId"
  | "runId"
  | "attempt"
  | "inputDigest"
  | "outputDigest"
  | "executorDeviceId"
  | "completedAt"
>;

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

function parseNonEmptyString(value: unknown, path: string, label: string): ProtocolParseResult<string> {
  const stringValue = parseString(value, path, label);
  if (!stringValue.ok) return stringValue;
  if (stringValue.value.length === 0) {
    return fail("invalid_value", path, `${label} must be a non-empty string`);
  }
  return stringValue;
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
    return fail(
      "invalid_value",
      path,
      `${label} must be a UTC RFC 3339 timestamp`,
    );
  }
  return pass(value);
}

function parseUniqueNonEmptyStringArray(
  value: unknown,
  path: string,
  label: string,
  minimumLength: number,
): ProtocolParseResult<string[]> {
  if (!Array.isArray(value)) {
    return fail("invalid_type", path, `${label} must be an array`);
  }
  if (value.length < minimumLength) {
    return fail("invalid_value", path, `${label} must contain at least ${minimumLength} item(s)`);
  }

  const seen = new Set<string>();
  const parsed: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const itemPath = indexPath(path, index);
    const item = parseNonEmptyString(value[index], itemPath, `${label} item`);
    if (!item.ok) return item;
    if (seen.has(item.value)) {
      return fail("semantic_conflict", itemPath, `${label} must not contain duplicate values`);
    }
    seen.add(item.value);
    parsed.push(item.value);
  }

  return pass(parsed);
}

function parseContextPackInput(
  value: unknown,
  path: string,
): ProtocolParseResult<ModelTaskInputContextPackV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const idField = parseRequiredField(object.value, "id", path);
  if (!idField.ok) return idField;
  const id = parseOpaqueIdentifier(idField.value, "ctx", childPath(path, "id"), "id");
  if (!id.ok) return id;

  const digestField = parseRequiredField(object.value, "digest", path);
  if (!digestField.ok) return digestField;
  const digest = parseSha256(digestField.value, childPath(path, "digest"), "digest");
  if (!digest.ok) return digest;

  const availabilityField = parseRequiredField(object.value, "availability", path);
  if (!availabilityField.ok) return availabilityField;
  const availability = parseEnumValue(
    availabilityField.value,
    DEVICE_LOCAL_AVAILABILITY,
    childPath(path, "availability"),
    "availability",
  );
  if (!availability.ok) return availability;

  return pass({
    ...object.value,
    id: id.value,
    digest: digest.value,
    availability: availability.value,
  });
}

function parseModelTaskInput(value: unknown, path: string): ProtocolParseResult<ModelTaskInputV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  let topicProposalId: string | undefined;
  if (hasOwn(object.value, "topicProposalId")) {
    const parsedTopicProposalId = parseOpaqueIdentifier(
      object.value.topicProposalId,
      "proposal",
      childPath(path, "topicProposalId"),
      "topicProposalId",
    );
    if (!parsedTopicProposalId.ok) return parsedTopicProposalId;
    topicProposalId = parsedTopicProposalId.value;
  }

  const contextPackField = parseRequiredField(object.value, "contextPack", path);
  if (!contextPackField.ok) return contextPackField;
  const contextPack = parseContextPackInput(contextPackField.value, childPath(path, "contextPack"));
  if (!contextPack.ok) return contextPack;

  const publicEvidenceRefsField = parseRequiredField(object.value, "publicEvidenceRefs", path);
  if (!publicEvidenceRefsField.ok) return publicEvidenceRefsField;
  const publicEvidenceRefs = parseUniqueNonEmptyStringArray(
    publicEvidenceRefsField.value,
    childPath(path, "publicEvidenceRefs"),
    "publicEvidenceRefs",
    0,
  );
  if (!publicEvidenceRefs.ok) return publicEvidenceRefs;

  return pass({
    ...object.value,
    ...(typeof topicProposalId === "string" ? { topicProposalId } : {}),
    contextPack: contextPack.value,
    publicEvidenceRefs: publicEvidenceRefs.value,
  });
}

function parseModelBinding(value: unknown, path: string): ProtocolParseResult<ModelTaskModelBindingV1> {
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

function parsePolicy(value: unknown, path: string): ProtocolParseResult<ModelTaskPolicyV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const permissionModeField = parseRequiredField(object.value, "permissionMode", path);
  if (!permissionModeField.ok) return permissionModeField;
  const permissionMode = parseString(
    permissionModeField.value,
    childPath(path, "permissionMode"),
    "permissionMode",
  );
  if (!permissionMode.ok) return permissionMode;
  if (permissionMode.value !== "read") {
    return fail("invalid_value", childPath(path, "permissionMode"), "permissionMode must be read");
  }

  const allowedOutputsField = parseRequiredField(object.value, "allowedOutputs", path);
  if (!allowedOutputsField.ok) return allowedOutputsField;
  const allowedOutputs = parseUniqueNonEmptyStringArray(
    allowedOutputsField.value,
    childPath(path, "allowedOutputs"),
    "allowedOutputs",
    1,
  );
  if (!allowedOutputs.ok) return allowedOutputs;

  const allowRemoteQueriesField = parseRequiredField(object.value, "allowRemoteQueries", path);
  if (!allowRemoteQueriesField.ok) return allowRemoteQueriesField;
  const allowRemoteQueries = parseBoolean(
    allowRemoteQueriesField.value,
    childPath(path, "allowRemoteQueries"),
    "allowRemoteQueries",
  );
  if (!allowRemoteQueries.ok) return allowRemoteQueries;

  const maxOutputTokensField = parseRequiredField(object.value, "maxOutputTokens", path);
  if (!maxOutputTokensField.ok) return maxOutputTokensField;
  const maxOutputTokens = parsePositiveSafeInteger(
    maxOutputTokensField.value,
    childPath(path, "maxOutputTokens"),
    "maxOutputTokens",
  );
  if (!maxOutputTokens.ok) return maxOutputTokens;

  return pass({
    ...object.value,
    permissionMode: "read",
    allowedOutputs: allowedOutputs.value,
    allowRemoteQueries: allowRemoteQueries.value,
    maxOutputTokens: maxOutputTokens.value,
  });
}

function parseOutputObject(value: unknown, path: string): ProtocolParseResult<Record<string, unknown>> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  try {
    const wrapped = JSON.parse(canonicalJson({ output: object.value })) as {
      output: Record<string, unknown>;
    };
    return pass(wrapped.output);
  } catch (error) {
    if (error instanceof TypeError) {
      const match = CANONICAL_JSON_ERROR_RE.exec(error.message);
      if (match) {
        return fail("invalid_value", match[1], `output must be canonical JSON: ${match[2]}`);
      }
    }
    return fail("invalid_value", path, "output must be canonical JSON");
  }
}

export function parseModelTaskV1(value: unknown): ProtocolParseResult<ModelTaskV1> {
  const wireValue = copyProtocolJsonValue(value);
  if (!wireValue.ok) return wireValue;

  const object = parseObject(wireValue.value, "$");
  if (!object.ok) return object;

  const schemaField = parseRequiredField(object.value, "schema", "$");
  if (!schemaField.ok) return schemaField;
  const schema = parseSchema(schemaField.value, MODEL_TASK_SCHEMA, MODEL_TASK_SCHEMA_RE, "$.schema", "schema");
  if (!schema.ok) return schema;

  const idField = parseRequiredField(object.value, "id", "$");
  if (!idField.ok) return idField;
  const id = parseOpaqueIdentifier(idField.value, "modeltask", "$.id", "id");
  if (!id.ok) return id;

  const runIdField = parseRequiredField(object.value, "runId", "$");
  if (!runIdField.ok) return runIdField;
  const runId = parseOpaqueIdentifier(runIdField.value, "run", "$.runId", "runId");
  if (!runId.ok) return runId;

  const phaseField = parseRequiredField(object.value, "phase", "$");
  if (!phaseField.ok) return phaseField;
  const phase = parseEnumValue(phaseField.value, TASK_PHASES, "$.phase", "phase");
  if (!phase.ok) return phase;

  const attemptField = parseRequiredField(object.value, "attempt", "$");
  if (!attemptField.ok) return attemptField;
  const attempt = parsePositiveSafeInteger(attemptField.value, "$.attempt", "attempt");
  if (!attempt.ok) return attempt;

  const inputDigestField = parseRequiredField(object.value, "inputDigest", "$");
  if (!inputDigestField.ok) return inputDigestField;
  const inputDigest = parseSha256(inputDigestField.value, "$.inputDigest", "inputDigest");
  if (!inputDigest.ok) return inputDigest;

  const inputField = parseRequiredField(object.value, "input", "$");
  if (!inputField.ok) return inputField;
  const input = parseModelTaskInput(inputField.value, "$.input");
  if (!input.ok) return input;

  const modelBindingField = parseRequiredField(object.value, "modelBinding", "$");
  if (!modelBindingField.ok) return modelBindingField;
  const modelBinding = parseModelBinding(modelBindingField.value, "$.modelBinding");
  if (!modelBinding.ok) return modelBinding;

  const policyField = parseRequiredField(object.value, "policy", "$");
  if (!policyField.ok) return policyField;
  const policy = parsePolicy(policyField.value, "$.policy");
  if (!policy.ok) return policy;

  const outputSchemaField = parseRequiredField(object.value, "outputSchema", "$");
  if (!outputSchemaField.ok) return outputSchemaField;
  const outputSchema = parseString(outputSchemaField.value, "$.outputSchema", "outputSchema");
  if (!outputSchema.ok) return outputSchema;

  const leaseExpiresAtField = parseRequiredField(object.value, "leaseExpiresAt", "$");
  if (!leaseExpiresAtField.ok) return leaseExpiresAtField;
  const leaseExpiresAt = parseUtc(leaseExpiresAtField.value, "$.leaseExpiresAt", "leaseExpiresAt");
  if (!leaseExpiresAt.ok) return leaseExpiresAt;

  const parsed = {
    ...object.value,
    schema: schema.value,
    id: id.value,
    runId: runId.value,
    phase: phase.value,
    attempt: attempt.value,
    inputDigest: inputDigest.value,
    input: input.value,
    modelBinding: modelBinding.value,
    policy: policy.value,
    outputSchema: outputSchema.value,
    leaseExpiresAt: leaseExpiresAt.value,
  } as ModelTaskV1;

  let expectedInputDigest: string;
  try {
    expectedInputDigest = sha256Digest(canonicalJson(parsed.input));
  } catch (error) {
    return fail(
      "invalid_value",
      "$.input",
      error instanceof Error ? error.message : "input must be canonical JSON",
    );
  }
  if (parsed.inputDigest !== expectedInputDigest) {
    return fail(
      "digest_mismatch",
      "$.inputDigest",
      `inputDigest must equal recomputed digest ${expectedInputDigest}`,
    );
  }

  return pass(parsed);
}

export function parseModelTaskResultV1(value: unknown): ProtocolParseResult<ModelTaskResultV1> {
  const wireValue = copyProtocolJsonValue(value);
  if (!wireValue.ok) return wireValue;

  const object = parseObject(wireValue.value, "$");
  if (!object.ok) return object;

  const schemaField = parseRequiredField(object.value, "schema", "$");
  if (!schemaField.ok) return schemaField;
  const schema = parseSchema(
    schemaField.value,
    MODEL_TASK_RESULT_SCHEMA,
    MODEL_TASK_RESULT_SCHEMA_RE,
    "$.schema",
    "schema",
  );
  if (!schema.ok) return schema;

  const taskIdField = parseRequiredField(object.value, "taskId", "$");
  if (!taskIdField.ok) return taskIdField;
  const taskId = parseOpaqueIdentifier(taskIdField.value, "modeltask", "$.taskId", "taskId");
  if (!taskId.ok) return taskId;

  const runIdField = parseRequiredField(object.value, "runId", "$");
  if (!runIdField.ok) return runIdField;
  const runId = parseOpaqueIdentifier(runIdField.value, "run", "$.runId", "runId");
  if (!runId.ok) return runId;

  const attemptField = parseRequiredField(object.value, "attempt", "$");
  if (!attemptField.ok) return attemptField;
  const attempt = parsePositiveSafeInteger(attemptField.value, "$.attempt", "attempt");
  if (!attempt.ok) return attempt;

  const inputDigestField = parseRequiredField(object.value, "inputDigest", "$");
  if (!inputDigestField.ok) return inputDigestField;
  const inputDigest = parseSha256(inputDigestField.value, "$.inputDigest", "inputDigest");
  if (!inputDigest.ok) return inputDigest;

  const outputField = parseRequiredField(object.value, "output", "$");
  if (!outputField.ok) return outputField;
  const output = parseOutputObject(outputField.value, "$.output");
  if (!output.ok) return output;

  const outputDigestField = parseRequiredField(object.value, "outputDigest", "$");
  if (!outputDigestField.ok) return outputDigestField;
  const outputDigest = parseSha256(outputDigestField.value, "$.outputDigest", "outputDigest");
  if (!outputDigest.ok) return outputDigest;

  const executorDeviceIdField = parseRequiredField(object.value, "executorDeviceId", "$");
  if (!executorDeviceIdField.ok) return executorDeviceIdField;
  const executorDeviceId = parseSha256(
    executorDeviceIdField.value,
    "$.executorDeviceId",
    "executorDeviceId",
  );
  if (!executorDeviceId.ok) return executorDeviceId;

  const modelReceiptField = parseRequiredField(object.value, "modelReceipt", "$");
  if (!modelReceiptField.ok) return modelReceiptField;
  const modelReceipt = parseResearchModelReceiptV1(modelReceiptField.value, "$.modelReceipt");
  if (!modelReceipt.ok) return modelReceipt;

  const completedAtField = parseRequiredField(object.value, "completedAt", "$");
  if (!completedAtField.ok) return completedAtField;
  const completedAt = parseUtc(completedAtField.value, "$.completedAt", "completedAt");
  if (!completedAt.ok) return completedAt;

  const signatureField = parseRequiredField(object.value, "signature", "$");
  if (!signatureField.ok) return signatureField;
  const signature = parseNonEmptyString(signatureField.value, "$.signature", "signature");
  if (!signature.ok) return signature;

  const parsed = {
    ...object.value,
    schema: schema.value,
    taskId: taskId.value,
    runId: runId.value,
    attempt: attempt.value,
    inputDigest: inputDigest.value,
    output: output.value,
    outputDigest: outputDigest.value,
    executorDeviceId: executorDeviceId.value,
    modelReceipt: modelReceipt.value,
    completedAt: completedAt.value,
    signature: signature.value,
  } as ModelTaskResultV1;

  return pass(parsed);
}

/**
 * Validates one parsed task/result association. Matching replays remain valid;
 * comparing a result with an already persisted receipt is a later storage
 * boundary concern. Unit 4 verifies outputDigest against the declared output
 * schema.
 */
export function validateModelTaskResultV1(
  task: ModelTaskV1,
  result: ModelTaskResultV1,
): ProtocolParseResult<ModelTaskResultV1> {
  let expectedInputDigest: string;
  try {
    expectedInputDigest = sha256Digest(canonicalJson(task.input));
  } catch {
    return fail("invalid_value", "$.input", "Model Task input must be canonical JSON");
  }

  if (task.inputDigest !== expectedInputDigest) {
    return fail(
      "digest_mismatch",
      "$.inputDigest",
      `Model Task inputDigest must equal recomputed digest ${expectedInputDigest}`,
    );
  }
  if (result.taskId !== task.id) {
    return fail("semantic_conflict", "$.taskId", "taskId must equal the Model Task id");
  }
  if (result.runId !== task.runId) {
    return fail("semantic_conflict", "$.runId", "runId must equal the Model Task runId");
  }
  if (result.attempt !== task.attempt) {
    return fail("semantic_conflict", "$.attempt", "attempt must equal the Model Task attempt");
  }
  if (result.inputDigest !== task.inputDigest) {
    return fail("semantic_conflict", "$.inputDigest", "inputDigest must equal the Model Task inputDigest");
  }
  if (result.modelReceipt.familiarId !== task.modelBinding.familiarId) {
    return fail(
      "semantic_conflict",
      "$.modelReceipt.familiarId",
      "modelReceipt familiarId must equal the Model Task familiarId",
    );
  }
  if (
    task.modelBinding.selection === "pinned"
    && result.modelReceipt.effectiveModel !== task.modelBinding.model
  ) {
    return fail(
      "semantic_conflict",
      "$.modelReceipt.effectiveModel",
      "modelReceipt effectiveModel must equal the pinned Model Task model",
    );
  }

  return pass(result);
}

export function modelTaskResultSignaturePayload(
  value: ModelTaskResultV1,
): ModelTaskResultSignaturePayloadV1 {
  return {
    taskId: value.taskId,
    runId: value.runId,
    attempt: value.attempt,
    inputDigest: value.inputDigest,
    outputDigest: value.outputDigest,
    executorDeviceId: value.executorDeviceId,
    completedAt: value.completedAt,
  };
}
