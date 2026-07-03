// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const streamEvents = readFileSync(new URL("../lib/stream-events.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

assert.match(
  source,
  /type ChatTurnLifecycle =[\s\S]*"queued"[\s\S]*"connecting"[\s\S]*"streaming"[\s\S]*"tooling"[\s\S]*"cancelled"[\s\S]*"failed"[\s\S]*"complete"/,
  "ChatView should model assistant send lifecycle with explicit phases",
);

assert.match(
  source,
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
  /\{\s*kind: "progress";\s*id\?: string;\s*label: string;\s*detail\?: string;\s*status\?: "running" \| "done" \| "error";\s*durationMs\?: number;\s*\}/,
  "Chat streams should expose non-token progress events for quiet phases",
);

assert.match(
  source,
  /progress\?: ProgressEvent\[\]/,
  "Assistant turns should keep progress events alongside text, thinking, and tools",
);

assert.match(
  source,
  /case "progress":[\s\S]*upsertTurnProgress\(assistantId, ev, liveGeneration\.sessionId\)/,
  "Progress events should update the active assistant turn",
);

assert.match(
  source,
  /case "session":[\s\S]*ev\.sessionId !== currentSessionRef\.current[\s\S]*onSessionStarted\?\.\(ev\.sessionId\)/,
  "A transparent resume fallback should promote the live chat to the replacement session id",
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
  /case "assistant_chunk":[\s\S]*setAssistantLifecycle\(assistantId, "streaming", liveGeneration\.sessionId\)/,
  "Assistant chunks should move the turn into a streaming lifecycle",
);

