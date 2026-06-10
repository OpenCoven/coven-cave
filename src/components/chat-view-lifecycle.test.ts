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

console.log("chat-view-lifecycle.test.ts: ok");
