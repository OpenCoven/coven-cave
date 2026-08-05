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
    /const requester = createDaemonTravelReconcileRequester\(\{[\s\S]*const response = await fetch\("\/api\/daemon\/travel\/reconcile", \{\s*method: "POST",\s*cache: "no-store",\s*signal,\s*\}\);[\s\S]*if \(!response\.ok\) throw new Error\("daemon travel reconcile failed"\);[\s\S]*const payload = await response\.json\(\);[\s\S]*payload\.ok !== true[\s\S]*throw new Error\("daemon travel reconcile returned an invalid response"\);[\s\S]*rawRetryAfterMs == null[\s\S]*typeof rawRetryAfterMs !== "number"[\s\S]*throw new Error\("daemon travel reconcile returned an invalid retry hint"\);[\s\S]*\}\);/,
    "Workspace should reject malformed travel reconcile responses while still accepting the route's null-or-number retry hint contract",
  );
  assert.match(
    workspace,
    /daemonTravelReconcileRequesterRef\.current = requester[\s\S]*daemonConnectionSupervisorRef\.current = supervisor[\s\S]*requester\.setActive\(!document\.hidden\)[\s\S]*supervisor\.start\(\)/,
    "Workspace should create the travel reconcile requester first, initialize its visibility state, and then start exactly one supervisor per mount",
  );
  assert.match(
    workspace,
    /const onDaemonConnectionVisibilityChange = \(\) => \{\s*const visible = !document\.hidden;\s*requester\.setActive\(visible\);\s*supervisor\.setVisible\(visible\);\s*\}[\s\S]*document\.addEventListener\("visibilitychange", onDaemonConnectionVisibilityChange\)/,
    "Workspace should forward document visibility changes into both daemon lanes with one shared visibility value",
  );
  assert.match(
    workspace,
    /document\.removeEventListener\("visibilitychange", onDaemonConnectionVisibilityChange\)[\s\S]*requester\.stop\(\)[\s\S]*supervisor\.stop\(\)[\s\S]*daemonTravelReconcileRequesterRef\.current = null[\s\S]*daemonConnectionSupervisorRef\.current = null/,
    "Workspace should remove the visibility listener, stop both daemon controllers, and clear both refs on unmount",
  );
  assert.match(
    workspace,
    /useRefreshOnFocus\(\(\) => \{\s*void daemonConnectionSupervisorRef\.current\?\.refresh\(\{ fresh: true \}\);\s*\}\)/,
    "Workspace focus recovery should use a fresh supervisor probe instead of reusing stale failure cache or in-flight work",
  );
  assert.doesNotMatch(
    workspace,
    /setInterval\(/,
    "Workspace daemon connection wiring should stay on explicit supervisor/requester timers instead of a raw interval loop",
  );
});

