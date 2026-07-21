// @ts-nocheck
// cave-32ks — capture → task → done. Phase 1 (send a card to a familiar) was
// verified already shipped (tile/stack/inspector "Start chat" + the
// /api/board/[id]/chat backlink route); these pins hold the two NEW deltas:
// live session status on the card chips (phase 2) and one-click "Mark done"
// from a settled chat (phase 3).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sessionStatusTone, sessionStatusWord } from "./session-status.ts";

// ── Pure mapping ──────────────────────────────────────────────────────────────
assert.equal(sessionStatusTone("running"), "running");
assert.equal(sessionStatusTone("starting"), "running");
assert.equal(sessionStatusTone("completed"), "done");
assert.equal(sessionStatusTone("failed"), "failed");
assert.equal(sessionStatusTone("killed"), "failed");
assert.equal(sessionStatusTone("orphaned"), "failed");
assert.equal(sessionStatusTone("idle"), "idle");
assert.equal(sessionStatusTone("something-new"), "idle", "unknown daemon states read as idle, never a lie");
assert.equal(sessionStatusTone(null), "idle");
assert.equal(sessionStatusWord("RUNNING"), "running", "case-insensitive");

// ── Phase 2 pins: the board's chips carry live status ─────────────────────────
const kanban = await readFile(new URL("../components/board-kanban.tsx", import.meta.url), "utf8");
const inspector = await readFile(new URL("../components/board-inspector.tsx", import.meta.url), "utf8");
const boardCss = await readFile(new URL("../styles/board/kanban-inspector.css", import.meta.url), "utf8");

assert.match(
  kanban,
  /board-kanban-card-chip--chat-\$\{sessionStatusTone\(session\.status\)\}/,
  "kanban chat chip is toned by the linked session's live status",
);
assert.match(kanban, /Chat · \{sessionStatusWord\(session\.status\)\}/, "kanban chip pairs the dot with the word");
assert.match(
  inspector,
  /board-drawer-chat-status-dot--\$\{sessionStatusTone\(session\.status\)\}/,
  "inspector chat card shows the status dot",
);
assert.match(
  inspector,
  /\{sessionStatusWord\(session\.status\)\} · open conversation/,
  "inspector desc pairs the dot with the word",
);
for (const tone of ["done", "failed", "idle"]) {
  assert.match(boardCss, new RegExp(`board-kanban-card-chip--chat-${tone}`), `kanban tone css: ${tone}`);
}
assert.match(boardCss, /board-drawer-chat-status-dot--running/, "inspector dot tones exist");

// ── Phase 3 pins: settled chat offers one-click Mark done ─────────────────────
const chatView = await readFile(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
const linkedWork = await readFile(new URL("../components/composer-linked-work-actions.tsx", import.meta.url), "utf8");

assert.match(
  linkedWork,
  /sessionSettled && t\.status !== "done" && onLinkedContextChange \? \(/,
  "Mark done shows only for a settled session on a not-yet-done task",
);
assert.match(
  linkedWork,
  /lifecycle: "completed",\s*lifecycleReason: sessionId/,
  "the linked-work action flips through the card lifecycle machine with an audit reason (status derives server-side)",
);
assert.match(
  chatView,
  /sessionSettled:\s*!activePendingTurn && Boolean\(lastSettledAssistantTurn\) && !lastSettledAssistantTurn\?\.error/,
  "settled = no in-flight turn, a clean last assistant turn",
);
assert.match(
  linkedWork,
  /announce\(`Task "\$\{t\.title\}" marked done\.`\)/,
  "success is voiced for AT",
);
assert.match(
  linkedWork,
  /Couldn't mark "\$\{t\.title\}" done/,
  "failure is voiced too — no silent no-op buttons",
);

console.log("session-status.test.ts: ok");
