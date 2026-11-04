import assert from "node:assert/strict";
import test from "node:test";
import { computeDefinitionDigest } from "@opencoven/coven-client";
import type { DaemonByteRequest } from "../coven-daemon.ts";
import { readAutomationDefinitionSnapshot } from "./automation-definition-snapshot.ts";

const action = "coven.automations.definition.get.v1";
const routine = {
  schemaVersion: 1, id: "journal-alba", name: "Journal", status: "PAUSED",
  rrule: "FREQ=DAILY;BYHOUR=8;BYMINUTE=0", timezone: "America/Chicago",
  misfire: "latest", overlap: "forbid", timeoutMinutes: 10,
  runtime: "codex", model: "chosen-model", retry: { maxAttempts: 2, backoffPolicy: "fixed", backoffSeconds: 60 }, familiarId: "alba", prompt: "Reflect", tags: ["journal"],
};

function document() {
  const value = {
    schemaVersion: "coven.automations.v1", automationId: "journal-alba", revision: 7,
    integrity: { algorithm: "sha256", canonicalization: "jcs-rfc8785", value: "0".repeat(64) },
    lifecycleState: "paused", display: { name: "Journal", description: "Keep this description", tags: ["journal"] },
    trigger: { variant: "schedule", version: 1, schedule: { rrule: routine.rrule, timezone: "America/Chicago" } },
    action: { variant: "familiarInvocation", version: 1, prompt: "Reflect" },
    binding: { familiarBindingPolicy: "exact", familiarId: "alba", authority: { approvalPolicyRef: "review-required" } },
    runtimeRequirements: { runtimeId: "codex", capabilities: ["journal"], model: "chosen-model" },
    policies: { timeout: { perRunMinutes: 10 }, retry: { maxAttempts: 2, backoffPolicy: "fixed", backoffSeconds: 60 },
      concurrency: { overlap: "forbid" }, misfire: { disposition: "latest" },
      retention: { occurrenceHistory: { classification: "extended" } } },
    extensions: { "x-journal": { preserve: ["custom", 42] } },
  };
  const digest = computeDefinitionDigest(value);
  assert.equal(digest.status, "computed");
  if (digest.status === "computed") value.integrity = { ...digest.digest };
  return value;
}

function transportFor(payload: unknown) {
  const requests: DaemonByteRequest[] = [];
  return { requests, transport: async (request: DaemonByteRequest) => {
    requests.push(request);
    const body = request.method === "GET" ? { capabilities: [{
      id: "coven.automations", label: "Automations", adapter: "coven-daemon",
      status: "available", policy: "allow", actions: [action],
      variantNegotiation: { version: 1, contractProfile: "coven.automations.v1", description: "Fixture",
        supported: { triggers: [], conditions: [], actions: [], triggerPolicies: [], deliveryPolicies: [], retentionPolicies: [] },
        experimental: [], refused: [], negotiationRules: [] },
    }] } : { ok: true, accepted: true, action, status: "completed",
      event: { kind: "automations.changed", action, payload } };
    return { ok: true, status: 200, data: Buffer.from(JSON.stringify(body)) };
  } };
}

test("one bounded revision read retains rich metadata omitted by the compatibility projection", async () => {
  const { transport, requests } = transportFor({ routine, revision: 7, tombstonedAt: null, definition: document() });
  const snapshot = await readAutomationDefinitionSnapshot("journal-alba", transport);
  assert.equal(snapshot.routine?.id, "journal-alba");
  assert.equal(snapshot.revision, 7);
  assert.equal(snapshot.definition?.display.description, "Keep this description");
  assert.deepEqual(snapshot.definition?.extensions, { "x-journal": { preserve: ["custom", 42] } });
  assert.equal(snapshot.definition?.policies.retry.backoffSeconds, 60);
  assert.equal(snapshot.definition?.binding.authority.approvalPolicyRef, "review-required");
  assert.equal(requests.filter(request => request.method === "POST").length, 1);
  assert.ok(requests.every(request => request.maxResponseBytes === (request.method === "GET" ? 16_384 : 1_048_576) && request.retryTransportFailure === false));
});

test("legacy and absent definitions remain distinguishable without inventing rich metadata", async () => {
  const legacy = await readAutomationDefinitionSnapshot("journal-alba", transportFor({ routine, revision: 7, tombstonedAt: null }).transport);
  assert.equal(legacy.revision, 7);
  assert.equal(legacy.definition, undefined);
  assert.deepEqual(await readAutomationDefinitionSnapshot("journal-alba", transportFor({ routine: null }).transport), { routine: null });
});

test("malformed, mismatched and tampered rich definitions refuse the snapshot", async () => {
  const wrongRevision = { ...document(), revision: 6 };
  const wrongId = { ...document(), automationId: "another" };
  // Re-sign these fixtures so correlation must reject them independently of
  // the digest check. Tampering below deliberately retains the old digest.
  for (const value of [wrongRevision, wrongId]) {
    const digest = computeDefinitionDigest(value);
    assert.equal(digest.status, "computed");
    if (digest.status === "computed") value.integrity = { ...digest.digest };
  }
  for (const definition of [null, {}, wrongRevision, wrongId,
    { ...document(), display: { name: "Tampered" } }]) {
    await assert.rejects(readAutomationDefinitionSnapshot("journal-alba", transportFor({ routine, revision: 7, tombstonedAt: null, definition }).transport), { code: "invalid_response" });
  }
});

test("a rich document cannot accompany an absent compatibility definition", async () => {
  await assert.rejects(readAutomationDefinitionSnapshot("journal-alba", transportFor({ routine: null, definition: document() }).transport), { code: "invalid_response" });
});

test("an unavailable daemon refuses rather than reading a local definition or returning absence", async () => {
  await assert.rejects(readAutomationDefinitionSnapshot("journal-alba", async () => ({ ok: false, status: 0, data: null })), { code: "unavailable" });
});

test("correctly digested rich documents cannot contradict the reviewed compatibility fields", async () => {
  for (const patch of [{ prompt: "Different instructions" }, { name: "Different name" }, { status: "ACTIVE" },
    { model: "other-model" }, { runtime: "other-runtime" }, { familiarId: "other-familiar" },
    { rrule: "FREQ=DAILY;BYHOUR=12" }, { timezone: "UTC" }, { timeoutMinutes: 99 }, { tags: ["other"] },
    { cwd: "/different" }, { outputTarget: "/unexpected-output" },
    { retry: { maxAttempts: 1, backoffPolicy: "none" } }]) {
    await assert.rejects(readAutomationDefinitionSnapshot("journal-alba", transportFor({ routine: { ...routine, ...patch },
      revision: 7, tombstonedAt: null, definition: document() }).transport), { code: "invalid_response" });
  }
});

test("a supported prompt survives duplication in the rich document and compatibility projection", async () => {
  const prompt = "x".repeat(9_000);
  const definition = document();
  definition.action.prompt = prompt;
  const digest = computeDefinitionDigest(definition);
  assert.equal(digest.status, "computed");
  if (digest.status === "computed") definition.integrity = { ...digest.digest };
  const snapshot = await readAutomationDefinitionSnapshot("journal-alba", transportFor({
    routine: { ...routine, prompt }, revision: 7, tombstonedAt: null, definition,
  }).transport);
  assert.equal(snapshot.routine?.prompt.length, 9_000);
  assert.equal(snapshot.definition?.action.prompt, prompt);
});
