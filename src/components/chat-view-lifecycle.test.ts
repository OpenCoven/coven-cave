// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
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
  /function setAssistantLifecycle\(id: string, lifecycle: ChatTurnLifecycle\)/,
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
  source,
  /\{ kind: "progress"; id\?: string; label: string; detail\?: string; status\?: "running" \| "done" \| "error"; durationMs\?: number \}/,
  "Chat streams should expose non-token progress events for quiet phases",
);

assert.match(
  source,
  /progress\?: ProgressEvent\[\]/,
  "Assistant turns should keep progress events alongside text, thinking, and tools",
);

assert.match(
  source,
  /case "progress":[\s\S]*upsertTurnProgress\(assistantId, ev\)/,
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
  /case "assistant_chunk":[\s\S]*setAssistantLifecycle\(assistantId, "streaming"\)/,
  "Assistant chunks should move the turn into a streaming lifecycle",
);

assert.match(
  source,
  /case "tool_use":[\s\S]*setAssistantLifecycle\(assistantId, "tooling"\)/,
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
  /const send = async \(\) => \{[\s\S]*?intentFromSlash\(text\)[\s\S]*?if \(busy\) return;[\s\S]*?setInput\(""\);[\s\S]*?setAttachments\(\[\]\);[\s\S]*?await sendRaw\(/,
  "send() must run slash intents first, then bail on busy BEFORE clearing the composer — a mid-stream Enter must not destroy the draft (CHAT-D5-01)",
);

assert.match(
  source,
  /const sendRaw = async [\s\S]*?\|\| busy\) return;/,
  "sendRaw should keep its own busy guard as the backstop behind send()'s",
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
  /function regenerateFor\(turn: Turn\)[\s\S]*?role === "user"[\s\S]*?if \(!prevUser\) return undefined;[\s\S]*?return \(\) => void sendRaw\(text, prevAttachments \?\? \[\]\);/,
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

console.log("chat-view-lifecycle.test.ts: ok");
