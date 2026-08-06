// @ts-nocheck
// Source pins for the Chat.dc.html session redesign (turn 2 "hybrid"):
//
//   2a — title row in the display serif, a slim mono context row beneath it,
//        full-width suggestion pills, and a user turn that reads as a card in
//        the reading column instead of a right-aligned accent bubble.
//   2b — the new-session page leads with a mono eyebrow and one serif line,
//        then a "Start from" launcher over work that already exists.
//   rail — session rows carry a state tick; groups carry a count and a rule.
//
// These pin the contracts the redesign depends on, not every declaration:
// which facts each row is allowed to state, and that it states them once.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const contextRow = readFileSync(new URL("./chat-session-context-row.tsx", import.meta.url), "utf8");
const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const emptyState = readFileSync(new URL("./chat-empty-state.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
// Facade sheets resolve to their effective content: run-tests.mjs loads
// scripts/css-source-contract-hook.cjs, which patches readFileSync so
// cave-chat.css yields everything it @imports. Run these files through the
// runner — invoking them bare skips the hook and fails for the wrong reason.
const styles = ["cave-chat", "chat-list"]
  .map((sheet) => readFileSync(new URL(`../styles/${sheet}.css`, import.meta.url), "utf8"))
  .join("\n");
const shellNav = readFileSync(new URL("../styles/globals/shell-navigation.css", import.meta.url), "utf8");

test("2a ③ — the context row renders under the header, from the same facts as the header", () => {
  // The find band (cave-7gr08) slides in between when open, so the window is
  // sized for it — the invariant is ordering: header, then band, then context
  // row, with nothing else in between.
  assert.match(
    chatView,
    /<\/header>[\s\S]{0,1800}<ChatSessionContextRow/,
    "the context row sits directly under the session header",
  );
  assert.match(
    chatView,
    /<\/header>[\s\S]{0,600}<ChatFindBand[\s\S]{0,1300}<ChatSessionContextRow/,
    "and the find band is the only thing between them",
  );
  // One derivation for the model: the header meta line and the context row
  // must never disagree about which model answered.
  assert.match(
    chatView,
    /const contextRowModel =\s*\n\s*responseMetadataModel\(lastSettledAssistantTurn\?\.responseMetadata\) \?\?/,
    "the row's model comes from the settled turn's response metadata first",
  );
  assert.match(
    chatView,
    /const \{ branch: sessionGitBranch \} = useChangesSummary\(/,
    "the branch rides the shared changes-summary gate rather than its own fetch",
  );
  // 2b: a brand-new chat renders NO context band — the new-session dashboard
  // already states the harness and model, so a lone model chip would repeat it.
  assert.match(
    chatView,
    /\{sessionId !== null \|\| turns\.length > 0 \? \(\s*\n\s*<ChatSessionContextRow/,
    "the band waits for a session or a first turn before it renders",
  );
});

test("2a ③ — the row is presentation over a pure model and never renders empty chrome", () => {
  assert.match(
    contextRow,
    /import \{\s*\n\s*chatContextChips,\s*\n\s*chatContextStats,/,
    "chips and stats derive from the pure chat-session-context model",
  );
  assert.match(
    contextRow,
    /if \(!chips\.length && !stats\.length\) return null;/,
    "a session with no facts yet renders no band at all",
  );
  assert.match(
    contextRow,
    /if \(chip\.id === "project" && pickerAvailable\)/,
    "only the project chip is interactive — the rest are facts, not controls",
  );
  assert.match(
    contextRow,
    /<ProjectPickerPopover/,
    "the project chip opens the shared project picker rather than a private menu",
  );
  assert.match(
    contextRow,
    /<div className="cave-chat-context-row" role="group" aria-label="Session context">/,
    "the context row exposes its accessible name through a semantic group",
  );
  assert.match(
    chatView,
    /harness=\{familiar\.harness\}[\s\S]*turns=\{turns\}/,
    "the strip receives the familiar runtime and the transcript it summarizes",
  );
  assert.match(
    contextRow,
    /function StatPopover[\s\S]*aria-haspopup="dialog"[\s\S]*<Popover/,
    "interactive metrics use the shared accessible popover",
  );
  assert.match(
    contextRow,
    /aria-label=\{`\$\{stat\.detail\.heading\} details`\}[\s\S]*ariaLabel=\{`\$\{stat\.detail\.heading\} details`\}/,
    "every metric trigger and card derives an accessible name from its heading",
  );
});

test("2a ③ — the instrument strip keeps every metric reachable at narrow widths", () => {
  assert.match(
    styles,
    /\.cave-chat-context-row\s*\{[\s\S]*?overflow-x:\s*auto/,
    "the detail row scrolls horizontally instead of deleting metrics",
  );
  assert.match(styles, /\.cave-chat-context-stat--action/, "detail metrics have trigger styling");
  assert.match(styles, /\.cave-chat-context-popover/, "breakdown cards have a scoped surface");
  assert.match(styles, /\.cave-chat-context-breakdown__bar/, "context detail includes a segmented bar");
  assert.doesNotMatch(
    styles,
    /@media \(max-width: 900px\)[\s\S]*?\.cave-chat-context-row__stats\s*\{[\s\S]*?display:\s*none/,
    "narrow panes do not hide the right-side metrics",
  );
});

test("2a — the title row and turn names wear the display serif", () => {
  assert.match(
    styles,
    /\.cave-chat-meta-line \.cave-chat-title button,\s*\n\.cave-chat-meta-line \.cave-chat-title-input \{[\s\S]*?font-family: var\(--font-serif/,
    "the session title reads in EB Garamond in both display and edit modes",
  );
  assert.match(
    styles,
    /\.cave-chat-linear \.cave-linear-turn--assistant \.cave-linear-turn-name \{[\s\S]*?font-family: var\(--font-serif/,
    "the familiar's name in a turn is the second identity moment",
  );
});

test("2a ⑤ — composer follow-ups are equal-width recommendation pills", () => {
  // The typed follow-ups keep their equal-width one-row geometry, but their
  // composer placement reads as quiet single-line recommendation pills.
  assert.match(
    styles,
    /\.cave-followup-cards__grid \{[\s\S]*?grid-auto-flow: column;[\s\S]*?grid-auto-columns: minmax\(0, 1fr\);/,
    "follow-up cards take equal shares of one row",
  );
  assert.match(
    styles,
    /\.cave-chat-followups \.cave-followup-card \{[\s\S]*?border-radius: var\(--radius-pill\);[\s\S]*?text-align: center;/,
    "composer follow-ups use the shared pill radius and centered label",
  );
  assert.match(
    styles,
    /\.cave-chat-followups \.cave-followup-card__type,\s*\.cave-chat-followups \.cave-followup-card__outcome \{[\s\S]*?display: none;/,
    "composer pills suppress visual metadata while preserving their accessible name",
  );
  // The pill-era override is gone: nothing renders .cave-next-path inside the
  // follow-up strip, so the orphaned selector must not linger in the cascade.
  assert.doesNotMatch(
    styles,
    /\.cave-chat-followups \.cave-next-path\b/,
    "the orphaned pill override does not survive the typed-card grammar",
  );
  // The shared in-turn chip grammar (intrinsic width, count-keyed row) is
  // untouched.
  assert.doesNotMatch(
    styles.match(/^\.cave-next-path \{[\s\S]*?\n\}/m)?.[0] ?? "",
    /flex: 1 1 0/,
    "in-turn next-path chips keep their intrinsic width",
  );
});

test("2a ④ — the user turn is a card in the reading column, not a right-aligned bubble", () => {
  const bubble = styles.match(/\.cave-chat-linear \.cave-bubble-user \{[\s\S]*?\n\}/g)?.at(-1) ?? "";
  assert.match(bubble, /border-radius: var\(--radius-card\)/, "uniform 12px corners");
  assert.match(bubble, /background: color-mix\(in oklch, var\(--bg-raised\)/, "neutral raised fill");
  assert.doesNotMatch(bubble, /14px 14px 4px 14px/, "the old tail-cornered bubble is gone");
});

test("2b — the new session leads with a mono eyebrow and one serif line", () => {
  assert.match(
    emptyState,
    /className="cave-chat-empty-eyebrow">\{`New session · \$\{familiar\.display_name\}`\}/,
    "the eyebrow names the session and its familiar",
  );
  assert.match(
    emptyState,
    /<p className="cave-chat-empty-hero">\s*\n\s*\{project \? "Brief the familiar" : "What should we begin\?"\}/,
    "the hero line states what the page is for and flips once a project is chosen",
  );
  assert.match(
    styles,
    /\.cave-chat-empty-hero \{[\s\S]*?font-family: var\(--font-serif/,
    "the hero is the surface's identity moment",
  );
});

test("2b — 'Start from' is always visible and launches work that already exists", () => {
  // The launcher appears when ANY of its sources has work — each group added
  // since (Queue, cave-3lonn) joins this same disjunction.
  assert.match(
    emptyState,
    /\{bands\.length > 0 \? <ChatStartFromBands bands=\{bands\} \/> : null\}/,
    "the launcher shows whenever any source contributed a band",
  );
  assert.doesNotMatch(
    emptyState,
    /cave-chat-empty-context-toggle/,
    "the open-work/recents disclosure is replaced by the always-visible launcher",
  );
  assert.match(
    emptyState,
    /startFromGroup\("tasks", railCards\.length, openCards\.length\)/,
    "the Tasks header counts the capped strip against every open card",
  );
  assert.match(
    emptyState,
    /startFromGroup\("chats", recents\.length, continuableCount\)/,
    "the Chats header counts the capped strip against every resumable thread",
  );
  // Resume/open contracts survive the restructure — and the groups reuse the
  // starting page's existing row grammar rather than a second vocabulary, so
  // the redesign adds structure without adding weight to the home CSS.
  assert.match(
    emptyState,
    /meta: tasksGroup,[\s\S]{0,1600}?onPick: \(\) => void resumeCard\(card\)/,
    "task tiles still resume through the board chat route",
  );
  assert.match(
    emptyState,
    /meta: chatsGroup,[\s\S]{0,900}?onPick: \(\) => openSession\(session\.id, session\.familiarId\)/,
    "thread tiles still open through the shared open-session event",
  );
  // Each band head states how much of its source is on screen — the count now
  // comes from the shared launcher, so it cannot drift per surface.
  assert.match(
    readFileSync(new URL("./chat-start-from-bands.tsx", import.meta.url), "utf8"),
    /className="cave-sf__band-count">\{meta\.count\}/,
    "each band states how much of its source is on screen",
  );
});

test("rail — rows carry a state tick and groups carry a count and a rule", () => {
  assert.match(
    sidebar,
    /<span className=\{`cnav__tick \$\{statusDotClass\(session\.status\)\}`\} aria-hidden \/>/,
    "the tick reuses the dot's state palette so a new status only teaches one place",
  );
  assert.match(
    sidebar,
    /<span className="cnav__label-count">\{bucket\.sessions\.length\}<\/span>/,
    "group headers count their rows",
  );
  assert.match(
    shellNav,
    /\.cnav__thread\.is-active \.cnav__tick \{\s*\n\s*left: var\(--space-3\);\s*\n\s*opacity: 1;/,
    "the active row keeps its runtime tick visible and shifts it away from the selection accent",
  );
  assert.match(
    shellNav,
    /\.cnav__tick\.cnav__dot--running \{[\s\S]*?animation: none;/,
    "ticks borrow the running colour but never the pulse — a rail of breathing bars is noise",
  );
  assert.match(sidebar, /<kbd className="cnav__new-kbd">⌘N<\/kbd>/, "the primary action shows its shortcut");
});

test("rail — the selected chat is a raised card with one accent rail", () => {
  const activeRow = shellNav.match(/\.cnav__thread\.is-active \{[\s\S]*?\n\}/)?.[0] ?? "";
  const activeRail = shellNav.match(/\.cnav__thread\.is-active::before \{[\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(activeRow, /margin: 0 var\(--space-2\);/, "the selection is inset from the list edge");
  assert.match(activeRow, /border-radius: var\(--radius-card\)/, "the selection reads as a rounded raised card");
  assert.match(activeRow, /background: var\(--bg-raised\)/, "the selection uses the raised surface rather than a second accent tint");
  assert.match(activeRail, /background: var\(--accent-presence\)/, "the selection keeps one lavender identity rail");
});
