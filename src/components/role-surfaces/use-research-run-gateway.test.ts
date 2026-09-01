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
  assert.match(hook, /hydrateHybridResearchRunProjectionInput/);
  assert.match(hook, /type ResearchRunCompleteView/);
  assert.match(hook, /missionDetailForRun\(legacyMissionRef\.current/);
  assert.match(hook, /researchMissionMatchesRunSelector/);
  assert.match(hook, /selectResearchRunProjections/);
  assert.match(hook, /researchMissionToRunProjectionInput/);
  assert.match(hook, /const \[retryGeneration, setRetryGeneration\] = useState\(0\)/);
  assert.match(hook, /controller\.abort\(\)/);
  assert.match(
    hook,
    /researchRunGatewayStreamUrl\(missionOrRunId,\s*familiarId,\s*0,\s*boundRunId\)/,
    "initial replay must bind its zero cursor to the snapshot run generation",
  );
  assert.match(hook, /openSource\(snapshot\.run\.id\)/);
  assert.match(hook, /frame\.run\.id !== boundRunId[\s\S]*?openSource\(frame\.run\.id\)/);
  assert.match(hook, /eventState\.run\.id !== frame\.event\.runId/);
  assert.match(hook, /source\?\.close\(\)/);
  assert.match(
    desk,
    /useResearchRunGateway\(\s*research\.selected\?\.id \?\? null,\s*familiarId,\s*research\.selected,\s*\)/,
  );
  assert.match(desk, /data-research-run-gateway-status/);
  assert.match(desk, /mission=\{canonicalRun\.missionDetail\}/);
  assert.match(desk, /onRetryRunGateway=\{canonicalRun\.retry\}/);
  assert.match(desk, /missionDetailAvailable=\{canonicalRun\.missionDetailAvailable\}/);
  assert.match(detail, /headline="Couldn't load canonical run history"/);
  assert.match(detail, /headline="Couldn't load historical run"/);
  assert.match(detail, /onRetryRunGateway\?\.\(\)/);
  assert.match(detail, /data-research-run-projection="plan"/);
  assert.match(detail, /data-research-run-projection="activity"/);
  assert.match(detail, /data-research-run-projection="evidence"/);
  assert.match(detail, /data-research-run-projection="report"/);
});

test("gateway callbacks read mission detail committed after render", () => {
  assert.doesNotMatch(
    hook,
    /const legacyMissionRef = useRef\(legacyMission\);\s*legacyMissionRef\.current = legacyMission;/,
    "render must not publish an uncommitted mission snapshot to event callbacks",
  );
  assert.match(
    hook,
    /useLayoutEffect\(\(\) => \{\s*legacyMissionRef\.current = legacyMission;\s*\}, \[legacyMission\]\)/,
    "the committed mission snapshot must update before browser events resume",
  );
});
