// @ts-nocheck
// New-chat dashboard — the work-led dashboard (launcher 3a) relocated from
// Home into the brand-new-chat view, then simplified (cave-gxap): the context
// rail is retired and the board is a capped, no-scroll column.
// Pins:
//   (1) chat-view splits its empty state: a null sessionId (brand-new chat)
//       renders <ChatNewDashboard>; existing zero-turn sessions keep the
//       task-aware <ChatEmptyState>;
//   (2) body-only shell: the board alone (ChatView owns the chrome above and
//       the composer below) — no chrome header, no docked composer, and no
//       context rail (the composer owns project picking + prompt snippets);
//   (3) no scrolling: the board clips instead of scrolling, and its content
//       is capped — open work at 5 rows, recent threads at 3;
//   (4) the board reads the live Tasks board + the inbox "needs you" tier
//       and offers the trimmed All/Needs-you filter tabs;
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

// ── (2) Body-only shell: the board alone — no rail ───────────────────────
assert.match(
  dash,
  /home-dash__body home-dash--embed[\s\S]*?home-dash__board/,
  "the embed carries the work board",
);
assert.doesNotMatch(dash, /home-dash__chrome/, "no identity chrome — ChatView's header covers it");
assert.doesNotMatch(dash, /home-dash__dock/, "no docked composer — ChatView's composer is the intent surface");
assert.doesNotMatch(dash, /home-dash__rail/, "the context rail is retired");
assert.doesNotMatch(dash, /ProjectPicker/, "no project picker — the composer owns project selection");
assert.doesNotMatch(dash, /home-dash__quick/, "no quick-start rows — prompt snippets live in the composer");
assert.doesNotMatch(dash, /home-dash__pick/, "no Pick up cards — Recent threads covers resumption");
assert.doesNotMatch(dash, /cave-chat-empty-task/, "no task arming — ChatEmptyState keeps that affordance");
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
assert.doesNotMatch(css, /home-dash__rail/, "the retired rail styles are gone");

// ── (3) No scrolling — the board clips, and its content is capped ────────
assert.match(
  css,
  /\.home-dash__board \{[\s\S]{0,200}?overflow: hidden/,
  "the board clips instead of scrolling",
);
assert.doesNotMatch(
  css,
  /overflow-y: auto/,
  "no internal scroll region survives in the dashboard sheet",
);
assert.match(dash, /const OPEN_WORK_ROWS_CAP = 5/, "open work is capped at 5 rows");
assert.match(dash, /const RECENT_THREADS_CAP = 3/, "recent threads are capped at 3 rows");
assert.match(
  dash,
  /filterOpenWork\(openWork, workFilter\)\.slice\(0, OPEN_WORK_ROWS_CAP\)/,
  "the visible open work applies the cap after filtering",
);
assert.match(dash, /\.slice\(0, RECENT_THREADS_CAP\)/, "recent threads apply their cap");
assert.match(
  css,
  /container-type: size/,
  "the board is a size container so fit tiers can query its height",
);
assert.match(
  css,
  /@container \(max-height: 650px\) \{[\s\S]{0,120}?\.home-dash__section--recent \{[\s\S]{0,40}?display: none/,
  "short panes shed Recent threads instead of clipping",
);
assert.match(
  css,
  /@container \(max-height: 480px\) \{[\s\S]{0,600}?\.home-dash__work-row:nth-child\(n \+ 4\) \{[\s\S]{0,40}?display: none/,
  "very short panes trim open work to three rows",
);
// An element can never match its own @container query — a `.home-dash__board`
// rule inside a tier is silently dead (shipped once: the 430px tier's padding
// shrink never applied). Tiers may restyle descendants only.
for (const [, tier] of css.matchAll(/@container[^{]*\{([\s\S]*?)\n\}/g)) {
  assert.doesNotMatch(
    tier,
    /\.home-dash__board\s*[{,]/,
    "fit tiers must not target .home-dash__board itself — it is the query container",
  );
}
assert.match(
  css,
  /\.home-dash__board-inner \{[\s\S]{0,200}?padding: var\(--space-6\) 0/,
  "vertical board padding lives on the inner wrapper so tiers can shrink it",
);

// ── (4) Open-work board — live data + trimmed filter tabs ────────────────
assert.match(dash, /const boardCards = useDashboardBoard\(\)/, "the board reads the live Tasks board");
assert.match(dash, /fetch\("\/api\/inbox", \{ cache: "no-store"/, "the needs-you tier reads the live inbox");
assert.match(dash, /groupInboxFeed\(items\)\.needsYou/, "needs-you uses the same attention tier as the bell");
assert.match(dash, /OPEN_WORK_FILTERS\.map/, "the board renders the trimmed filter tabs");
assert.match(
  dash,
  /\$\{openWork\.length\} thread\$\{openWork\.length === 1 \? "" : "s"\} open\./,
  "the headline counts the open threads",
);
assert.match(dash, /home-dash__work-resume/, "work rows keep the visual Resume CTA");
assert.match(dash, /home-dash__section-label">Open work</, "the Open work section keeps its label");
assert.match(dash, /home-dash__section-label">Recent threads</, "a Recent threads list renders under Open work");
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
