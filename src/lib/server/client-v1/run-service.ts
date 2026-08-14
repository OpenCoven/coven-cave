import { randomUUID } from "node:crypto";

import { executeChatSend } from "@/lib/server/chat-send-service";
import { requestChatStop } from "@/lib/server/chat-stop-registry";
import {
  aliasRunBuffer,
  hasRunBuffer,
} from "@/lib/server/chat-stream-buffer";
import type { ChatAttachment } from "@/lib/chat-attachments";
import {
  isSafeConversationSessionId,
  type ConversationFile,
} from "@/lib/cave-conversations";
import { cleanModelId } from "@/lib/chat-model-state";
import { canonicalHarnessId, isTrustedChatHarness } from "@/lib/harness-adapters";
import { resolveActivePath } from "@/lib/conversation-tree";
import { cwdFromConversationRuntime } from "@/lib/server/chat-work-branch";
import { isValidChatAttachmentId } from "@/lib/server/chat-attachment-store";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { MAX_PROMPT_CHARS } from "@/lib/server/session-security";

import type { ClientPrincipal } from "./auth.ts";
import {
  ClientAttachmentError,
  resolveAndBindClientAttachments,
} from "./attachment-service.ts";
import {
  withAuthorizedClientConversation,
  type AuthorizedClientConversationResult,
} from "./chat-service.ts";
import { isUuid } from "./contract.ts";
import {
  claimOperation,
  completeOperation,
  findCompletedOperation,
  hashNormalizedRequest,
  type ClaimOperationResult,
  type ClientOperationResponse,
} from "./idempotency-store.ts";
import {
  ClientRunOperationStoreError,
  clientRunOperationLaunchingRetryAfterMs,
  launchClientRunOperation,
  readClientRunOperation,
  reserveClientRunOperation,
  type LaunchClientRunOperationResult,
  type ClientRunOperationRecord,
} from "./run-operation-store.ts";
import { clientV1Error, clientV1Ok } from "./responses.ts";
import { translateInitialChatResponse } from "./sse.ts";

export const CLIENT_SEND_MAX_ATTACHMENTS = 4;
const MAX_PROJECT_ROOT_CHARS = 4096;
const MAX_MODEL_CHARS = 200;
const SEND_KEYS = new Set([
  "operationId",
  "conversationId",
  "familiarId",
  "prompt",
  "attachmentIds",
  "projectRoot",
  "model",
  "harness",
  "retryOfTurnId",
]);

export type ClientSendInput = {
  operationId: string;
  conversationId: string;
  familiarId: string;
  prompt: string;
  attachmentIds: string[];
  projectRoot: string | null;
  model?: string;
  harness?: string;
  retryOfTurnId?: string;
};

export type ClientRunMetadata = {
  runId: string;
  conversationId: string;
  resumePath: string;
};

type StoredClientRunMetadata = ClientRunMetadata & {
  internalRunId: string;
};

type StoredRunStatus =
  | "attachable"
  | "launching"
  | "reconcile_required"
  | "manual_recovery_required";
type StoredRunState = "launching" | "launched";

type StoredRunReceipt = {
  metadata: StoredClientRunMetadata;
  status: StoredRunStatus;
  runState: StoredRunState;
};

type ResolvedStoredRun = StoredRunReceipt & {
  response: Response;
};

export type ClientRunLookup =
  | { kind: "found"; metadata: StoredClientRunMetadata }
  | { kind: "launching"; metadata: StoredClientRunMetadata; retryAfterMs: number }
  | { kind: "not_found" };

export type ClientRetryInput = {
  operationId: string;
  retryOfTurnId: string;
};

export function clientRunBufferKey(runId: string, credentialId: string): string {
  return `\0client-v1:${credentialId}:${runId}`;
}

// A narrow, explicitly safe allowlist forwarded onto the synthetic canonical
// `Request` alongside the propagated abort signal. `executeChatSend` does not
// currently read any of these — this is a deliberate, minimal, defensive
// convention, not a fix for an observed bug. The client's own credentials
// (`authorization`) and the internal loopback marker header are NEVER
// forwarded: this request is authorized separately, as this facade's own
// principal, not a passthrough of the caller's transport identity.
const FORWARDED_SAFE_HEADERS = ["accept-language"] as const;

