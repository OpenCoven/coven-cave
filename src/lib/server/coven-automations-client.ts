// Thin client over the Coven daemon's coven.automations.* control actions
// (coven#816). Every mutation routes through POST /api/v1/actions; a daemon
// that is offline, unconfigured, or too old to know the actions surfaces as
// CovenAutomationsUnavailableError (degraded) — the caller presents that
// precisely and must NEVER fall back to direct Codex execution.

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

export async function updateRoutine(
  definition: CovenantAutomationDraft & { id: string },
  transport: AutomationTransport = callDaemon,
): Promise<CovenantAutomation> {
  const normalized = {
    ...definition,
    schemaVersion: 1,
    misfire: definition.misfire ?? "latest",
    overlap: definition.overlap ?? "forbid",
    timezone: definition.timezone ?? "local",
  };
  const payload = await invokeAction<CovenAutomationsGetPayload & { updatedAt?: string }>(
    "coven.automations.update",
    { definition: normalized },
    transport,
  );
  if (payload.error || !payload.routine) {
    throw new CovenAutomationsUnavailableError(payload.error ?? "update failed", false);
  }
  return payload.routine;
}

export async function deleteRoutine(
  id: string,
  transport: AutomationTransport = callDaemon,
): Promise<boolean> {
  const payload = await invokeAction<{ id?: string; deleted?: boolean; error?: string }>(
    "coven.automations.delete",
    { id },
    transport,
  );
  if (payload.error) {
    throw new CovenAutomationsUnavailableError(payload.error, false);
  }
  return payload.deleted === true;
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
