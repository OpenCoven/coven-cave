import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The app should recover from a slow/blipping desktop through one lifecycle
// supervisor: all automatic signals wake the same jittered worker.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");
const app = await read("apps/ios/CovenCave/CovenCave/CovenCaveApp.swift");
const thread = await read("apps/ios/CovenCave/CovenCave/State/ChatThread.swift");
const chatView = await read("apps/ios/CovenCave/CovenCave/Views/ChatView.swift");
const client = await read("apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift");

// --- One supervisor owns automatic backoff + heartbeat ----------------------
assert.match(
  model,
  /connectionSupervisorTask: Task<Void, Never>\?/,
  "AppModel should own one automatic recovery worker",
);
assert.match(
  model,
  /func requestConnectionRecovery[\s\S]*?connectionSupervisorDelayTask\?\.cancel\(\)[\s\S]*?guard connectionSupervisorTask == nil/,
  "real signals should wake backoff without launching an overlapping loop",
);
assert.match(
  model,
  /func runConnectionSupervisor[\s\S]*?while supervisorLeaseIsCurrent\(generation\)[\s\S]*?ConnectionRetryPolicy\.heartbeatSeconds[\s\S]*?ConnectionRetryPolicy\.delaySeconds[\s\S]*?refreshConnection/,
  "the supervisor should own both the healthy heartbeat and jittered retry cadence",
);
assert.doesNotMatch(
  model,
  /func connectWithRetry[\s\S]*?while connectionState/,
  "the compatibility/manual retry entry point must not retain a second backoff loop",
);

