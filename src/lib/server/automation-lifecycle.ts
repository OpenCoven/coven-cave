import type { CovenAutomationCommandResult, CovenAutomationDefinition, CovenAutomationRoutine } from "@opencoven/coven-client";
import {
  AUTOMATION_ID_PATTERN,
  LIFECYCLE_ADOPTION_KEY_PATTERN,
  LIFECYCLE_MAX_IDS,
  isLifecycleCommandErrorCode,
  type AutomationHealthView,
  type AutomationLifecycleCommand,
  type AutomationLifecycleCommandResult,
  type AutomationLifecycleDetail,
  type AutomationLifecycleOverview,
  type AutomationLifecycleRecord,
} from "../automations/lifecycle.ts";
import { createAutomationCommandClient, createAutomationReadClient } from "./coven-automations-sdk.ts";

type ReadClient = Pick<ReturnType<typeof createAutomationReadClient>, "list" | "get" | "health">;
type CommandClient = Pick<ReturnType<typeof createAutomationCommandClient>, "pause" | "activate">;

/** Per-id reads in flight at once when the whole-list read cannot be decoded. */
const READ_CONCURRENCY = 4;
/** Recorded with each command as provenance. It grants nothing: authority comes from the transport. */
const CAVE_PRINCIPAL = "cave";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

type ReadFailure = "unsupported" | "unavailable" | "unreadable";

/** An SDK refusal says Coven lacks the read; a decode or validation failure is
 * about one answer; anything else means Coven could not be read at all. */
function classify(error: unknown): ReadFailure {
  const code = errorCode(error);
  if (code === "capability_unsupported" || code === "unsupported_operation") return "unsupported";
  if (code === "invalid_response" || code === "action_rejected" || code === "invalid_options") return "unreadable";
  return "unavailable";
}

function stateOf(routine: CovenAutomationRoutine): "active" | "paused" | "disabled" | null {
  return routine.status === "ACTIVE" ? "active" : routine.status === "PAUSED" ? "paused" : routine.status === "DISABLED" ? "disabled" : null;
}

function zone(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(value);
}

/** Only the lifecycle facts leave the server: never the prompt or other definition text. */
function project(id: string, routine: CovenAutomationRoutine | null, revision: number | undefined, tombstoned: boolean): AutomationLifecycleRecord {
  if (routine === null || tombstoned) return { id, kind: "absent" };
  const state = stateOf(routine);
  if (state === null || revision === undefined || !Number.isSafeInteger(revision) || revision < 1 || !zone(routine.timezone)) {
    return { id, kind: "unreadable" };
  }
  return { id, kind: "present", state, revision, timezone: routine.timezone };
}

function projectDefinition(id: string, definition: CovenAutomationDefinition): AutomationLifecycleRecord {
  return definition.routine === null
    ? { id, kind: "absent" }
    : project(id, definition.routine, definition.revision, definition.tombstonedAt !== null);
}

function requestedIds(query: URLSearchParams): string[] | null {
  if ([...query.keys()].some((key) => key !== "id")) return null;
  const ids = query.getAll("id");
  if (ids.length < 1 || ids.length > LIFECYCLE_MAX_IDS || new Set(ids).size !== ids.length ||
    ids.some((id) => !AUTOMATION_ID_PATTERN.test(id))) return null;
  return ids;
}

/**
 * The canonical lifecycle of the requested automations, read through the
 * pinned SDK. One `definition.list.v1` read normally answers for all of them;
 * when that answer cannot be decoded (the SDK bounds it at 16 KiB, which long
 * prompts can exceed) each id is read on its own. Nothing is invented: an id
 * Coven does not report is `absent`, and one it cannot answer for is
 * `unreadable`.
 */
export async function readAutomationLifecycleOverview(
  query: URLSearchParams,
  signal: AbortSignal,
  client: ReadClient = createAutomationReadClient(undefined, { shareCapabilities: true }),
): Promise<AutomationLifecycleOverview> {
  const ids = requestedIds(query);
  if (!ids) return { kind: "invalid" };
  try {
    const list = await client.list({}, { signal });
    const byId = new Map(list.routines.map((routine) => [routine.id, routine]));
    return {
      kind: "available",
      readAt: new Date().toISOString(),
      records: ids.map((id) => {
        const routine = byId.get(id);
        return routine
          ? project(id, routine, list.revisionById[id], Object.hasOwn(list.tombstonedAtById, id))
          : { id, kind: "absent" as const };
      }),
    };
  } catch (error) {
    const failure = classify(error);
    if (failure !== "unreadable") return { kind: failure };
  }

  const records = new Array<AutomationLifecycleRecord>(ids.length);
  let next = 0;
  let stop: "unsupported" | "unavailable" | null = null;
  const worker = async () => {
    while (stop === null && next < ids.length) {
      const index = next++;
      const id = ids[index];
      try {
        records[index] = projectDefinition(id, await client.get(id, { signal }));
      } catch (error) {
        const failure = classify(error);
        if (failure === "unreadable") records[index] = { id, kind: "unreadable" };
        else stop ??= failure;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, ids.length) }, worker));
  if (stop !== null) return { kind: stop };
  return { kind: "available", readAt: new Date().toISOString(), records };
}