function safeForwardedHeaders(originalRequest: Request | undefined): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  for (const name of FORWARDED_SAFE_HEADERS) {
    const value = originalRequest?.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}

export function parseClientRetryInput(value: unknown): ClientRetryInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2
    || !Object.hasOwn(record, "operationId")
    || !Object.hasOwn(record, "retryOfTurnId")
  ) throw new Error('Retry body must contain exactly "operationId" and "retryOfTurnId".');
  const operationId = requireString(record, "operationId").trim();
  const retryOfTurnId = requireString(record, "retryOfTurnId").trim();
  if (!isUuid(operationId)) throw new Error('"operationId" must be a UUID.');
  if (!isSafeConversationSessionId(retryOfTurnId)) {
    throw new Error('"retryOfTurnId" is invalid.');
  }
  return { operationId, retryOfTurnId };
}

function requireString(record: Record<string, unknown>, key: string): string {
  if (typeof record[key] !== "string") throw new Error(`"${key}" must be a string.`);
  return record[key] as string;
}

export function parseClientSendInput(value: unknown): ClientSendInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be an object.");
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!SEND_KEYS.has(key)) throw new Error(`Unknown request field: "${key}".`);
  }
  const operationId = requireString(record, "operationId").trim();
  const conversationId = requireString(record, "conversationId").trim();
  const familiarId = requireString(record, "familiarId").trim();
  const prompt = requireString(record, "prompt").trim();
  if (!isUuid(operationId)) throw new Error('"operationId" must be a UUID.');
  if (!isSafeConversationSessionId(conversationId)) throw new Error('"conversationId" is invalid.');
  if (!isValidFamiliarId(familiarId)) throw new Error('"familiarId" is invalid.');
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`"prompt" must contain between 1 and ${MAX_PROMPT_CHARS} characters.`);
  }
  if (!Array.isArray(record.attachmentIds) || record.attachmentIds.length > CLIENT_SEND_MAX_ATTACHMENTS) {
    throw new Error(`"attachmentIds" must be an array of at most ${CLIENT_SEND_MAX_ATTACHMENTS} ids.`);
  }
  const attachmentIds: string[] = [];
  const seenAttachments = new Set<string>();
  for (const id of record.attachmentIds) {
    if (!isValidChatAttachmentId(id)) throw new Error('"attachmentIds" contains an invalid id.');
    if (seenAttachments.has(id)) throw new Error('"attachmentIds" must not contain duplicates.');
    seenAttachments.add(id);
    attachmentIds.push(id);
  }
  if (record.projectRoot !== null && typeof record.projectRoot !== "string") {
    throw new Error('"projectRoot" must be a string or null.');
  }
  const projectRoot = record.projectRoot as string | null;
  if (typeof projectRoot === "string" && (!projectRoot || projectRoot.length > MAX_PROJECT_ROOT_CHARS)) {
    throw new Error(`"projectRoot" must contain between 1 and ${MAX_PROJECT_ROOT_CHARS} characters.`);
  }
  let model: string | undefined;
  if (Object.hasOwn(record, "model")) {
    if (typeof record.model !== "string" || record.model.length > MAX_MODEL_CHARS) {
      throw new Error('"model" must be a bounded safe model id.');
    }
    model = cleanModelId(record.model) ?? undefined;
    if (!model) throw new Error('"model" must be a bounded safe model id.');
  }
  let harness: string | undefined;
  if (Object.hasOwn(record, "harness")) {
    if (typeof record.harness !== "string") throw new Error('"harness" must be a string.');
    harness = canonicalHarnessId(record.harness);
    if (!isTrustedChatHarness(harness)) throw new Error('"harness" is invalid.');
  }
  let retryOfTurnId: string | undefined;
  if (Object.hasOwn(record, "retryOfTurnId")) {
    if (typeof record.retryOfTurnId !== "string"
      || !isSafeConversationSessionId(record.retryOfTurnId)) {
      throw new Error('"retryOfTurnId" is invalid.');
    }
    retryOfTurnId = record.retryOfTurnId;
  }
  return {
    operationId,
    conversationId,
    familiarId,
    prompt,
    attachmentIds,
    projectRoot,
    ...(model ? { model } : {}),
    ...(harness ? { harness } : {}),
    ...(retryOfTurnId ? { retryOfTurnId } : {}),
  };
}

