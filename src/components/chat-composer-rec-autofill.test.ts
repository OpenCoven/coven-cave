// @ts-nocheck
// Pins for the recommended-next-path composer ghost fill (cave-h62k): the
// empty composer mirrors the last settled turn's top suggestion as its
// placeholder, and ⇥ accepts it as an editable draft — fill, never send.
// ← was removed as an accept key in cave-i66c; see the regression pin below.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const transcriptCss = readFileSync(new URL("../styles/cave-chat/transcript.css", import.meta.url), "utf8");

// The recommendation derives from the ACTIVE branch path's last settled
// assistant turn — but only a reply can be keyboard-filled.
assert.match(
  source,
  /const recommendedNextPath = useMemo\(\(\) => \{[\s\S]*?extractChatRenderedText\(last\.text\)\.nextPaths\.find\(\(path\) => path\.kind === "reply"\) \?\? null;[\s\S]*?\}, \[activePath\]\);/,
  "recommendedNextPath only reads reply suggestions from the active path's last settled assistant turn",
);
assert.match(
  source,
  /\.find\(\(t\) => t\.role === "assistant" && !t\.pending && !t\.error\)/,
  "pending and errored turns never feed the recommendation",
);

// Key handling: empty-draft-only, not while busy, Shift+Tab untouched, and
// ordered AFTER the menu/token handlers so they keep owning Tab while open.
const keyBranch = source.match(
  /e\.key === "Tab" &&\n\s*!e\.shiftKey &&\n\s*input === "" &&\n\s*!busy &&\n\s*recommendedNextPath/,
);
assert.ok(keyBranch, "⇥ fill is gated on empty draft, not-busy, and a live recommendation");
const menuKeyIdx = source.indexOf("if (handleMenuKey(e)) return;");
const fillIdx = source.indexOf('e.key === "Tab" &&\n      !e.shiftKey &&');
assert.ok(menuKeyIdx !== -1 && fillIdx > menuKeyIdx, "menus keep owning Tab — fill branch comes after handleMenuKey");

// Regression (cave-i66c): ← must never be an accept key. It was briefly one on
// the reasoning that an empty textarea makes it inert, but that is only true of
// the text buffer — ArrowLeft stays a live navigation key for screen readers and
// IME candidate lists, and it is the one key a person presses expecting nothing
// to happen. Assert on the ACCEPT BRANCH rather than the whole file, so the
// unrelated ↑↓ history handler (handleArrowKey) stays free to use arrow keys.
const acceptBranch = source.slice(fillIdx, source.indexOf("}", source.indexOf("setInput(recommendedNextPath.prompt);")));
assert.ok(
  !acceptBranch.includes("ArrowLeft"),
  "left arrow must not be intercepted for recommendation autofill",
);
assert.match(
  source,
  /setInput\(recommendedNextPath\.prompt\);\n\s*return;/,
  "accepting fills the draft (never sends)",
);

// Placeholder: the recommendation replaces the idle hint; the input does not
// carry keyboard-help copy because the send button is the visible affordance.
assert.match(
  transcriptCss,
  /\.cave-chat-linear \.cave-composer-send \{[\s\S]*?border-radius: var\(--radius-control\);[\s\S]*?background: var\(--text-primary\);[\s\S]*?color: var\(--bg-panel\);/,
  "the send button is the composer’s sole high-contrast square action",
);
assert.match(
  source,
  /: recommendedNextPath\n\s*\? recommendedNextPath\.prompt/,
  "empty composer shows the recommendation without a key hint",
);
assert.doesNotMatch(source, /↵ to send|⇥ to fill/, "the composer renders no visible send or fill key tips");

console.log("chat-composer-rec-autofill: all pins hold");
