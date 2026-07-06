import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The Diary — the experimental iPad page where you write to a familiar with
// Apple Pencil and the reply writes itself out live, Tom Riddle style. This
// locks the load-bearing pieces: PencilKit input that stays Simulator-testable,
// Vision handwriting recognition composited on white, pen-lift (not per-stroke)
// submission, the SSE stream feeding a paced reveal loop, session resume for
// follow-ups, and the iPad-only entry point.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const diary = await read("apps/ios/CovenCave/CovenCave/Views/DiaryView.swift");
const home = await read("apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift");

// ── Pencil input ─────────────────────────────────────────────────────────────
assert.match(diary, /import PencilKit/, "the diary draws with PencilKit");
assert.match(
  diary,
  /drawingPolicy = \.anyInput/,
  "finger input stays enabled — the Simulator has no Pencil, and the page must stay testable there",
);
assert.match(
  diary,
  /overrideUserInterfaceStyle = \.light/,
  "the canvas is forced light so PencilKit doesn't invert the sepia ink in dark mode",
);
assert.match(
  diary,
  /squelch/,
  "programmatic drawing writes (clearing the page) must not re-enter the stroke delegate",
);

// ── Pen-lift submission (not per-stroke) ─────────────────────────────────────
assert.match(
  diary,
  /penLiftTask\?\.cancel\(\)/,
  "each new stroke re-arms the pen-lift timer — recognition fires on a writing pause, not mid-word",
);

// ── Handwriting recognition ──────────────────────────────────────────────────
assert.match(diary, /import Vision/, "handwriting is read via Vision");
assert.match(
  diary,
  /VNRecognizeTextRequest/,
  "recognition uses VNRecognizeTextRequest",
);
assert.match(
  diary,
  /UIColor\.white\.setFill\(\)/,
  "strokes are composited onto white before recognition — Vision needs the contrast",
);
assert.match(
  diary,
  /recognitionLevel = \.accurate/,
  "handwriting needs the accurate recognition level",
);

// ── The reply writes itself out ──────────────────────────────────────────────
assert.match(
  diary,
  /client\.sendStream\(body\)/,
  "the reply streams through the sanctioned chat SSE bridge",
);
assert.match(
  diary,
  /sessionId: sessionId/,
  "follow-up writes resume the same session so the diary keeps context",
);
assert.match(
  diary,
  /case \.assistantChunk\(let chunk\):[\s\S]*?pendingReply\.append/,
  "streamed chunks land in the reveal buffer, not directly on screen",
);
assert.match(
  diary,
  /SnellRoundhand/,
  "the reply renders in a cursive hand",
);
assert.match(
  diary,
  /case "\.", "!", "\?":/,
  "the reveal cadence breathes at sentence ends — handwriting, not a teleprinter",
);
assert.match(
  diary,
  /reduceMotion/,
  "Reduce Motion collapses the reveal/soak animations",
);

// ── iPad-only entry point ────────────────────────────────────────────────────
assert.match(
  home,
  /if sizeClass == \.regular \{[\s\S]*?showDiary = true/,
  "the Diary entry point only shows in regular width (iPad) — the page is sized for Pencil writing",
);
assert.match(
  home,
  /fullScreenCover\(isPresented: \$showDiary\) \{\s*\n\s*DiaryView\(\)/,
  "the Diary opens full screen",
);

console.log("ios-diary-page.test.mjs: ok");
