import assert from "node:assert/strict";
import test from "node:test";
import type { ResearchMission } from "./research-missions.ts";
import {
  actOnResearchMission,
  createResearchMission,
  isActiveResearchMission,
  listResearchMissions,
  runResearchAutomationNow,
  scheduleResearchMission,
  selectStableMission,
  setResearchAutomationStatus,
} from "./research-mission-client.ts";

function mission(id: string, status: ResearchMission["status"]): ResearchMission {
  return { id, status } as ResearchMission;
}

test("list encodes familiar id and forwards abort signals", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const requests: Array<{ input: string; signal?: AbortSignal | null }> = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({ input: String(input), signal: init?.signal });
    return Response.json({ ok: true, missions: [] });
  }) as typeof fetch;
  try {
    await listResearchMissions("sage & team", controller.signal);
    assert.equal(requests[0]?.input, "/api/research/missions?familiarId=sage%20%26%20team");
    assert.equal(requests[0]?.signal, controller.signal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("create posts the reviewed mission input", async () => {
  const originalFetch = globalThis.fetch;
  let method = "";
  let body = "";
  globalThis.fetch = (async (_input, init) => {
    method = init?.method ?? "";
    body = String(init?.body ?? "");
    return Response.json({ ok: true, mission: mission("m1", "running") });
  }) as typeof fetch;
  try {
    const input = {
      familiarId: "sage",
      intent: "Compare two databases",
      mode: "brief" as const,
      modeSource: "auto" as const,
      deliverable: "brief",
      bounds: {
        wallClockMinutes: 20,
        maxIterations: 1,
        sourceTarget: 6,
        checkpointEvery: 1,
        stopWhenCostUnavailable: false,
      },
    };
    await createResearchMission(input);
    assert.equal(method, "POST");
    assert.deepEqual(JSON.parse(body), input);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stable selection survives polling and active states are explicit", () => {
  const missions = [mission("new", "queued"), mission("selected", "completed")];
  assert.equal(selectStableMission("selected", missions), "selected");
  assert.equal(selectStableMission("missing", missions), "new");
  assert.equal(isActiveResearchMission(missions[0]), true);
  assert.equal(isActiveResearchMission(missions[1]), false);
});

test("actions post to the encoded mission endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ input: string; method?: string; body?: BodyInit | null }> = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({ input: String(input), method: init?.method, body: init?.body });
    return Response.json({ ok: true, mission: mission("m/1", "checkpoint") });
  }) as typeof fetch;
  try {
    await actOnResearchMission("m/1", { action: "continue" });
    assert.equal(requests[0]?.input, "/api/research/missions/m%2F1/actions");
    assert.equal(requests[0]?.method, "POST");
    assert.deepEqual(JSON.parse(String(requests[0]?.body)), { action: "continue" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("schedule and standard Automation controls use their owning APIs", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ input: string; method?: string; body?: BodyInit | null }> = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({ input: String(input), method: init?.method, body: init?.body });
    return Response.json({ ok: true, mission: mission("m/1", "checkpoint") });
  }) as typeof fetch;
  try {
    await scheduleResearchMission("m/1", {
      rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
    });
    await setResearchAutomationStatus("auto/1", "ACTIVE");
    await runResearchAutomationNow("auto/1");
    assert.deepEqual(requests.map((request) => [request.input, request.method]), [
      ["/api/research/missions/m%2F1/schedule", "POST"],
      ["/api/codex-automations/auto%2F1", "PATCH"],
      ["/api/codex-automations/auto%2F1/run", "POST"],
    ]);
    assert.deepEqual(JSON.parse(String(requests[1]?.body)), { status: "ACTIVE" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
