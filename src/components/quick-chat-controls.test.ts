// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./quick-chat-controls.tsx", import.meta.url), "utf8");

assert.match(source, /StandardSelect/, "quick-chat select helper should delegate to StandardSelect");
assert.doesNotMatch(source, /PopoverBody|PopoverItem|anchorRef/, "quick-chat select helper should not maintain its own popover implementation");
assert.match(source, /renderValue=/, "quick-chat select helper should keep its compact trigger rendering through StandardSelect");

// Shared conversation thread — used by both the in-app dropdown and the tray.
assert.match(source, /export function QuickChatThread/, "controls export the shared multi-turn thread renderer");
assert.match(source, /import \{ MarkdownBlock \} from "@\/components\/message-bubble"/, "familiar replies render markdown via the shared MarkdownBlock");
assert.match(source, /copyText\(message\.text\)/, "each familiar reply can be copied to the clipboard");
assert.match(source, /aria-live="polite"/, "the thread is a polite live region so streamed replies are announced");
assert.match(source, /quick-chat-caret|quick-chat-typing/, "streaming turns show a caret / thinking affordance");

// ── Shared building blocks: one source of truth for both surfaces ────────────
// The overlay and the tray render the same header identity, controls row, and
// composer — drift between the two (e.g. hint copy, focus behavior) was a bug.
for (const name of [
  "QuickChatIdentity",
  "QuickChatControlsRow",
  "QuickChatComposer",
  "useSuggestionPicker",
]) {
  assert.match(
    source,
    new RegExp(`export function ${name}`),
    `controls export the shared ${name} used by both quick-chat surfaces`,
  );
}
assert.match(
  source,
  /export const QUICK_CHAT_SUGGESTIONS/,
  "the one-tap starter suggestions are defined once and shared",
);
assert.match(
  source,
  /loading \? "Loading familiars…" : familiar \? `@\$\{familiar\.id\}` : "No familiar selected"/,
  "the shared header identity shows a loading state while the roster loads",
);
assert.match(
  source,
  /loading && familiars\.length === 0\s*\?\s*\[\{ value: "", label: "Loading…", disabled: true \}\]/,
  "the shared familiar select shows a disabled Loading placeholder while the roster is empty",
);
assert.match(
  source,
  /CONTROL_SELECT_CLASS =\s*\n?\s*"[^"]*rounded-\[var\(--radius-control\)\]/,
  "selector controls use the shared control radius token",
);
assert.doesNotMatch(source, /rounded-md/, "controls avoid hard-coded md radius");
assert.ok(source.includes('import { Button } from "@/components/ui/button"'), "controls use the shared Button primitive");
assert.ok(source.includes('import { IconButton } from "@/components/ui/icon-button"'), "controls use the shared IconButton primitive");
assert.doesNotMatch(source, /<button\b/, "controls do not hand-roll button controls");

// ── Composer: Enter sends, Shift+Enter newline, IME left alone ────────────────
assert.match(
  source,
  /\(event\.metaKey \|\| event\.ctrlKey\) && event\.key === "Enter"/,
  "the shared composer sends on Cmd/Ctrl+Enter",
);
assert.match(
  source,
  /event\.key === "Enter" && !event\.shiftKey && !event\.nativeEvent\.isComposing/,
  "plain Enter sends, Shift+Enter inserts a newline, IME composition is left alone",
);
assert.match(
  source,
  /requestAnimationFrame\(\(\) => composerRef\.current\?\.focus\(\)\)/,
  "picking a suggestion moves the caret into the composer (both surfaces, via useSuggestionPicker)",
);

// ── Thread auto-scroll must not fight the user ────────────────────────────────
// (cave-o8si) Follow-along uses the shared intent-release hook: scrolling up
// detaches, only returning to the true bottom re-attaches, and pins are
// rAF-coalesced. The old `< 48px` position re-stick — which yanked a reader
// pausing near the bottom — stays gone.
assert.match(
  source,
  /const \{ schedulePin, stick \} = useStickToBottom\(scrollRef\)/,
  "the thread follows via the shared intent-release hook",
);
assert.doesNotMatch(
  source,
  /clientHeight < 48/,
  "the position-threshold re-stick stays gone",
);
assert.match(
  source,
  /schedulePin\(\);\s*\}, \[messages\.length, lastText, schedulePin\]\)/,
  "streamed tokens pin through the coalesced scheduler",
);
assert.match(
  source,
  /stick\(\);\s*\}, \[messages\.length, stick\]\)/,
  "a new turn re-engages follow-along scrolling",
);
{
  const hook = readFileSync(new URL("../lib/use-stick-to-bottom.ts", import.meta.url), "utf8");
  assert.match(hook, /e\.deltaY < 0 && stuckRef\.current && scrollable\(\)/, "wheel-up releases the stick");
  assert.match(hook, /clientHeight <= 4\) setStuck\(true\)/, "only the true bottom re-sticks");
  assert.match(hook, /cancelAnimationFrame\(pinFrameRef\.current\);[\s\S]{0,400}pinFrameRef\.current = null;/, "the rAF guard nulls on cancel (StrictMode wedge)");
}

// ── Copy affordance resets ────────────────────────────────────────────────────
assert.match(
  source,
  /setTimeout\(\(\) => setCopied\(false\), 1500\)/,
  "the copied ✓ hands the button back to copy after a beat (it used to stick forever)",
);

console.log("quick-chat-controls.test.ts OK");
