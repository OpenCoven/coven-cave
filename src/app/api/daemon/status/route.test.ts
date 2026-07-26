// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{[^}]*loadDaemonStatusSnapshot[^}]*\} from "@\/lib\/cave-config"/,
  "daemon status should read a lock-protected Cave snapshot before calling the daemon",
);

assert.match(
  source,
  /snapshot = await loadDaemonStatusSnapshot\(\)[\s\S]*?return caveHomeStatusUnavailable\(\)/,
  "Cave home lock failures should return a structured status response instead of HTTP 500",
);

assert.match(
  source,
  /availability: "status-unavailable"[\s\S]*?Cave home is temporarily busy/,
  "the structured degraded response should distinguish local Cave storage from daemon availability",
);

assert.match(
  source,
  /daemonTargetForConfig\(config\)/,
  "daemon status should derive the selected local-vs-hub target from config",
);

assert.match(
  source,
  /callDaemonTarget<Health>\(target,/,
  "the health request and status metadata should use the same resolved daemon target",
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
  /classifyHubFailure\(res\)/,
  "hub failures should reuse the probe route's shared unauthorized/unhealthy/unreachable taxonomy",
);

assert.match(
  source,
  /availability: failureAvailability\(target, res\)/,
  "daemon failures should expose a machine-readable availability classification",
);

assert.match(
  source,
  /running: true,[\s\S]{0,80}availability: "online"/,
  "a healthy daemon should expose online availability",
);

console.log("daemon status route.test.ts: ok");
