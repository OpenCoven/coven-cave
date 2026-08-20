// @ts-nocheck
// Contract pins for the chat activity map. The behavioural half lives in
// src/lib/chat-run-rail.test.ts, which exercises the real derivation; this file
// guards the wiring and the two decisions that are easy to "fix" back into
// defects.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("./chat-run-rail.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/cave-chat/run-rail.css", import.meta.url), "utf8");
const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const facade = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

// ── mounted and styled, or it is dead code ──────────────────────────────────
assert.match(chatView, /^import \{ ChatActivityMap \} from "@\/components\/chat-run-rail";$/m, "chat-view imports the activity map");
assert.match(
  chatView,
  /<ChatActivityMap\s+turns=\{activePath\}/,
  "the activity map derives from the SAME activePath the transcript renders",
);
assert.match(
  chatView,
  /activePath\.length > 0 && activityMapVisible \? \(\s*\n\s*<ChatActivityMap/,
  "the activity map follows its session-header visibility toggle",
);
assert.doesNotMatch(
  chatView,
  /ChatThreadMinimap|ChatThreadSpine/,
  "chat no longer mounts the retired thread spine or minimap",
);
assert.match(
  component,
  /export function ChatActivityMap\(/,
  "the user-facing component is named for the activity map",
);
assert.match(
  component,
  /aria-label="Activity map"/,
  "assistive technology receives the same activity-map name as the menu",
);
// ── DOM order IS reading order (review catch on #4460) ──────────────────────
// The rail was briefly the row's first child, placed visually with `order: 1`.
// That reads correctly on screen and wrongly to a screen reader: `order` moves
// boxes, never reading order, so assistive tech met the annotation before the
// conversation. The mount now follows the transcript in the DOM.
{
  const transcript = chatView.indexOf('className="cave-chat-transcript');
  const rail = chatView.indexOf("<ChatActivityMap");
  assert.ok(transcript > 0 && rail > 0, "both the transcript and the rail are mounted");
  assert.ok(
    rail > transcript,
    "the rail is mounted AFTER the transcript — DOM order is the accessible order",
  );
}
// Comments are stripped first: the rule's own comment explains the `order: 1`
// it no longer has, and an unanchored search happily matched that prose — the
// same "satisfied by a comment" trap this file already guards elsewhere.
{
  const rule = css.match(/\.cave-runrail \{[^}]*\}/)?.[0] ?? "";
  const declarations = rule.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(
    declarations,
    /^\s*order\s*:/m,
    "no CSS `order` on the rail: reordering visually would decouple it from reading order again",
  );
}
assert.match(facade, /^@import "\.\/cave-chat\/run-rail\.css";$/m, "the stylesheet is imported by the cave-chat facade");

// ── the omissions are the feature ───────────────────────────────────────────
// PLAN, LEFT, CONTEXT WINDOW and COST are absent on purpose: progress[] carries
// only "notice" in practice, nothing declares a step total, and usage/costUsd
// reach 3 of 7755 turns because harnesses do not emit them (cave-0osmn).
// Re-adding any of them without its data source ships a panel that displays a
// number nothing measured.
for (const banned of ["Context window", "contextMeter", "costUsd", "Left"]) {
  assert.ok(
    !component.includes(banned),
    `${banned} must not appear until something populates it — see lib/chat-run-rail.ts for the measured coverage`,
  );
}

// ── cascade guard ───────────────────────────────────────────────────────────
// The category fallback must be declared on the rail ROOT. Declaring it on
// .cave-runrail__seg / __dot instead puts it AFTER the .--read/.--shell
// modifiers at equal specificity, where it silently wins — which rendered the
// entire legend grey while the bars stayed coloured.
const segRule = css.match(/^\.cave-runrail__seg \{([^}]*)\}/m);
const dotRule = css.match(/^\.cave-runrail__dot \{([^}]*)\}/m);
assert.ok(segRule && dotRule, "the segment and dot rules still exist");
for (const [name, rule] of [["__seg", segRule[1]], ["__dot", dotRule[1]]]) {
  assert.doesNotMatch(
    rule,
    /--tim\s*:/,
    `${name} must not redeclare --tim; the fallback belongs on .cave-runrail so the category modifiers win`,
  );
}
assert.match(
  css,
  /\.cave-runrail \{[\s\S]*?--tim:\s*var\(--text-muted\);[\s\S]*?\}/,
  "the rail root carries the single --tim fallback",
);

// The rail is a column beside the transcript, never a second horizontal scroller
// inside it (cave-l2hkx).
assert.match(css, /\.cave-runrail \{[\s\S]*?overflow-x:\s*hidden/, "the rail never scrolls sideways");
// The gate reserves a readable transcript beside the activity map.
assert.match(
  component,
  /ACTIVITY_MAP_MIN_ROW_WIDTH/,
  "the activity map has its own width threshold instead of inheriting the retired thread-map gate",
);

// ── wide-pane gate ─────────────────────────────────────────────────────────
// The map is layout. Without this gate it takes up to 300px from the transcript
// on a narrow pane; measuring itself would oscillate.
assert.doesNotMatch(component, /THREAD_INSTRUMENTS_MIN_WIDTH/, "the retired thread-map threshold is not imported");
assert.match(
  component,
  /ref\.current\?\.parentElement/,
  "the gate measures the PARENT ROW, not the transcript — measuring the element it shrinks oscillates: mount, narrow, unmount, widen, mount",
);
assert.doesNotMatch(
  component,
  /if \(!wide\) return null/,
  "a narrow rail hides in CSS rather than unmounting — a removed node cannot observe its parent to measure its way back",
);
assert.match(css, /\.cave-runrail--narrow \{ display: none; \}/, "the narrow state leaves layout entirely");

console.log("chat-run-rail.test.ts (component): ok");
