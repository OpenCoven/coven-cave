// @ts-nocheck
// Quick-chat window polish (cave-fdt5): readable measure on wide windows,
// meta chips instead of a status sentence, and a legible disabled Send.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const glass = readFileSync(new URL("../styles/quick-chat-glass.css", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const tray = readFileSync(new URL("./tray-quick-chat.tsx", import.meta.url), "utf8");

// ── Readable measure ─────────────────────────────────────────────────────────
assert.match(
  glass,
  /\.tray-quick-chat__pane \{[\s\S]{0,700}?max-width: 920px;\s*\n\s*margin-inline: auto;/,
  "The pane column caps at a readable measure and centers on wide windows",
);

// ── Meta chips ───────────────────────────────────────────────────────────────
assert.match(
  globals,
  /\.quick-chat-meta-chip \{[\s\S]{0,400}?border-radius: 999px;[\s\S]{0,200}?background: var\(--bg-subtle\);/,
  "Meta chips are quiet token pills",
);
assert.doesNotMatch(
  tray,
  /Thinking: \$\{thinkingEffort\}/,
  "The status run-on sentence is gone from the composer hint area",
);
assert.match(
  tray,
  /className="quick-chat-meta-chip" title="Thinking effort"/,
  "Thinking chip labels itself via tooltip",
);
assert.match(
  tray,
  /className="quick-chat-meta-chip" title="Model"/,
  "Model chip labels itself via tooltip",
);

// ── Disabled Send stays visible ──────────────────────────────────────────────
assert.match(
  globals,
  /\.quick-chat-overlay__actions \.ui-btn--primary:disabled \{\s*\n\s*opacity: 1;\s*\n\s*border-color: var\(--border-hairline\);\s*\n\s*background: var\(--bg-subtle\);\s*\n\s*color: var\(--text-muted\);/,
  "Disabled Send renders as a visible 'present but not ready' control, not a 50% ghost",
);

// ── The composer input keeps its visible focus treatment ────────────────────
assert.match(
  globals,
  /\.quick-chat-overlay__input:focus \{\s*\n\s*border-color: var\(--accent-presence\);/,
  "Composer input keeps the accent focus treatment",
);

// ── The --bg-subtle token is actually defined ────────────────────────────────
// Chips, keycaps, and recent-search pills referenced --bg-subtle while no
// theme defined it — every one rendered transparent. It now derives from
// --bg-raised so it tracks all themes through one definition.
assert.match(
  globals,
  /--bg-subtle: color-mix\(in oklch, var\(--bg-raised\) 72%, transparent\);/,
  "--bg-subtle is defined (derived from --bg-raised)",
);

console.log("quick-chat-polish.test.ts: ok");
