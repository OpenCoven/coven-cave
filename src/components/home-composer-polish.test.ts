// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");

// ───────── Task 1: Destination-aware placeholder + drop subtitle ─────────
assert.match(
  source,
  /const PLACEHOLDERS: Record<Destination, string> = \{[\s\S]*?chat:[\s\S]*?board:[\s\S]*?reminder:[\s\S]*?\}/,
  "PLACEHOLDERS must be a Record<Destination, string> with chat/board/reminder keys",
);
assert.match(
  source,
  /placeholder=\{PLACEHOLDERS\[destination\]\}/,
  "textarea must use placeholder={PLACEHOLDERS[destination]}",
);
assert.doesNotMatch(
  source,
  /placeholder="Ask anything, start a task, set a reminder…"/,
  "Old static placeholder must be removed",
);
assert.doesNotMatch(
  source,
  /Pick a destination, and go\./,
  "Redundant subtitle must be removed",
);

// ───────── Task 2: Keyboard hint strip ─────────
assert.match(source, /<div className="hc-keyboard-hint">/, "hc-keyboard-hint div in JSX");
assert.match(source, /⏎ send · ⇧⏎ newline · ↑↓ history · \/ commands/, "Hint copy: send/newline/history/commands");

const css = await readFile(new URL("../styles/home-composer.css", import.meta.url), "utf8");
assert.match(css, /\.hc-keyboard-hint\s*\{[\s\S]*?color:\s*var\(--text-muted\)/, ".hc-keyboard-hint CSS with --text-muted");

// ───────── Task 3: Visible Send label ─────────
assert.match(source, /<span className="hc-send-label">Send<\/span>/, "Send label in button body");
assert.match(source, /aria-label="Send"/, "Button keeps aria-label='Send'");
assert.match(css, /\.hc-send-btn\s*\{[\s\S]*?gap:\s*5px/, ".hc-send-btn uses gap: 5px");
assert.doesNotMatch(css, /\.hc-send-btn\s*\{[\s\S]*?width:\s*32px;[\s\S]*?height:\s*32px;[\s\S]*?\}/, "Old fixed 32x32 size removed");
assert.match(css, /\.hc-send-label\s*\{/, ".hc-send-label rule defined");

// ── "Jump back in" recent-chats strip ──
assert.match(source, /onOpenSession\?: \(sessionId: string, familiarId: string \| null\) => void/, "HomeComposer accepts a resume handler");
assert.match(source, /const recentSessions = useMemo/, "derives the recent sessions");
assert.match(source, /\.filter\(\(s\) => !s\.archived_at && s\.title\)/, "recents exclude archived/untitled chats");
assert.match(source, /onOpenSession && recentSessions\.length > 0/, "the strip only shows when there are recents and a resume handler");
assert.match(source, /onClick=\{\(\) => onOpenSession\(s\.id, s\.familiarId \?\? null\)\}/, "clicking a recent resumes that chat");
assert.match(source, /Jump back in/, "the strip is labelled");
assert.match(css, /\.home-recent \{/, "the recents strip is styled");

console.log("home-composer-polish.test.ts: ok");
