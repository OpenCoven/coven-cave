import assert from "node:assert/strict";
import test from "node:test";
import { computeDefinitionDigest } from "@opencoven/coven-client";
import type { CovenAutomationDefinitionDocument } from "@opencoven/coven-client";
import type { DaemonByteRequest } from "../coven-daemon.ts";
import { createRoutineDraft, parseReviewedAutomationSource, reviseRoutineDefinition, tombstoneRoutine } from "./automation-consumer-commands.ts";

const routine = { schemaVersion: 1, id: "daily", name: "Daily", status: "PAUSED" as const,
  rrule: "FREQ=DAILY;BYHOUR=8", timezone: "UTC", misfire: "latest" as const, overlap: "forbid" as const,
  timeoutMinutes: 10, runtime: "codex", familiarId: "alba", prompt: "Reflect", tags: ["journal"] };
function source() {
  const definition: CovenAutomationDefinitionDocument = {
    schemaVersion: "coven.automations.v1", automationId: "daily", revision: 4,
    integrity: { algorithm: "sha256", canonicalization: "jcs-rfc8785", value: "0".repeat(64) }, lifecycleState: "paused",
    display: { name: "Daily", description: "Preserve description", tags: ["journal"] },
    trigger: { variant: "schedule", version: 1, schedule: { rrule: routine.rrule, timezone: "UTC" } },
    action: { variant: "familiarInvocation", version: 1, prompt: "Reflect", cwd: "/journal" },
    binding: { familiarBindingPolicy: "exact", familiarId: "alba", authority: { approvalPolicyRef: "existing-policy" } },
    runtimeRequirements: { runtimeId: "codex", capabilities: ["sessions.launch"], model: "existing-model" },
    policies: { timeout: { perRunMinutes: 10 }, retry: { maxAttempts: 3, backoffPolicy: "fixed", backoffSeconds: 30 },
      concurrency: { overlap: "forbid" }, misfire: { disposition: "latest" }, retention: { occurrenceHistory: { classification: "extended" } } },
    extensions: { "x-journal": { custom: true } },
  };
  const digest = computeDefinitionDigest(definition);
  assert.equal(digest.status, "computed");
  return { routine: { ...routine, cwd: "/journal", model: "existing-model", retry: { maxAttempts: 3, backoffPolicy: "fixed" as const, backoffSeconds: 30 } }, revision: 4, definition: { ...definition, integrity: digest.status === "computed" ? digest.digest : definition.integrity } };
}
function wire({ lost = false, conflict = false, rejectReady = false } = {}) {
  const commands: Record<string, any>[] = [];
  const transport = async (request: DaemonByteRequest) => {
    if (request.method === "GET") return { ok: true, status: 200, data: Buffer.from(JSON.stringify({ capabilities: [{
      id: "coven.automations", label: "Automations", adapter: "coven-daemon", status: "available", policy: "allow",
      actions: ["coven.automations.command.v1", "coven.automations.definition.create.v1", "coven.automations.definition.revise.v1", "coven.automations.definition.tombstone.v1"],
      variantNegotiation: { version: 1, contractProfile: "coven.automations.v1", description: "Fixture",
        supported: { triggers: [{ variant: "schedule", version: 1 }], conditions: [], actions: [{ variant: "familiarInvocation", version: 1 }], triggerPolicies: [], deliveryPolicies: [], retentionPolicies: [] },
        experimental: [], refused: [], negotiationRules: [] },
    }] })) };
    const body = request.body as { action: string; envelope: Record<string, any> };
    commands.push(JSON.parse(JSON.stringify(body.envelope)));
    if (lost) return { ok: false, status: 0, data: null };
    const { command, adoptionKey } = body.envelope;
    const refused = conflict || (rejectReady && command === "definition.revise.v1");
    const result = refused
      ? { schemaVersion: "coven.automations.v1", command, adoptionKey, outcome: "rejected", error: { code: "REVISION_CONFLICT", httpStatus: 409, message: "moved", retryable: false, currentRevision: 6 } }
      : { schemaVersion: "coven.automations.v1", command, adoptionKey, outcome: "committed", revision: command === "definition.create.v1" ? 1 : 5, result: {} };
    return { ok: !refused, status: refused ? 409 : 200, data: Buffer.from(JSON.stringify({ action: body.action, ok: !refused, accepted: !refused, status: refused ? "rejected" : "completed", result })) };
  };
  return { transport, commands };
}

test("rich edits preserve metadata and send the reviewed revision and adoption key", async () => {
  const { transport, commands } = wire();
  await reviseRoutineDefinition(source(), { name: "Renamed", prompt: "New instructions" }, { expectedRevision: 4, adoptionKey: "edit-stable-123" }, transport);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].expectedRevision, 4);
  assert.equal(commands[0].adoptionKey, "edit-stable-123");
  const definition = commands[0].payload.definition;
  assert.equal(definition.display.name, "Renamed");
  assert.equal(definition.display.description, "Preserve description");
  assert.equal(definition.action.prompt, "New instructions");
  assert.equal(definition.action.cwd, "/journal");
  assert.equal(definition.policies.retry.maxAttempts, 3);
  assert.equal(definition.binding.authority.approvalPolicyRef, "existing-policy");
  assert.deepEqual(definition.extensions, { "x-journal": { custom: true } });
});

