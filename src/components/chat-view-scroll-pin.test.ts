// @ts-nocheck
// Transcript follow-pin (CHAT-D10-01/-D10-04): the chat never scrolls without
// clear user intent. While `following`, the scroller stays glued to the bottom
// through EVERY height change — turns mutations AND late async layout
// (MarkdownBlock's mdToHtml promise, SyntaxBlock's shiki swap, mermaid,
// images) — via a ResizeObserver feeding the same coalesced instant-rAF pin.
// Release happens only on user input: wheel up, touch drag, PageUp/Home/
// ArrowUp, or a scrollbar grab that actually moves up. These source-text
// assertions guard that wiring (the behavior is exercised live; this catches
// accidental removal).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

// --- The pin executor: instant, coalesced, shared -------------------------

assert.match(
  src,
  /const schedulePin = useCallback\(\(\) => \{\s*if \(!followingRef\.current\) return;\s*if \(pinFrameRef\.current !== null\) return;\s*pinFrameRef\.current = requestAnimationFrame\(/,
  "schedulePin coalesces through pinFrameRef and re-checks following inside the rAF",
);

assert.match(
  src,
  /pinFrameRef\.current = null;\s*const el = scrollRef\.current;\s*if \(!el \|\| !followingRef\.current\) return;\s*el\.scrollTop = el\.scrollHeight;/,
  "the pin is an instant scrollTop assignment — never a queued smooth scrollTo (CHAT-D10-01)",
);

assert.match(
  src,
  /useEffect\(\(\) => \{\s*schedulePin\(\);\s*\}, \[turns, schedulePin\]\);/,
  "every turns mutation schedules a pin",
);

// The wedge that broke pinning entirely: StrictMode/Suspense re-run effects
// while refs persist, so a cancel that leaves the stale rAF id in place makes
// schedulePin's coalescing guard skip every future pin. Cancel MUST null.
assert.match(
  src,
  /cancelAnimationFrame\(pinFrameRef\.current\);[\s\S]{0,400}?pinFrameRef\.current = null;/,
  "the pin cleanup nulls pinFrameRef after cancelAnimationFrame (StrictMode/Suspense re-mount safety)",
);

// --- CHAT-D10-04: late async layout must not strand the viewport ----------

assert.match(
  src,
  /new ResizeObserver\(\(\) => \{\s*if \(followingRef\.current\) schedulePin\(\);\s*\}\)/,
  "a ResizeObserver re-pins on size changes ONLY while following — a released reader is never moved",
);

assert.match(
  src,
  /ro\.observe\(scroller\);\s*const thread = threadRef\.current;\s*if \(thread\) ro\.observe\(thread\);/,
  "the observer watches both the scroller (composer/window resizes) and the thread (content growth)",
);

assert.match(
  src,
  /ref=\{threadRef\}\s*className="cave-chat-thread"/,
  "threadRef is attached to the thread element the observer watches",
);

// --- Release on intent only ------------------------------------------------

assert.match(
  src,
  /const scrollable = \(\) => el\.scrollHeight - el\.clientHeight > 1;/,
  "release is gated on an actually-scrollable transcript (no stranded FAB on short chats)",
);

assert.match(
  src,
  /if \(e\.deltaY < 0 && followingRef\.current && scrollable\(\)\) updateFollowing\(false\);/,
  "wheel up releases the pin",
);

assert.match(
  src,
  /if \(e\.target === el && e\.offsetX >= el\.clientWidth\) scrollbarGrab = true;/,
  "a mousedown in the scrollbar gutter arms scrollbar-release (drags emit no wheel/touch/key events)",
);

assert.match(
  src,
  /if \(!scrollbarGrab \|\| !followingRef\.current\) return;\s*if \(el\.scrollHeight - el\.scrollTop - el\.clientHeight > 4\) updateFollowing\(false\);/,
  "only an actual upward move during a scrollbar grab releases — programmatic pins never do",
);

console.log("chat-view-scroll-pin.test.ts: ok");
