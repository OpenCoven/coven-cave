import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hook = readFileSync(new URL("./use-research-run-gateway.ts", import.meta.url), "utf8");
const desk = readFileSync(new URL("./research-tab-desk.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("./research-mission-detail.tsx", import.meta.url), "utf8");

test("Research Desk subscribes to the canonical gateway and reduces only same-run events", () => {
  assert.match(hook, /getResearchRunGateway/);
  assert.match(hook, /researchRunGatewayStreamUrl/);
  assert.match(hook, /createResearchRunEventState/);
  assert.match(hook, /consumeResearchRunEvent/);
  assert.match(hook, /eventState\.run\.id !== frame\.event\.runId/);
  assert.match(hook, /source\?\.close\(\)/);
  assert.match(desk, /useResearchRunGateway\(research\.selected\?\.id \?\? null, familiarId\)/);
  assert.match(desk, /data-research-run-gateway-status/);
  assert.match(detail, /canonicalRun\?\.activity/);
});
