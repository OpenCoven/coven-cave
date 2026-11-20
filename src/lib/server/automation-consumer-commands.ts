import { createHash } from "node:crypto";
import { computeDefinitionDigest } from "@opencoven/coven-client";
import type { CovenAutomationCommandResult, CovenAutomationDefinitionDocument, CovenAutomationDraftInput, CovenAutomationRevisionInput } from "@opencoven/coven-client";
import { callDaemonBytes } from "../coven-daemon.ts";
import type { CovenantAutomation, CovenantAutomationDraft } from "../coven-automations-types.ts";
import { definitionProjectionMismatch } from "./automation-definition-snapshot.ts";
import { createAutomationCommandClient } from "./coven-automations-sdk.ts";

export type ReviewedAutomationSource = {
  routine: CovenantAutomation;
  revision: number;
  definition?: CovenAutomationDefinitionDocument;
};
export type AutomationMutationContext = { adoptionKey: string; expectedRevision: number };
export type AutomationDefinitionPatch = Partial<Pick<CovenantAutomation, "name" | "prompt" | "rrule" | "model" | "cwd" | "tags" | "familiarId" | "runtime" | "timeoutMinutes" | "status">>;

export function parseReviewedAutomationSource(value: unknown, id: string, expectedRevision: number): ReviewedAutomationSource {
  if (!value || typeof value !== "object" || !("routine" in value) || !("revision" in value)
    || value.revision !== expectedRevision || !value.routine || typeof value.routine !== "object") refuse("invalid_reviewed_definition");
  const routine = value.routine as Record<string, unknown>;
  if (routine.id !== id || routine.schemaVersion !== 1 || !["ACTIVE", "PAUSED", "DISABLED"].includes(String(routine.status))
    || !["name", "prompt", "rrule", "runtime", "timezone"].every(key => typeof routine[key] === "string")
    || !Array.isArray(routine.tags) || routine.tags.some(tag => typeof tag !== "string")) refuse("invalid_reviewed_definition");
  const source = value as ReviewedAutomationSource;
  try { reviewedDefinition(source); } catch { refuse("invalid_reviewed_definition"); }
  return source;
}

function refuse(code: string): never {
  throw Object.assign(new Error(`Coven automation mutation refused: ${code}`), { code });
}

function commandContext(adoptionKey: string, intent: string) {
  if (typeof adoptionKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(adoptionKey)) refuse("adoption_key_required");
  return { adoptionKey, intent, principalId: "cave" };
}

function revision(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) refuse("reviewed_revision_required");
  return value;
}

function committed(result: CovenAutomationCommandResult): number {
  if (result.outcome === "rejected") {
    throw Object.assign(new Error(`Coven automation mutation refused: ${result.error.code}`), {
      code: result.error.code, currentRevision: result.error.currentRevision,
    });
  }
  return result.revision;
}

/** Base-profile conversion only. Unknown flat fields are refused, not hidden
 * in extensions. The authority reference records provenance and grants no
 * execution rights; activation remains a separate reviewed command. */
function draftFromRoutine(routine: CovenantAutomationDraft): CovenAutomationDraftInput {
  const allowed = new Set(["schemaVersion", "id", "name", "status", "rrule", "timezone", "misfire", "overlap", "timeoutMinutes",
    "runtime", "familiarId", "cwd", "outputTarget", "prompt", "model", "tags", "retry"]);
  if (Object.keys(routine).some(key => !allowed.has(key)) || routine.misfire && routine.misfire !== "latest"
    || routine.overlap && routine.overlap !== "forbid" || !routine.familiarId) refuse("unsupported_definition_mapping");
  const timezone = !routine.timezone || routine.timezone === "local"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone : routine.timezone === "utc" ? "UTC" : routine.timezone;
  if (!timezone || timezone === "local") refuse("timezone_unresolved");
  const retry = (routine as CovenantAutomationDraft & { retry?: CovenAutomationDefinitionDocument["policies"]["retry"] }).retry;
  return {
    schemaVersion: "coven.automations.v1", automationId: routine.id,
    display: { name: routine.name, tags: [...routine.tags] },
    trigger: { variant: "schedule", version: 1, schedule: { rrule: routine.rrule, timezone } },
    action: { variant: "familiarInvocation", version: 1, prompt: routine.prompt, ...(routine.cwd !== undefined ? { cwd: routine.cwd } : {}) },
    binding: { familiarBindingPolicy: "exact", familiarId: routine.familiarId, authority: { approvalPolicyRef: "cave:base-v1-owner-local" } },
    runtimeRequirements: { runtimeId: routine.runtime, capabilities: ["sessions.launch"], ...(routine.model !== undefined ? { model: routine.model } : {}) },
    policies: { timeout: { perRunMinutes: routine.timeoutMinutes }, retry: retry ?? { maxAttempts: 1, backoffPolicy: "none" },
      concurrency: { overlap: "forbid" }, misfire: { disposition: "latest" },
      ...(routine.outputTarget !== undefined ? { delivery: { outputTarget: routine.outputTarget, mode: "atomic" } } : {}),
      retention: { occurrenceHistory: { classification: "standard" } } },
  };
}

