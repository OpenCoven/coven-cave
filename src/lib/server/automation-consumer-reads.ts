import { isCovenClientError } from "@opencoven/coven-client";
import type { CovenAutomationRoutine, CovenAutomationRun } from "@opencoven/coven-client";
import { callDaemonBytes } from "../coven-daemon.ts";
import { CovenAutomationsUnavailableError, type CovenantAutomation, type RoutineRun } from "../coven-automations-types.ts";
import { redactSecretText } from "../secret-redaction.ts";
import { createAutomationReadClient } from "./coven-automations-sdk.ts";
import { readAutomationDefinitionSnapshot } from "./automation-definition-snapshot.ts";

export type AutomationReadTransport = typeof callDaemonBytes;

/** Keep the compatibility routes' degraded-error contract without exposing
 * transport diagnostics or converting a failed read into an empty result. */
async function compatibilityRead<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); } catch (error) {
    if (!isCovenClientError(error)) throw error;
    const degraded = ["unavailable", "timeout", "capability_unsupported", "unsupported_operation"].includes(error.code);
    throw new CovenAutomationsUnavailableError(`Coven automation read failed: ${error.code}`, degraded);
  }
}

function compatibleRoutine(routine: CovenAutomationRoutine): CovenantAutomation {
  return { ...routine, tags: [...routine.tags ?? []] };
}

function compatibleRun(run: CovenAutomationRun): RoutineRun {
  const { status } = run;
  if (status !== "running" && status !== "succeeded" && status !== "failed" && status !== "cancelled") {
    throw new CovenAutomationsUnavailableError("Coven returned a run state this compatibility view cannot represent", false);
  }
  return { ...run, status, occurrenceId: run.occurrenceId ?? undefined, sessionId: run.sessionId ?? undefined,
    familiarId: run.familiarId ?? undefined, runtime: run.runtime ?? undefined, exitCode: run.exitCode ?? undefined,
    logJson: run.logJson ?? undefined, outputCommit: run.outputCommit ?? undefined, finishedAt: run.finishedAt ?? undefined };
}

export async function listRoutines(transport: AutomationReadTransport = callDaemonBytes): Promise<CovenantAutomation[]> {
  return compatibilityRead(async () => (await createAutomationReadClient(transport).list()).routines.map(compatibleRoutine));
}

export async function readRoutineDefinition(id: string, transport: AutomationReadTransport = callDaemonBytes) {
  return compatibilityRead(async () => {
    const snapshot = await readAutomationDefinitionSnapshot(id, transport);
    if (snapshot.routine === null || snapshot.tombstonedAt !== null) return null;
    return { ...snapshot, routine: compatibleRoutine(snapshot.routine) };
  });
}

export async function getRoutine(id: string, transport: AutomationReadTransport = callDaemonBytes): Promise<CovenantAutomation | null> {
  return (await readRoutineDefinition(id, transport))?.routine ?? null;
}

export async function readRoutineRevision(id: string, transport: AutomationReadTransport = callDaemonBytes): Promise<number | null> {
  return (await readRoutineDefinition(id, transport))?.revision ?? null;
}

export async function listRoutineRuns(id: string, limit = 20, transport: AutomationReadTransport = callDaemonBytes): Promise<RoutineRun[]> {
  return compatibilityRead(async () => (await createAutomationReadClient(transport).runs(id, { limit })).runs.map(compatibleRun));
}

export async function readRoutineLog(id: string, runId: string, transport: AutomationReadTransport = callDaemonBytes) {
  return compatibilityRead(async () => {
    const { run } = await createAutomationReadClient(transport).getRun(runId);
    if (!run || run.automationId !== id || !run.logJson) return null;
    // The SDK transport bounds the entire response to 16 KiB. Redact before
    // presentation; stored text and receipt references are not verified proof.
    return { log: redactSecretText(run.logJson), truncated: false };
  });
}
