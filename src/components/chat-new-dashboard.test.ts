// @ts-nocheck
// New-chat dashboard — the slimmed work board that greets a brand-new chat
// (Home stays the quiet hearth). Pins:
//   (1) chat-view splits its empty state: a null sessionId (brand-new chat)
//       renders <ChatNewDashboard>; existing zero-turn sessions keep the
//       task-aware <ChatEmptyState>;
//   (2) single-pane, board-only shell: NO context rail (the composer's footer
//       band owns project · model · linked-work), no chrome header, no docked
//       composer — ChatView owns the chrome above and the composer below;
//   (3) reduced open work: no filter tabs; the rows are capped (WORK_CAP)
//       with the overflow deferred to "+N more in Tasks", and Recent threads
//       is capped too (RECENT_CAP) — so the board never scrolls;
//   (4) the board reads the live Tasks board + the inbox "needs you" tier;
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

// ── (2) Single-pane, board-only shell ────────────────────────────────────
assert.match(
  dash,
  /home-dash__body home-dash--embed[\s\S]*?home-dash__board/,
  "the embed is the work board alone",
);
assert.doesNotMatch(dash, /home-dash__rail/, "no context rail — the composer footer band owns project/task context");
assert.doesNotMatch(dash, /<ProjectPicker/, "no rail project picker — the composer's project chip covers it");
assert.doesNotMatch(dash, /home-dash__quick/, "no quick-start rows — the composer is the intent surface");
assert.doesNotMatch(dash, /home-dash__pick/, "no Pick up cards — Recent threads is the single resume list");
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
assert.doesNotMatch(css, /home-dash__rail/, "the retired rail styles are gone");
assert.doesNotMatch(css, /home-dash__quick/, "the retired quick-start styles are gone");
assert.doesNotMatch(css, /home-dash__pick/, "the retired pick-up styles are gone");
assert.doesNotMatch(css, /home-dash__chrome/, "the retired chrome styles are gone");
assert.doesNotMatch(css, /home-dash__dock/, "the retired dock styles are gone");

// ── (3) Reduced open work, no scrolling ──────────────────────────────────
assert.doesNotMatch(dash, /OPEN_WORK_FILTERS/, "the filter tabs are gone");
assert.doesNotMatch(dash, /role="tablist"/, "no tablist chrome on the board head");
assert.match(dash, /const WORK_CAP = \d+/, "open-work rows are capped");
assert.match(dash, /openWork\.slice\(0, WORK_CAP\)/, "the board renders at most WORK_CAP rows");
assert.match(dash, /\+\{moreWork\} more in Tasks/, "overflow defers to Tasks instead of scrolling");
assert.match(dash, /const RECENT_CAP = \d+/, "recent threads are capped");
assert.match(
  dash,
  /el\.scrollHeight > el\.clientHeight \+ 1 && shed < maxShed/,
  "a pre-paint fit pass sheds tail rows until the board fits its pane",
);
assert.match(dash, /new ResizeObserver\(\(\) => dispatchShed\("reset"\)\)/, "pane resizes re-converge the fit pass");
assert.match(
  css,
  /\.home-dash__board \{[\s\S]{0,200}?overflow: hidden/,
  "the board pane does not scroll — capped content fits it",
);
assert.doesNotMatch(css, /\.home-dash__board \{[\s\S]{0,200}?overflow-y: auto/, "no board scrollbar");
assert.match(
  dash,
  /\$\{openWork\.length\} thread\$\{openWork\.length === 1 \? "" : "s"\} open\./,
  "the headline counts the open threads",
);
assert.match(dash, /home-dash__work-resume/, "work rows keep the visual Resume CTA");
assert.match(dash, /home-dash__section-label">Recent threads</, "a Recent threads list renders under Open work");
assert.match(
  dash,
  /home-dash__meta">[\s\S]*?\{familiar\.harness\}[\s\S]*?\{modelId \? <span>\{modelId\}<\/span> : null\}/,
  "the board head carries the harness · model identity meta (runtime-chip probe)",
);

// ── (4) Open-work board — live data ──────────────────────────────────────
assert.match(dash, /const boardCards = useDashboardBoard\(\)/, "the board reads the live Tasks board");
assert.match(dash, /fetch\("\/api\/inbox", \{ cache: "no-store"/, "the needs-you tier reads the live inbox");
assert.match(dash, /groupInboxFeed\(items\)\.needsYou/, "needs-you uses the same attention tier as the bell");

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

console.log("chat-new-dashboard.test.ts: ok");
