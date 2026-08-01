// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

test("Workspace swaps the fixed 5s daemon-status poll for the connection supervisor", () => {
  assert.match(
    workspace,
    /import \{[\s\S]*createDaemonConnectionSupervisor,[\s\S]*type DaemonConnectionPoll,[\s\S]*\} from "@\/lib\/daemon-connection-supervisor";/,
    "Workspace should import the daemon connection supervisor contract",
  );
  assert.match(
    workspace,
    /import \{ createDaemonTravelReconcileRequester \} from "@\/lib\/daemon-travel-reconcile-client";/,
    "Workspace should import the daemon travel reconcile requester next to the connection supervisor",
  );
  assert.doesNotMatch(
    workspace,
    /createDaemonStatusRequestGate/,
    "Workspace should stop owning the legacy daemon-status request gate",
  );
  assert.doesNotMatch(
    workspace,
    /usePausablePoll\(\(\) => void refreshDaemonStatus\(\), 5000/,
    "Workspace should no longer keep a daemon-specific fixed 5s poll loop",
  );
  assert.doesNotMatch(
    workspace,
    /fetch\("\/api\/daemon\/status"/,
    "Workspace connection refreshes should no longer call the detailed daemon-status route",
  );
});

test("Workspace wires one mounted supervisor with fresh connection requests, visibility, and focus refresh", () => {
  assert.match(
    workspace,
    /const daemonConnectionSupervisorRef = useRef<ReturnType<typeof createDaemonConnectionSupervisor> \| null>\(null\)/,
    "Workspace should keep one supervisor ref for the mounted shell",
  );
  assert.match(
    workspace,
    /const daemonTravelReconcileRequesterRef = useRef<ReturnType<typeof createDaemonTravelReconcileRequester> \| null>\(null\)/,
    "Workspace should keep one travel reconcile requester ref for the mounted shell",
  );
  assert.match(
    workspace,
    /const response = await fetch\(fresh \? "\/api\/daemon\/connection\?fresh=1" : "\/api\/daemon\/connection", \{\s*cache: "no-store",\s*signal,\s*\}\)/,
    "ordinary and fresh connection refreshes should use the narrow daemon connection route with the supplied AbortSignal",
  );
  assert.match(
    workspace,
    /const payload = await response\.json\(\)\.catch\(\(\) => null\)/,
    "JSON parse failures should collapse to a null payload without discarding the HTTP status",
  );
  assert.match(
    workspace,
    /return \{\s*responseStatus: response\.status,\s*responseOk: response\.ok,\s*payload,\s*\}/,
    "Workspace should publish the supervisor poll contract back to the classifier",
  );
  assert.match(
    workspace,
    /const requester = createDaemonTravelReconcileRequester\(\{[\s\S]*const response = await fetch\("\/api\/daemon\/travel\/reconcile", \{\s*method: "POST",\s*cache: "no-store",\s*signal,\s*\}\);[\s\S]*if \(!response\.ok\) throw new Error\("daemon travel reconcile failed"\);[\s\S]*\}\);/,
    "Workspace should create a separate POST travel reconcile requester that uses AbortSignal and throws only a generic non-ok error",
  );
  assert.match(
    workspace,
    /daemonTravelReconcileRequesterRef\.current = requester[\s\S]*daemonConnectionSupervisorRef\.current = supervisor[\s\S]*supervisor\.start\(\)/,
    "Workspace should create the travel reconcile requester before starting exactly one supervisor per mount",
  );
  assert.match(
    workspace,
    /document\.addEventListener\("visibilitychange", onDaemonConnectionVisibilityChange\)/,
    "Workspace should forward document visibility changes into the supervisor",
  );
  assert.match(
    workspace,
    /document\.removeEventListener\("visibilitychange", onDaemonConnectionVisibilityChange\)[\s\S]*requester\.stop\(\)[\s\S]*supervisor\.stop\(\)[\s\S]*daemonTravelReconcileRequesterRef\.current = null[\s\S]*daemonConnectionSupervisorRef\.current = null/,
    "Workspace should remove the visibility listener, stop both daemon controllers, and clear both refs on unmount",
  );
  assert.match(
    workspace,
    /useRefreshOnFocus\(\(\) => \{\s*void daemonConnectionSupervisorRef\.current\?\.refresh\(\);\s*\}\)/,
    "Workspace should reuse the shared focus-refresh primitive instead of hand-rolled browser-only focus logic",
  );
});

test("Workspace refreshDaemonStatus maps trusted starts to fresh supervisor refreshes", () => {
  assert.match(
    workspace,
    /const refreshDaemonStatus = useCallback\(async \(opts\?: \{ trusted\?: boolean \}\) => \{[\s\S]*await daemonConnectionSupervisorRef\.current\?\.refresh\(\{ fresh: opts\?\.trusted === true \}\);[\s\S]*\}, \[\]\)/,
    "trusted daemon starts should await a fresh supervisor refresh while ordinary failures keep the normal lane",
  );
  assert.match(
    workspace,
    /runWorkspaceDaemonStart\(\{[\s\S]*refreshStatus: refreshDaemonStatus/,
    "Workspace automatic and manual starts should continue to share the tested start flow",
  );
});

test("Workspace applies connection polls through the existing classifier-driven status semantics", () => {
  const applyPoll = workspace.match(
    /const applyDaemonConnectionPoll = useCallback\(\(poll: DaemonConnectionPoll, context: \{ fresh: boolean \}\) => \{[\s\S]*?\n\s*\}, \[\]\);/,
  )?.[0] ?? "";
  assert.ok(applyPoll.length > 0, "Workspace should centralize daemon connection publication in a stable apply callback");
  assert.match(
    workspace,
    /import \{[\s\S]*classifyDaemonConnectionTravelCadence,[\s\S]*classifyDaemonStatusPoll,[\s\S]*\} from "@\/lib\/daemon-status-classification";/,
    "Workspace should import the explicit daemon travel cadence classifier next to the status classifier",
  );
  assert.match(
    applyPoll,
    /const travelCadence = classifyDaemonConnectionTravelCadence\(poll\.payload\);[\s\S]*if \(travelCadence === "hub-unreachable"\) \{[\s\S]*daemonTravelReconcileRequesterRef\.current\?\.setHubOutageActive\(true\);[\s\S]*\} else if \(travelCadence === "hub-reachable"\) \{[\s\S]*daemonTravelReconcileRequesterRef\.current\?\.setHubOutageActive\(false\);[\s\S]*daemonTravelReconcileRequesterRef\.current\?\.trigger\(\);[\s\S]*\} else if \(travelCadence === "non-hub"\) \{[\s\S]*daemonTravelReconcileRequesterRef\.current\?\.setHubOutageActive\(false\);[\s\S]*\}/,
    "only structurally definite hub and non-hub answers should change travel cadence; unknown answers stay inert",
  );
  assert.doesNotMatch(
    applyPoll,
    /travelCadence === "unknown"[\s\S]*setHubOutageActive|travelCadence === "unknown"[\s\S]*trigger\(/,
    "unknown connection payloads should not clear outage cadence or trigger reconcile work",
  );
  assert.match(applyPoll, /const result = classifyDaemonStatusPoll\(poll\)/, "the shared classifier remains authoritative");
  assert.match(
    applyPoll,
    /daemonAutoStartCoordinatorRef\.current!\.observeStatus\(result\)/,
    "the first accepted classifier result should still feed the one-shot desktop auto-start decision",
  );
  assert.match(
    applyPoll,
    /if \(result\.kind === "running"\) \{[\s\S]*setAcceptedLocalDaemonHealthy\(result\.targetMode === "local"\)[\s\S]*\} else \{[\s\S]*setAcceptedLocalDaemonHealthy\(false\)/,
    "acceptedLocalDaemonHealthy should still only latch when the active target is a healthy local daemon",
  );
  assert.match(
    applyPoll,
    /if \(poll\.responseStatus !== 401\) setAuthExpired\(false\)/,
    "any non-401 connection response should clear the auth-expired latch",
  );
  assert.match(applyPoll, /setDaemonStatusResolved\(true\)/, "the first accepted connection poll should still resolve the unknown boot state");
  assert.match(
    applyPoll,
    /if \(result\.kind === "auth-expired"\) \{[\s\S]*setAuthExpired\(true\)[\s\S]*setDaemonStatusUnavailable\(null\)[\s\S]*return;/,
    "401s should remain distinct from transport availability failures",
  );
  assert.match(
    applyPoll,
    /if \(result\.kind === "unavailable"\) \{[\s\S]*daemonHealthyStreakRef\.current = 0[\s\S]*setDaemonStatusUnavailable\(result\.reason\)[\s\S]*return;/,
    "status-unavailable polls should keep their reason and reset the healthy streak",
  );
  assert.match(
    applyPoll,
    /if \(result\.kind === "offline"\) \{[\s\S]*daemonHealthyStreakRef\.current = 0[\s\S]*setDaemonRunning\(false\)[\s\S]*setDaemonOffline\(true\)[\s\S]*return;/,
    "definitive local offline polls should still drive the Start daemon banner path",
  );
  assert.match(
    applyPoll,
    /setDaemonRunning\(true\)[\s\S]*daemonHealthyStreakRef\.current \+= 1/,
    "running polls should continue to advance the healthy streak",
  );
  assert.match(
    applyPoll,
    /if \(context\.fresh\) daemonHealthyStreakRef\.current = 2/,
    "a trusted post-Start success should still shortcut the two-success banner clear",
  );
  assert.match(
    applyPoll,
    /if \(daemonHealthyStreakRef\.current >= 2\) setDaemonOffline\(false\)/,
    "ordinary background recovery should still require two healthy polls before clearing offline",
  );
});