function alreadyStarted(metadata: ClientRunMetadata): Response {
  return clientV1Error(
    409,
    "operation_already_started",
    "This operation has already started. Attach to its run stream.",
    false,
    {
      details: {
        runId: metadata.runId,
        conversationId: metadata.conversationId,
        resumePath: metadata.resumePath,
      },
    },
  );
}

function canonicalProjectRoot(conversation: ConversationFile): string | null {
  if (Object.hasOwn(conversation, "projectRoot")) return conversation.projectRoot ?? null;
  return cwdFromConversationRuntime(conversation.runtime) ?? null;
}

function retryParent(conversation: ConversationFile, turnId: string): string | null | undefined {
  const assistant = conversation.turns.find((turn) => turn.id === turnId);
  if (!assistant || assistant.role !== "assistant" || (!assistant.isError && !assistant.cancelled)) {
    return undefined;
  }
  const user = assistant.parentId
    ? conversation.turns.find((turn) => turn.id === assistant.parentId && turn.role === "user")
    : undefined;
  if (!user) return undefined;
  return user.parentId ?? null;
}

type AuthorizeConversation = <T>(
  sessionId: string,
  effect: (conversation: ConversationFile) => Promise<T>,
) => Promise<AuthorizedClientConversationResult<T>>;

export type ClientRunServiceDeps = {
  authorizeConversation: AuthorizeConversation;
  claimOperation: typeof claimOperation;
  completeOperation: typeof completeOperation;
  findCompletedOperation: typeof findCompletedOperation;
  reserveRunOperation: typeof reserveClientRunOperation;
  readRunOperation: typeof readClientRunOperation;
  launchRunOperation: typeof launchClientRunOperation;
  resolveAttachments: typeof resolveAndBindClientAttachments;
  executeChatSend: typeof executeChatSend;
  requestChatStop: typeof requestChatStop;
  now: () => number;
};

const defaultDeps: ClientRunServiceDeps = {
  authorizeConversation: withAuthorizedClientConversation,
  claimOperation,
  completeOperation,
  findCompletedOperation,
  reserveRunOperation: reserveClientRunOperation,
  readRunOperation: readClientRunOperation,
  launchRunOperation: launchClientRunOperation,
  resolveAttachments: (ids, credentialId, conversationId) =>
    resolveAndBindClientAttachments(ids, credentialId, conversationId),
  executeChatSend,
  requestChatStop,
  now: () => Date.now(),
};

function claimFailure(kind: ClaimOperationResult["kind"]): Response {
  if (kind === "conflict") {
    return clientV1Error(
      409,
      "conflict",
      "This operationId was already used for a different request.",
      false,
    );
  }
  return clientV1Error(
    503,
    "service_unavailable",
    "The operation ledger is temporarily unavailable.",
    true,
  );
}

function launchPending(retryAfterMs: number): Response {
  const response = clientV1Error(
    409,
    "conflict",
    "A request with this Idempotency-Key is already being processed.",
    true,
  );
  response.headers.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  return response;
}

function metadataForStoredRun(
  operationId: string,
  conversationId: string,
  internalRunId: string,
): StoredClientRunMetadata {
  return {
    runId: operationId,
    conversationId,
    resumePath: `/api/client/v1/runs/${operationId}/stream`,
    internalRunId,
  };
}

function metadataForRecord(record: Pick<ClientRunOperationRecord, "operationId" | "conversationId" | "internalRunId">): StoredClientRunMetadata {
  return metadataForStoredRun(record.operationId, record.conversationId, record.internalRunId);
}

async function durableRunReceipt(
  metadata: StoredClientRunMetadata,
  response: Response,
): Promise<ClientOperationResponse> {
  const body = await response.clone().json() as Record<string, unknown>;
  body.internalRunId = metadata.internalRunId;
  return {
    status: response.status,
    body,
  };
}

function reconcileRequired(
  metadata: ClientRunMetadata,
  runState: StoredRunState = "launched",
): Response {
  return clientV1Error(
    409,
    "operation_already_started",
    "This operation may already have launched. Reconcile its run stream instead of launching again.",
    false,
    {
      details: {
        runId: metadata.runId,
        conversationId: metadata.conversationId,
        resumePath: metadata.resumePath,
        status: "reconcile_required",
        reconcilePath: metadata.resumePath,
        runState,
      },
    },
  );
}

