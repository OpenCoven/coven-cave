// Thin client over the Coven daemon's coven.automations.* control actions
// (coven#816). Every mutation routes through POST /api/v1/actions; a daemon
// that is offline, unconfigured, or too old to know the actions surfaces as
// CovenAutomationsUnavailableError (degraded) — the caller presents that
// precisely and must NEVER fall back to direct Codex execution.
//
// Edits and deletes use the versioned definition commands (#5217). Once any
// versioned command has touched a definition, Coven refuses the legacy
// `coven.automations.update` and turns `coven.automations.delete` into a
// no-op, so Cave's own pause/resume would otherwise strand its Save and Delete.
// Both commands carry an expected revision and an adoption key: a definition
// that moved is a typed conflict, never an overwrite.

import { randomUUID } from "node:crypto";
import { callDaemon, normalizeDaemonError } from "@/lib/coven-daemon";
import {
  CovenAutomationsUnavailableError,
  type CovenantAutomation,
  type CovenAutomationActionResult,
  type CovenantAutomationDraft,
  type CovenAutomationsGetPayload,
  type CovenAutomationsImportPayload,
  type CovenAutomationsListPayload,
  type CovenAutomationsRunPayload,
  type CovenAutomationsRunsPayload,
  type RoutineRun,
} from "@/lib/coven-automations-types";

export type AutomationTransport = typeof callDaemon;

const DEFAULT_TIMEOUT_MS = 6000;

async function invokeAction<T>(
  action: string,
  params: Record<string, unknown>,
  transport: AutomationTransport,
): Promise<T> {
  const response = await transport<CovenAutomationActionResult<T>>({
    method: "POST",
    path: "/api/v1/actions",
    body: { action, ...params },
    timeoutMs: DEFAULT_TIMEOUT_MS,
    diagnosticOperation: action,
  });

  // A refused action still answers with its envelope (HTTP 400 + status
  // "rejected" and a reason, e.g. an rrule the scheduler cannot run). That is
  // the daemon saying no, not the daemon being unreachable — surface the
  // reason instead of degrading to "unavailable".
  const refused = response.data as Partial<CovenAutomationActionResult<T>> | null;
  if (!response.ok && refused && refused.status === "rejected") {
    throw new CovenAutomationsUnavailableError(refused.reason ?? "action rejected", false);
  }
  if (!response.ok || !response.data) {
    const message = response.error ?? "automations daemon unavailable";
    throw new CovenAutomationsUnavailableError(
      message.startsWith("daemon") ? message : `daemon request failed: ${message}`,
      true,
    );
  }

  const result = response.data;
  if (!result.accepted || result.status === "rejected" || !result.event) {
    const reason = result.reason ?? "action rejected";
    throw new CovenAutomationsUnavailableError(reason, false);
  }

  return result.event.payload;
}

export async function listRoutines(
  transport: AutomationTransport = callDaemon,
): Promise<CovenantAutomation[]> {
  const payload = await invokeAction<CovenAutomationsListPayload>(
    "coven.automations.list",
    {},
    transport,
  );
  if (payload.error) {
    throw new CovenAutomationsUnavailableError(payload.error, false);
  }
  return payload.routines ?? [];
}

export async function getRoutine(
  id: string,
  transport: AutomationTransport = callDaemon,
): Promise<CovenantAutomation | null> {
  const payload = await invokeAction<CovenAutomationsGetPayload>(
    "coven.automations.get",
    { id },
    transport,
  );
  if (payload.error) {
    throw new CovenAutomationsUnavailableError(payload.error, false);
  }
  return payload.routine ?? null;
}

export async function createRoutine(
  definition: CovenantAutomationDraft,
  transport: AutomationTransport = callDaemon,
): Promise<CovenantAutomation> {
  const normalized = {
    ...definition,
    schemaVersion: 1,
    misfire: definition.misfire ?? "latest",
    overlap: definition.overlap ?? "forbid",
    timezone: definition.timezone ?? "local",
  };
  const payload = await invokeAction<CovenAutomationsGetPayload & { createdAt?: string }>(
    "coven.automations.create",
    { definition: normalized },
    transport,
  );
  if (payload.error || !payload.routine) {
    throw new CovenAutomationsUnavailableError(payload.error ?? "create failed", false);
  }
  return payload.routine;
}

/** Coven refused a versioned command because the definition is no longer at
 * the expected revision. Nothing was applied. */
export class CovenAutomationRevisionConflictError extends CovenAutomationsUnavailableError {
  readonly currentRevision: number | null;

  constructor(currentRevision: number | null) {
    super(`changed in Coven${currentRevision ? ` (now revision ${currentRevision})` : ""}; nothing was applied. Reload it and try again.`, false);
    this.name = "CovenAutomationRevisionConflictError";
    this.currentRevision = currentRevision;
  }
}

type VersionedAnswer<T> = { outcome?: string; revision?: number; result?: T };

/** One versioned definition command. Coven adopts by key, so a request whose
 * answer was lost is resent once under the same key: it is reconciled, never
 * applied twice. A typed refusal is reported with its code. */
