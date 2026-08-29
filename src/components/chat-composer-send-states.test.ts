// @ts-nocheck
// Source pins for the chat composer's send-state grammar (cave-9v9jr handoff,
// Composer.dc.html): one circular submit control that renders in four distinct
// states — idle (empty draft), ready (draft present), queue (draft staged while
// a turn streams), and stop (cancel the streaming turn). The queue itself
// renders as steerable/removable chips above the control row. These pins keep
// the state grammar honest: a regression that collapses the states into one
// button, or that drops the queue affordances, fails here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const source = read("./chat-view.tsx");
const css = [
  "../styles/cave-composer.css",
  "../styles/cave-chat.css",
  "../styles/cave-chat/transcript.css",
]
  .map((sheet) => read(sheet))
  .join("\n");

const submitRowMatch = source.match(
  /<div className="cave-composer-submit-row">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/,
);
assert.ok(submitRowMatch, "expected the composer submit row in ChatView");
const submitRow = submitRowMatch[0];

// ── Four distinct send states ────────────────────────────────────────────────

// Idle + ready: the plain .cave-composer-send is the resting control; it flips
// to ready via data-typing="true" once the draft (or an attachment) exists.
assert.match(
  submitRow,
  /className="cave-composer-send focus-ring transition-colors"[\s\S]*?aria-label="Send message"/,
  "the resting send control keeps the plain cave-composer-send class",
);
assert.match(
  submitRow,
  /data-typing=\{input\.trim\(\) \? "true" : undefined\}[\s\S]*?className="cave-composer-send focus-ring transition-colors"[\s\S]*?aria-label="Send message"/,
  "the ready state is signalled by data-typing=true on the plain send control",
);
assert.match(
  submitRow,
  /disabled=\{!projectLaunchReady \|\| \(!input\.trim\(\) && attachments\.length === 0\)\}/,
  "the send control stays disabled until the draft or an attachment is present",
);

// Queue: while busy with a staged draft, the same circle becomes a queue-send
// button (accent tinted) with its own label.
assert.match(
  submitRow,
  /className="cave-composer-send cave-composer-send--queue focus-ring transition-colors"[\s\S]*?title="Queue message"[\s\S]*?aria-label="Queue message"/,
  "a staged draft during a streaming turn renders the queue variant of the send circle",
);

// Stop: while busy, the circle becomes the cancel/stop control (danger tint),
// carrying the escape-key shortcut.
assert.match(
  submitRow,
  /className="cave-composer-send cave-composer-send--busy focus-ring transition-colors"[\s\S]*?title="Stop response \(esc\)"[\s\S]*?aria-label="Cancel response"[\s\S]*?aria-keyshortcuts="Escape"/,
  "a streaming turn renders the stop variant of the send circle with the esc shortcut",
);

// The send circle is a circle — pill radius, accent presence outline at rest.
assert.match(
  css,
  /\.cave-composer-send\s*\{[\s\S]*?border-radius:\s*var\(--radius-pill\);/,
  "the send circle uses the pill radius token",
);
assert.match(
  css,
  /\.cave-composer-send\s*\{[\s\S]*?border:\s*1px solid var\(--accent-presence\);/,
  "the send circle outlines with the accent-presence token",
);
assert.match(
  css,
  /\.cave-composer-send\s*\{[\s\S]*?background:\s*transparent;/,
  "the send circle rests on transparent",
);

// State colours ride the token system — accent tint for ready/queue, danger
// for stop — no hardcoded hues.
assert.match(
  css,
  /\.cave-composer-send\[data-typing="true"\]\s*\{[\s\S]*?background:\s*color-mix\(in oklch, var\(--accent-presence\) 18%, transparent\);/,
  "the ready state tints the circle with an accent-presence mix",
);
assert.match(
  css,
  /\.cave-composer-send--queue\s*\{[\s\S]*?background:\s*color-mix\(in oklch, var\(--accent-presence\) 18%, transparent\);/,
  "the queue state uses the same accent tint as ready",
);
assert.match(
  css,
  /\.cave-composer-send--busy\s*\{[\s\S]*?background:\s*color-mix\(in oklch, var\(--color-danger\) 90%, transparent\);[\s\S]*?color:\s*var\(--color-danger-foreground\);/,
  "the stop state tints the circle with the danger token",
);

// ── Queue chips: staged follow-ups stay outside the transcript ───────────────
const queueMatch = source.match(
  /<div className="cave-composer-queue" role="group" aria-label="Queued messages">[\s\S]*?<\/div>\s*\) : null\}/,
);
assert.ok(queueMatch, "expected the composer queue group in ChatView");
const queue = queueMatch[0];

assert.match(
  queue,
  /className="cave-composer-queue__chip"/,
  "each queued message renders as a chip",
);
assert.match(
  queue,
  /className="cave-composer-queue__steer focus-ring"[\s\S]*?aria-label=\{busy \? "Send queued message next" : "Send queued message"\}/,
  "a queued chip can be steered to send next (truthful about the busy state)",
);
assert.match(
  queue,
  /className="cave-composer-queue__remove focus-ring"[\s\S]*?aria-label="Remove queued message"/,
  "a queued chip can be removed",
);
assert.match(
  queue,
  /message\.attachments\.length > 0 && message\.text\.trim\(\)[\s\S]*?cave-composer-queue__count/,
  "chips with both text and attachments show the attachment count",
);

assert.match(
  css,
  /\.cave-composer-queue__chip\s*\{[\s\S]*?border:\s*1px solid color-mix\(in oklch, var\(--accent-presence\) 34%, var\(--border-hairline\)\);[\s\S]*?border-radius:\s*var\(--radius-pill\);/,
  "queue chips use token borders and the pill radius",
);

// Mobile: the send circle grows to the touch target.
assert.match(
  css,
  /@media \(max-width: 767px\)[\s\S]*?\.cave-composer-send\s*\{[\s\S]*?width:\s*var\(--touch-target\);/,
  "the send circle grows to the touch target on mobile",
);

console.log("chat-composer-send-states.test.ts: ok");