/** One automation's lifecycle plus the health facts Coven reports for it. */
export async function readAutomationLifecycleDetail(
  id: string,
  signal: AbortSignal,
  client: ReadClient = createAutomationReadClient(undefined, { shareCapabilities: true }),
): Promise<AutomationLifecycleDetail> {
  if (!AUTOMATION_ID_PATTERN.test(id)) return { kind: "invalid" };
  let record: AutomationLifecycleRecord;
  try {
    record = projectDefinition(id, await client.get(id, { signal }));
  } catch (error) {
    const failure = classify(error);
    if (failure !== "unreadable") return { kind: failure };
    record = { id, kind: "unreadable" };
  }
  let health: AutomationHealthView | null = null;
  if (record.kind === "present") {
    try {
      const { health: reported } = await client.health(id, { signal });
      health = {
        nextDueAt: reported.nextDueAt,
        lastPlannedAt: reported.lastPlannedAt,
        lastStartedAt: reported.lastStartedAt,
        lastSuccessAt: reported.lastSuccessAt,
        consecutiveFailures: reported.consecutiveFailures,
        quarantined: reported.quarantinedAt !== null,
      };
    } catch {
      // The lifecycle read stands; the surface says health could not be read.
      health = null;
    }
  }
  return { kind: "available", readAt: new Date().toISOString(), record, health };
}

type CommandBody = { command: AutomationLifecycleCommand; expectedRevision: number; adoptionKey: string };

function commandBody(value: unknown): CommandBody | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "command" && key !== "expectedRevision" && key !== "adoptionKey")) return null;
  if ((body.command !== "pause" && body.command !== "activate") ||
    typeof body.expectedRevision !== "number" || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1 ||
    typeof body.adoptionKey !== "string" || !LIFECYCLE_ADOPTION_KEY_PATTERN.test(body.adoptionKey)) return null;
  return { command: body.command, expectedRevision: body.expectedRevision, adoptionKey: body.adoptionKey };
}

function commandResult(result: CovenAutomationCommandResult): AutomationLifecycleCommandResult {
  if (result.outcome === "committed" || result.outcome === "replayed") {
    return { kind: "committed", revision: result.revision, replayed: result.outcome === "replayed" };
  }
  if (result.error.code === "REVISION_CONFLICT") {
    return { kind: "conflict", currentRevision: result.error.currentRevision ?? null };
  }
  return isLifecycleCommandErrorCode(result.error.code) ? { kind: "rejected", code: result.error.code } : { kind: "unavailable" };
}

/**
 * Pause or resume at exactly the revision the person was looking at. Coven
 * decides: a moved definition comes back as a conflict, and a command whose
 * answer was lost comes back `unknown` for the caller to resend under the same
 * adoption key. This sends once and never retries on its own.
 */
export async function sendAutomationLifecycleCommand(
  id: string,
  body: unknown,
  signal: AbortSignal,
  client: CommandClient = createAutomationCommandClient(),
): Promise<AutomationLifecycleCommandResult> {
  const parsed = commandBody(body);
  if (!AUTOMATION_ID_PATTERN.test(id) || !parsed) return { kind: "invalid" };
  const context = {
    adoptionKey: parsed.adoptionKey,
    intent: parsed.command === "pause" ? "Pause from Cave" : "Resume from Cave",
    principalId: CAVE_PRINCIPAL,
  };
  try {
    const result = parsed.command === "pause"
      ? await client.pause(id, parsed.expectedRevision, context, { signal })
      : await client.activate(id, parsed.expectedRevision, context, { signal });
    return commandResult(result);
  } catch (error) {
    const code = errorCode(error);
    if (code === "outcome_unknown") return { kind: "unknown" };
    if (code === "capability_unsupported" || code === "unsupported_operation") return { kind: "unsupported" };
    if (code === "invalid_options") return { kind: "invalid" };
    return { kind: "unavailable" };
  }
}