function reviewedDefinition(source: ReviewedAutomationSource): CovenAutomationRevisionInput {
  revision(source.revision);
  if (source.definition === undefined) {
    if (source.routine.status === "DISABLED") refuse("explicit_lifecycle_transition_required");
    return { ...draftFromRoutine(source.routine), lifecycleState: source.routine.status === "ACTIVE" ? "active" : "paused" };
  }
  const digest = computeDefinitionDigest(source.definition);
  if (digest.status !== "computed" || digest.digest.value !== source.definition.integrity.value
    || source.definition.automationId !== source.routine.id || source.definition.revision !== source.revision
    || definitionProjectionMismatch(source.routine, source.definition)) refuse("invalid_reviewed_definition");
  const { revision: _revision, integrity: _integrity, ...definition } = source.definition;
  if (definition.lifecycleState === "disabled") refuse("explicit_lifecycle_transition_required");
  return { ...definition, lifecycleState: definition.lifecycleState === "active" ? "active" : "paused" };
}

export async function createRoutineDraft(
  routine: CovenantAutomationDraft,
  context: Pick<AutomationMutationContext, "adoptionKey">,
  transport: typeof callDaemonBytes = callDaemonBytes,
): Promise<number> {
  const command = commandContext(context.adoptionKey, "Create paused automation from Cave");
  if (routine.status !== "PAUSED") refuse("creation_must_be_paused");
  const definition = draftFromRoutine(routine);
  const client = createAutomationCommandClient(transport);
  const created = committed(await client.createDraft(definition, command));
  const readyKey = `cave-ready:${createHash("sha256").update(command.adoptionKey).digest("hex")}`;
  try {
    return committed(await client.revise(routine.id, created, { ...definition, lifecycleState: "paused" }, { ...command, adoptionKey: readyKey }));
  } catch (error) {
    // The draft already exists. Even a definitive second-step refusal must
    // retain the original create intent rather than create another identity.
    throw Object.assign(error instanceof Error ? error : new Error("Paused revision unconfirmed"), { uncertain: true });
  }
}

/** A caller retains this exact reviewed source and key until the outcome is
 * known. Never re-read a newer document to reconstruct an uncertain command. */
export async function reviseRoutineDefinition(
  source: ReviewedAutomationSource,
  patch: AutomationDefinitionPatch,
  context: AutomationMutationContext,
  transport: typeof callDaemonBytes = callDaemonBytes,
): Promise<number> {
  const command = commandContext(context.adoptionKey, "Edit reviewed automation from Cave");
  if (revision(context.expectedRevision) !== source.revision) refuse("reviewed_revision_mismatch");
  const allowed = new Set(["name", "prompt", "rrule", "model", "cwd", "tags", "familiarId", "runtime", "timeoutMinutes", "status"]);
  if (Object.keys(patch).some(key => !allowed.has(key))) refuse("unsupported_definition_fields");
  if (patch.status !== undefined && patch.status !== source.routine.status) refuse("explicit_lifecycle_transition_required");
  const definition = reviewedDefinition(source);
  const next: CovenAutomationRevisionInput = {
    ...definition,
    display: { ...definition.display, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.tags !== undefined ? { tags: [...patch.tags] } : {}) },
    action: { ...definition.action, ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}), ...(patch.cwd !== undefined ? { cwd: patch.cwd } : {}) },
    trigger: { ...definition.trigger, schedule: { ...definition.trigger.schedule, ...(patch.rrule !== undefined ? { rrule: patch.rrule } : {}) } },
    binding: { ...definition.binding, ...(patch.familiarId !== undefined ? { familiarId: patch.familiarId } : {}) },
    policies: { ...definition.policies, ...(patch.timeoutMinutes !== undefined ? { timeout: { perRunMinutes: patch.timeoutMinutes } } : {}) },
    ...(definition.runtimeRequirements ? { runtimeRequirements: { ...definition.runtimeRequirements,
      ...(patch.runtime !== undefined ? { runtimeId: patch.runtime } : {}), ...(patch.model !== undefined ? { model: patch.model } : {}) } } : {}),
  };
  if (!definition.runtimeRequirements && (patch.runtime !== undefined || patch.model !== undefined)) refuse("unsupported_runtime_mapping");
  return committed(await createAutomationCommandClient(transport).revise(source.routine.id, context.expectedRevision, next, command));
}

export async function tombstoneRoutine(id: string, context: AutomationMutationContext, transport: typeof callDaemonBytes = callDaemonBytes): Promise<number> {
  const command = commandContext(context.adoptionKey, "Delete reviewed automation from Cave");
  return committed(await createAutomationCommandClient(transport).tombstone(id, revision(context.expectedRevision), command));
}

export async function pauseRoutine(id: string, context: AutomationMutationContext, transport: typeof callDaemonBytes = callDaemonBytes): Promise<number> {
  const command = commandContext(context.adoptionKey, "Pause reviewed automation from Cave");
  return committed(await createAutomationCommandClient(transport).pause(id, revision(context.expectedRevision), command));
}
