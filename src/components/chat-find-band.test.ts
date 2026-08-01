// @ts-nocheck
// Source pins for the find band (cave-7gr08, Chat.dc.html 2a). The behavioural
// contract lives in src/lib/transcript-find.test.ts; these pin the wiring and
// the design's structure — control row, toggles, hit list, empty state.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const band = read("./chat-find-band.tsx");
const chatView = read("./chat-view.tsx");
const css = read("../styles/cave-chat/activity.css");

// ── The band replaced the inline widget, under the title row ────────────────
assert.doesNotMatch(chatView, /function ChatFindBar/, "the inline find bar is retired");
assert.doesNotMatch(css, /\.cave-chat-find\b/, "and so is its CSS, exclusions included");
assert.match(
  chatView,
  /<\/header>[\s\S]{0,600}?<ChatFindBand/,
  "the band renders under the title row, not inside the action cluster",
);
assert.match(
  chatView,
  /turns\.length > 0 && !findOpen \?[\s\S]{0,400}?aria-label="Find in conversation"/,
  "the header keeps only the trigger, and hides it while the band is open",
);

// ── Control row: the design's 37px row with both toggles ────────────────────
assert.match(css, /\.cave-find-band__controls \{[\s\S]*?min-height: 37px;/, "37px control row");
assert.match(band, /aria-pressed=\{matchCase\}/, "Match case is a pressed-state toggle");
assert.match(band, /aria-pressed=\{wholeWord\}/, "Whole word is a pressed-state toggle");
assert.match(
  css,
  /\.cave-find-band__count \{[\s\S]*?font-variant-numeric: tabular-nums;/,
  "the count is tabular so it does not shuffle the controls as it changes",
);

// ── The hit list is the point of the redesign ───────────────────────────────
assert.match(band, /hits\.map\(\(hit, index\) =>/, "every hit gets a row");
assert.match(
  band,
  /<mark className="cave-find-hit__mark">\{match\}<\/mark>/,
  "the hit is highlighted in place inside its snippet",
);
assert.match(
  band,
  /hit\.snippet\.slice\(0, hit\.snippetStart\)[\s\S]*?hit\.snippet\.slice\(hit\.snippetStart, hit\.snippetEnd\)[\s\S]*?hit\.snippet\.slice\(hit\.snippetEnd\)/,
  "the row splits its snippet by the hit's own offsets",
);
assert.match(band, /onClick=\{\(\) => onSelectHit\(index\)\}/, "a row jumps to its hit");
assert.match(band, /data-role=\{hit\.role\}/, "the author name is role-tinted");
assert.match(css, /\.cave-find-hit__name\[data-role="user"\]/, "and the tint is defined");
assert.match(
  css,
  /\.cave-find-band__list \{[\s\S]*?max-height: 240px;[\s\S]*?overflow-y: auto;/,
  "the list scrolls inside a cap so the band never eats the transcript",
);

// A nested <button> is invalid markup and the inner one steals the click —
// UserChatAvatar is a button that navigates to settings, so the row uses a
// plain initial instead.
assert.doesNotMatch(band, /<UserChatAvatar/, "no nested button inside the hit row");
assert.match(band, /cave-find-hit__initial/, "the user side of a hit row is a plain initial");

// ── Empty state names a way forward ─────────────────────────────────────────
assert.match(band, /No matches in this chat/, "the empty state says what happened");
assert.match(
  band,
  /matchCase \|\| wholeWord \?/,
  "it only offers to relax a filter that is actually on",
);
assert.match(band, /cave-find-band__kbd">⌘K<\/kbd>/, "and points at all-session search");

// ── chat-view wiring: hits, toggles, re-jump ────────────────────────────────
assert.match(chatView, /findTranscriptHits\(/, "the view matches occurrences, not just turns");
assert.match(
  chatView,
  /\{ matchCase: findMatchCase, wholeWord: findWholeWord \}/,
  "the toggles reach the matcher",
);
assert.match(
  chatView,
  /const key = \[findMatchCase \? "c" : "", findWholeWord \? "w" : "", findDebouncedQuery\]\.join\("\|"\);/,
  "the re-jump key includes the toggles — flipping one must not strand the active hit",
);
assert.match(
  chatView,
  /const id = matches\[idx\]\?\.turnId;/,
  "a jump still resolves to a turn, because scrolling lands on a turn",
);

console.log("chat-find-band.test.ts: ok");