test("creation cannot start a routine and uses stable distinct keys for draft and paused revision", async () => {
  const { transport, commands } = wire();
  await createRoutineDraft(routine, { adoptionKey: "create-stable-123" }, transport);
  assert.deepEqual(commands.map(command => command.command), ["definition.create.v1", "definition.revise.v1"]);
  assert.equal(commands[0].payload.definition.lifecycleState, "draft");
  assert.equal(commands[1].payload.definition.lifecycleState, "paused");
  assert.equal(commands[1].expectedRevision, 1);
  assert.notEqual(commands[0].adoptionKey, commands[1].adoptionKey);
  const repeated = wire();
  await createRoutineDraft(routine, { adoptionKey: "create-stable-123" }, repeated.transport);
  assert.deepEqual(repeated.commands, commands);
  await assert.rejects(createRoutineDraft({ ...routine, status: "ACTIVE" }, { adoptionKey: "create-active-123" }, transport));
});

test("a lost command answer stays uncertain and is never retried by the adapter", async () => {
  const { transport, commands } = wire({ lost: true });
  await assert.rejects(reviseRoutineDefinition(source(), { name: "Renamed" }, { expectedRevision: 4, adoptionKey: "edit-stable-123" }, transport), { code: "outcome_unknown" });
  assert.equal(commands.length, 1);
});

test("a refused paused revision after draft creation reports an incomplete creation that must retain its identity", async () => {
  const { transport, commands } = wire({ rejectReady: true });
  await assert.rejects(createRoutineDraft(routine, { adoptionKey: "create-stable-123" }, transport), { code: "REVISION_CONFLICT", uncertain: true });
  assert.deepEqual(commands.map(command => command.command), ["definition.create.v1", "definition.revise.v1"]);
});

test("missing review context, unsupported fields and altered source metadata are refused before dispatch", async () => {
  const { transport, commands } = wire();
  for (const context of [{ expectedRevision: 3, adoptionKey: "edit-stable-123" }, { expectedRevision: 4, adoptionKey: "" }]) {
    await assert.rejects(reviseRoutineDefinition(source(), { name: "Renamed" }, context, transport));
  }
  await assert.rejects(reviseRoutineDefinition(source(), { status: "ACTIVE" }, { expectedRevision: 4, adoptionKey: "edit-stable-123" }, transport));
  const tampered = source();
  tampered.definition = { ...tampered.definition, display: { name: "Tampered" } };
  await assert.rejects(reviseRoutineDefinition(tampered, { name: "Renamed" }, { expectedRevision: 4, adoptionKey: "edit-stable-123" }, transport));
  assert.equal(commands.length, 0);
});

test("tombstone sends one reviewed command without a pre-read and preserves typed conflicts", async () => {
  const { transport, commands } = wire({ conflict: true });
  await assert.rejects(tombstoneRoutine("daily", { expectedRevision: 4, adoptionKey: "delete-stable-123" }, transport), { code: "REVISION_CONFLICT", currentRevision: 6 });
  assert.equal(commands.length, 1);
  assert.equal(commands[0].command, "definition.tombstone.v1");
});

test("flat definitions retain supported retry, timezone and output metadata during their first typed revision", async () => {
  const { commands, transport } = wire();
  const legacy = { ...routine, timezone: "utc", outputTarget: "/journal/result", retry: { maxAttempts: 2, backoffPolicy: "fixed" as const, backoffSeconds: 40 } };
  await reviseRoutineDefinition({ routine: legacy, revision: 4 }, { name: "Edited" }, { expectedRevision: 4, adoptionKey: "legacy-edit-123" }, transport);
  const definition = commands[0].payload.definition;
  assert.equal(definition.trigger.schedule.timezone, "UTC");
  assert.equal(definition.policies.retry.maxAttempts, 2);
  assert.equal(definition.policies.retry.backoffSeconds, 40);
  assert.equal(definition.policies.delivery.outputTarget, "/journal/result");
});

test("flat definitions with unmappable metadata are refused instead of losing fields", async () => {
  const { commands, transport } = wire();
  const legacy = { ...routine, unsupportedSchedulerPolicy: "keep-me" };
  await assert.rejects(reviseRoutineDefinition({ routine: legacy, revision: 4 }, { name: "Edited" }, { expectedRevision: 4, adoptionKey: "legacy-edit-123" }, transport), { code: "unsupported_definition_mapping" });
  assert.equal(commands.length, 0);
});

test("retrying an uncertain edit with its original snapshot sends the identical command", async () => {
  const { transport, commands } = wire({ lost: true });
  const reviewed = source();
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(reviseRoutineDefinition(reviewed, { name: "Renamed" }, { expectedRevision: 4, adoptionKey: "edit-stable-123" }, transport), { code: "outcome_unknown" });
  }
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[1], commands[0]);
});

test("edits refuse a correctly digested source that contradicts the fields the user reviewed", async () => {
  const { transport, commands } = wire();
  for (const patch of [{ prompt: "Different reviewed prompt" }, { model: "other-model" },
    { cwd: "/different" }, { outputTarget: "/unexpected-output" }]) {
    const reviewed = source();
    const inconsistent = { ...reviewed, routine: { ...reviewed.routine, ...patch } };
    assert.throws(() => parseReviewedAutomationSource(inconsistent, "daily", 4), { code: "invalid_reviewed_definition" });
    await assert.rejects(reviseRoutineDefinition(inconsistent, { name: "Renamed" },
      { expectedRevision: 4, adoptionKey: "edit-stable-123" }, transport), { code: "invalid_reviewed_definition" });
  }
  assert.equal(commands.length, 0);
});
