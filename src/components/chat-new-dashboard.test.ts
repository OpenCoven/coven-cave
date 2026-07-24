// @ts-nocheck
// New-chat dashboard — the work-led dashboard (launcher 3a) relocated from
// Home into the brand-new-chat view; Home went back to the quiet hearth.
// Pins:
//   (1) chat-view splits its empty state: a null sessionId (brand-new chat)
//       renders <ChatNewDashboard>; existing zero-turn sessions keep the
//       task-aware <ChatEmptyState>;
//   (2) body-only shell: rail + board (ChatView owns the chrome above and
//       the composer below) — no chrome header, no docked composer;
//   (3) the rail carries Project · Quick start · Task · Pick up; quick rows
//       seed the chat composer through onPrompt, the picker is the shared
//       ProjectPicker, Pick up shows the two most-recent resumable sessions;
//   (4) the board reads the live Tasks board + the inbox "needs you" tier
//       and offers the All/Running/Blocked/Inbox filter tabs;
//   (5) self-contained navigation: the component reaches other surfaces
//       through the established window-event bridges, not prop drilling;
//   (6) Home is the hearth again — home-composer neither renders the
//       dashboard nor imports its sheet.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dash = await readFile(new URL("./chat-new-dashboard.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const homeComposer = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/home-dashboard.css", import.meta.url), "utf8");

// ── (1) chat-view's empty-state split ────────────────────────────────────
assert.match(
  chatView,
  /sessionId === null \? \([\s\S]{0,700}?<ChatNewDashboard/,
  "a brand-new chat (null sessionId) renders the relocated dashboard",
);
assert.match(
  chatView,
  /<ChatNewDashboard[\s\S]*?\) : \(\s*<ChatEmptyState/,
  "existing zero-turn sessions keep the task-aware ChatEmptyState",
);

// ── (2) Body-only shell: rail + board ────────────────────────────────────
assert.match(
  dash,
  /home-dash__body home-dash--embed[\s\S]*?home-dash__rail[\s\S]*?home-dash__board/,
  "the embed stacks the context rail beside the work board",
);
assert.doesNotMatch(dash, /home-dash__chrome/, "no identity chrome — ChatView's header covers it");
assert.doesNotMatch(dash, /home-dash__dock/, "no docked composer — ChatView's composer is the intent surface");
assert.match(
  css,
  /\.home-dash--embed \{[\s\S]{0,300}?flex: 1/,
  "the embed stretches to fill the empty transcript",
);
assert.match(
  css,
  /\.cave-chat-transcript:has\(\.home-dash--embed\) \.cave-chat-thread \{[\s\S]{0,200}?max-width: none/,
  "the thread releases its centered reading measure for the board",
);
assert.doesNotMatch(css, /home-dash__chrome/, "the retired chrome styles are gone");
assert.doesNotMatch(css, /home-dash__dock/, "the retired dock styles are gone");

// ── (3) Context rail — Project · Quick start · Task · Pick up ────────────
assert.match(dash, /home-dash__rail-label">Project</, "the rail leads with the Project group");
assert.match(dash, /<ProjectPicker/, "the project control is the shared ProjectPicker");
assert.match(dash, /home-dash__rail-label">Quick start</, "the rail carries a Quick start group");
assert.match(dash, /home-dash__quick-row[\s\S]*?onPrompt\(/, "quick-start rows seed the chat composer draft");
assert.match(dash, /onClick=\{onOpenPromptSnippets\}/, "a quick-start row opens the prompt-snippets modal");
assert.match(dash, /home-dash__rail-label">Task</, "the rail keeps the task-arming group");
assert.match(dash, /cave-chat-empty-task-armed/, "arming shows the linked-card banner");
assert.match(dash, /home-dash__rail-label">Pick up</, "the rail surfaces a Pick up group");
assert.match(dash, /resumableSessions\(sessions, 2\)/, "Pick up shows the two most-recent resumable sessions");

// ── (4) Open-work board — live data + filter tabs ────────────────────────
assert.match(dash, /const boardCards = useDashboardBoard\(\)/, "the board reads the live Tasks board");
assert.match(dash, /fetch\("\/api\/inbox", \{ cache: "no-store"/, "the needs-you tier reads the live inbox");
assert.match(dash, /groupInboxFeed\(items\)\.needsYou/, "needs-you uses the same attention tier as the bell");
assert.match(dash, /OPEN_WORK_FILTERS\.map/, "the board renders the All/Running/Blocked/Inbox filter tabs");
assert.match(
  dash,
  /\$\{openWork\.length\} thread\$\{openWork\.length === 1 \? "" : "s"\} open\./,
  "the headline counts the open threads",
);
assert.match(dash, /home-dash__work-resume/, "work rows keep the visual Resume CTA");
assert.match(dash, /home-dash__rail-label">Recent threads</, "a Recent threads list renders under Open work");
assert.match(
  dash,
  /home-dash__meta">[\s\S]*?\{familiar\.harness\}[\s\S]*?\{modelId \? <span>\{modelId\}<\/span> : null\}/,
  "the board head carries the harness · model identity meta (runtime-chip probe)",
);

// ── (5) Self-contained navigation — window-event bridges ─────────────────
assert.match(
  dash,
  /new CustomEvent\("cave:navigate-mode", \{ detail: \{ mode \} \}\)/,
  "surface jumps (Tasks, Rituals) go through the navigate-mode bridge",
);
assert.match(
  dash,
  /new CustomEvent\("cave:agents-open-session"/,
  "session opens go through the agents-open-session bridge",
);
assert.match(
  dash,
  /action: "read", ids: \[id\]/,
  "opening a needs-you item read-stamps it like the workspace bell",
);

// ── (6) Home is the hearth again ─────────────────────────────────────────
assert.match(homeComposer, /home-hearth-card/, "Home renders the centered hearth card");
assert.doesNotMatch(homeComposer, /home-dash/, "Home no longer renders the dashboard shell");
assert.doesNotMatch(
  homeComposer,
  /home-dashboard\.css/,
  "Home no longer imports the dashboard sheet (it ships with the new-chat view)",
);
