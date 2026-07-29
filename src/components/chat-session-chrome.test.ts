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
const styles = ["cave-chat", "chat-list"]
  .map((sheet) => readFileSync(new URL(`../styles/${sheet}.css`, import.meta.url), "utf8"))
  .join("\n");
const shellNav = readFileSync(new URL("../styles/globals/shell-navigation.css", import.meta.url), "utf8");

test("2a ③ — the context row renders under the header, from the same facts as the header", () => {
  assert.match(
    chatView,
    /<\/header>[\s\S]{0,600}<ChatSessionContextRow/,
    "the context row sits directly under the session header",
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
    /chip\.id === "project" && pickerAvailable \?/,
    "only the project chip is interactive — the rest are facts, not controls",
  );
  assert.match(
    contextRow,
    /<ProjectPickerPopover/,
    "the project chip opens the shared project picker rather than a private menu",
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

test("2a ⑤ — follow-up pills spread the composer's width; in-turn chips don't", () => {
  assert.match(
    styles,
    /\.cave-chat-followups \.cave-next-path \{[\s\S]*?flex: 1 1 0;[\s\S]*?height: 40px;/,
    "follow-ups take equal shares of one 40px row",
  );
  // The shared in-turn chip grammar (intrinsic width, scrollable row) is
  // untouched — the override only ever applies under .cave-chat-followups.
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
  assert.match(
    emptyState,
    /const startFromVisible = railVisible \|\| recents\.length > 0;/,
    "the launcher shows when there is work to start from",
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
    /className="cave-chat-empty-task"[\s\S]{0,500}?onClick=\{\(\) => void resumeCard\(card\)\}/,
    "task rows still resume through the board chat route",
  );
  assert.match(
    emptyState,
    /className="cave-chat-empty-recent"[\s\S]{0,400}?onClick=\{\(\) => openSession\(session\.id, session\.familiarId\)\}/,
    "thread rows still open through the shared open-session event",
  );
  assert.match(
    emptyState,
    /className="cave-chat-startfrom__count">\{tasksGroup\.count\}/,
    "each group states how much of its source is on screen",
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
    /\.cnav__thread\.is-active \.cnav__tick \{\s*\n\s*opacity: 0;/,
    "the active row's accent tick replaces the state tick instead of doubling it",
  );
  assert.match(
    shellNav,
    /\.cnav__tick\.cnav__dot--running \{[\s\S]*?animation: none;/,
    "ticks borrow the running colour but never the pulse — a rail of breathing bars is noise",
  );
  assert.match(sidebar, /<kbd className="cnav__new-kbd">⌘N<\/kbd>/, "the primary action shows its shortcut");
});
