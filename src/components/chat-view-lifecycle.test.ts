// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("./chat-router.tsx", import.meta.url), "utf8");
const turnStateSource = readFileSync(new URL("../lib/chat-turn-state.ts", import.meta.url), "utf8");
const draftHook = readFileSync(new URL("../lib/use-composer-draft.ts", import.meta.url), "utf8");
const streamEvents = readFileSync(new URL("../lib/stream-events.ts", import.meta.url), "utf8");
const styles = ["cave-md", "cave-composer", "chat-list", "calendar", "cave-chat", "cave-chat/activity"]
  .map((sheet) => readFileSync(new URL(`../styles/${sheet}.css`, import.meta.url), "utf8"))
  .join("\n");

assert.match(
  turnStateSource,
  /type ChatTurnLifecycle =[\s\S]*"queued"[\s\S]*"connecting"[\s\S]*"streaming"[\s\S]*"tooling"[\s\S]*"cancelled"[\s\S]*"failed"[\s\S]*"complete"/,
  "ChatView should model assistant send lifecycle with explicit phases",
);

assert.match(
  turnStateSource,
  /lifecycle\?: ChatTurnLifecycle/,
  "Assistant turns should carry lifecycle metadata for trustworthy status UI",
);

assert.match(
  source,
  /function setAssistantLifecycle\([\s\S]*id: string,[\s\S]*lifecycle: ChatTurnLifecycle,[\s\S]*targetSessionId: string \| null = currentSessionRef\.current/,
  "ChatView should centralize assistant lifecycle updates",
);

assert.match(
  source,
  /function lifecycleLabel\(lifecycle: ChatTurnLifecycle\)/,
  "Lifecycle phases should map to user-facing labels in one place",
);

assert.match(
  source,
  /function MetaLine[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*data-lifecycle=\{state\}/,
  "In-flight chat lifecycle should be announced through the header meta line",
);

assert.match(
  source,
  /<MetaLine[\s\S]*busy=\{busy\}[\s\S]*familiar=\{familiar\}/,
  "ChatView should render the lifecycle status in the header while a send is active",
);

assert.match(
  streamEvents,
  /\{\s*kind: "progress";\s*id\?: string;\s*label: string;\s*detail\?: string;\s*status\?: "running" \| "done" \| "notice" \| "error";\s*durationMs\?: number;\s*\}/,
  "Chat streams should expose non-token progress events for quiet phases",
);

assert.match(
  source,
  /event\.status === "notice"[\s\S]*?ph:info/,
  "neutral progress notices use an informational icon instead of an error icon",
);
assert.match(
  styles,
  /\.cave-progress-row--notice\s*\{[\s\S]*?var\(--text-secondary\)/,
  "neutral progress notices use secondary text styling rather than danger color",
);

assert.match(
  turnStateSource,
  /progress\?: ProgressEvent\[\]/,
  "Assistant turns should keep progress events alongside text, thinking, and tools",
);

assert.match(
  source,
  /case "progress":[\s\S]*upsertTurnProgress\([\s\S]*?assistantId,[\s\S]*?ev,[\s\S]*?liveGeneration\.sessionId,[\s\S]*?liveStreamMetadata\(liveGeneration\)/,
  "Progress events should update the active assistant turn",
);

assert.match(
  source,
  /case "session":[\s\S]*ev\.sessionId !== currentSessionRef\.current[\s\S]*onSessionStarted\?\.\(\{\s*newSessionId: ev\.sessionId,\s*expectedSessionId: liveGeneration\.originSessionId,\s*composeInstance,\s*\}\)/,
  "A transparent resume fallback should promote the live chat with origin and compose provenance",
);

assert.match(
  source,
  /case "session": \{[\s\S]*const isBrandNewSession = liveGeneration\.sessionId == null;[\s\S]*if \(!isBrandNewSession\) \{[\s\S]*emitAttentionClear\(ev\.sessionId, liveGeneration\.runId, liveGeneration\.clearWatermark\);[\s\S]*liveGeneration\.markAttentionCleared\(ev\.sessionId\);[\s\S]*\}\n\s*reconcileLiveChatGenerationSession\(\s*liveGeneration,\s*ev\.sessionId,\s*liveGeneration\.runId,\s*\);/,
  "A brand-new chat's first session event must not emit an attention clear — no canonical row exists yet, so the assistant's first genuine request must surface instead of being masked by an unknown-baseline projection",
);

assert.match(
  source,
  /function ProgressGroup[\s\S]*<details[\s\S]*open=\{pending \|\| undefined\}[\s\S]*Progress[\s\S]*progress\.map/,
  "Progress events should render as a collapsible activity timeline that stays open while running",
);

assert.match(
  source,
  /function fmtDuration\(ms\?: number\)[\s\S]*ms == null \|\| ms < 0/,
  "Duration formatting should preserve valid 0ms timings",
);

assert.match(
  source,
  /function DurationText[\s\S]*const duration = fmtDuration\(durationMs\)[\s\S]*return duration \?/,
  "Progress and tool rows should render durations through a shared null-safe helper",
);

assert.match(
  source,
  /errors === 1 \? "issue" : "issues"/,
  "Progress issue counts should pluralize correctly",
);

assert.match(
  source,
  /const applyAssistantChunk = \([\s\S]*?setAssistantLifecycle\([\s\S]*?assistantId,[\s\S]*?"streaming",[\s\S]*?liveGeneration\.sessionId,[\s\S]*?liveStreamMetadata\(liveGeneration\)/,
  "Assistant chunks should move the turn into a streaming lifecycle",
);

assert.match(
  source,
  /case "assistant_chunk": \{[\s\S]{0,400}?applyAssistantChunk\(ev\.text, assistantId, liveGeneration\)/,
  "The assistant_chunk event delegates to the shared streaming-lifecycle application",
);

assert.match(
  source,
  /import \{ rebaseToolTextOffsets \} from "@\/lib\/tool-offset-correction";/,
  "ChatView should use the client-safe tool-offset correction helper",
);
assert.match(
  source,
  /const replaceAssistantText = \(\s*text: string,\s*correction: ToolOffsetCorrection \| undefined,[\s\S]*?t\.id === assistantId\s*\? \{[\s\S]*?text,[\s\S]*?tools: rebaseToolTextOffsets\(t\.tools, correction\),[\s\S]*?pending: true,[\s\S]*?lifecycle: "streaming"/,
  "authoritative text replacement should atomically rebase the same assistant turn's live tools",
);
assert.match(
  source,
  /case "assistant_replace": \{\s*replaceAssistantText\(ev\.text, ev\.toolOffsetCorrection, assistantId, liveGeneration\);/,
  "assistant replacement events should pass correction metadata to the atomic turn update",
);

assert.match(
  source,
  /case "tool_use":[\s\S]*setAssistantLifecycle\([\s\S]*?assistantId,[\s\S]*?"tooling",[\s\S]*?liveGeneration\.sessionId,[\s\S]*?liveStreamMetadata\(liveGeneration\)/,
  "Tool events should move the turn into a tool-use lifecycle",
);

assert.match(
  source,
  /case "done":[\s\S]*lifecycle: ev\.isError \?\s*"failed"\s*:\s*"complete"/,
  "Done events should close the turn as failed or complete",
);

assert.match(
  source,
  /AbortError[\s\S]*lifecycle: "cancelled"/,
  "Cancelled sends should leave an explicit cancelled lifecycle in the transcript",
);

assert.match(
  source,
  /const turnStatus = turn\.lifecycle \?\? \(turn\.error \? "failed" : turn\.pending \? "streaming" : "complete"\)/,
  "Assistant row status should prefer lifecycle metadata over inferred pending/error state",
);

assert.match(
  source,
  /cave-turn-status--\$\{turnStatus\}[\s\S]*\{lifecycleLabel\(turnStatus\)\}/,
  "Assistant row status chip should expose the lifecycle label",
);

assert.match(
  source,
  /const send = async \(override\?: string\) => \{[\s\S]*?intentFromSlash\(text\)[\s\S]*?const queueing = busy \|\| abortRef\.current;[\s\S]*?if \(queueing\) \{[\s\S]*?enqueueMessage\(\{[\s\S]*?text: outgoingText,[\s\S]*?attachments: outgoingAttachments,[\s\S]*?mentionedFiles: outgoingMentions,[\s\S]*?controls:/,
  "send() must queue a rich follow-up while busy instead of dropping it (CHAT-D5-01)",
);

assert.match(
  source,
  /const sendRaw = async [\s\S]*?if \(\(busy \|\| abortRef\.current\) && !allowBusy\) \{[\s\S]*?enqueueMessage\(/,
  "sendRaw should queue all programmatic sends while any runtime is in flight, while allowing the queue drain to hand off exactly one settled item",
);

assert.match(
  source,
  /if \(command === "\/run" \|\| command === "\/codex" \|\| command === "\/claude"\)[\s\S]*?setTimeout\(\(\) => sendRaw\(args\), 0\);[\s\S]*?const sendRaw = async [\s\S]*?enqueueMessage\(/,
  "slash sends for Codex, Claude, and other harness-backed commands must queue through sendRaw instead of being dropped mid-response",
);

assert.match(
  source,
  /type ChatSendControls = \{[\s\S]*?permissionMode: CommandPermissionMode;/,
  "queued messages must preserve the selected access level",
);

assert.match(
  source,
  /const sendOptions: ChatSendOptions = \{[\s\S]*?projectRoot: requestProjectRoot,[\s\S]*?mentionedFilesRoot: mentionRoot[\s\S]*?modelOverride:[\s\S]*?options: sendOptions,[\s\S]*?permissionMode,[\s\S]*?queuedRuntimeHost: runtimeHost/,
  "queued messages must retain queue-time model, project, file-mention, access, and host metadata",
);

assert.match(
  source,
  /const queueing = busy \|\| abortRef\.current;[\s\S]*?const queuedParentTurnId = queueing[\s\S]*?branchParent !== undefined \? branchParent : \(activeLeafId \|\| null\)[\s\S]*?parentTurnId: queuedParentTurnId[\s\S]*?if \(queueing\) \{[\s\S]*?options: sendOptions/,
  "queued messages must capture their visible branch leaf before later navigation can change it",
);

assert.match(
  source,
  /if \(\(busy \|\| abortRef\.current\) && !allowBusy\) \{[\s\S]*?parentTurnId:\s*opts\?\.parentTurnId !== undefined \? opts\.parentTurnId : \(activeLeafId \|\| null\)/,
  "programmatic sends that queue through sendRaw must capture their visible branch leaf before later navigation can change it",
);

assert.match(
  source,
  /"queuedRuntimeHost" in controlsOverride[\s\S]*?\? controlsOverride\.queuedRuntimeHost[\s\S]*?: \(controlsOverride\?\.runtimeHost \?\? runtimeHost\)/,
  "a queued automatic host choice must not be replaced by a later host picker change",
);

assert.match(
  source,
  /\.\.\.\(fleetHost \? \{ runtimeHost: fleetHost \} : \{\}\),/,
  "the queued host choice must be forwarded to every chat bridge request, not only Omnigent runs",
);

assert.match(
  source,
  /const requestedProjectRoot = opts\?\.projectRoot \?\? requestProjectRoot;[\s\S]*?const mentionedFilesRootForRequest = opts\?\.mentionedFilesRoot \?\? mentionRoot;[\s\S]*?if \(!projectLaunchReadyForRequest\)[\s\S]*?const projectRootForRequest = requestedProjectRoot;[\s\S]*?projectRoot: projectRootForRequest,[\s\S]*?permissionMode: controlsOverride\?\.permissionMode \?\? permissionMode,[\s\S]*?mentionedFilesRoot: mentionedFilesRootForRequest/,
  "delayed dispatch must authorize and use queued metadata rather than the latest composer state",
);

assert.match(
  source,
  /const drainNextQueuedMessage = useCallback\(\(\) => \{[\s\S]*?const \[next, \.\.\.rest\] = queuedMessagesRef\.current;[\s\S]*?void sendQueuedMessageRef\.current\(next\);[\s\S]*?if \(sawDone && !streamFailed && !controller\.signal\.aborted\) \{[\s\S]*?drainNextQueuedMessage\(\);/,
  "only a naturally successful stream completion should drain one queued follow-up",
);

assert.match(
  source,
  /aria-label="Queued messages"[\s\S]*?steerQueuedMessage\(message\.id\)[\s\S]*?removeQueuedMessage\(message\.id\)/,
  "queued messages should remain visible with send-next and remove controls",
);

assert.match(
  source,
  /if \(busy \|\| abortRef\.current\) \{[\s\S]*?announce\("Queued message will send next\.", "polite"\);[\s\S]*?const sendRaw = async [\s\S]*?if \(\(busy \|\| abortRef\.current\) && !allowBusy\)/,
  "send-next and normal sends must recognize every supported runtime as in flight, including non-streaming hosts and the render gap before busy updates",
);

assert.match(
  source,
  /title="Queue message"[\s\S]*?aria-label="Queue message"[\s\S]*?title="Cancel \(esc\)"/,
  "a live response must expose both Queue and Cancel controls",
);

assert.match(
  turnStateSource,
  /const liveChatRegistry = createLiveGenerationRegistry<Turn, LiveChatGenerationSnapshot>\(cloneLiveTurn\)/,
  "In-flight chat generations should be persisted outside the ChatView component so navigation away does not lose them",
);

assert.match(
  turnStateSource,
  /function subscribeLiveChatGeneration\(\s*sessionId: string,\s*listener: \(snapshot: LiveChatGenerationSnapshot \| null\) => void,\s*\)/,
  "ChatView should subscribe to live generation snapshots when returning to a session",
);
assert.match(
  turnStateSource,
  /type LiveChatGenerationSnapshot = LiveGenerationSnapshot<Turn> & \{[\s\S]*runId\?: string \| null;[\s\S]*streamHealth\?: ChatStreamClientHealth;[\s\S]*clearWatermark\?: string \| null;/,
  "Live chat snapshots should persist run ownership, client stream health, and the stable attention-clear watermark without widening unrelated registries",
);
assert.match(
  turnStateSource,
  /function stageLiveChatGenerationMetadata\([\s\S]*liveChatRegistry\.stage/,
  "Chat-specific metadata should stage onto the registry without notifying separately from turn advances",
);
assert.match(
  turnStateSource,
  /function advanceLiveChatGeneration\([\s\S]*metadata\?: LiveChatGenerationMetadata[\s\S]*stageLiveChatGenerationMetadata\(sessionId, metadata\)[\s\S]*liveChatRegistry\.advance/,
  "Every chat turn advance should stage its latest run and health metadata before the coalesced notification",
);
assert.match(
  turnStateSource,
  /function publishLiveChatGenerationMetadata\([\s\S]*recordLiveChatGeneration\(staged\)/,
  "Infrequent health transitions should be able to publish a staged chat snapshot",
);

assert.match(
  source,
  /const liveGeneration: LiveStreamGeneration = \{[\s\S]*?sessionId: initialLiveSessionId,[\s\S]*?originSessionId: initialLiveSessionId,[\s\S]*?controller,[\s\S]*?runId,[\s\S]*?clearWatermark: now,[\s\S]*?recordLiveChatGeneration\(\{\s*sessionId: liveGeneration\.sessionId,[\s\S]*?controller,[\s\S]*?turns: nextTurns,[\s\S]*?runId,[\s\S]*?streamHealth: generationStreamHealth,[\s\S]*?clearWatermark: now/,
  "sendRaw should persist the active stream snapshot with its controller, run ID, health, and stable clear watermark",
);

assert.match(
  source,
  /function attentionClearWatermarkForLiveGeneration\([\s\S]*?return live\.clearWatermark \?\? live\.turns\.find\(\(turn\) => turn\.id === live\.activeLeafId\)\?\.createdAt \?\? null;/,
  "adopted live generations should reuse the snapshot's own clear watermark, falling back to its active pending turn timestamp instead of remount time",
);

assert.match(
  source,
  /function maybeEmitAdoptedPendingAttentionClear\([\s\S]*?emitAttentionClear\(targetSessionId, live\.runId, attentionClearWatermarkForLiveGeneration\(live\)\);/,
  "adopted pending generations should emit clears with the stable snapshot watermark",
);

// sessionAliases must be seeded with the origin id so the pre-migration
// registry entry is covered even if the run re-records it after migration.
// Without seeding, a resumed-replacement race could leave a zombie under the
// original session id that no cleanup path would ever clear.
assert.match(
  source,
  /sessionAliases: new Set\(initialLiveSessionId \? \[initialLiveSessionId\] : \[\]\)/,
  "generation sessionAliases must seed the origin id so the initial registry entry is always in the cleanup set",
);

assert.match(
  source,
  /case "session": \{[\s\S]*?reconcileLiveChatGenerationSession\(\s*liveGeneration,\s*ev\.sessionId,\s*liveGeneration\.runId,\s*\)/,
  "stable session replacement migrates the live snapshot and tracks the final alias",
);
assert.match(
  source,
  /clearLiveChatGenerationAliases\(liveGeneration\.sessionAliases, runId\)/,
  "terminal cleanup retires every origin/final alias with the run-id guard",
);
assert.match(
  source,
  /case "done": \{[\s\S]*?if \(ev\.sessionId\) \{\s*reconcileLiveChatGenerationSession\(\s*liveGeneration,\s*ev\.sessionId,\s*liveGeneration\.runId,\s*\)/,
  "done-only stable session replacements use the same migration and alias registration path",
);

assert.match(
  source,
  /readLiveChatGeneration\(sessionId\)[\s\S]*?adoptLiveGenerationMetadata\(live, sessionId\)[\s\S]*?setTurns\(live\.turns\)[\s\S]*?setActiveLeafId\(live\.activeLeafId\)[\s\S]*?abortRef\.current = live\.controller[\s\S]*?setBusy\(true\)/,
  "History loading should restore run/health ownership before rehydrating a live generation snapshot",
);

assert.match(
  source,
  /subscribeLiveChatGeneration\(sessionId, \(live\) => \{[\s\S]*?adoptLiveGenerationMetadata\(live, sessionId\)[\s\S]*?setTurns\(live\.turns\)[\s\S]*?setBusy\(true\)[\s\S]*?setBusy\(false\)/,
  "A remounted ChatView should restore ownership before following live generation updates and settle when the stream finishes",
);

// A live snapshot whose writing component unmounted (or whose stream died
// without running cleanup) is never cleared from the registry; without a
// staleness guard, every later mount on that session inherits a zombie
// `busy = true` and shows "Streaming…" forever with nothing streaming. The
// liveness rule itself lives in @/lib/live-chat-snapshot (unit-tested there);
// ChatView imports and applies it at both adoption sites.
assert.match(
  source,
  /import \{ isLiveSnapshotActive \} from "@\/lib\/live-chat-snapshot"/,
  "ChatView should consume the extracted, unit-tested liveness rule",
);

assert.match(
  source,
  /readLiveChatGeneration\(sessionId\)[\s\S]*?isLiveSnapshotActive\(live, Date\.now\(\)\)[\s\S]*?setBusy\(true\)[\s\S]*?clearLiveChatGeneration\(sessionId\)/,
  "Mount-time adoption should ignore and evict a stale live snapshot instead of pinning busy",
);

assert.match(
  source,
  /subscribeLiveChatGeneration\(sessionId, \(live\) => \{[\s\S]*?if \(live && isLiveSnapshotActive\(live, Date\.now\(\)\)\)/,
  "The live-generation subscription should gate busy on snapshot liveness",
);

assert.match(
  styles,
  /\.cave-chat-meta-line\s*\{[\s\S]*min-height:/,
  "Lifecycle header meta line should have stable dimensions",
);

assert.match(
  styles,
  /\.cave-chat-meta-line--streaming[\s\S]*cave-chat-meta-blip/,
  "Streaming meta line state should match the class ChatView emits",
);

assert.match(
  styles,
  /\.cave-progress-group[\s\S]*\.cave-progress-row--running/,
  "Progress timeline should have stable styles for running rows",
);

assert.match(
  styles,
  /\.cave-turn-status--tooling/,
  "Tooling lifecycle should have its own status style",
);

// ── CHAT-D6-01 / CHAT-D6-02: edit-and-resend + regenerate (append semantics) ──

const bubbleSource = readFileSync(new URL("./message-bubble.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /function editTurnInComposer\(turn: Turn\)[\s\S]*?setInput\(\(current\) => \(current\.trim\(\) \? current : turn\.text\)\);[\s\S]*?inputRef\.current\?\.focus\(\);/,
  "Edit on a user turn loads its text into the composer only when the draft is empty, then focuses it (CHAT-D6-01)",
);

assert.match(
  source,
  /onEdit=\{t\.role === "user" && t\.text\.trim\(\) \? \(\) => handlers\(\)\.editTurnInComposer\(t\) : undefined\}/,
  "Only user turns with text get the Edit affordance (CHAT-D6-01)",
);

assert.match(
  source,
  /function regenerateFor\(turn: Turn\)[\s\S]*?if \(busy \|\| turn\.role !== "assistant" \|\| turn\.pending\) return undefined;/,
  "Regenerate is hidden while busy and on pending turns (CHAT-D6-02)",
);

// The backwards walk for the preceding user turn moved into a named helper
// when the reader's "You asked" card needed the same turn (cave-r8gfl). The
// guarantee is unchanged and split across two assertions: the helper finds the
// nearest USER turn, and regenerate still reuses that turn's controls plus the
// assistant's authoritative retry model.
assert.match(
  source,
  /function precedingUserTurn\(turn: Turn\): Turn \| undefined \{[\s\S]*?candidate\.role === "user"/,
  "The preceding-user-turn walk is a single named helper, not copied per caller (CHAT-D6-02)",
);

assert.match(
  source,
  /function regenerateFor\(turn: Turn\)[\s\S]*?const prevUser = precedingUserTurn\(turn\);[\s\S]*?if \(!prevUser\) return undefined;[\s\S]*?retryTurnModelRequest\(prevUser, turn\)[\s\S]*?modelControls: prevUser\.modelControls \?\? \{\}/,
  "Regenerate reuses the preceding user turn's controls and the assistant's authoritative retry model (CHAT-D6-02)",
);

assert.match(
  source,
  /onRegenerate=\{handlers\(\)\.regenerateFor\(t\)\}/,
  "Assistant turns get the Regenerate affordance via the gated helper (CHAT-D6-02)",
);

assert.match(
  bubbleSource,
  /aria-label="Edit message"[\s\S]{0,200}className="cave-copy-btn cave-copy-btn-bubble cave-copy-btn--icon"/,
  "Edit renders in the user bubble's CSS-revealed action row with the shared button styling (CHAT-D6-01)",
);

assert.match(
  bubbleSource,
  /aria-label="Regenerate response"[\s\S]{0,200}className="cave-copy-btn cave-copy-btn-bubble cave-copy-btn--icon"/,
  "Regenerate renders in the assistant bubble's CSS-revealed action row with the shared button styling (CHAT-D6-02)",
);

// ── CHAT-D12-03: visible retry at failed turns on desktop ──

// regenerateFor's gate is busy/role/pending only — a failed turn (pending:
// false, error: true) must keep passing it, or the pill below never renders.
const regenerateForBody =
  source.match(
    /function regenerateFor\(turn: Turn\)[\s\S]*?\n  \}\n\n  \/\/ Branch navigator/,
  )?.[0] ?? "";
assert.ok(regenerateForBody, "regenerateFor body should be extractable (CHAT-D12-03)");
assert.doesNotMatch(
  regenerateForBody,
  /turn\.error/,
  "regenerateFor must serve failed turns — its gate must not exclude turn.error (CHAT-D12-03)",
);

assert.match(
  source,
  /\{turn\.error && onRegenerate \? \([\s\S]{0,400}?aria-label="Retry failed turn"[\s\S]{0,300}?onClick=\{onRegenerate\}/,
  "Failed assistant turns render an explicit Retry button wired to the regenerate callback (CHAT-D12-03)",
);

assert.match(
  source,
  /cave-turn-status--\$\{turnStatus\}[\s\S]{0,900}?cave-turn-retry/,
  "The Retry affordance lives in the turn meta row beside the status chip — discoverable without hover (CHAT-D12-03)",
);

// The transport-failure path is untouched: failed dones still arm the
// lastFailedSend banner state alongside the per-turn affordance.
assert.match(
  source,
  /case "done":[\s\S]*?if \(ev\.isError\) \{[\s\S]*?setLastFailedSend\(request\);/,
  "Failed dones must still arm lastFailedSend for the transport retry path (CHAT-D12-03)",
);

assert.match(
  styles,
  /\.cave-turn-retry\s*\{[\s\S]*?display: inline-flex/,
  "Retry pill has always-visible styling — no hover-reveal gating (CHAT-D12-03)",
);

// ── CHAT-D12-02: per-turn token usage + cost ──

assert.match(
  streamEvents,
  /kind: "done";\s*durationMs\?: number;\s*isError\?: boolean;\s*sessionId\?: string;\s*usage\?: TurnUsage;\s*costUsd\?: number/,
  "The done StreamEvent must carry optional usage and cost fields (CHAT-D12-02)",
);

assert.match(
  source,
  /case "done":[\s\S]*?durationMs: ev\.durationMs,\s*\n\s*usage: ev\.usage,\s*\n\s*costUsd: ev\.costUsd,/,
  "The done handler must store usage and cost on the settled turn alongside duration (CHAT-D12-02)",
);

assert.match(
  turnStateSource,
  /durationMs: turn\.durationMs,\s*\n\s*usage: turn\.usage,\s*\n\s*costUsd: turn\.costUsd,/,
  "History load must map persisted usage and cost back onto turns (CHAT-D12-02)",
);

assert.match(
  source,
  /function UsageText\(\{ usage, costUsd \}[\s\S]*?const summary = usageSummary\(usage, costUsd\);[\s\S]*?if \(!summary\) return null;[\s\S]*?title=\{usageBreakdown\(usage, costUsd\) \?\? undefined\}/,
  "UsageText renders the compact summary with the full breakdown as tooltip, and nothing when the harness emitted no usage (CHAT-D12-02)",
);

// The readout lives in the assistant turn's meta row, after the timestamp.
const usageTurnRow =
  source.match(/function TurnRowImpl[\s\S]*?\n}\n\ntype TurnRowProps/)?.[0] ?? "";
assert.ok(usageTurnRow, "TurnRow body should be extractable (CHAT-D12-02)");
assert.match(
  usageTurnRow,
  /className="cave-linear-turn-recency"[\s\S]{0,220}?title=\{exactTime\}[\s\S]{0,220}?\{recency\}[\s\S]{0,700}?<UsageText usage=\{turn\.usage\} costUsd=\{turn\.costUsd\} \/>/,
  "Assistant turn meta row keeps the muted usage/cost readout after the visible recency timestamp, now inside the reveal-on-hover extras cluster (CHAT-D12-02 / cave-xsq.2)",
);

// ── CHAT-D9-04: find highlight timer cleanup ──

assert.match(
  source,
  /const clearFoundHighlightTimer = useCallback\(\(\) => \{[\s\S]*?window\.clearTimeout\(foundClearTimerRef\.current\);[\s\S]*?foundClearTimerRef\.current = null;/,
  "Find highlight timer cleanup should clear and null the pending timeout",
);
assert.match(
  source,
  /const foundFrameRef = useRef<number \| null>\(null\);[\s\S]*?window\.cancelAnimationFrame\(foundFrameRef\.current\);[\s\S]*?foundFrameRef\.current = null;/,
  "Find highlight cleanup should cancel and null a pending requestAnimationFrame",
);
assert.match(
  source,
  /foundFrameRef\.current = requestAnimationFrame\(\(\) => \{[\s\S]*?setFoundTurnId\(id\);[\s\S]*?foundFrameRef\.current = null;/,
  "Find jumps should track the highlight requestAnimationFrame until it fires",
);

assert.match(
  source,
  /const closeFind = useCallback\(\(\) => \{[\s\S]*?clearFoundHighlightTimer\(\);[\s\S]*?setFoundTurnId\(null\);/,
  "Closing find should clear the pending highlight timer before resetting foundTurnId",
);

assert.match(
  source,
  /useEffect\(\(\) => \{[\s\S]*?setFindOpen\(false\);[\s\S]*?clearFoundHighlightTimer\(\);[\s\S]*?setFoundTurnId\(null\);[\s\S]*?\}, \[clearFoundHighlightTimer, sessionId\]\);/,
  "Switching sessions should clear the pending find highlight timer",
);

// MetaLine complete state extends the existing one-liner format:
// "… · 7s · 12.4k tok · $0.08" — and stays silent when there is no usage.
assert.match(
  source,
  /const dur = fmtDuration\(args\.durationMs\);\s*\n\s*if \(dur\) segs\.push\(dur\);[\s\S]{0,300}?const usage = usageSummary\(args\.usage, args\.costUsd\);\s*\n\s*if \(usage\) segs\.push\(usage\);/,
  "MetaLine's complete state appends the usage summary after the duration in the same dot-separated format (CHAT-D12-02)",
);

assert.match(
  source,
  /const lastSettledAssistantTurn = useMemo\([\s\S]*?t\.role === "assistant" &&\s*\n\s*!t\.pending/,
  "The MetaLine readout derives from the latest settled assistant turn (CHAT-D12-02)",
);

assert.match(
  source,
  /durationMs=\{lastSettledAssistantTurn\?\.durationMs\}\s*\n\s*usage=\{lastSettledAssistantTurn\?\.usage\}\s*\n\s*costUsd=\{lastSettledAssistantTurn\?\.costUsd\}/,
  "ChatView passes the settled turn's duration, usage, and cost into MetaLine together (CHAT-D12-02)",
);

// ── CHAT-D12-01: consolidate simultaneous streaming status signals ──

// (a) While the turn has neither visible text nor streamed reasoning, the
// generic ThinkingIndicator owns the status. As soon as reasoning arrives,
// its inline disclosure becomes the live surface instead, avoiding duplicate
// thinking chrome. One shared flag gates both the chip and the fallback.
assert.match(
  source,
  /const indicatorVisible = Boolean\(turn\.pending\) && !visible && !reasoning;/,
  "TurnRow reserves the generic indicator for pending turns without visible text or streamed reasoning (CHAT-D12-01)",
);
assert.match(
  source,
  /\{turnStatus !== "complete" && !indicatorVisible && \(/,
  "Lifecycle chip is suppressed while the turn's own ThinkingIndicator is visible (CHAT-D12-01)",
);
assert.match(
  source,
  /\{indicatorVisible \? \(\s*\n\s*<ThinkingIndicator label="Thinking" startedAt=\{turn\.createdAt \? new Date\(turn\.createdAt\)\.getTime\(\) : undefined\} \/>/,
  "ThinkingIndicator renders off the same flag that suppresses the chip (CHAT-D12-01)",
);
// Settled chips stay load-bearing: the suppression must key off pending, so a
// failed turn (pending: false) always shows the Failed chip that anchors the
// Retry pill (#416/#420).
assert.doesNotMatch(
  source,
  /const indicatorVisible =[^\n]*turn\.error/,
  "Indicator-visibility flag must not involve turn.error — settled Failed chips always render (CHAT-D12-01)",
);

// (b) The synthetic "Receiving response" progress row settles at the first
// assistant chunk instead of staying "running" for the whole stream — the
// streamed text itself is the live signal, and the auto-open ProgressGroup
// quiets down to real connect/tool events. (The chunk application lives in
// applyAssistantChunk; both the coalesced stream-loop path and handleEvent's
// assistant_chunk case delegate to it — see chat-view-chunk-coalescing.)
assert.match(
  source,
  /const applyAssistantChunk = \([\s\S]*?id: "stream",\s*\n\s*label: "Receiving response",\s*\n\s*status: "done",/,
  "The synthetic Receiving-response row settles (done) at first chunk (CHAT-D12-01)",
);

// (b2) The server's "Starting <harness>" step (id "harness-start") is only
// settled server-side at process EXIT, so it spun as the live activity
// headline for the whole reply. Streamed text or a tool event proves the
// start completed — both apply sites settle it client-side; the server's
// exit update (label + duration) still lands via the normal upsert.
assert.match(
  source,
  /function settleProgressEventById\(\s*\n\s*progress: ProgressEvent\[\] \| undefined,\s*\n\s*id: string,/,
  "settleProgressEventById settles a named running step on later evidence",
);
assert.match(
  source,
  /const applyAssistantChunk = \([\s\S]*?upsertProgressEvent\(settleProgressEventById\(t\.progress, "harness-start"\), \{\s*\n\s*id: "stream",/,
  "First streamed chunk settles the harness-start step (it demonstrably started)",
);
assert.match(
  source,
  /upsertProgressEvent\(settleProgressEventById\(t\.progress, "harness-start"\), \{\s*\n\s*id: "tools",/,
  "A tool event settles the harness-start step too (tooling turns can run long before prose)",
);

// (c) CHAT-D3-06: the MetaLine streaming state carries a compact ticking
// elapsed ("writing… · 14s · esc to cancel") so the wall-clock counter
// survives past the first token. SR-quiet: the ticker lives in an aria-hidden
// span INSIDE the role="status" live region, so the per-second rewrite is
// excluded from the accessibility tree (the CHAT-D12-04 rewrites-per-second
// problem); the announced meta string only changes on state transitions.
assert.match(
  source,
  /function MetaLineElapsed\(\{ since \}: \{ since: string \}\)[\s\S]*?setInterval\(tick, 1000\)[\s\S]*?aria-hidden="true"/,
  "MetaLineElapsed ticks on a 1s interval and renders aria-hidden (CHAT-D3-06)",
);
assert.match(
  source,
  /\{state === "streaming" && pendingSince \? <MetaLineElapsed since=\{pendingSince\} \/> : null\}\s*\n\s*\{state === "streaming" \? " · esc to cancel" : null\}/,
  "Streaming meta line renders elapsed between the phase wording and the esc hint (CHAT-D3-06)",
);
// The esc hint moved out of the meta builder into MetaLine's JSX so the ticker
// could slot in before it — the segment builder must not duplicate it.
const metaLineSegmentsBody =
  source.match(/function metaLineSegments\([\s\S]*?\n}\n/)?.[0] ?? "";
assert.ok(metaLineSegmentsBody, "metaLineSegments body should be extractable (CHAT-D3-06)");
assert.doesNotMatch(
  metaLineSegmentsBody,
  /esc to cancel/,
  "metaLineSegments no longer carries the esc hint — MetaLine renders it after the ticker (CHAT-D3-06)",
);
// The ticker anchors to the in-flight assistant turn's createdAt.
assert.match(
  source,
  /pendingSince=\{activePendingTurn\?\.createdAt \?\? null\}/,
  "ChatView anchors the MetaLine ticker to the pending assistant turn (CHAT-D3-06)",
);
assert.match(
  styles,
  /\.cave-chat-meta-line__elapsed\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums/,
  "Elapsed ticker uses tabular digits so the meta line doesn't jitter (CHAT-D3-06)",
);

// The composer draft survives a reload: input initialises from localStorage
// and is written back on change (and cleared when emptied, e.g. after a send).
// The plumbing lives in the shared use-composer-draft hook (parity with home);
// these pins hold the call sites, the hook test holds the semantics.
assert.match(
  source,
  /export const DEFAULT_CHAT_COMPOSER_DRAFT_KEY = "cave:chat-composer-draft:v1"/,
  "ChatView exports the existing draft key as its safe default",
);
assert.match(
  source,
  /composerDraftKey\?: string/,
  "ChatView accepts a caller-owned draft namespace",
);
assert.match(
  source,
  /composerDraftKey = DEFAULT_CHAT_COMPOSER_DRAFT_KEY/,
  "ChatView preserves the existing draft slot when no override is provided",
);
assert.match(
  source,
  /const \[input, setInput\] = useState\(\(\) => readComposerDraft\(composerDraftKey\)\)/,
  "composer input initialises from the selected draft namespace",
);
assert.match(
  source,
  /const \{ clearNow: clearDraft \} = useDraftPersistence\(composerDraftKey, input, COMPOSER_DRAFT_WRITE_DELAY_MS\)/,
  "the selected draft namespace persists through the shared debounced hook",
);
assert.match(
  routerSource,
  /import \{ ChatView, DEFAULT_CHAT_COMPOSER_DRAFT_KEY \} from "@\/components\/chat-view"/,
  "ChatRouter shares ChatView's compatibility default",
);
assert.match(
  routerSource,
  /composerDraftKey\?: string/,
  "ChatRouter accepts an independent draft namespace",
);
assert.match(
  routerSource,
  /composerDraftKey = DEFAULT_CHAT_COMPOSER_DRAFT_KEY/,
  "ChatRouter keeps the legacy draft namespace by default",
);
assert.match(
  routerSource,
  /<ChatView[\s\S]*?composerDraftKey=\{composerDraftKey\}[\s\S]*?key=\{`chat-compose-\$\{composeInstance\}`\}/,
  "ChatRouter forwards its namespace to the primary ChatView",
);
assert.match(
  routerSource,
  /<ChatView[\s\S]*?composerDraftKey=\{`\$\{composerDraftKey\}:split:\$\{paneId\}`\}[\s\S]*?sessionId=\{paneId\}/,
  "ChatRouter gives every split pane a unique draft namespace",
);
assert.match(
  draftHook,
  /if \(text\) window\.localStorage\.setItem\(key, text\);\s*else window\.localStorage\.removeItem\(key\)/,
  "an emptied draft removes the key (sent messages don't reappear on reload)",
);

// The ↑/↓ prompt-history survives a reload — shared hook; the pin holds the
// keyed call site, the hook test holds the recall/persist semantics.
assert.match(
  source,
  /const \{ push: pushHistory, handleArrowKey \} = useComposerHistory\(COMPOSER_HISTORY_KEY\)/,
  "input history rides the shared persisted recall stack",
);
assert.match(
  source,
  /if \(handleArrowKey\(e, input, setInput\)\) return;/,
  "↑/↓ recall is delegated to the shared hook from the composer keyboard handler",
);

// ── Mid-stream thread switch must not cross wires (2026-07-03 audit P0) ───────
// A live stream accumulates in its session's registry snapshot — module scope,
// so it survives thread switches AND full surface unmounts (cave-0er). Only a
// view currently showing that session mirrors the update into setTurns.
assert.match(
  source,
  /if \(targetSessionId\) \{[\s\S]*?const stored = advanceLiveChatGeneration\([\s\S]*?targetSessionId,[\s\S]*?updater,[\s\S]*?nextActiveLeafId,[\s\S]*?metadata,[\s\S]*?\);[\s\S]*?if \(targetSessionId === currentSessionRef\.current\) \{[\s\S]*?setTurns\(stored\.turns\);/,
  "updateLiveTurns accumulates in the module-scope registry first so unmounted views can't drop chunks, mirroring into setTurns only for the on-screen session",
);
// A view that adopted (not started) a stream reconciles from disk on settle —
// it never sees the stream's "done" event, and the server only persists the
// exchange when the harness exits (cave-0er).
assert.match(
  source,
  /if \(!live && refetchOnSettleRef\.current === sessionId && !streamOwnerRef\.current\) \{[\s\S]*?setHistoryRetryKey\(\(k\) => k \+ 1\);/,
  "a non-owner view refetches the conversation from disk when an adopted/orphaned stream settles",
);
// Switching threads releases the previous thread's streaming lock so its busy
// state / Esc-cancel don't bleed onto the newly displayed thread.
assert.match(
  source,
  /release streaming state owned by the PREVIOUS thread[\s\S]{0,400}?setBusy\(false\);\s*\n\s*abortRef\.current = null;/,
  "the history-load effect clears streaming state inherited from the previous thread",
);

// Thread-switch composer isolation (cave chat audit): ChatView is a single
// instance reused across threads, so per-thread composer context must be reset
// on session switch or it bleeds a reply-quote / attachments / branch-parent /
// enhance-draft into the next conversation's next send.
assert.match(
  source,
  /setMentionedFiles\(\[\]\);\s*\n\s*setRuntimeHost\(null\);[\s\S]{0,600}?setReplyTarget\(null\);\s*\n\s*clearAttachments\(\);\s*\n\s*setPendingBranchParent\(undefined\);\s*\n\s*promptEnhance\.reset\(\);/,
  "the session-switch reset effect clears reply-target, attachments, pending branch parent, and enhance state so they don't leak across threads",
);

// Stream teardown must be ownership-scoped: a settling BACKGROUND stream must
// not clobber a newer concurrent stream's abort/stop wiring or unlock the composer.
assert.match(
  source,
  /if \(abortRef\.current === controller\) \{\s*\n\s*streamOwnerRef\.current = false;\s*\n\s*abortRef\.current = null;\s*\n\s*stopKeysRef\.current = \{ runId: null, sessionId: null \};\s*\n\s*setBusy\(false\);/,
  "sendRaw's finally only tears down the shared stream wiring when it still owns the active controller",
);

// IME composition safety: the Enter that confirms a CJK/kana candidate must not send.
assert.match(
  source,
  /e\.key === "Enter" && !e\.shiftKey && !e\.nativeEvent\.isComposing/,
  "the composer's Enter-to-send is gated on !isComposing so IME candidate-confirm doesn't fire a half-composed message",
);

// New-chat background-generation isolation (cave-8zq): a generation started on
// a brand-new chat carries an immutable originSessionId, and both the "session"
// and "done" events only adopt the server-assigned id into the displayed
// thread's currentSessionRef when this run owns the displayed view.
// For null-origin (sessionless) runs the ownership predicate also checks the
// displayed compose slot so that an older background run (A) cannot splice into
// a newer displayed compose (B) when both share originSessionId === null.
// Background null-origin runs still bind creation-refresh state and refresh the
// authoritative sidebar on done — only view adoption and router notification
// (onSessionStarted) are gated; ChatRouter's promotion predicate (origin-match
// guard) prevents promoting A's session into B's compose view.
assert.match(
  source,
  /const liveGeneration: LiveStreamGeneration = \{[\s\S]*?sessionId: initialLiveSessionId,[\s\S]*?originSessionId: initialLiveSessionId,[\s\S]*?controller,[\s\S]*?runId,/,
  "each generation records the immutable thread it started on (originSessionId)",
);
// ownsDisplayedView is imported from the pure helper module and called in both events.
assert.match(
  source,
  /import \{[\s\S]*?ownsDisplayedView[\s\S]*?\} from "@\/lib\/chat-session-ownership"/,
  "ChatView imports the pure ownsDisplayedView predicate from chat-session-ownership",
);
// displayedCreationRunIdRef tracks which run owns the displayed view.
assert.match(
  source,
  /const displayedCreationRunIdRef = useRef<string \| null>\(null\)/,
  "displayedCreationRunIdRef is declared to track the run owning the displayed view",
);
assert.match(
  source,
  /const onSessionsChangedRef = useRef\(onSessionsChanged\);\s*\n\s*onSessionsChangedRef\.current = onSessionsChanged;\s*\n\s*useLayoutEffect\(\(\) => \{\s*\n\s*return \(\) => \{\s*\n\s*displayedCreationRunIdRef\.current = null;\s*\n\s*\};\s*\n\s*\}, \[\]\);/,
  "the callback ref stays render-synchronized while layout cleanup synchronously releases compose ownership",
);
// Set to runId at the start of every send so resumed replacements also lose
// promotion authority when unmount/thread-switch cleanup clears the slot.
assert.match(
  source,
  /creationRefreshStateRef\.current = onSendStart\([\s\S]{0,400}?displayedCreationRunIdRef\.current = runId;/,
  "every send sets displayedCreationRunIdRef to its runId so stale resumed and sessionless runs cannot adopt",
);
{
  // Both session and done events call ownsDisplayedView and gate adoption on it.
  const ownedChecks = source.match(
    /const owned = ownsDisplayedView\(\{[\s\S]*?currentSessionId: currentSessionRef\.current,[\s\S]*?originSessionId: liveGeneration\.originSessionId,[\s\S]*?runId: liveGeneration\.runId,[\s\S]*?displayedCreationRunId: displayedCreationRunIdRef\.current,[\s\S]*?\}\);[\s\S]*?if \(owned\) \{[\s\S]*?liveSessionIdRef\.current = ev\.sessionId;[\s\S]*?currentSessionRef\.current = ev\.sessionId;[\s\S]*?setHistoryState\("loaded"\);/g,
  );
  assert.ok(
    ownedChecks && ownedChecks.length === 2,
    "both session and done events call ownsDisplayedView and gate ref adoption on the owned result",
  );
}
{
  // Both session and done events notify the router via the display-ownership
  // predicate, passing originSessionId so the router can match the specific
  // thread being replaced (null for sessionless creation, non-null for A→B).
  const notifyChecks = source.match(
    /const shouldPromote = canPromoteDisplayedSession\(\{[\s\S]*?currentSessionId: currentSessionRef\.current,[\s\S]*?originSessionId: liveGeneration\.originSessionId,[\s\S]*?runId: liveGeneration\.runId,[\s\S]*?displayedCreationRunId: displayedCreationRunIdRef\.current,[\s\S]*?\}\);[\s\S]*?if \(shouldPromote\) \{\s*onSessionStarted\?\.\(\{\s*newSessionId: ev\.sessionId,\s*expectedSessionId: liveGeneration\.originSessionId,\s*composeInstance,\s*\}\);\s*\}/g,
  );
  assert.ok(
    notifyChecks && notifyChecks.length === 2,
    "session and done events notify through the display-ownership predicate with session, origin, and compose provenance",
  );
}
// onSessionStarted must never be called from an ad hoc owned check — both paths
// use the promotion predicate so stale background promotions are correctly gated.
assert.doesNotMatch(
  source,
  /if \(owned(?: && liveGeneration\.originSessionId === null)?\) \{\s*\n\s*onSessionStarted\?\.\(ev\.sessionId/,
  "onSessionStarted is never called from an ad hoc ownership condition; both event paths use the promotion predicate",
);

assert.match(
  source,
  /const completedSessionId = ev\.sessionId \?\? liveGeneration\.sessionId;/,
  "done resolves the stable session id from either the event or live generation",
);
assert.match(
  source,
  /onDoneCreationRefresh\([\s\S]*?creationRefreshStateRef\.current,[\s\S]*?liveGeneration\.runId,[\s\S]*?completedSessionId[\s\S]*?\)/,
  "a successful first send refreshes the authoritative session list after persistence via the creation-refresh helper",
);
assert.match(
  source,
  /shouldCreationRefresh \|\| shouldReplacementRefresh[\s\S]{0,400}onSessionsChangedRef\.current\?\.\(\)/,
  "creation, replacement, and Board refresh flags feed one consolidated refresh invocation",
);
assert.doesNotMatch(
  source,
  /if \(completedSessionId\) \{\s*onSessionsChanged\?\.\(\);\s*\}/,
  "ordinary follow-ups do not refresh as though they created a sidebar row",
);
assert.match(
  source,
  /onCreationSessionIdentified\([\s\S]*?creationRefreshStateRef\.current,[\s\S]*?liveGeneration\.runId,[\s\S]*?liveGeneration\.originSessionId/,
  "ChatView passes liveGeneration.runId and liveGeneration.originSessionId to onCreationSessionIdentified for per-generation provenance",
);

// Session event binds OUTSIDE the ownership predicate: the generation owns its
// session ID regardless of which thread the view is currently displaying.
// The provenance gate is encoded in the helper (runId + originSessionId args).
// ownsDisplayedView is called after the bind and gates both adoption and notify.
assert.match(
  source,
  /case "session": \{[\s\S]*?creationRefreshStateRef\.current = onCreationSessionIdentified\([\s\S]*?liveGeneration\.runId,[\s\S]*?liveGeneration\.originSessionId,[\s\S]*?ev\.sessionId[\s\S]*?\)[\s\S]*?const owned = ownsDisplayedView\(/,
  "session event binds creation-refresh (with runId and provenance param) before calling ownsDisplayedView, so background sessionless generations still bind even when the user has switched threads",
);

// Done event binds with completedSessionId (covers the done-before-session race
// and the background-generation path) before invoking onDoneCreationRefresh.
// runId and provenance are passed to onCreationSessionIdentified; onDoneCreationRefresh
// no longer takes originSessionId (removed as unused parameter).
assert.match(
  source,
  /onCreationSessionIdentified\(\s*creationRefreshStateRef\.current,[\s\S]*?liveGeneration\.runId,[\s\S]*?liveGeneration\.originSessionId,[\s\S]*?completedSessionId[\s\S]*?\)[\s\S]*?onDoneCreationRefresh\(/,
  "done event binds creation-refresh using runId, provenance param, and completedSessionId before invoking onDoneCreationRefresh",
);

// Provenance gate is encoded in the helpers, not the caller: ChatView always
// calls both helpers and passes liveGeneration.originSessionId. The old
// caller-side `if (originSessionId === null)` guard must not be present.
assert.doesNotMatch(
  source,
  /liveGeneration\.originSessionId === null[\s\S]{0,120}?onCreationSessionIdentified/,
  "provenance gate is encoded in the helper API; ChatView must not guard onCreationSessionIdentified calls with a caller-side originSessionId === null check",
);
// onCreationSessionIdentified receives liveGeneration.originSessionId; onDoneCreationRefresh does not
assert.match(
  source,
  /onCreationSessionIdentified\(\s*creationRefreshStateRef\.current,[\s\S]*?liveGeneration\.runId,[\s\S]*?liveGeneration\.originSessionId,[\s\S]*?completedSessionId[\s\S]*?onDoneCreationRefresh\(\s*creationRefreshStateRef\.current,\s*liveGeneration\.runId,\s*completedSessionId/,
  "done event: onCreationSessionIdentified receives originSessionId; onDoneCreationRefresh takes only state/runId/completedSessionId (originSessionId removed)",
);

// The generation's finally unconditionally calls onCreationRunTerminated, covering every
// terminal exit: HTTP rejection, missing body, exhausted recovery, abort, and stream
// exceptions. The helper is safe to call unconditionally — it removes unbound
// entries and retry aliases while preserving the original bound retry entry.
assert.match(
  source,
  /} finally \{[\s\S]{0,800}?onCreationRunTerminated\(\s*creationRefreshStateRef\.current,\s*liveGeneration\.runId/,
  "generation's finally unconditionally calls onCreationRunTerminated — covers every terminal exit",
);
// HTTP rejection and missing body return early without scattered cleanup; they rely on
// the generation's finally instead.
assert.doesNotMatch(
  source,
  /chatBridgeFailureMessage[\s\S]{0,1000}?onCreationRunTerminated/,
  "HTTP rejection path has no scattered onCreationRunTerminated — relies on finally",
);
// The SSE error event handler no longer carries scattered cleanup (finally covers it).
assert.doesNotMatch(
  source,
  /case "error": \{[\s\S]{0,500}?onCreationRunTerminated/,
  "SSE case 'error' handler has no scattered onCreationRunTerminated — relies on finally",
);
// sendRaw passes runId to onSendStart for per-generation creation-refresh tracking
assert.match(
  source,
  /onSendStart\(\s*creationRefreshStateRef\.current,\s*runId,\s*initialLiveSessionId\s*\)/,
  "sendRaw passes runId and initialLiveSessionId to onSendStart for per-generation creation-refresh tracking",
);

// Issue 1: missing body return path has no scattered onCreationRunTerminated — relies on finally
assert.doesNotMatch(
  source,
  /"Chat bridge response did not include a stream"[\s\S]{0,400}?onCreationRunTerminated/,
  "missing body path has no scattered onCreationRunTerminated — relies on finally",
);

assert.match(
  source,
  /const onSessionsChangedRef = useRef\(onSessionsChanged\);\s*\n\s*onSessionsChangedRef\.current = onSessionsChanged;/,
  "the retained refresh ref always points to the latest callback",
);
assert.doesNotMatch(
  source,
  /cave:sessions-refresh/,
  "session refreshes stay on the ChatView → ChatRouter → Workspace callback chain",
);
assert.match(
  source,
  /useLayoutEffect\(\(\) => \{\s*\n\s*return \(\) => \{\s*\n\s*displayedCreationRunIdRef\.current = null;/,
  "keyed compose replacement synchronously revokes the old view's display ownership",
);
assert.match(
  source,
  /startNewConversation[\s\S]{0,400}onSessionsChangedRef\.current\?\.\(\)/,
  "Board/startNewConversation reaches the same consolidated refresh path",
);

// cave-b63 (1): model-state / usage-plan refreshes gate their setState on a
// caller predicate so a fetch resolving after a thread switch can't overwrite
// the new thread's model/plan; the effects pass () => !cancelled.
assert.match(
  source,
  /refreshModelState = useCallback\(async \([\s\S]*?shouldApply: \(\) => boolean = \(\) => true[\s\S]*?if \(canApply\(\)\) \{\s*\n\s*modelStateRef\.current = next;\s*\n\s*setModelState\(next\);\s*\n\s*setModelCapabilities\(/,
  "refreshModelState only applies its result when the caller's shouldApply() allows it",
);
assert.match(
  source,
  /void refreshModelState\(\(\) => !cancelled\);/,
  "the model-state effect vetoes a stale apply via () => !cancelled",
);
assert.match(
  source,
  /modelStateRequestRef = useRef\(0\)[\s\S]*modelSelectionRevisionRef = useRef\(0\)[\s\S]*requestId === modelStateRequestRef\.current[\s\S]*expectedSelectionRevision === modelSelectionRevisionRef\.current/,
  "rapid model/runtime mutations drop older model-state responses",
);
assert.match(
  source,
  /void refreshUsagePlan\(undefined, \(\) => !cancelled\);/,
  "the usage-plan effect vetoes a stale apply via () => !cancelled",
);

// cave-b63 (4): /clear tears down any in-flight stream first (cancelSend) so the
// live registry doesn't mirror the cleared turns back on the next chunk.
assert.match(
  source,
  /if \(command === "\/clear"\) \{\s*\n\s*\/\/[\s\S]*?cancelSend\(\);\s*\n\s*liveSessionIdRef\.current = null;\s*\n\s*setTurns\(\[\]\);/,
  "/clear cancels an in-flight stream before clearing the transcript",
);

// ── Replacement refresh wiring (Task 1 P2) ────────────────────────────────
// shouldReplacementRefreshOnDone is imported and called in the done handler
// with the three required decision inputs.
assert.match(
  source,
  /shouldReplacementRefreshOnDone/,
  "chat-view.tsx uses shouldReplacementRefreshOnDone for the replacement refresh decision",
);
assert.match(
  source,
  /shouldReplacementRefreshOnDone\(\s*liveGeneration\.originSessionId,\s*completedSessionId,\s*ev\.isError,?\s*\)/,
  "done handler invokes shouldReplacementRefreshOnDone with originSessionId, completedSessionId, and ev.isError",
);
// Consolidation: exactly one onSessionsChangedRef call gated on the combined boolean;
// no separate pre-bind startNewConversation-only call remains.
assert.doesNotMatch(
  source,
  /if \(startNewConversation && ev\.sessionId\) onSessionsChangedRef\.current\?\.\(\)/,
  "startNewConversation is consolidated into shouldRefreshSessions — no standalone pre-bind call",
);
// The consolidated boolean carries all three sources: creation, replacement, board.
assert.match(
  source,
  /const shouldRefreshSessions = shouldCreationRefresh \|\| shouldReplacementRefresh \|\|[\s\S]{0,80}startNewConversation/,
  "shouldRefreshSessions consolidates creation, replacement, and board conditions before the single ref call",
);
assert.match(
  source,
  /startNewConversation && !!ev\.sessionId && !ev\.isError/,
  "Board condition in shouldRefreshSessions requires !ev.isError — successful completion refreshes, error does not",
);
assert.doesNotMatch(
  source,
  /startNewConversation && !!ev\.sessionId(?! && !ev\.isError)/,
  "Board refresh must not fire on ev.isError — bare condition without the guard must not exist",
);

console.log("chat-view-lifecycle.test.ts: ok");