async function invokeVersioned<T>(
  action: string,
  params: Record<string, unknown>,
  transport: AutomationTransport,
): Promise<VersionedAnswer<T>> {
  const body = { action, adoptionKey: `cave-${randomUUID()}`, ...params };
  let response = await transport<CovenAutomationActionResult<VersionedAnswer<T>> & {
    error?: { code?: string; currentRevision?: number };
  }>({ method: "POST", path: "/api/v1/actions", body, timeoutMs: DEFAULT_TIMEOUT_MS, diagnosticOperation: action });
  if (response.status === 0) {
    response = await transport({ method: "POST", path: "/api/v1/actions", body, timeoutMs: DEFAULT_TIMEOUT_MS, diagnosticOperation: action });
  }
  const data = response.data;
  if (data && data.status === "rejected") {
    if (data.error?.code === "REVISION_CONFLICT") {
      throw new CovenAutomationRevisionConflictError(Number.isSafeInteger(data.error.currentRevision) ? data.error.currentRevision! : null);
    }
    throw new CovenAutomationsUnavailableError(data.reason ?? data.error?.code ?? "action rejected", false);
  }
  if (!response.ok || !data) {
    const message = response.error ?? "automations daemon unavailable";
    throw new CovenAutomationsUnavailableError(
      message.startsWith("daemon") ? message : `daemon request failed: ${message}`,
      true,
    );
  }
  const answer = data.event?.payload;
  if (!data.accepted || !answer || (answer.outcome !== "committed" && answer.outcome !== "replayed")) {
    throw new CovenAutomationsUnavailableError(data.reason ?? "action rejected", false);
  }
  return answer;
}

/** The revision Coven holds now, or null when it has no live definition with this id. */
export async function readRoutineRevision(
  id: string,
  transport: AutomationTransport = callDaemon,
): Promise<number | null> {
  return (await readRoutineDefinition(id, transport))?.revision ?? null;
}

/**
 * The routine body and the revision Coven holds for it, read from one
 * `definition.get.v1` snapshot so the two always belong together. Null when
 * Coven holds no live definition with this id.
 */
export async function readRoutineDefinition(
  id: string,
  transport: AutomationTransport = callDaemon,
): Promise<{ routine: CovenantAutomation; revision: number } | null> {
  const payload = await invokeAction<{ routine?: CovenantAutomation | null; revision?: number; tombstonedAt?: string | null; error?: string }>(
    "coven.automations.definition.get.v1",
    { id },
    transport,
  );
  if (payload.error) throw new CovenAutomationsUnavailableError(payload.error, false);
  if (!payload.routine || payload.tombstonedAt) return null;
  if (typeof payload.revision !== "number" || !Number.isSafeInteger(payload.revision) || payload.revision < 1) {
    throw new CovenAutomationsUnavailableError("Coven reported no revision for this definition", false);
  }
  // The versioned read omits empty optional fields that the legacy read always sends.
  return { routine: { ...payload.routine, tags: payload.routine.tags ?? [] }, revision: payload.revision };
}

/**
 * Replace the definition at `expectedRevision`, or at the revision Coven holds
 * now when the caller saw none. Coven's `definition.revise.v1` takes the same
 * routine body as the legacy update, so status edits keep working.
 */
export async function updateRoutine(
  definition: CovenantAutomationDraft & { id: string },
  transport: AutomationTransport = callDaemon,
  { expectedRevision }: { expectedRevision?: number } = {},
): Promise<CovenantAutomation> {
  const normalized = {
    ...definition,
    schemaVersion: 1,
    misfire: definition.misfire ?? "latest",
    overlap: definition.overlap ?? "forbid",
    timezone: definition.timezone ?? "local",
  };
  const revision = expectedRevision ?? await readRoutineRevision(definition.id, transport);
  if (revision === null) throw new CovenAutomationsUnavailableError(`no routine with id \`${definition.id}\``, false);
  const answer = await invokeVersioned<{ routine?: CovenantAutomation }>(
    "coven.automations.definition.revise.v1",
    { expectedRevision: revision, definition: normalized },
    transport,
  );
  if (!answer.result?.routine) throw new CovenAutomationsUnavailableError("update failed", false);
  return answer.result.routine;
}

/**
 * Tombstone the definition, keeping its history. False when Coven has no live
 * definition with this id; a definition that moved past `expectedRevision`
 * is a conflict, not a delete.
 */
export async function deleteRoutine(
  id: string,
  transport: AutomationTransport = callDaemon,
  { expectedRevision }: { expectedRevision?: number } = {},
): Promise<boolean> {
  const current = await readRoutineRevision(id, transport);
  if (current === null) return false;
  const answer = await invokeVersioned<{ deleted?: boolean }>(
    "coven.automations.definition.tombstone.v1",
    { id, expectedRevision: expectedRevision ?? current },
    transport,
  );
  return answer.result?.deleted === true;
}

export async function runRoutine(
  id: string,
  transport: AutomationTransport = callDaemon,
): Promise<CovenAutomationsRunPayload> {
  // A run that FAILED is a legitimate outcome, not an action rejection: the
  // daemon reports it in the run payload (status "failed" + error), and the
  // caller decides how to present it. Only transport failures and rejected
  // actions throw (inside invokeAction).
  return invokeAction<CovenAutomationsRunPayload>(
    "coven.automations.run",
    { id },
    transport,
  );
}

export async function listRoutineRuns(
  id: string,
  limit = 20,
  transport: AutomationTransport = callDaemon,
): Promise<RoutineRun[]> {
  const payload = await invokeAction<CovenAutomationsRunsPayload>(
    "coven.automations.runs",
    { id, limit },
    transport,
  );
  if (payload.error) {
    throw new CovenAutomationsUnavailableError(payload.error, false);
  }
  return payload.runs ?? [];
}

export async function importLegacyRoutines(
  transport: AutomationTransport = callDaemon,
): Promise<CovenAutomationsImportPayload> {
  const payload = await invokeAction<CovenAutomationsImportPayload>(
    "coven.automations.import",
    {},
    transport,
  );
  if (payload.error) {
    throw new CovenAutomationsUnavailableError(payload.error, false);
  }
  return payload;
}

export { normalizeDaemonError };
