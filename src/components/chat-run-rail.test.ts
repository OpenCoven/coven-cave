// @ts-nocheck
// Contract pins for the run rail (cave-w716g). The behavioural half lives in
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
assert.match(chatView, /^import \{ ChatRunRail \} from "@\/components\/chat-run-rail";$/m, "chat-view imports the rail");
assert.match(
  chatView,
  /<ChatRunRail\s+turns=\{activePath\}/,
  "the rail derives from the SAME activePath the transcript renders — a second source could disagree with the thread beside it",
);
assert.match(
  chatView,
  /activePath\.length > 0 && instrumentsVisible \? \(\s*\n\s*<ChatRunRail/,
  "the rail shares the instruments toggle rather than adding a second setting for one idea",
);
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
assert.match(css, /\.cave-runrail \{[\s\S]*?order:\s*1/, "the rail is ordered after the transcript it annotates");

// ── wide-pane gate ─────────────────────────────────────────────────────────
// The rail is LAYOUT, unlike the spine and minimap which are overlays. Without
// this gate it takes up to 300px from the transcript on a narrow pane; with the
// WRONG gate it oscillates. Both failure modes are pinned.
assert.match(
  component,
  /THREAD_INSTRUMENTS_MIN_WIDTH/,
  "the rail gates on the same width as the spine and minimap so all three appear together",
);
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