assert.match(
  source,
  /case "tool_use":[\s\S]*setAssistantLifecycle\(assistantId, "tooling", liveGeneration\.sessionId\)/,
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
  /const send = async \(override\?: string\) => \{[\s\S]*?intentFromSlash\(text\)[\s\S]*?if \(busy\) return;[\s\S]*?setInput\(""\);[\s\S]*?setAttachments\(\[\]\);[\s\S]*?await sendRaw\(outgoingText, outgoingAttachments, outgoingMentions/,
  "send() must run slash intents first, then bail on busy BEFORE clearing the composer — a mid-stream Enter must not destroy the draft (CHAT-D5-01)",
);

assert.match(
  source,
  /const sendRaw = async [\s\S]*?\|\| busy\) return;/,
  "sendRaw should keep its own busy guard as the backstop behind send()'s",
);

assert.match(
  source,
  /const liveChatGenerations = new Map<string, LiveChatGenerationSnapshot>\(\)/,
  "In-flight chat generations should be persisted outside the ChatView component so navigation away does not lose them",
);

assert.match(
  source,
  /function subscribeLiveChatGeneration\(sessionId: string, listener: LiveChatGenerationListener\)/,
  "ChatView should subscribe to live generation snapshots when returning to a session",
);

assert.match(
  source,
  /const liveGeneration = \{ sessionId: initialLiveSessionId, controller \}[\s\S]*?recordLiveChatGeneration\(\{\s*sessionId: liveGeneration\.sessionId,[\s\S]*?controller,[\s\S]*?turns: nextTurns/,
  "sendRaw should persist the active stream snapshot with its abort controller",
);

assert.match(
  source,
  /readLiveChatGeneration\(sessionId\)[\s\S]*?setTurns\(live\.turns\)[\s\S]*?setActiveLeafId\(live\.activeLeafId\)[\s\S]*?abortRef\.current = live\.controller[\s\S]*?setBusy\(true\)/,
  "History loading should rehydrate a live generation snapshot for the selected session",
);

assert.match(
  source,
  /subscribeLiveChatGeneration\(sessionId, \(live\) => \{[\s\S]*?setTurns\(live\.turns\)[\s\S]*?setBusy\(true\)[\s\S]*?setBusy\(false\)/,
  "A remounted ChatView should keep following live generation updates and settle when the stream finishes",
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
  /subscribeLiveChatGeneration\(sessionId, \(live\) => \{\s*if \(live && isLiveSnapshotActive\(live, Date\.now\(\)\)\)/,
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
  /onEdit=\{t\.role === "user" && t\.text\.trim\(\) \? \(\) => editTurnInComposer\(t\) : undefined\}/,
  "Only user turns with text get the Edit affordance (CHAT-D6-01)",
);

assert.match(
  source,
  /function regenerateFor\(turn: Turn\)[\s\S]*?if \(busy \|\| turn\.role !== "assistant" \|\| turn\.pending\) return undefined;/,
  "Regenerate is hidden while busy and on pending turns (CHAT-D6-02)",
);

assert.match(
  source,
  /function regenerateFor\(turn: Turn\)[\s\S]*?role === "user"[\s\S]*?if \(!prevUser\) return undefined;[\s\S]*?return \(\) => void sendRaw\(text, prevAttachments \?\? \[\]/,
  "Regenerate re-sends the preceding user turn (text + attachments) through the guarded sendRaw path, and hides when no user turn precedes (CHAT-D6-02)",
);

assert.match(
  source,
  /onRegenerate=\{regenerateFor\(t\)\}/,
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
    /function regenerateFor\(turn: Turn\)[\s\S]*?return \(\) => void sendRaw\(text, prevAttachments \?\? \[\]/,
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
  source,
  /durationMs: t\.durationMs,\s*\n\s*usage: t\.usage,\s*\n\s*costUsd: t\.costUsd,/,
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
  /className="cave-linear-turn-recency"[\s\S]{0,220}?title=\{exactTime\}[\s\S]{0,220}?\{recency\}[\s\S]{0,220}?<UsageText usage=\{turn\.usage\} costUsd=\{turn\.costUsd\} \/>/,
  "Assistant turn meta row appends the muted usage/cost readout after the visible recency timestamp (CHAT-D12-02)",
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

// (a) While the turn's own live indicator shows (pending, no visible text),
// the Queued/Connecting/Writing chip in the same meta row is redundant —
// suppressed until text flows or the turn settles. One shared flag gates both
// so the chip and the indicator can never double up.
assert.match(
  source,
  /const indicatorVisible = Boolean\(turn\.pending\) && !visible;/,
  "TurnRow derives a single indicator-visibility flag from pending + visible text (CHAT-D12-01)",
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
// quiets down to real connect/tool events.
assert.match(
  source,
  /case "assistant_chunk":[\s\S]*?id: "stream",\s*\n\s*label: "Receiving response",\s*\n\s*status: "done",/,
  "The synthetic Receiving-response row settles (done) at first chunk (CHAT-D12-01)",
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
assert.match(
  source,
  /const \[input, setInput\] = useState\(\(\) => readComposerDraft\(\)\)/,
  "composer input initialises from the persisted draft",
);
assert.match(
  source,
  /useEffect\(\(\) => \{\s*const timer = window\.setTimeout\(\(\) => \{\s*writeComposerDraft\(input\);\s*\}, COMPOSER_DRAFT_WRITE_DELAY_MS\);\s*return \(\) => window\.clearTimeout\(timer\);\s*\}, \[input\]\)/,
  "the draft is debounced so mobile typing does not write localStorage on every keystroke",
);
assert.match(
  source,
  /if \(text\) window\.localStorage\.setItem\(COMPOSER_DRAFT_KEY, text\);\s*else window\.localStorage\.removeItem\(COMPOSER_DRAFT_KEY\)/,
  "an emptied draft removes the key (sent messages don't reappear on reload)",
);

// The ↑/↓ prompt-history survives a reload: it initialises from localStorage
// and is persisted whenever it changes.
assert.match(
  source,
  /const \[inputHistory, setInputHistory\] = useState<string\[\]>\(\(\) => readComposerHistory\(COMPOSER_HISTORY_KEY\)\)/,
  "input history initialises from the persisted recall stack",
);
assert.match(
  source,
  /writeComposerHistory\(COMPOSER_HISTORY_KEY, inputHistory\)/,
  "input history is persisted when it changes",
);

// ── Mid-stream thread switch must not cross wires (2026-07-03 audit P0) ───────
// A background stream updates its OWN registry snapshot, never the displayed
// transcript — otherwise switching threads renders/persists the wrong session.
assert.match(
  source,
  /if \(targetSessionId && targetSessionId !== currentSessionRef\.current\) \{[\s\S]*?const snap = readLiveChatGeneration\(targetSessionId\);[\s\S]*?recordLiveChatGeneration\(\{[\s\S]*?turns: updater\(snap\.turns\)/,
  "updateLiveTurns routes background-stream updates to the streaming session's snapshot, not setTurns",
);
// Switching threads releases the previous thread's streaming lock so its busy
// state / Esc-cancel don't bleed onto the newly displayed thread.
assert.match(
  source,
  /release streaming state owned by the PREVIOUS thread[\s\S]{0,400}?setBusy\(false\);\s*\n\s*abortRef\.current = null;/,
  "the history-load effect clears streaming state inherited from the previous thread",
);

console.log("chat-view-lifecycle.test.ts: ok");