function manualRecoveryRequired(metadata: ClientRunMetadata): Response {
  return clientV1Error(
    409,
    "operation_already_started",
    "This operation entered an indeterminate launch state and cannot be relaunched automatically.",
    false,
    {
      details: {
        runId: metadata.runId,
        conversationId: metadata.conversationId,
        resumePath: metadata.resumePath,
        status: "manual_recovery_required",
        runState: "launching",
      },
    },
  );
}

export function clientRunLaunchingInProgress(
  metadata: ClientRunMetadata,
  retryAfterMs: number,
): Response {
  const response = clientV1Error(
    409,
    "operation_already_started",
    "This run is still launching. Retry shortly.",
    true,
    {
      details: {
        runId: metadata.runId,
        conversationId: metadata.conversationId,
        resumePath: metadata.resumePath,
        status: "launching",
        runState: "launching",
      },
    },
  );
  response.headers.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  return response;
}

function responseFromStored(stored: ClientOperationResponse): Response {
  return Response.json(stored.body, { status: stored.status });
}

function parseStoredRunReceipt(
  runId: string,
  operation: ClientOperationResponse | null,
): StoredRunReceipt | null {
  if (!operation || operation.status !== 409 || !operation.body
    || typeof operation.body !== "object") return null;
  const details = (operation.body as {
    error?: { code?: unknown; details?: Partial<ClientRunMetadata> & Record<string, unknown> };
  }).error?.details;
  const internalRunId = (operation.body as { internalRunId?: unknown }).internalRunId;
  if (
    (operation.body as { error?: { code?: unknown } }).error?.code !== "operation_already_started"
    || details?.runId !== runId
    || typeof details.conversationId !== "string"
    || !isSafeConversationSessionId(details.conversationId)
    || details.resumePath !== `/api/client/v1/runs/${runId}/stream`
    || !isUuid(internalRunId)
  ) return null;
  const status = details.status === "manual_recovery_required"
    ? "manual_recovery_required"
    : details.status === "reconcile_required"
      ? "reconcile_required"
      : "attachable";
  const runState = details.runState === "launching" ? "launching" : "launched";
  return {
    metadata: { ...(details as ClientRunMetadata), internalRunId },
    status,
    runState,
  };
}

function aliasAttachableRunBuffer(
  metadata: StoredClientRunMetadata,
  credentialId: string,
): boolean {
  const bufferKey = clientRunBufferKey(metadata.runId, credentialId);
  return hasRunBuffer(bufferKey) || aliasRunBuffer(metadata.internalRunId, bufferKey);
}

async function readStoredRunReceipt(
  deps: ClientRunServiceDeps,
  runId: string,
  credentialId: string,
): Promise<StoredRunReceipt | null> {
  const operation = await deps.findCompletedOperation({
    key: runId,
    credentialId,
    route: "messages-send",
  });
  return parseStoredRunReceipt(runId, operation);
}

async function resolveStoredRunStatus(
  deps: ClientRunServiceDeps,
  record: ClientRunOperationRecord,
  credentialId: string,
): Promise<ResolvedStoredRun> {
  const metadata = metadataForRecord(record);
  if (aliasAttachableRunBuffer(metadata, credentialId)) {
    return {
      metadata,
      status: "attachable",
      runState: record.state === "launching" ? "launching" : "launched",
      response: alreadyStarted(metadata),
    };
  }
  const launchRetryAfterMs = clientRunOperationLaunchingRetryAfterMs(record, deps.now());
  if (launchRetryAfterMs !== null) {
    return {
      metadata,
      status: "launching",
      runState: "launching",
      response: clientRunLaunchingInProgress(metadata, launchRetryAfterMs),
    };
  }
  const stored = await readStoredRunReceipt(deps, record.operationId, credentialId);
  if (stored) {
    if (aliasAttachableRunBuffer(stored.metadata, credentialId)) {
      return {
        ...stored,
        status: "attachable",
        response: alreadyStarted(stored.metadata),
      };
    }
    if (stored.status === "manual_recovery_required") {
      return {
        ...stored,
        response: manualRecoveryRequired(stored.metadata),
      };
    }
    return {
      ...stored,
      status: "reconcile_required",
      response: reconcileRequired(stored.metadata, stored.runState),
    };
  }
  if (record.state === "launched") {
    return {
      metadata,
      status: "reconcile_required",
      runState: "launched",
      response: reconcileRequired(metadata, "launched"),
    };
  }
  return {
    metadata,
    status: "manual_recovery_required",
    runState: "launching",
    response: manualRecoveryRequired(metadata),
  };
}

