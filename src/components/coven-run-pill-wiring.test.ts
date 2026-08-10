// @ts-nocheck
/**
 * The status-bar run pill's wiring (design proposal §11, second half).
 *
 * The pill spans three files that are otherwise unrelated — the run publishes
 * from GroupChatView, the status bar renders it, and workspace joins them — so
 * the contract between them is pinned here rather than in any one suite.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const groupChat = readFileSync(new URL("./group-chat-view.tsx", import.meta.url), "utf8");
const statusBar = readFileSync(new URL("./status-bar.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const signal = readFileSync(new URL("../lib/coven-run-signal.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/status-bar.css", import.meta.url), "utf8");

// ── Publisher ────────────────────────────────────────────────────────────────
assert.match(
  groupChat,
  /publishCovenRunPill\(covenRunPill\(\{ run: activeRun, paused \}\)\)/,
  "the coven publishes the run the model already derived, not a second source of truth",
);
// A pill that outlives its surface would keep claiming a run is live after the
// reader has navigated away. Both exits must clear it.
assert.match(
  groupChat,
  /useEffect\(\(\) => \(\) => publishCovenRunPill\(null\), \[\]\)/,
  "unmount clears the pill",
);
assert.match(
  groupChat,
  /if \(!activeId\) publishCovenRunPill\(null\)/,
  "leaving every coven clears the pill",
);
assert.match(
  groupChat,
  /window\.addEventListener\(COVEN_JUMP_TO_RUN_EVENT, jump\)[\s\S]{0,200}removeEventListener\(COVEN_JUMP_TO_RUN_EVENT, jump\)/,
  "the jump listener is removed with its effect",
);

// ── Transport ────────────────────────────────────────────────────────────────
assert.match(
  signal,
  /function sameSlot\([\s\S]{0,600}a\.label === b\.label/,
  "an unchanged pill must not notify — the publisher re-derives on every streamed token",
);
assert.match(
  signal,
  /for \(const listener of \[\.\.\.listeners\]\) listener\(\)/,
  "the listener set is snapshotted before notifying, so subscribing during a notify is safe",
);

// ── Renderer ─────────────────────────────────────────────────────────────────
assert.match(
  statusBar,
  /<div className="status-bar__trail">\s*\n\s*\{run \? <CovenRunPillChip run=\{run\} onJumpToRun=\{onJumpToRun\} \/> : null\}/,
  "the pill sits in the status bar's trailing cluster",
);
assert.match(
  statusBar,
  /formatCovenDuration\(now - run\.startedAtMs\)/,
  "the live clock is derived from the run's start timestamp, so a reload agrees with the header",
);
assert.match(
  statusBar,
  /if \(!ticking\) return;[\s\S]{0,200}setInterval/,
  "the 1s ticker runs only while the run is genuinely live",
);
assert.match(
  statusBar,
  /<Icon name=\{run\.icon\}[\s\S]{0,200}<span className="status-bar__chip-label">\{label\}<\/span>/,
  "colour is never the only channel — the pill carries an icon and a label",
);
// A readout without a jump handler must not look clickable.
assert.match(
  statusBar,
  /if \(!onJumpToRun\) \{\s*\n\s*return \(\s*\n\s*<span/,
  "without a jump handler the pill is a span, not a button",
);

// ── Joiner ───────────────────────────────────────────────────────────────────
assert.match(
  workspace,
  /const covenRun = useSyncExternalStore\(\s*\n\s*subscribeCovenRunPill,\s*\n\s*covenRunPillSnapshot,\s*\n\s*covenRunPillServerSnapshot,\s*\n\s*\)/,
  "workspace subscribes rather than deriving state it does not hold",
);
assert.match(workspace, /run=\{covenRun\}/, "the subscribed run reaches the status bar");
assert.match(
  workspace,
  /onJumpToRun=\{\(\) => \{[\s\S]{0,400}setMode\("groupchat"\)/,
  "the pill reuses the existing open-the-coven-tab path instead of a second route",
);
assert.match(
  workspace,
  /dispatchEvent\(new CustomEvent\(COVEN_JUMP_TO_RUN_EVENT\)\)/,
  "clicking the pill also asks the coven to scroll to its run",
);
// ChatSurface must stay out of it: relaying a prop it has no stake in is the
// coupling this signal exists to avoid.
const chatSurface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
assert.doesNotMatch(
  chatSurface,
  /covenRunPill|CovenRunPill|onJumpToRun/,
  "ChatSurface is not a relay for the pill",
);

// ── Motion ───────────────────────────────────────────────────────────────────
assert.match(
  css,
  /\.status-bar__run-dot\[data-live="true"\] \{\s*\n\s*animation: status-bar-run-pulse/,
  "only a genuinely live run pulses",
);
assert.match(
  css,
  /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}\.status-bar__run-dot\[data-live="true"\] \{\s*\n\s*animation: none/,
  "the pulse has a reduced-motion story",
);

console.log("coven-run-pill-wiring.test.ts: ok");