// --- CovenCaveApp feeds launch + foreground into that supervisor ------------
assert.match(
  app,
  /@Environment\(\\\.scenePhase\) private var scenePhase/,
  "the app should observe scenePhase",
);
assert.match(
  app,
  /\.task \{[\s\S]*?startConnectionSupervisor\(\)[\s\S]*?setConnectionSupervisorActive\(scenePhase == \.active\)/,
  "launch should start the supervisor only when the initial scene owns foreground",
);
assert.match(
  app,
  /case \.active:[\s\S]*?await app\.setConnectionSupervisorActive\(true\)[\s\S]*?case \.background:[\s\S]*?await app\.setConnectionSupervisorActive\(false\)/,
  "scene transitions should activate/suspend the supervisor rather than spawn probes",
);
assert.match(
  model,
  /func setConnectionSupervisorActive\(_ active: Bool\) async[\s\S]*?stopConnectionSupervisorWorker\(\)[\s\S]*?await refreshCoordinator\.cancelActiveRefresh\(\)/,
  "background ownership should cancel the coordinator's actual in-flight discovery task",
);
assert.match(
  model,
  /private func supervisorLeaseIsCurrent\(_ generation: UInt64\) -> Bool \{[\s\S]*?!Task\.isCancelled[\s\S]*?connectionSupervisorActive[\s\S]*?connectionPathAvailable[\s\S]*?connectionSupervisorGeneration == generation/,
  "a cancelled or superseded supervisor probe must not apply state after foreground ownership ends",
);
assert.match(
  model,
  /heartbeatAnswered = await client\.ping\(\)[\s\S]{0,120}guard supervisorLeaseIsCurrent\(generation\) else \{ return \}[\s\S]*?await refreshAccessTokenIfNeeded[\s\S]{0,240}guard supervisorLeaseIsCurrent\(generation\) else \{ return \}[\s\S]{0,80}flushQueuedMessages\(\)/,
  "an obsolete heartbeat must not refresh credentials or flush queued work after cancellation",
);

// --- Live transport failures feed the same single-flight supervisor ----------
assert.match(
  model,
  /connectionMonitor\.pathUpdateHandler[\s\S]*?path\.status == \.satisfied[\s\S]*?updateConnectionPath\(available: pathAvailable\)[\s\S]*?func updateConnectionPath[\s\S]*?requestConnectionRecovery\(\.networkAvailable\)[\s\S]*?connectionState = \.unreachable\(\.diagnosis\(for: \.offline\)\)/,
  "NWPath loss should make the state honest immediately and recovery should wait for the satisfied edge",
);
assert.match(
  model,
  /func noteConnectionFailure\(_ error: Error\)[\s\S]*?ConnectionFailureDisposition\.classify\(error\)[\s\S]*?connectionState = \.degraded\(\.diagnosis\(for: failure\)\)[\s\S]*?requestConnectionRecovery\(\.streamFailure\)/,
  "an unrecovered chat transport failure should enter degraded state and wake the supervisor",
);
assert.match(
  thread,
  /for try await frame in client\.sendStream\([\s\S]{0,420}?\) \{[\s\S]*?guard sawDone else \{ throw URLError\(\.networkConnectionLost\) \}/,
  "a clean EOF without the terminal done event must enter resume/resync instead of acknowledging a truncated reply",
);
assert.match(
  thread,
  /if !recovery\.completed \{[\s\S]*?onConnectionFailure\?\(error\)/,
  "a stream should report connection health only after live resume and transcript resync both fail",
);
assert.equal(
  (chatView.match(/onConnectionFailure: \{ app\.noteConnectionFailure\(\$0\) \}/g) ?? []).length,
  6,
  "every user chat send/retry/forward path should report terminal transport failures to AppModel",
);
assert.match(
  model,
  /thread\.replayQueued\([\s\S]*?onConnectionFailure: \{ \[weak self\] error in[\s\S]*?self\.noteConnectionFailure\(error\)/,
  "offline queue replay should report a second connection drop too",
);
assert.match(
  model,
  /func configure\(host:[\s\S]{0,700}stopConnectionSupervisorWorker\(\)[\s\S]{0,160}cancelQueuedMessageFlush\(\)[\s\S]{0,160}connectionConfigurationGeneration &\+= 1[\s\S]{0,180}await refreshCoordinator\.cancelActiveRefresh\(\)/,
  "re-pairing revokes supervisor, queued replay, and manual refresh ownership before credential mutation",
);
assert.match(
  model,
  /func configure\(host:[\s\S]*?let transitionGeneration = connectionConfigurationGeneration[\s\S]*?await refreshCoordinator\.cancelActiveRefresh\(\)[\s\S]{0,360}guard connectionConfigurationLeaseIsCurrent\(transitionGeneration\) else \{ return \}[\s\S]*?let configuredGeneration = connectionConfigurationGeneration[\s\S]*?await refreshConnection\(\)[\s\S]{0,180}connectionConfigurationLeaseIsCurrent\(configuredGeneration\)/,
  "an older configure must prove transition ownership after every suspension before it can overwrite a newer endpoint",
);
assert.match(
  model,
  /private func resetHostScopedStateForNewConnection\(\)[\s\S]*?serverSessions = \[\][\s\S]{0,180}sessionsError = nil[\s\S]{0,180}lastSessionsLoadedAt = nil[\s\S]*?operatorProfile = nil/,
  "pairing a different host must clear the previous host's sessions and operator identity before new loads can fail",
);
assert.match(
  model,
  /disconnectRefreshCancellationTask\?\.cancel\(\)[\s\S]{0,120}disconnectRefreshCancellationTask = nil[\s\S]*?func disconnect\(\)[\s\S]*?disconnectRefreshCancellationTask = Task \{[\s\S]*?cancelActiveRefreshIfCallerCurrent\(\)/,
  "configure must revoke the synchronous disconnect bridge before a replacement probe can start",
);
assert.match(
  model,
  /let configurationGeneration = connectionConfigurationGeneration[\s\S]*?guard refreshLeaseIsCurrent\([\s\S]{0,160}configurationGeneration: configurationGeneration/,
  "manual and supervisor refreshes are fenced by endpoint epoch",
);
assert.match(model, /let sleeperID = UUID\(\)[\s\S]{0,160}connectionSupervisorDelayID = sleeperID/);
assert.match(
  model,
  /if connectionSupervisorGeneration == generation,\s*\n\s*connectionSupervisorDelayID == sleeperID/,
  "an obsolete supervisor may clear only the exact backoff sleeper it installed",
);
assert.match(
  model,
  /queuedMessageFlushTask\?\.cancel\(\)[\s\S]*?queuedMessageFlushID == flushID[\s\S]*?connectionConfigurationLeaseIsCurrent\(configurationGeneration\)/,
  "queued replay is tracked, cancellable, and bound to one endpoint epoch",
);
assert.match(
  model,
  /persistAfterRollback: \{ \[weak self\] in[\s\S]{0,420}await self\?\.flushThreadsAndWait\(\) \?\? false/,
  "pre-POST cancellation rollback must reach disk even after the old endpoint lease is revoked",
);

// --- Live sends are fenced across their durability suspension --------------
assert.match(
  model,
  /struct ConnectionDispatchLease: Equatable \{[\s\S]{0,100}fileprivate let generation: UInt64[\s\S]{0,100}fileprivate let baseURL: URL\?/,
  "live sends should carry an opaque snapshot of endpoint authority",
);
assert.match(
  model,
  /func connectionDispatchLeaseIsCurrent[\s\S]{0,180}connectionConfigurationLeaseIsCurrent\(lease\.generation\)[\s\S]{0,100}connection\?\.baseURL == lease\.baseURL/,
  "automatic relocation must revoke a dispatch lease even when the credential epoch is unchanged",
);
assert.match(
  model,
  /func persistThreadsBeforeDispatch\(for lease: ConnectionDispatchLease\) async -> Bool \{[\s\S]{0,160}guard connectionDispatchLeaseIsCurrent\(lease\) else \{ return false \}[\s\S]{0,160}let persisted = await flushThreadsAndWait\(\)[\s\S]{0,120}return persisted && connectionDispatchLeaseIsCurrent\(lease\)/,
  "checkpoint persistence must prove the same endpoint epoch before and after disk suspension",
);
assert.equal(
  (chatView.match(/let dispatchLease = app\.captureConnectionDispatchLease\(\)/g) ?? []).length,
  5,
  "every live prose, suggestion, command, diagram, and forward send captures an endpoint lease",
);
assert.equal(
  (chatView.match(/liveDispatchLeaseIsCurrent: \{\s*app\.connectionDispatchLeaseIsCurrent\(dispatchLease\)\s*\}/g) ?? []).length,
  5,
  "every live send passes its lease into each fan-out child",
);
assert.equal(
  (chatView.match(/persistBeforeDispatch: \{\s*await app\.persistThreadsBeforeDispatch\(for: dispatchLease\)\s*\}/g) ?? []).length,
  5,
  "every live send fences both sides of its durability checkpoint",
);
assert.equal(
  (chatView.match(/persistAfterRollback: \{ await app\.flushThreadsAndWait\(\) \}/g) ?? []).length,
  5,
  "every live send retains an endpoint-unfenced rollback save",
);

const streamStart = thread.indexOf("private func stream(");
const streamEnd = thread.indexOf("/// Apply one stream event", streamStart);
const streamImplementation = streamStart >= 0 && streamEnd > streamStart
  ? thread.slice(streamStart, streamEnd)
  : "";
assert.match(
  streamImplementation,
  /if let liveDispatchLeaseIsCurrent, !liveDispatchLeaseIsCurrent\(\) \{[\s\S]*?rollbackLiveDeliveryBeforeDispatch\([\s\S]*?onChange\(\)[\s\S]*?await persistAfterProvablyUnsentRollback\(\)[\s\S]*?return \.queued\s*\n\s*\}\s*\n\s*guard let body = makeSendBody/,
  "a revoked child rolls back durably before request construction and returns a non-completing outcome",
);
assert.ok(
  streamImplementation.indexOf("if let liveDispatchLeaseIsCurrent")
    < streamImplementation.indexOf("ChatTurnNotifier.shared.turnStarted"),
  "a revoked endpoint must not announce a turn as started",
);
assert.ok(
  streamImplementation.indexOf("if let liveDispatchLeaseIsCurrent")
    < streamImplementation.indexOf("client.sendStream("),
  "each fan-out leg must re-check authority before POST setup",
);
const deferredSendStart = client.indexOf("preflight: @escaping @MainActor () -> Bool");
const deferredSendEnd = client.indexOf("/// Signals `GET /api/chat/stream`", deferredSendStart);
const deferredSend = deferredSendStart >= 0 && deferredSendEnd > deferredSendStart
  ? client.slice(deferredSendStart, deferredSendEnd)
  : "";
const deferredPreflight = deferredSend.indexOf("guard preflight() else");
const deferredRequest = deferredSend.indexOf('var req = try request("api/chat/send"');
const deferredStarted = deferredSend.indexOf("onRequestStarted()");
const deferredURLSession = deferredSend.indexOf("Self.streamSession.bytes(for: req)");
assert.ok(
  deferredSend.includes("let task = Task { @MainActor in")
    && deferredPreflight >= 0
    && deferredRequest > deferredPreflight
    && deferredStarted > deferredRequest
    && deferredURLSession > deferredStarted,
  "the deferred stream task must serialize epoch preflight, request construction, and URLSession start on MainActor",
);
assert.match(
  streamImplementation,
  /client\.sendStream\(\s*\n\s*body,\s*\n\s*preflight: \{ liveDispatchLeaseIsCurrent\?\(\) \?\? true \},[\s\S]{0,260}onRequestStarted:[\s\S]{0,260}ChatTurnNotifier\.shared\.turnStarted/,
  "the actual deferred POST task owns the final lease check and only then announces a started turn",
);
assert.match(
  streamImplementation,
  /if error is CaveClient\.SendPreflightRevoked \{[\s\S]*?rollbackLiveDeliveryBeforeDispatch\([\s\S]*?onChange\(\)[\s\S]*?await persistAfterProvablyUnsentRollback\(\)[\s\S]*?return \.queued[\s\S]*?if error is CancellationError/,
  "a deferred preflight rejection rolls back the exact leg durably without entering ambiguous transport recovery",
);
assert.match(
  thread,
  /func rollbackLiveDeliveryBeforeDispatch\([\s\S]*?queuedRunIdsByFamiliarId\?\[familiarId\] == runId[\s\S]*?runIds\.removeValue\(forKey: familiarId\)[\s\S]*?attemptedIds\.remove\(familiarId\)[\s\S]*?queuedDispatchInFlight = false/,
  "a stale child removes only its exact familiar/run marker and leaves sibling state available for reconciliation",
);
assert.match(
  chatView,
  /private func forward\([\s\S]{0,260}guard let client = app\.client else \{ return \}\s*\n\s*let dispatchLease = app\.captureConnectionDispatchLease\(\)[\s\S]*?Task \{ @MainActor in[\s\S]*?destination\.send\([\s\S]*?liveDispatchLeaseIsCurrent:[\s\S]*?dispatchLease[\s\S]*?client: client/,
  "forwarding must capture its CaveClient and matching epoch lease in the same actor turn before deferring work",
);
const queueFlushStart = model.indexOf("func flushQueuedMessages()");
const queueFlushEnd = model.indexOf("/// Rolling renewal", queueFlushStart);
const queueFlush = queueFlushStart >= 0 && queueFlushEnd > queueFlushStart
  ? model.slice(queueFlushStart, queueFlushEnd)
  : "";
const queueClient = queueFlush.indexOf("guard let client, !flushingQueued");
const queueLease = queueFlush.indexOf("let dispatchLease = captureConnectionDispatchLease()");
const queueReplay = queueFlush.indexOf("await thread.replayQueued(");
const queuePreflight = queueFlush.indexOf("dispatchLeaseIsCurrent: { [weak self] in", queueReplay);
assert.ok(
  queueClient >= 0
    && queueLease > queueClient
    && queueReplay > queueLease
    && queuePreflight > queueReplay
    && queueFlush.indexOf("self.queuedMessageFlushID == flushID", queuePreflight) > queuePreflight
    && queueFlush.indexOf("self.connectionDispatchLeaseIsCurrent(dispatchLease)", queuePreflight) > queuePreflight,
  "queued replay must carry the same flush-id, configuration, and base-URL lease into its deferred POST task",
);
const replayStart = thread.indexOf("func replayQueued(client: CaveClient,");
const replayEnd = thread.indexOf("/// Remove one message", replayStart);
const replayImplementation = replayStart >= 0 && replayEnd > replayStart
  ? thread.slice(replayStart, replayEnd)
  : "";
const replayStream = replayImplementation.indexOf("let streamOutcome = await stream(");
assert.ok(
  replayImplementation.includes("dispatchLeaseIsCurrent: @escaping () -> Bool")
    && replayStream >= 0
    && replayImplementation.indexOf(
      "liveDispatchLeaseIsCurrent: dispatchLeaseIsCurrent",
      replayStream,
    ) > replayStream,
  "fresh queued runs must not fall back to an unconditional deferred send preflight",
);

console.log("ios-auto-reconnect: OK");
