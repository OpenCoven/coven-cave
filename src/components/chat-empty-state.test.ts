// @ts-nocheck
// Source pins for the task-aware chat starting page (chat-empty-state.tsx)
// and its card-follows-chat counterpart in chat-view.tsx. These pin the
// contracts that make the page honest: the rail resumes through the board
// route, navigation rides the established open-session event, and "Start a
// task" really creates a linked card at the stream's session event.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const emptyState = readFileSync(new URL("./chat-empty-state.tsx", import.meta.url), "utf8");
const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

test("open-work rail resumes through the board chat route and the open-session event", () => {
  assert.match(
    emptyState,
    /fetch\(`\/api\/board\/\$\{card\.id\}\/chat`, \{[\s\S]*?method: "POST"/,
    "rail rows resume via POST /api/board/[id]/chat (board-view contract)",
  );
  assert.match(
    emptyState,
    /new CustomEvent\("cave:agents-open-session"/,
    "navigation rides the established cross-tree open-session event",
  );
  assert.match(
    emptyState,
    /aria-label=\{`\$\{action\} '\$\{card\.title\}' — \$\{card\.status\}, \$\{card\.priority\} priority`\}/,
    "rail rows carry a full-context accessible name",
  );
  assert.match(
    emptyState,
    /\{card\.status\}/,
    "status is rendered as a word — color never carries the meaning alone",
  );
});

test("board fetch is abort-guarded and refreshes on focus, without polling", () => {
  assert.match(emptyState, /new AbortController\(\)/, "board load allocates an abort controller");
  assert.match(
    emptyState,
    /controller\.signal\.aborted/,
    "aborted responses are ignored (useProjects loader pattern)",
  );
  assert.match(emptyState, /useRefreshOnFocus\(load/, "board snapshot refreshes on window refocus");
  assert.doesNotMatch(emptyState, /setInterval/, "the starting page must not poll");
  assert.match(
    emptyState,
    /arrayContentEqual\(prev, next\) \? prev : next/,
    "unchanged board snapshots keep the previous reference",
  );
});

test("'Start a task' arms card-follows-chat instead of creating upfront", () => {
  assert.match(
    emptyState,
    /className="cave-chat-empty-task-tile"/,
    "the task tile renders as a dashed invitation tile",
  );
  assert.match(
    emptyState,
    /linkedTasks\.length === 0 \?/,
    "the tile and rail are suppressed once the chat already has a linked task",
  );
  assert.match(
    chatView,
    /if \(taskArmedRef\.current\) \{[\s\S]{0,400}?void createLinkedTaskCard\(ev\.sessionId, request\.text\)/,
    "the stream 'session' event creates the linked card from the first prompt",
  );
  assert.match(
    chatView,
    /taskArmedRef\.current = false;[\s\S]{0,200}?setTaskArmed\(false\);[\s\S]{0,200}?void createLinkedTaskCard/,
    "the armed ref is one-shot: cleared before the async create fires",
  );
  assert.match(
    chatView,
    /sessionId: forSessionId,[\s\S]{0,60}?status: "running"/,
    "the created card is linked to the session and lands as running work",
  );
});

test("continue row and identity polish", () => {
  assert.match(emptyState, /deriveContinueThreads\(/, "recent threads derive from the sessions prop");
  assert.match(emptyState, /excludeSessionId: sessionId/, "an existing zero-turn thread never suggests itself");
  assert.match(emptyState, /cave-chat-empty-role/, "familiar role renders as a quiet identity line");
  assert.match(emptyState, /\{modelId \? <span>\{modelId\}<\/span> : null\}/, "effective model joins the meta row as muted text");
  assert.match(emptyState, /title=\{project\.root\}/, "the ellipsizing project path exposes its full value");
});

test("chat-first landing: time greeting eyebrow, calm first paint, disclosed context", () => {
  // The retired home hero's time-of-day greeting now warms the chat landing,
  // sampled client-side so SSR never paints a mismatch.
  assert.match(
    emptyState,
    /greetingForHour\(new Date\(\)\.getHours\(\)\)/,
    "the landing samples a time-of-day greeting after mount",
  );
  assert.match(emptyState, /className=\{`cave-chat-empty-greeting/, "greeting renders as the landing eyebrow");

  // Project picker, open-work rail, task tile and recents collapse by default so
  // first paint is just greeting + suggestions + composer (Phase 2.1).
  assert.match(
    emptyState,
    /const \[showContext, setShowContext\] = useState\(false\)/,
    "the working context is collapsed by default",
  );
  assert.match(
    emptyState,
    /className="cave-chat-empty-context-toggle"[\s\S]*?aria-expanded=\{showContext\}/,
    "a labelled toggle discloses the working context with aria-expanded",
  );
  assert.match(
    emptyState,
    /\{showContext \? \([\s\S]*?className="cave-chat-empty-context-body"/,
    "the project picker + rails render only once context is expanded",
  );

  // Ordering: greeting sits above the identity; suggestions paint before the
  // collapsed context block.
  assert.ok(
    emptyState.indexOf("cave-chat-empty-greeting") < emptyState.indexOf("cave-chat-empty-familiar"),
    "greeting eyebrow sits above the familiar identity",
  );
  assert.ok(
    emptyState.indexOf("cave-chat-empty-prompts") < emptyState.indexOf('className="cave-chat-empty-context"'),
    "starter suggestions are part of the always-visible first paint, ahead of the collapsed context",
  );

  // The greeting eyebrow + context toggle stay on semantic tokens.
  assert.match(styles, /\.cave-chat-empty-greeting-dot \{[\s\S]*?background: var\(--accent-presence\)/, "greeting dot uses the presence accent token");
  assert.match(styles, /\.cave-chat-empty-context-toggle \{[\s\S]*?border-radius: 999px/, "context toggle reads as a pill control");
});

test("task-aware styles use semantic tokens and respect reduced motion", () => {
  assert.match(
    styles,
    /\.cave-chat-empty-task-status \{[\s\S]*?border-radius: 999px/,
    "status chip is a pill",
  );
  assert.match(
    styles,
    /\.cave-chat-empty-task-tile \{[\s\S]*?border: 1px dashed color-mix\(in oklch, var\(--accent-presence\)/,
    "task tile uses the dashed-invitation treatment on the presence accent",
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.cave-chat-empty-task-skeleton \{[\s\S]*?animation: none/,
    "skeleton pulse is disabled under reduced motion",
  );
  assert.doesNotMatch(
    styles.match(/\.cave-chat-empty-task[\s\S]*?\.cave-chat-empty-recent-time \{[\s\S]*?\}/)?.[0] ?? "",
    /#[0-9a-fA-F]{3,8}\b/,
    "task-aware section styles stay on semantic tokens — no hardcoded hex",
  );
});
