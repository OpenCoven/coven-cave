// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const view = await readFile(new URL("./board-view.tsx", import.meta.url), "utf8");
const kanban = await readFile(new URL("./board-kanban.tsx", import.meta.url), "utf8");

// ───────── Loading state (no empty-CTA flash on open) ─────────
assert.match(view, /const \[hasLoaded, setHasLoaded\] = useState\(false\)/, "BoardView must track a hasLoaded flag");
assert.match(view, /finally\s*\{\s*setHasLoaded\(true\);/, "load() must set hasLoaded in finally");
assert.match(view, /!hasLoaded && !error \?/, "A loading branch must precede the empty-state branch");
assert.match(view, /role="status" aria-label="Loading tasks"/, "Loading state must be announced");

// ───────── Failed mutations surface (no silent revert) ─────────
assert.match(view, /const \[actionError, setActionError\] = useState<string \| null>\(null\)/, "BoardView must track actionError");
assert.match(
  view,
  /if \(!json\.ok\) \{[\s\S]*?setActionError\([\s\S]*?await load\(\);/,
  "patchCard must surface an error (not silently revert) on a failed mutation",
);
assert.match(view, /catch \{\s*setActionError\([\s\S]*?await load\(\);/, "patchCard must handle network failure with feedback + revert");
assert.match(view, /\{actionError && \(/, "actionError must render a banner");

// ───────── Crash-guard + card a11y ─────────
assert.doesNotMatch(kanban, /PRIORITIES\.find\(\(p\) => p\.id === card\.priority\)!/, "PRIORITIES.find non-null assertion must be gone");
assert.match(
  kanban,
  /PRIORITIES\.find\(\(p\) => p\.id === card\.priority\) \?\? \{ id: card\.priority, label: card\.priority \}/,
  "Priority lookup must fall back instead of asserting",
);
assert.match(kanban, /role="button"/, "Kanban cards must expose a button role");
assert.match(kanban, /aria-label=\{`\$\{card\.title\}[\s\S]*?priority[\s\S]*?Enter to open; Space to move\.`\}/, "Cards need a descriptive aria-label with the move/open shortcuts");
assert.match(kanban, /aria-keyshortcuts="Enter Space"/, "Cards must declare their key shortcuts");
assert.doesNotMatch(kanban, /aria-selected=\{isSelected\}/, "Invalid aria-selected on the card must be removed");
assert.doesNotMatch(kanban, /aria-grabbed=\{isGrabbed\}/, "Deprecated aria-grabbed must be removed (state is in the label + live announce)");
// Keyboard DnD contract preserved.
assert.match(kanban, /data-card-id=\{card\.id\}/, "Cards keep data-card-id for keyboard grab");
assert.match(kanban, /board-kanban-card--grabbed/, "Grabbed visual affordance preserved");

console.log("board-ux-polish.test.ts: ok");
