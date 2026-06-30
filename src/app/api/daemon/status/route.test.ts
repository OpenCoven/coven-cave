// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{[^}]*loadConfig[^}]*\} from "@\/lib\/cave-config"/,
  "daemon status should read Cave config before calling the daemon",
);

assert.match(
  source,
  /daemonTargetForConfig\(config\)/,
  "daemon status should derive the selected local-vs-hub target from config",
);

assert.match(
  source,
  /target: targetSummary\(target\)/,
  "daemon status response should include the current target summary",
);

assert.match(
  source,
  /executorStatusesForConfig\(config\)/,
  "daemon status should check configured executor node availability from Cave config",
);

assert.match(
  source,
  /deriveTravelClientStatus\(/,
  "daemon status should derive the travel-client mode from Cave travel state and hub reachability",
);

assert.match(
  source,
  /recordTravelHubReachability\(hubReachable\)/,
  "daemon status should persist network reachability transitions, not auth/health failures",
);

assert.match(
  source,
  /executors: executorStatuses/,
  "daemon status response should include executor node availability",
);

assert.match(
  source,
  /travel: travelStatus/,
  "daemon status response should include travel/offline/queue state",
);

assert.match(
  source,
  /startLocalDaemon\(\)/,
  "daemon status should wake the laptop-local daemon when travel mode takes authority",
);

assert.match(
  source,
  /recordLocalSubdaemonWakeRequest\(\)/,
  "daemon status should persist that travel mode requested a local sub-daemon wake",
);

assert.match(
  source,
  /syncOfflineTravelQueue\(config\)/,
  "daemon status should replay queued travel work after the hub reconnects",
);

assert.match(
  source,
  /res\.ok && !travelState\.manualOffline/,
  "manual offline mode should block automatic reconnect replay",
);

assert.match(
  source,
  /travelReplay/,
  "daemon status should expose reconnect replay attempts in the status response",
);

assert.match(
  source,
  /reason: target\.error/,
  "an unconfigured hub should be reported as an explicit status failure",
);

assert.match(
  source,
  /res\.status === 401 \|\| res\.status === 403[\s\S]*hub unauthorized/,
  "hub auth failures should be labelled separately instead of treated as offline",
);

console.log("daemon status route.test.ts: ok");
