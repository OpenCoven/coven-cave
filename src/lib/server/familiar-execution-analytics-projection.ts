import { createHash } from "node:crypto";
import type { ConversationFile } from "../cave-conversations.ts";
import {
  EXECUTION_ATTEMPT_SCHEMA_VERSION,
  normalizeExecutionAttemptSnapshot,
  type ExecutionAttemptSnapshotV1,
  type ExecutionModelSelection,
} from "../familiar-execution-analytics.ts";
import { canonicalHarnessId } from "../harness-adapters.ts";
import type {
  ModelControlFamily,
  ModelControlValues,
} from "../model-control-capabilities.ts";
import type { SessionOrigin } from "../types.ts";

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function nonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function requestedModelForTurn(
  turn: ConversationFile["turns"][number],
): ExecutionModelSelection | undefined {
  const metadata = turn.responseMetadata;
  if (typeof metadata?.requestedModel === "string") {
    const requested = metadata.requestedModel.trim();
    return requested
      ? { kind: "model", id: requested }
      : { kind: "runtime-default" };
  }
  const desired = text(metadata?.desiredModel);
  if (desired) return { kind: "model", id: desired };
  const override = text(turn.modelOverride);
  if (override) return { kind: "model", id: override };
  return turn.modelOverrideScope === "runtime-default"
    ? { kind: "runtime-default" }
    : undefined;
}

function controlsForTurn(
  turn: ConversationFile["turns"][number],
): ExecutionAttemptSnapshotV1["controls"] {
  const metadata = turn.responseMetadata;
  const requested = metadata?.requestedControls ?? turn.modelControls;
  const forwarded = metadata?.forwardedControls;
  const applied = metadata?.appliedControls;
  const rejectedFamilies = metadata?.rejectedControlFamilies?.filter(
    (family): family is ModelControlFamily =>
      family === "reasoning" ||
      family === "performance" ||
      family === "verbosity" ||
      family === "output-limit" ||
      family === "modalities" ||
      family === "tool-support",
  );
  if (!requested && !forwarded && !applied && !rejectedFamilies?.length) return undefined;
  return {
    ...(requested ? { requested: requested as ModelControlValues } : {}),
    ...(forwarded ? { forwarded } : {}),
    ...(applied ? { applied } : {}),
    ...(rejectedFamilies?.length ? { rejectedFamilies } : {}),
  };
}

function executionOrigin(
  conversation: ConversationFile,
  turn: ConversationFile["turns"][number],
): SessionOrigin | undefined {
  if (conversation.origin) return conversation.origin;
  if (turn.origin === "voice") return "call";
  if (turn.origin === "chat") return "chat";
  return undefined;
}

export function deterministicExecutionAttemptId(args: {
  familiarId: string;
  sessionId: string;
  turnId: string;
  attemptNumber: number;
}): string {
  const digest = createHash("sha256")
    .update([
      `v${EXECUTION_ATTEMPT_SCHEMA_VERSION}`,
      args.familiarId,
      args.sessionId,
      args.turnId,
      String(args.attemptNumber),
    ].join("\u001f"))
    .digest("hex")
    .slice(0, 32);
  return `ea1_${digest}`;
}

/**
 * Project historical Cave conversation turns into the content-free attempt
 * contract. A transcript may contain one persisted assistant result per turn;
 * retries inside the harness are not reconstructable, so historical rows use
 * attemptNumber 1 rather than inventing additional attempts.
 */
export function projectConversationExecutionAttempts(
  conversation: ConversationFile,
): ExecutionAttemptSnapshotV1[] {
  const attempts: ExecutionAttemptSnapshotV1[] = [];
  for (const turn of conversation.turns) {
    if (turn.role !== "assistant") continue;
    if (!Number.isFinite(Date.parse(turn.createdAt))) continue;
    const attemptNumber = 1;
    const harnessId = text(turn.responseMetadata?.harness) ??
      text(conversation.harness);
    const requested = requestedModelForTurn(turn);
    const forwarded = text(turn.responseMetadata?.forwardedModel);
    const confirmed = text(turn.responseMetadata?.confirmedModel);
    const controls = controlsForTurn(turn);
    const durationMs = nonNegative(turn.durationMs);
    const costUsd = nonNegative(turn.costUsd);
    const tools = turn.tools?.map((tool) => {
      const toolDurationMs = nonNegative(tool.durationMs);
      return {
        name: tool.name,
        status: tool.status,
        ...(toolDurationMs !== undefined ? { durationMs: toolDurationMs } : {}),
      };
    });
    const usage = turn.usage
      ? {
          inputTokens: turn.usage.inputTokens,
          outputTokens: turn.usage.outputTokens,
          ...(turn.usage.cacheReadTokens !== undefined
            ? { cacheReadTokens: turn.usage.cacheReadTokens }
            : {}),
          ...(turn.usage.cacheCreationTokens !== undefined
            ? { cacheCreationTokens: turn.usage.cacheCreationTokens }
            : {}),
        }
      : undefined;
    const origin = executionOrigin(conversation, turn);
    const candidate = {
      schemaVersion: EXECUTION_ATTEMPT_SCHEMA_VERSION,
      attemptId: deterministicExecutionAttemptId({
        familiarId: conversation.familiarId,
        sessionId: conversation.sessionId,
        turnId: turn.id,
        attemptNumber,
      }),
      familiarId: conversation.familiarId,
      sessionId: conversation.sessionId,
      turnId: turn.id,
      attemptNumber,
      execution: {
        kind: "assistant-response",
        ...(origin ? { origin } : {}),
      },
      ...(harnessId
        ? { harness: { id: canonicalHarnessId(harnessId) } }
        : {}),
      ...(requested || forwarded || confirmed
        ? {
            models: {
              ...(requested ? { requested } : {}),
              ...(forwarded ? { forwarded } : {}),
              ...(confirmed ? { confirmed } : {}),
            },
          }
        : {}),
      ...(controls ? { controls } : {}),
      timing: {
        completedAt: turn.createdAt,
        ...(durationMs !== undefined ? { durationMs } : {}),
      },
      ...(usage ? { usage } : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
      outcome: {
        status: turn.cancelled
          ? "cancelled"
          : turn.isError
            ? "error"
            : "succeeded",
      },
      ...(tools !== undefined ? { tools } : {}),
      provenance: {
        source: "conversation-backfill",
        sourceSchema: "cave-conversation-v1",
        capturedAt: turn.createdAt,
      },
      coverage: { knownFields: [] },
    };
    const snapshot = normalizeExecutionAttemptSnapshot(candidate);
    if (snapshot) attempts.push(snapshot);
  }
  return attempts;
}