async function persistRunStatusResponse(
  deps: ClientRunServiceDeps,
  input: Pick<ClientSendInput, "operationId">,
  claimId: string | null,
  status: ResolvedStoredRun,
): Promise<void> {
  if (!claimId || status.status === "launching") return;
  try {
    const completed = await deps.completeOperation(
      { key: input.operationId, claimId },
      await durableRunReceipt(status.metadata, status.response),
    );
    if (completed.kind === "conflict" || completed.kind === "not_found") {
      console.warn("[client-v1] unable to durably persist run launch receipt");
    }
  } catch (error) {
    console.warn("[client-v1] failed to persist run launch receipt:", error);
  }
}

async function lookupClientRun(
  deps: ClientRunServiceDeps,
  runId: string,
  credentialId: string,
): Promise<ClientRunLookup> {
  if (!isUuid(runId) || !isUuid(credentialId)) return { kind: "not_found" };
  const reserved = await deps.readRunOperation({
    operationId: runId,
    credentialId,
  });
  if (reserved?.state === "launched") {
    const metadata = metadataForRecord(reserved);
    aliasAttachableRunBuffer(metadata, credentialId);
    return { kind: "found", metadata };
  }
  if (reserved?.state === "launching") {
    const metadata = metadataForRecord(reserved);
    if (aliasAttachableRunBuffer(metadata, credentialId)) {
      return { kind: "found", metadata };
    }
    const retryAfterMs = clientRunOperationLaunchingRetryAfterMs(reserved, deps.now());
    if (retryAfterMs !== null) return { kind: "launching", metadata, retryAfterMs };
  }
  const stored = await readStoredRunReceipt(deps, runId, credentialId);
  if (!stored || stored.status === "manual_recovery_required") return { kind: "not_found" };
  aliasAttachableRunBuffer(stored.metadata, credentialId);
  return { kind: "found", metadata: stored.metadata };
}

