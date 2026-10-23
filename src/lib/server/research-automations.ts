import type { CovenAutomationCommandResult, CovenAutomationDraftInput } from "@opencoven/coven-client";
import { createHash } from "node:crypto";
import type { RoutineRun } from "../coven-automations-types.ts";
import { covenRoutineRrule } from "../automations/routine-rrule.ts";
import { createAutomationCommandClient, createAutomationReadClient } from "./coven-automations-sdk.ts";

export type ResearchAutomationContext = {
  missionId: string;
  automationId: string;
  adoptionKey: string;
};

export type ResearchAutomationInput = {
  name: string;
  rrule: string;
  prompt: string;
  cwds: string[];
  tags: string[];
  familiars: string[];
  model: string;
  reasoningEffort: string;
  executionEnvironment: string;
  skillPath: string | null;
};

export type ResearchAutomationRecord = {
  id: string;
  status: "ACTIVE" | "PAUSED";
  rrule: string;
  revision: number;
};

function refuse(code: string): never {
  throw Object.assign(new Error(`Research automation refused: ${code}`), { code });
}

function contextFor(value: ResearchAutomationContext | undefined) {
  if (!value || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.missionId)
    || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(value.automationId)
    || typeof value.adoptionKey !== "string" || value.adoptionKey.length < 1 || value.adoptionKey.length > 200) {
    refuse("research-automation-contract-required");
  }
  return {
    adoptionKey: value.adoptionKey,
    intent: "Research automation definition",
    principalId: "cave",
    correlationId: value.missionId,
  };
}

function committed(answer: CovenAutomationCommandResult): number {
  if (answer.outcome === "rejected") {
    throw Object.assign(new Error(`Research automation refused: ${answer.error.code}`), {
      code: answer.error.code, currentRevision: answer.error.currentRevision,
    });
  }
  return answer.revision;
}

export async function listResearchAutomationRuns(id: string, limit = 20): Promise<RoutineRun[]> {
  const { runs } = await createAutomationReadClient().runs(id, { limit });
  return runs.map((run) => {
    if (!["running", "succeeded", "failed", "cancelled"].includes(run.status)) refuse("unsupported-research-run-status");
    return {
      id: run.id, automationId: run.automationId, runtime: run.runtime ?? "",
      status: run.status as RoutineRun["status"], startedAt: run.startedAt,
      ...(run.finishedAt !== null ? { finishedAt: run.finishedAt } : {}),
      ...(run.exitCode !== null ? { exitCode: run.exitCode } : {}),
      ...(run.logJson !== null ? { logJson: run.logJson } : {}),
      ...(run.outputCommit !== null ? { outputCommit: run.outputCommit } : {}),
      ...(run.sessionId !== null ? { sessionId: run.sessionId } : {}),
      ...(run.familiarId !== null ? { familiarId: run.familiarId } : {}),
      ...(run.occurrenceId !== null ? { occurrenceId: run.occurrenceId } : {}),
    };
  });
}

/** Definition projection only. Missing legacy ids require explicit import;
 * this boundary never opens a Codex directory or creates a replacement id. */
export async function getResearchAutomation(id: string): Promise<ResearchAutomationRecord | null> {
  const answer = await createAutomationReadClient().get(id);
  if (!answer.routine || answer.tombstonedAt) return null;
  if (answer.routine.id !== id) refuse("automation-id-mismatch");
  if (answer.routine.status !== "ACTIVE" && answer.routine.status !== "PAUSED") refuse("automation-disabled");
  return {
    id, revision: answer.revision, status: answer.routine.status,
    rrule: `RRULE:${answer.routine.rrule.replace(/^RRULE:/, "")}`,
  };
}

export async function createResearchAutomation(
  input: ResearchAutomationInput,
  context?: ResearchAutomationContext,
): Promise<ResearchAutomationRecord> {
  const command = contextFor(context);
  // These fields have no executable mapping in the released base profile.
  // Do not hide them in extensions where the executor would ignore them.
  if (input.reasoningEffort || input.executionEnvironment || input.skillPath
    || input.cwds.length !== 1 || input.familiars.length !== 1) refuse("unsupported-research-automation-fields");
  if (!input.tags.includes(`research-mission:${context!.missionId}`)) refuse("mission-correlation-mismatch");
  const schedule = covenRoutineRrule(input.rrule);
  if (!schedule.ok) refuse("unsupported-research-schedule");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timezone || timezone === "local") refuse("research-timezone-unresolved");
  const definition: CovenAutomationDraftInput = {
    schemaVersion: "coven.automations.v1",
    automationId: context!.automationId,
    display: { name: input.name, tags: [...input.tags] },
    trigger: { variant: "schedule", version: 1, schedule: { rrule: schedule.rrule, timezone } },
    action: { variant: "familiarInvocation", version: 1, prompt: input.prompt, cwd: input.cwds[0] },
    // v0.4.10 stores this reference but does not enforce Runtime Authority.
    // It records the base owner-local profile and grants no execution rights.
    binding: { familiarBindingPolicy: "exact", familiarId: input.familiars[0], authority: { approvalPolicyRef: "cave:research:base-v1-owner-local" } },
    runtimeRequirements: { runtimeId: "coven-code", capabilities: ["sessions.launch"], ...(input.model ? { model: input.model } : {}) },
    policies: {
      timeout: { perRunMinutes: 60 }, retry: { maxAttempts: 1, backoffPolicy: "none" },
      concurrency: { overlap: "forbid" }, misfire: { disposition: "latest" },
      retention: { occurrenceHistory: { classification: "standard" } },
    },
  };
  const client = createAutomationCommandClient();
  const createdRevision = committed(await client.createDraft(definition, command));
  // The released lifecycle requires draft -> revise(paused) before an
  // explicit activation. Both steps retain the reviewed body and stable keys.
  const readyKey = `research-ready:${createHash("sha256").update(command.adoptionKey).digest("hex")}`;
  const revision = committed(await client.revise(context!.automationId, createdRevision,
    { ...definition, lifecycleState: "paused" }, { ...command, adoptionKey: readyKey }));
  const current = await getResearchAutomation(context!.automationId);
  if (!current || current.revision < revision || current.status !== "PAUSED") refuse("research-create-state-changed");
  return current;
}

export async function updateResearchAutomation(
  id: string,
  patch: { status?: "ACTIVE" | "PAUSED" },
  context?: ResearchAutomationContext & { expectedRevision: number },
): Promise<ResearchAutomationRecord> {
  const command = contextFor(context);
  if (context!.automationId !== id || !Number.isSafeInteger(context!.expectedRevision) || context!.expectedRevision < 1) {
    refuse("research-automation-revision-required");
  }
  if (Object.keys(patch).some(key => key !== "status") || (patch.status !== "PAUSED" && patch.status !== "ACTIVE")) refuse("unsupported-research-automation-patch");
  const client = createAutomationCommandClient();
  const result = patch.status === "PAUSED"
    ? await client.pause(id, context!.expectedRevision, command)
    : await client.activate(id, context!.expectedRevision, command);
  const revision = committed(result);
  // Read after the committed command rather than inventing the schedule.
  const current = await getResearchAutomation(id);
  if (!current) refuse("automation-missing-after-command");
  if (current.revision < revision) refuse("automation-stale-after-command");
  return current;
}
