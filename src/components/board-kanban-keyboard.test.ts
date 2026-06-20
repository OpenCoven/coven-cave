// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./board-kanban.tsx", import.meta.url),
  "utf8",
);

// Consumes the foundations announcer.
assert.match(
  source,
  /import\s+\{[^}]*useAnnouncer[^}]*\}\s+from\s+["']@\/components\/ui\/live-region["']/,
  "imports useAnnouncer",
);
assert.match(source, /useAnnouncer\(\)/, "calls useAnnouncer()");

// Grab-mode state.
assert.match(
  source,
  /(grabbedCardId|keyboardGrabbedId)/,
  "tracks the keyboard-grabbed card id in state",
);

// Key handlers.
assert.match(source, /key === " "|e\.key === " "/, "handles Space (grab/drop)");
assert.match(
  source,
  /key === "ArrowLeft"|key === "ArrowRight"/,
  "handles ArrowLeft/Right for column nav while grabbed",
);
assert.match(source, /key === "Escape"/, "handles Escape to cancel grab");

// Visual affordance class.
assert.match(
  source,
  /board-kanban-card--grabbed/,
  "applies the --grabbed class to the grabbed card",
);

// Announcements fire.
assert.match(source, /announce\(/, "calls announce(...) for grab/move/drop");

// Column containers are marked.
assert.match(
  source,
  /data-kanban-column=/,
  "column containers are marked with data-kanban-column",
);

// Card rows expose data-card-id.
assert.match(
  source,
  /data-card-id=/,
  "card rows expose data-card-id",
);

// Touch / pen drag keeps mouse HTML5 drag intact while giving touch users a
// long-press path with a visible ghost and the same move callback.
assert.match(
  source,
  /pointerType === "mouse"/,
  "touch drag handler must leave mouse/native HTML5 drag alone",
);
assert.match(
  source,
  /setTimeout\([\s\S]*?350\)/,
  "touch drag should wait for a long-press before activating",
);
assert.match(
  source,
  /board-kanban-touch-ghost/,
  "touch drag should render a floating ghost while active",
);
assert.match(
  source,
  /onMoveStatus\(card\.id, target\)/,
  "touch drop should reuse the board status move callback",
);

// Swimlane collapse is a real <button> with aria-expanded (keyboard-operable).
assert.match(source, /board-swimlane-toggle/, "swimlane toggle is a button");
assert.match(source, /aria-expanded=\{!isCollapsed\}/, "swimlane toggle announces expanded state");

console.log("board-kanban-keyboard.test.ts OK");