export function createClientRunService(overrides: Partial<ClientRunServiceDeps> = {}) {
  const deps: ClientRunServiceDeps = { ...defaultDeps, ...overrides };

  const service = {
    async send(
      input: ClientSendInput,
      principal: ClientPrincipal,
      originalRequest?: Request,
    ): Promise<Response> {
      const authorized = await deps.authorizeConversation(input.conversationId, async (conversation) => {
        const projectRoot = canonicalProjectRoot(conversation);
        if (
          conversation.familiarId !== input.familiarId
          || projectRoot !== input.projectRoot
          || (input.harness !== undefined
            && canonicalHarnessId(conversation.harness) !== input.harness)
        ) {
          return { kind: "not_found" as const };
        }
        let parentTurnId: string | null | undefined;
        if (input.retryOfTurnId !== undefined) {
          parentTurnId = retryParent(conversation, input.retryOfTurnId);
          if (parentTurnId === undefined) return { kind: "not_found" as const };
        }
        return { kind: "authorized" as const, projectRoot, parentTurnId };
      });
      if (!authorized.ok || authorized.value.kind === "not_found") {
        return clientV1Error(404, "not_found", "Conversation not found.", false);
      }

      const requestHash = hashNormalizedRequest(input);
      let claim: ClaimOperationResult;
      try {
        claim = await deps.claimOperation({
          key: input.operationId,
          credentialId: principal.credentialId,
          route: "messages-send",
          requestHash,
        });
      } catch {
        return claimFailure("capacity_exceeded");
      }
      if (
        claim.kind !== "claimed"
        && claim.kind !== "pending"
        && claim.kind !== "replay"
      ) {
        return claimFailure(claim.kind);
      }

      let reserved: ClientRunOperationRecord | null = null;
      if (claim.kind === "claimed") {
        try {
          const reservation = await deps.reserveRunOperation({
            operationId: input.operationId,
            credentialId: principal.credentialId,
            requestHash,
            conversationId: input.conversationId,
            internalRunId: randomUUID(),
          });
          if (reservation.kind === "conflict") return claimFailure("conflict");
          reserved = reservation.record;
        } catch (error) {
          if (error instanceof ClientRunOperationStoreError) {
            return clientV1Error(
              503,
              "service_unavailable",
              "Run launch state is unavailable.",
              true,
            );
          }
          throw error;
        }
      } else {
        try {
          reserved = await deps.readRunOperation({
            operationId: input.operationId,
            credentialId: principal.credentialId,
            requestHash,
          });
        } catch (error) {
          if (error instanceof ClientRunOperationStoreError) {
            return clientV1Error(
              503,
              "service_unavailable",
              "Run launch state is unavailable.",
              true,
            );
          }
          throw error;
        }
      }

      if (!reserved) {
        if (claim.kind === "replay") {
          const replayable = await service.findReplayableResponse(
            input.operationId,
            principal.credentialId,
          );
          return replayable ?? responseFromStored(claim.response);
        }
        return claim.kind === "pending"
          ? launchPending(claim.retryAfterMs)
          : clientV1Error(
            503,
            "service_unavailable",
            "Run launch state is unavailable.",
            true,
          );
      }

      if (reserved.state === "launching" || reserved.state === "launched") {
        const status = await resolveStoredRunStatus(deps, reserved, principal.credentialId);
        await persistRunStatusResponse(
          deps,
          input,
          claim.kind === "claimed" ? claim.claimId : null,
          status,
        );
        return status.response;
      }

      let launched: LaunchClientRunOperationResult<Response>;
      try {
        launched = await deps.launchRunOperation({
          operationId: input.operationId,
          credentialId: principal.credentialId,
          requestHash,
          launch: async (record) => {
            let attachments: ChatAttachment[];
            try {
              attachments = await deps.resolveAttachments(
                input.attachmentIds,
                principal.credentialId,
                input.conversationId,
              );
            } catch (error) {
              if (error instanceof ClientAttachmentError) throw error;
              throw new ClientAttachmentError(
                503,
                "service_unavailable",
                "Attachments are temporarily unavailable.",
              );
            }
            const legacyBody: Record<string, unknown> = {
              familiarId: input.familiarId,
              prompt: input.prompt,
              attachments,
              projectRoot: authorized.value.projectRoot,
              sessionId: input.conversationId,
              runId: record.internalRunId,
              ...(input.model
                ? { modelOverride: input.model, modelOverrideScope: "next-message" }
                : {}),
              ...(authorized.value.parentTurnId !== undefined
                ? { parentTurnId: authorized.value.parentTurnId }
                : {}),
            };
            const response = await deps.executeChatSend(new Request(
              "http://localhost/api/chat/send",
              {
                method: "POST",
                headers: safeForwardedHeaders(originalRequest),
                body: JSON.stringify(legacyBody),
                signal: originalRequest?.signal ?? undefined,
              },
            ));
            aliasRunBuffer(
              record.internalRunId,
              clientRunBufferKey(input.operationId, principal.credentialId),
            );
            return response;
          },
        });
      } catch (error) {
        if (error instanceof ClientAttachmentError) {
          return clientV1Error(
            error.status,
            error.code,
            error.message,
            error.status === 503,
          );
        }
        if (error instanceof ClientRunOperationStoreError) {
          return clientV1Error(
            503,
            "service_unavailable",
            "Run launch state is unavailable.",
            true,
          );
        }
        throw error;
      }

      if (launched.kind === "conflict") return claimFailure("conflict");
      if (launched.kind === "already_launching" || launched.kind === "already_launched") {
        const status = await resolveStoredRunStatus(deps, launched.record, principal.credentialId);
        await persistRunStatusResponse(
          deps,
          input,
          claim.kind === "claimed" ? claim.claimId : null,
          status,
        );
        return status.response;
      }
      const started: ResolvedStoredRun = {
        metadata: metadataForRecord(launched.record),
        status: "attachable",
        runState: "launched",
        response: alreadyStarted(metadataForRecord(launched.record)),
      };
      await persistRunStatusResponse(
        deps,
        input,
        claim.kind === "claimed" ? claim.claimId : null,
        started,
      );
      return translateInitialChatResponse(launched.value, {
        runId: input.operationId,
        conversationId: input.conversationId,
      }, launched.record.internalRunId);
    },

    async inspectRun(runId: string, credentialId: string): Promise<ClientRunLookup> {
      return lookupClientRun(deps, runId, credentialId);
    },

    async findRun(runId: string, credentialId: string): Promise<StoredClientRunMetadata | null> {
      const result = await service.inspectRun(runId, credentialId);
      return result.kind === "found" ? result.metadata : null;
    },

    async findReplayableResponse(runId: string, credentialId: string): Promise<Response | null> {
      if (!isUuid(runId) || !isUuid(credentialId)) return null;
      const reserved = await deps.readRunOperation({
        operationId: runId,
        credentialId,
      });
      if (reserved?.state === "launching" || reserved?.state === "launched") {
        return (await resolveStoredRunStatus(deps, reserved, credentialId)).response;
      }
      const stored = await readStoredRunReceipt(deps, runId, credentialId);
      if (stored) {
        if (aliasAttachableRunBuffer(stored.metadata, credentialId)) {
          return alreadyStarted(stored.metadata);
        }
        return stored.status === "manual_recovery_required"
          ? manualRecoveryRequired(stored.metadata)
          : reconcileRequired(stored.metadata, stored.runState);
      }
      const operation = await deps.findCompletedOperation({
        key: runId,
        credentialId,
        route: "messages-send",
      });
      return operation ? responseFromStored(operation) : null;
    },

    async retry(
      priorRunId: string,
      retry: ClientRetryInput,
      principal: ClientPrincipal,
      originalRequest?: Request,
    ): Promise<Response> {
      const run = await service.inspectRun(priorRunId, principal.credentialId);
      if (run.kind === "launching") {
        return clientRunLaunchingInProgress(run.metadata, run.retryAfterMs);
      }
      if (run.kind !== "found") return clientV1Error(404, "not_found", "Run not found.", false);
      const metadata = run.metadata;
      const prepared = await deps.authorizeConversation(metadata.conversationId, async (conversation) => {
        const active = resolveActivePath(
          conversation.turns,
          conversation.activeLeafId ?? "",
        );
        const assistant = active.find((turn) => turn.id === retry.retryOfTurnId);
        if (
          !assistant
          || assistant.role !== "assistant"
          || (!assistant.isError && !assistant.cancelled)
          || !assistant.parentId
        ) return null;
        const user = active.find(
          (turn) => turn.id === assistant.parentId && turn.role === "user",
        );
        if (!user || !user.text.trim()) return null;
        const attachmentIds = (user.attachments ?? [])
          .map((attachment) => attachment.storedId)
          .filter((id): id is string => isValidChatAttachmentId(id));
        return {
          operationId: retry.operationId,
          conversationId: conversation.sessionId,
          familiarId: conversation.familiarId,
          prompt: user.text,
          attachmentIds,
          projectRoot: canonicalProjectRoot(conversation),
          harness: canonicalHarnessId(conversation.harness),
          ...(cleanModelId(assistant.responseMetadata?.retryModel)
            ? { model: cleanModelId(assistant.responseMetadata?.retryModel)! }
            : {}),
          retryOfTurnId: retry.retryOfTurnId,
        } satisfies ClientSendInput;
      });
      if (!prepared.ok) {
        return clientV1Error(404, "not_found", "Conversation not found.", false);
      }
      if (!prepared.value) {
        return clientV1Error(
          409,
          "conflict",
          "The selected assistant turn is not eligible for retry.",
          false,
        );
      }
      return service.send(prepared.value, principal, originalRequest);
    },

    async stop(runId: string, principal: ClientPrincipal): Promise<Response> {
      const run = await service.inspectRun(runId, principal.credentialId);
      if (run.kind === "launching") {
        return clientRunLaunchingInProgress(run.metadata, run.retryAfterMs);
      }
      if (run.kind !== "found") return clientV1Error(404, "not_found", "Run not found.", false);
      const metadata = run.metadata;
      const authorized = await deps.authorizeConversation(
        metadata.conversationId,
        async () => true,
      );
      if (!authorized.ok) {
        return clientV1Error(404, "not_found", "Run not found.", false);
      }
      const stopped = deps.requestChatStop(metadata.internalRunId);
      // The stop receipt is intentionally bounded to the client-safe `runId`
      // (never `internalRunId`) and the `stopped` boolean — no conversation
      // id, internal run id, or other internal detail is ever persisted into
      // the idempotency ledger or returned over the wire for this mutation.
      return clientV1Ok({ ok: true, runId: metadata.runId, stopped });
    },
  };
  return service;
}

export const clientRunService = createClientRunService();
