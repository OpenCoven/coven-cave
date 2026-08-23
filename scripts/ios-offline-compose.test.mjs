import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Offline compose (cave-u6k): composing while the phone has no route to the
// desktop used to dead-end in a transport error. Prose now parks on the
// thread as a `queued` user message — persisted across restarts via the
// normal thread snapshot — and replays through the ordinary send fan-out on
// the next reconnect. Only provably-unsent failures enter the queue; durable
// per-familiar progress keeps group replay from clearing before every target
// settles or collapsing intentional repeated prompts by text equality.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const thread = await read("apps/ios/CovenCave/CovenCave/State/ChatThread.swift");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");
const models = await read("apps/ios/CovenCave/CovenCave/Models/Models.swift");
const chatView = await read("apps/ios/CovenCave/CovenCave/Views/ChatView.swift");
const bubble = await read("apps/ios/CovenCave/CovenCave/Views/MessageBubble.swift");

// --- Model: queued is an OPTIONAL Codable field (old snapshots must decode) --
assert.match(
  thread,
  /var queued: Bool\?/,
  "DisplayMessage.queued must be optional so pre-feature snapshots still decode",
);
assert.match(
  thread,
  /var isQueued: Bool \{ queued == true \}/,
  "isQueued reads the optional safely",
);
assert.match(
  thread,
  /var queuedDispatchInFlight: Bool\?/,
  "an online send can stay crash-recoverable without being presented as offline compose",
);
assert.match(
  thread,
  /var isQueuedDispatchInFlight: Bool \{ queued == true && queuedDispatchInFlight == true \}/,
);

// --- Compose path: offline branches to enqueue, never to the network --------
assert.match(
  chatView,
  /case \.prose\(let text\):[\s\S]*thread\.enqueue\(outgoing, attachments: attachments,[\s\S]*modelControls: modelControlValues,[\s\S]*modelOverrideScope: modelBinding\.scope\)/,
  "ChatView.send parks prose with its selected-model control snapshot when disconnected",
);
assert.match(
  chatView,
  /showToast\("Queued — sends when reconnected", systemImage: "clock"\)/,
  "queueing is announced with a toast",
);
assert.match(
  chatView,
  /private func sendSuggestion[\s\S]*thread\.enqueue\(text,[\s\S]*modelControls: modelControlValues,[\s\S]*modelOverrideScope: modelBinding\.scope\)/,
  "suggestion chips queue offline with the same selected-model control snapshot",
);
assert.match(
  thread,
  /func enqueue\(_ text: String, attachments: \[CaveClient\.ChatAttachment\] = \[\],[\s\S]{0,240}?modelControls: \[String: String\] = \[:\],[\s\S]{0,180}?modelOverrideScope: ChatModelOverrideScope\? = nil\)/,
  "ChatThread.enqueue persists the offline selected-model control snapshot and scope",
);

// --- Transport-failure conversion: only when provably unsent ----------------
assert.match(
  thread,
  /let deliveryProvenUnsent = !receivedAnyEvent[\s\S]{0,120}Self\.isOfflineTransportError\(error\)[\s\S]*?if let userMessageId, !recovery\.accepted, deliveryProvenUnsent/,
  "a failed send queues ONLY when no phase observed server acceptance and the error is connect-level",
);
assert.match(thread, /case \.completed:[\s\S]{0,180}recovery\.accepted = true/);
assert.match(thread, /case \.pending:[\s\S]{0,320}recovery\.accepted = true/);
assert.match(thread, /private func resumeInterruptedStream[\s\S]*?recovery\.accepted = true/);
assert.match(
  thread,
  /messages\.removeAll \{ \$0\.id == messageId \}[\s\S]{0,180}mutate\(userMessageId\) \{[\s\S]{0,80}\$0\.queued = true/,
  "queue-conversion removes the placeholder bubble and flags the user message",
);
assert.match(
  thread,
  /case \.notConnectedToInternet, \.cannotFindHost, \.cannotConnectToHost,\s*\n\s*\.dnsLookupFailed, \.dataNotAllowed,\s*\n\s*\.internationalRoamingOff:/,
  "offline classification is a closed provably-unsent set (ambiguous drops and timeouts excluded)",
);
const offlineClassifier = thread.match(
  /nonisolated static func isOfflineTransportError\(_ error: Error\)[\s\S]*?^    \}/m,
)?.[0] ?? "";
assert.doesNotMatch(
  offlineClassifier,
  /networkConnectionLost/,
  "a lost connection can happen after the POST landed — never replay it automatically",
);
assert.doesNotMatch(
  thread,
  /\.timedOut[\s\S]{0,80}?return true/,
  "timeouts are ambiguous (the request may have reached the server) — never queue them",
);

