import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type { CovenAutomationDefinitionDocument } from "@opencoven/coven-client";

test("compatibility read routes use typed daemon requests and retain payloads, partial results and offline refusal", async () => {
  const root = await mkdtemp("/tmp/c7-read-");
  const keys = ["COVEN_HOME", "COVEN_CAVE_HOME", "COVEN_SOCKET"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.COVEN_HOME = root;
  process.env.COVEN_CAVE_HOME = path.join(root, "cave");
  process.env.COVEN_SOCKET = path.join(root, "daemon.sock");
  const calls: Record<string, unknown>[] = [];
  const routine = { schemaVersion: 1, id: "daily", name: "Daily", status: "PAUSED", rrule: "FREQ=DAILY;BYHOUR=8",
    timezone: "UTC", misfire: "latest", overlap: "forbid", timeoutMinutes: 10, runtime: "codex", familiarId: "alba", prompt: "Reflect", tags: [] };
  let storedRevision = 4;
  let createdDefinition: CovenAutomationDefinitionDocument | undefined;
  const run = { id: "old-run", automationId: "daily", occurrenceId: "occ-1", sessionId: null, familiarId: null, runtime: null,
    status: "succeeded", exitCode: 0, logJson: "Recorded reflection", outputCommit: null,
    startedAt: "2026-10-01T08:00:00Z", finishedAt: "2026-10-01T08:01:00Z", receiptId: null, attempts: [],
    automationRevision: 4, definitionDigest: null, authorityProfile: null, timeoutAt: null };
  const actions = ["coven.automations.definition.list.v1", "coven.automations.definition.get.v1", "coven.automations.runs", "coven.automations.run.get.v1",
    "coven.automations.command.v1", "coven.automations.definition.tombstone.v1", "coven.automations.definition.revise.v1", "coven.automations.definition.create.v1"];
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/v1/capabilities") {
      res.end(JSON.stringify({ capabilities: [{ id: "coven.automations", label: "Automations", adapter: "coven-daemon",
        status: "available", policy: "allow", actions,
        variantNegotiation: { version: 1, contractProfile: "coven.automations.v1", description: "Fixture",
          supported: { triggers: [], conditions: [], actions: [], triggerPolicies: [], deliveryPolicies: [], retentionPolicies: [] },
          experimental: [], refused: [], negotiationRules: [] } }] }));
      return;
    }
    let bytes = "";
    for await (const chunk of req) bytes += chunk;
    const body = JSON.parse(bytes);
    calls.push(body);
    if (body.action === "coven.automations.command.v1") {
      const creating = body.envelope.payload.definition?.automationId === "created";
      if (creating) createdDefinition = body.envelope.payload.definition;
      else {
        storedRevision = body.envelope.expectedRevision + 1;
        if (body.envelope.command === "definition.revise.v1") routine.name = body.envelope.payload.definition.display.name;
      }
      res.end(JSON.stringify({ ok: true, accepted: true, action: body.action, status: "completed",
        result: { schemaVersion: "coven.automations.v1", command: body.envelope.command, adoptionKey: body.envelope.adoptionKey,
          outcome: "committed", revision: creating ? createdDefinition!.revision : storedRevision, result: {} } }));
      return;
    }
    let payload;
    if (body.action === actions[0]) payload = { routines: [routine], revisionById: { daily: storedRevision }, tombstonedAtById: {} };
    else if (body.action === actions[1] && body.id === "created" && createdDefinition) payload = {
      routine: { ...routine, id: "created", name: createdDefinition.display.name, prompt: createdDefinition.action.prompt,
        runtime: createdDefinition.runtimeRequirements?.runtimeId, timeoutMinutes: createdDefinition.policies.timeout.perRunMinutes, retry: createdDefinition.policies.retry },
      revision: createdDefinition.revision, tombstonedAt: null, definition: createdDefinition,
    };
    else if (body.action === actions[1]) payload = { routine, revision: storedRevision, tombstonedAt: null };
    else if (body.action === actions[2]) payload = { runs: body.id === "daily" ? [run] : [] };
    else if (body.action === actions[3]) payload = { run };
    else { res.writeHead(400); res.end("unexpected action"); return; }
    if (body.id === "refused") {
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, accepted: false, action: body.action, status: "rejected", reason: "refused" }));
      return;
    }
    res.end(JSON.stringify({ ok: true, accepted: true, action: body.action, status: "completed",
      event: { kind: "automations.changed", action: body.action, payload } }));
  });
  try {
    await new Promise<void>(resolve => server.listen(process.env.COVEN_SOCKET!, resolve));
    const list = await import("../../app/api/codex-automations/route.ts");
    const definition = await import("../../app/api/codex-automations/[id]/definition/route.ts");
    const history = await import("../../app/api/codex-automations/[id]/runs/route.ts");
    const log = await import("../../app/api/codex-automations/[id]/runs/[runId]/log/route.ts");
    const last = await import("../../app/api/codex-automation-last-runs/route.ts");
    const detail = await import("../../app/api/codex-automations/[id]/route.ts");
    const request = new Request("http://127.0.0.1:3000/api/codex-automations/daily");
    const params = { params: Promise.resolve({ id: "daily" }) };
    const listed = await list.GET();
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).automations[0].rrule, "RRULE:FREQ=DAILY;BYHOUR=8");
    const current = await definition.GET(request, params);
    assert.equal(current.headers.get("cache-control"), "no-store");
    const reviewed = await current.json();
    assert.equal(reviewed.revision, 4);
    assert.equal((await (await history.GET(request, params)).json()).runs[0].id, "old-run");
    const logged = await log.GET(request, { params: Promise.resolve({ id: "daily", runId: "old-run" }) });
    assert.deepEqual(await logged.json(), { ok: true, log: "Recorded reflection", truncated: false });
    assert.equal((await log.GET(request, { params: Promise.resolve({ id: "other", runId: "old-run" }) })).status, 404);
    const badges = await last.GET(new Request("http://127.0.0.1:3000/api/codex-automation-last-runs?id=daily&id=refused"));
    const partial = await badges.json();
    assert.equal(partial.ok, true);
    assert.equal(partial.runs.daily.id, "old-run");
    assert.equal(partial.runs.refused, null);
    const edited = await detail.PATCH(new Request("http://127.0.0.1:3000/api/codex-automations/daily", {
      method: "PATCH", headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify({ name: "Updated", expectedRevision: 4, adoptionKey: "cave-edit:fixture-1", reviewedSource: reviewed.reviewedSource }),
    }), params);
    assert.equal(edited.status, 200, await edited.clone().text());
    assert.equal((await edited.json()).automation.name, "Updated");
    const edit = calls.find(call => call.action === "coven.automations.command.v1")?.envelope as { command: string; expectedRevision: number; adoptionKey: string };
    assert.equal(edit.command, "definition.revise.v1");
    assert.equal(edit.expectedRevision, 4);
    assert.equal(edit.adoptionKey, "cave-edit:fixture-1");
    const deleted = await detail.DELETE(new Request("http://127.0.0.1:3000/api/codex-automations/daily?expectedRevision=5", {
      method: "DELETE", headers: { host: "127.0.0.1:3000", "Idempotency-Key": "cave-delete:daily:5" },
    }), params);
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { ok: true, revision: 6 });
    const command = calls.at(-1)?.envelope as { command: string; adoptionKey: string; expectedRevision: number };
    assert.equal(command.command, "definition.tombstone.v1");
    assert.equal(command.adoptionKey, "cave-delete:daily:5");
    assert.equal(command.expectedRevision, 5);
    const beforeCreation = calls.length;
    const created = await list.POST(new Request("http://127.0.0.1:3000/api/codex-automations", {
      method: "POST", headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify({ id: "created", adoptionKey: "cave-create:fixture-1", timezone: "UTC", name: "New job",
        prompt: "Reflect", rrule: "RRULE:FREQ=DAILY;BYHOUR=8", familiars: ["alba"], cwds: [], model: "", tags: [] }),
    }));
    assert.equal(created.status, 200, await created.clone().text());
    const newJob = await created.json();
    assert.equal(newJob.automation.id, "created");
    assert.equal(newJob.automation.status, "PAUSED");
    assert.equal(newJob.revision, 2);
    const creationCommands = calls.slice(beforeCreation).filter(call => call.action === "coven.automations.command.v1")
      .map(call => call.envelope as { command: string; adoptionKey: string });
    assert.deepEqual(creationCommands.map(entry => entry.command), ["definition.create.v1", "definition.revise.v1"]);
    assert.equal(creationCommands[0].adoptionKey, "cave-create:fixture-1");
    assert.notEqual(creationCommands[0].adoptionKey, creationCommands[1].adoptionKey);
    assert.ok(calls.every(call => actions.includes(String(call.action))));
    assert.ok(calls.some(call => call.action === actions[2] && call.limit === 1));
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    const offline = await list.GET();
    assert.equal(offline.status, 503);
    assert.equal((await offline.json()).degraded, true);
  } finally {
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(root, { recursive: true, force: true });
  }
});