test("Workspace travel reconcile request validates the route's {ok,retryAfterMs?} contract at runtime", async () => {
  // Extract the actual request() closure body and evaluate it, so this test
  // exercises real behavior rather than only pattern-matching the source.
  const bodyMatch = workspace.match(
    /const requester = createDaemonTravelReconcileRequester\(\{\s*request: async \(\{ signal \}\) => \{([\s\S]*?)\n      \},\n    \}\);/,
  );
  assert.ok(bodyMatch, "travel reconcile request() body must be extractable for a runtime check");
  const body = bodyMatch[1]
    .replace(/: number \| null/g, "")
    .replace(/: \{ signal: AbortSignal \}/g, "");
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const request = new AsyncFunction("signal", body);

  async function requestWith(mockResponse: { ok: boolean; json: () => Promise<unknown> }) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => mockResponse) as typeof fetch;
    try {
      return await request(undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  function okResponse(json: () => Promise<unknown>) {
    return { ok: true, json };
  }

  await assert.rejects(
    () => requestWith(okResponse(() => Promise.reject(new SyntaxError("Unexpected token")))),
    /./,
    "malformed JSON should reject rather than silently resolve to no retry",
  );
  await assert.rejects(
    () => requestWith(okResponse(async () => ({}))),
    /invalid response/,
    "a payload missing ok should be rejected as an invalid response",
  );
  await assert.rejects(
    () => requestWith(okResponse(async () => ({ ok: false }))),
    /invalid response/,
    "ok: false should be rejected as an invalid response",
  );
  await assert.rejects(
    () => requestWith(okResponse(async () => ({ ok: true, retryAfterMs: "soon" }))),
    /invalid retry hint/,
    "a non-numeric retry hint should be rejected",
  );
  await assert.rejects(
    () => requestWith(okResponse(async () => ({ ok: true, retryAfterMs: -5 }))),
    /invalid retry hint/,
    "a negative retry hint should be rejected",
  );
  await assert.rejects(
    () => requestWith(okResponse(async () => ({ ok: true, retryAfterMs: Number.NaN }))),
    /invalid retry hint/,
    "a NaN retry hint should be rejected",
  );
  await assert.rejects(
    () => requestWith(okResponse(async () => ({ ok: true, retryAfterMs: Number.POSITIVE_INFINITY }))),
    /invalid retry hint/,
    "a non-finite retry hint should be rejected",
  );
  assert.equal(
    await requestWith(okResponse(async () => ({ ok: true, retryAfterMs: null }))),
    undefined,
    "an explicit null retry hint should resolve to no retry",
  );
  assert.equal(
    await requestWith(okResponse(async () => ({ ok: true }))),
    undefined,
    "an omitted retry hint should resolve to no retry",
  );
  assert.deepEqual(
    await requestWith(okResponse(async () => ({ ok: true, retryAfterMs: 1500.7 }))),
    { retryAfterMs: 1500 },
    "a valid retry hint should resolve floored",
  );
});

test("Workspace refreshDaemonStatus maps trusted starts and explicit refreshes to fresh supervisor probes", () => {
  assert.match(
    workspace,
    /const refreshDaemonStatus = useCallback\(async \(opts\?: \{ trusted\?: boolean; fresh\?: boolean \}\) => \{[\s\S]*await daemonConnectionSupervisorRef\.current\?\.refresh\(\{ fresh: opts\?\.fresh === true \|\| opts\?\.trusted === true \}\);[\s\S]*\}, \[\]\)/,
    "trusted starts and explicit Retry recovery should both await a fresh supervisor refresh while ordinary failures keep the normal lane",
  );
  assert.match(
    workspace,
    /runWorkspaceDaemonStart\(\{[\s\S]*refreshStatus: refreshDaemonStatus/,
    "Workspace automatic and manual starts should continue to share the tested start flow",
  );
  assert.match(
    workspace,
    /id: "daemon-status-unavailable"[\s\S]*label: "Retry"[\s\S]*void refreshDaemonStatus\(\{ fresh: true \}\)/,
    "the daemon-status Retry CTA should issue a fresh connection probe",
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
    /const travelCadence = classifyDaemonConnectionTravelCadence\(poll\.payload\);[\s\S]*if \(travelCadence === "hub-unreachable"\) \{[\s\S]*daemonTravelReconcileRequesterRef\.current\?\.observeHubState\("unreachable"\);[\s\S]*\} else if \(travelCadence === "hub-reachable"\) \{[\s\S]*daemonTravelReconcileRequesterRef\.current\?\.observeHubState\("reachable"\);[\s\S]*\} else if \(travelCadence === "non-hub"\) \{[\s\S]*daemonTravelReconcileRequesterRef\.current\?\.observeHubState\("inactive"\);[\s\S]*\}/,
    "only structurally definite hub and non-hub answers should update the requester's explicit hub state; unknown answers stay inert",
  );
  assert.doesNotMatch(
    applyPoll,
    /travelCadence === "unknown"[\s\S]*setHubOutageActive|travelCadence === "unknown"[\s\S]*trigger\(/,
    "unknown connection payloads should not clear outage cadence or trigger reconcile work",
  );
  assert.doesNotMatch(
    applyPoll,
    /travelCadence === "hub-reachable"[\s\S]*trigger\(/,
    "steady reachable hub heartbeats should not POST travel reconcile unconditionally",
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