// --- Replay: reconnect flush, in order, duplicate-safe -----------------------
const refreshFoundStart = model.indexOf("case .found(let working):");
const refreshFoundEnd = model.indexOf("case .unauthorized:", refreshFoundStart);
const refreshFound = refreshFoundStart >= 0 && refreshFoundEnd > refreshFoundStart
  ? model.slice(refreshFoundStart, refreshFoundEnd)
  : "";
assert.ok(refreshFound.indexOf("connectionState = .connected") >= 0);
assert.ok(refreshFound.indexOf("await refreshAccessTokenIfNeeded") > refreshFound.indexOf("connectionState = .connected"));
assert.ok(refreshFound.indexOf("flushQueuedMessages()") > refreshFound.indexOf("await refreshAccessTokenIfNeeded"));
assert.match(
  model,
  /await refreshAccessTokenIfNeeded[\s\S]{0,240}guard supervisorLeaseIsCurrent[\s\S]{0,100}flushQueuedMessages\(\)\s*\n\s*failureCount = 0\s*\n\s*continue/,
  "the foreground ping-success path flushes too",
);
assert.match(
  model,
  /guard let client, !flushingQueued else \{ return \}/,
  "overlapping reconnect signals flush once",
);
assert.match(
  model,
  /func flushQueuedMessages\(\) \{\s*\n\s*guard connectionState == \.connected else \{ return \}/,
  "a settled sibling may re-wake replay, but an offline failure must wait for a real reconnect",
);
assert.match(
  thread,
  /func replayQueued\(client: CaveClient,[\s\S]{0,160}?onConnectionFailure: \(\(Error\) -> Void\)\? = nil,[\s\S]{0,140}?dispatchLeaseIsCurrent: @escaping \(\) -> Bool,[\s\S]{0,140}?persistBeforeDispatch: @escaping \(\) async -> Bool,[\s\S]{0,160}?onChange: @escaping \(\) -> Void\) async/,
  "ChatThread.replayQueued drives the reconnect send",
);
assert.match(
  thread,
  /var queuedCompletedFamiliarIds: \[String\]\?/,
  "queued group replay persists which familiar targets have already settled",
);
assert.match(thread, /var queuedRunIdsByFamiliarId: \[String: String\]\?/);
assert.match(thread, /var queuedAttemptedFamiliarIds: \[String\]\?/);
assert.match(thread, /var queuedTargetFamiliarIds: \[String\]\?/);
assert.match(models, /var attentionClearOperationId: String\?/);
assert.match(models, /var parentId: String\?/);
const sendStart = thread.indexOf("func send(_ text: String");
const sendEnd = thread.indexOf("/// Offline compose", sendStart);
const sendImplementation = sendStart >= 0 && sendEnd > sendStart
  ? thread.slice(sendStart, sendEnd)
  : "";
assert.match(
  sendImplementation,
  /queued: true,[\s\S]{0,100}queuedDispatchInFlight: true,[\s\S]{0,100}queuedRunIdsByFamiliarId: deliveryRunIds,[\s\S]{0,100}queuedAttemptedFamiliarIds: familiarIds,[\s\S]{0,100}queuedTargetFamiliarIds: familiarIds/,
  "a live fan-out records every delivery identity and immutable target before dispatch",
);
assert.ok(
  sendImplementation.indexOf("guard await persistBeforeDispatch()") >= 0,
  "the live fan-out persistence guard must exist",
);
assert.ok(
  sendImplementation.indexOf("await self.stream(") >= 0,
  "the live fan-out stream call must exist",
);
assert.ok(
  sendImplementation.indexOf("guard await persistBeforeDispatch()")
    < sendImplementation.indexOf("await self.stream("),
  "no live fan-out POST may start before its identity checkpoint succeeds",
);
assert.match(
  sendImplementation,
  /guard await persistBeforeDispatch\(\),\s*!Task\.isCancelled,\s*liveDispatchLeaseIsCurrent\(\) else \{[\s\S]*?_ = await persistAfterRollback\(\)[\s\S]*?return\s*\n\s*\}[\s\S]*?runId: delivery\.runId/,
  "a failed live checkpoint durably rolls back before stream and the exact persisted run id reaches it",
);
assert.match(
  thread,
  /activeDeliveries: \[String: \[String: String\]\][\s\S]{0,1000}guard familiars\[familiarId\] == runId else \{ return \}/,
  "active ownership is keyed by user, familiar, and run id so stale tasks cannot release newer work",
);
const replayStart = thread.indexOf("func replayQueued(client: CaveClient,");
const replayEnd = thread.indexOf("/// Remove one message", replayStart);
const replayImplementation = replayStart >= 0 && replayEnd > replayStart
  ? thread.slice(replayStart, replayEnd)
  : "";
assert.doesNotMatch(
  replayImplementation,
  /\.text\s*==\s*prompt|prompt\s*==\s*[^\n]*\.text/,
  "two intentional queued turns with identical text must never be reconciled by prompt equality",
);
assert.match(
  replayImplementation,
  /let targets = queuedMessage\.queuedTargetFamiliarIds[\s\S]{0,180}queuedRunIdsByFamiliarId[\s\S]{0,100}\?\? familiarIds/,
  "replay freezes the original fan-out instead of using mutable group membership",
);
assert.match(thread, /var sendPrompt: String\?/);
assert.match(sendImplementation, /sendPrompt: shown == trimmed \? nil : trimmed/);
assert.match(replayImplementation, /let prompt = queuedMessage\.sendPrompt \?\? queuedMessage\.text/);
assert.match(thread, /let prompt = source\?\.sendPrompt \?\? source\?\.text \?\? ""/);
assert.match(thread, /sendPrompt: message\.sendPrompt/);
const attemptedStart = replayImplementation.indexOf("if let existingRunId = runId, attempted");
const freshRunStart = replayImplementation.indexOf("if runId == nil", attemptedStart);
assert.ok(attemptedStart >= 0 && freshRunStart > attemptedStart);
const attemptedBranch = replayImplementation.slice(attemptedStart, freshRunStart);
assert.match(attemptedBranch, /reconcileQueuedRun\(/);
assert.match(attemptedBranch, /continue/);
assert.doesNotMatch(attemptedBranch, /await stream\(/);
assert.match(
  replayImplementation,
  /mutate\(queuedId\) \{[\s\S]{0,240}runIds\[familiarId\] = runId[\s\S]{0,240}attemptedIds\.insert\(familiarId\)[\s\S]{0,240}guard await persistBeforeDispatch\(\),\s*!Task\.isCancelled,\s*dispatchLeaseIsCurrent\(\) else/,
  "run identity and attempted state are checkpointed together, and persistence failure blocks POST",
);
assert.match(
  replayImplementation,
  /persistAfterRollback: @escaping \(\) async -> Bool/,
  "queued replay must accept a local durability checkpoint independent of endpoint ownership",
);
const freshCheckpoint = replayImplementation.indexOf("guard await persistBeforeDispatch()", freshRunStart);
const freshStream = replayImplementation.indexOf("let streamOutcome = await stream(", freshCheckpoint);
assert.ok(freshCheckpoint >= 0 && freshStream > freshCheckpoint);
assert.match(
  replayImplementation.slice(freshCheckpoint, freshStream),
  /else \{[\s\S]*?_ = await persistAfterRollback\(\)[\s\S]*?return\s*\n\s*\}[\s\S]*?guard !Task\.isCancelled, dispatchLeaseIsCurrent\(\) else \{[\s\S]*?_ = await persistAfterRollback\(\)[\s\S]*?return\s*\n\s*\}/,
  "failed and cancelled pre-POST checkpoints durably roll back before returning",
);
assert.match(
  replayImplementation.slice(freshStream),
  /runId: runId,[\s\S]{0,160}liveDispatchLeaseIsCurrent: dispatchLeaseIsCurrent,[\s\S]{0,120}persistAfterProvablyUnsentRollback: persistAfterRollback/,
  "queued replay passes the exact checkpointed run id and its local rollback durability closure into stream",
);
assert.match(
  sendImplementation,
  /runId: delivery\.runId,[\s\S]{0,220}liveDispatchLeaseIsCurrent: liveDispatchLeaseIsCurrent,[\s\S]{0,120}persistAfterProvablyUnsentRollback: persistAfterRollback/,
  "live fan-out gives a provably-unsent stream rollback an immediate local durability checkpoint",
);
assert.match(
  replayImplementation,
  /mutate\(placeholder\.id\) \{[\s\S]{0,160}\$0\.text = ""[\s\S]{0,160}\$0\.streaming = true/,
  "cursor-zero resume clears persisted placeholder text before buffered chunks replay",
);
assert.match(
  thread,
  /\$0\.role == "user" && \$0\.attentionClearOperationId == runId[\s\S]{0,260}\$0\.role == "assistant" && \$0\.parentId == userTurn\.id/,
  "recovery adopts only the exact run-owned user turn's direct assistant child",
);
assert.doesNotMatch(
  thread.match(/private func adoptServerTurnIfPresent\([\s\S]*?return \.completed\s*\n    \}/)?.[0] ?? "",
  /\.text\s*==|==\s*prompt/,
  "exact run reconciliation must never fall back to prompt matching",
);
assert.match(
  thread,
  /var completed = Set\(queuedMessage\.queuedCompletedFamiliarIds \?\? \[\]\)[\s\S]*?for familiarId in targets where !completed\.contains\(familiarId\)[\s\S]*?let streamOutcome = await stream[\s\S]*?guard streamOutcome\.completesQueuedFanOutLeg,[\s\S]*?!settled\.streaming else \{ return \}/,
  "replay advances only after an explicit terminal stream result",
);
assert.match(
  thread,
  /var completesQueuedFanOutLeg: Bool \{\s*\n\s*self == \.acknowledged \|\| self == \.failed\s*\n\s*\}/,
  "only acknowledged and explicit terminal-failure outcomes complete a queued fan-out leg",
);
const settledOutcome = thread.match(/private func settledSendOutcome\([\s\S]*?^    \}/m)?.[0] ?? "";
assert.doesNotMatch(
  settledOutcome,
  /isQueued|return \.queued/,
  "the durable in-flight marker must not relabel a successful live stream as queued",
);
assert.match(
  replayImplementation,
  /let placeholderBeforeReconciliation = existingPlaceholder[\s\S]*?case \.retryLater[\s\S]*?\$0 = placeholderBeforeReconciliation/,
  "transient reconciliation failures restore locally persisted reply content",
);
assert.match(thread, /id == "resume-gap"/);
assert.match(
  thread,
  /if sawDone, !sawResumeGap|if !sawResumeGap[\s\S]{0,300}return \.completed/,
  "a completed resume with an evicted prefix cannot be treated as a full reply",
);
const resumeStart = thread.indexOf("private func resumeInterruptedStream(");
const resyncStart = thread.indexOf("private func resyncInterruptedTurn(", resumeStart);
const resumeImplementation = resumeStart >= 0 && resyncStart > resumeStart
  ? thread.slice(resumeStart, resyncStart)
  : "";
assert.match(
  resumeImplementation,
  /async throws -> InterruptedStreamRecovery/,
  "exact resume propagates cancellation",
);
const resumeFrameLoop = resumeImplementation.indexOf("for try await frame in client.resumeStream");
const inFrameCancellation = resumeImplementation.indexOf("try Task.checkCancellation()", resumeFrameLoop);
const frameLoopEnd = resumeImplementation.indexOf(
  "\n                }\n                try Task.checkCancellation()",
  inFrameCancellation,
);
const postFrameAcceptance = resumeImplementation.indexOf("recovery.accepted = true", frameLoopEnd);
assert.ok(
  resumeFrameLoop >= 0
    && inFrameCancellation > resumeFrameLoop
    && frameLoopEnd > inFrameCancellation
    && postFrameAcceptance > frameLoopEnd,
  "exact resume checks cancellation while consuming frames and treats a normal empty 2xx as accepted",
);
assert.match(
  thread,
  /private func resyncInterruptedTurn[\s\S]*?async throws -> PersistedQueuedRun[\s\S]*?try await Task\.sleep[\s\S]*?try Task\.checkCancellation\(\)[\s\S]*?return try await adoptServerTurnIfPresent/,
  "transcript resync propagates cancellation and GET failures instead of collapsing them to absence",
);
assert.match(
  thread,
  /catch is CancellationError \{[\s\S]*?outcome = \.cancelled[\s\S]*?return outcome[\s\S]*?if let recoveryError,[\s\S]{0,160}\{[\s\S]*?onConnectionFailure\?\(recoveryError\)[\s\S]*?outcome = \.noAcknowledgement/,
  "cancelled recovery stays cancelled while transient reconciliation failures retain the durable run marker",
);
assert.match(
  thread,
  /let deliveryProvenUnsent = !receivedAnyEvent[\s\S]{0,120}Self\.isOfflineTransportError\(error\)[\s\S]*?if let recoveryError,[\s\S]{0,120}!\(deliveryProvenUnsent && !recovery\.accepted\)[\s\S]*?attemptedIds\.remove\(familiarId\)[\s\S]*?if let persistAfterProvablyUnsentRollback \{\s*\n\s*_ = await persistAfterProvablyUnsentRollback\(\)[\s\S]{0,100}outcome = \.queued/,
  "a provably-unsent transport rollback reaches disk before degraded state can strand the old attempted marker",
);
const offlineConversionStart = thread.indexOf(
  "if let userMessageId, !recovery.accepted, deliveryProvenUnsent",
);
const offlineConversionEnd = thread.indexOf("} else {", offlineConversionStart);
const offlineConversion = offlineConversionStart >= 0 && offlineConversionEnd > offlineConversionStart
  ? thread.slice(offlineConversionStart, offlineConversionEnd)
  : "";
assert.doesNotMatch(
  offlineConversion,
  /completedReplyFamiliarIds|queuedCompletedFamiliarIds/,
  "one provably-unsent sibling must not infer that a stopped unacknowledged placeholder completed another leg",
);
assert.doesNotMatch(
  thread,
  /private func completedReplyFamiliarIds/,
  "group completion must come from explicit stream outcomes, never transcript shape",
);
assert.match(
  thread,
  /mutate\(queuedId\) \{\s*\n\s*\$0\.queued = false[\s\S]{0,240}\$0\.queuedTargetFamiliarIds = nil\s*\n\s*\}/,
  "the queue clears only after every intended familiar attempt has settled",
);

// --- UI: queued reads as waiting, not as an error ----------------------------
assert.match(
  bubble,
  /if isUser, message\.isQueued \{[\s\S]{0,240}message\.isQueuedDispatchInFlight[\s\S]{0,120}"Sending…"[\s\S]{0,120}"Queued — sends when reconnected"/,
  "durable in-flight sends and offline queued messages have honest distinct status chips",
);
assert.match(
  bubble,
  /"Queued\. Sends when the desktop is reachable again\."/,
  "the queued state is announced to assistive tech",
);

console.log("ios-offline-compose.test.mjs: ok");
