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
  /import \{[^}]*reconcileDaemonTravelState[^}]*\} from "@\/lib\/server\/daemon-travel-reconcile"/,
  "daemon status should delegate travel reconciliation to the shared helper",
);

assert.match(
  source,
  /import \{[^}]*daemonHealthRequest[^}]*daemonHealthResponseSucceeded[^}]*\} from "@\/lib\/server\/daemon-health-request"/,
  "daemon status should import the shared daemon health request contract and predicate",
);

assert.match(
  source,
  /snapshot = await loadDaemonStatusSnapshot\(\)[\s\S]*?return respond\(caveHomeStatusUnavailable\(error\)\)/,
  "Cave home lock failures should return a correlated structured status response instead of HTTP 500",
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
  /callDaemonTarget<Health>\(target, \{[\s\S]*?daemonHealthRequest\(\)[\s\S]*?diagnostics[\s\S]*?\}\)/,
  "the health request, status metadata, and correlation should use the same resolved daemon target",
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
  /const \{ travelStatus, travelReplay \} = await reconcileDaemonTravelState\(\{/,
  "daemon status should use the shared helper for hub reachability persistence, replay, and wake semantics",
);

assert.match(
  source,
  /const health = daemonHealthResponseSucceeded\(res\) \? res\.data : null;\s*const daemonHealthy = health !== null;/,
  "daemon status should derive daemonHealthy and the parsed health payload from the shared health predicate",
);

assert.match(
  source,
  /daemonHealthy,\s*\n\s*\}\);/,
  "daemon status should pass the shared daemonHealthy result into travel reconciliation",
);

assert.match(
  source,
  /if \(!daemonHealthy \|\| \(compatibility && !compatibility\.ok\)\) \{/,
  "daemon status should use the shared daemonHealthy result for the final healthy-response guard",
);

assert.doesNotMatch(
  source,
  /Boolean\(res\.ok && res\.data\)/,
  "daemon status should not inline a weaker parsed-payload check",
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
  /travelReplay/,
  "daemon status should expose reconnect replay attempts in the status response",
);

assert.doesNotMatch(
  source,
  /recordTravelHubReachability\(|syncOfflineTravelQueue\(|startLocalDaemon\(|recordLocalSubdaemonWakeRequest\(/,
  "daemon status should not duplicate the shared reachability, replay, and wake sequence inline",
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
  /availability: compatibility && !compatibility\.ok \? "incompatible" : failureAvailability\(target, res\)/,
  "daemon failures should expose a machine-readable availability classification",
);

assert.match(
  source,
  /running: true,[\s\S]{0,80}availability: "online"/,
  "a healthy daemon should expose online availability",
);

assert.match(
  source,
  /assessDaemonStartupCompatibility\(health, installedVersion\)/,
  "local status must not report a listening but version-skewed daemon as online",
);

assert.match(
  source,
  /availability: compatibility && !compatibility\.ok \? "incompatible"/,
  "runtime coherence failures should remain separately actionable",
);

console.log("daemon status route.test.ts: ok");
