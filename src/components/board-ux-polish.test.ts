// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const view = await readFile(new URL("./board-view.tsx", import.meta.url), "utf8");
const kanban = await readFile(new URL("./board-kanban.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../styles/board.css", import.meta.url), "utf8");

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

// ───────── Desktop board toolbar stays one row ─────────
assert.match(
  styles,
  /\.board-header\s*\{[\s\S]*flex-wrap:\s*nowrap/,
  "Desktop board header should keep title, search, and controls on one row",
);
assert.match(
  styles,
  /\.board-header-controls\s*\{[\s\S]*flex-wrap:\s*nowrap/,
  "Desktop board controls should not wrap under the search field",
);
assert.match(
  styles,
  /\.board-search-wrap\s*\{[\s\S]*min-width:\s*0/,
  "Desktop board search should be allowed to shrink before forcing toolbar wrapping",
);
assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.board-header\s*\{[\s\S]*flex-wrap:\s*wrap/,
  "Mobile board header should keep its stacked layout",
);

// ───────── Crash-guard + card a11y ─────────
assert.doesNotMatch(kanban, /PRIORITIES\.find\(\(p\) => p\.id === card\.priority\)!/, "PRIORITIES.find non-null assertion must be gone");
assert.match(
  kanban,
  /PRIORITIES\.find\(\(p\) => p\.id === card\.priority\) \?\? \{ id: card\.priority, label: card\.priority \}/,
  "Priority lookup must fall back instead of asserting",
);
assert.match(kanban, /role=\{selectMode \? "checkbox" : "button"\}/, "Kanban cards expose a button role (checkbox in select mode)");
assert.match(kanban, /aria-label=\{`\$\{card\.title\}[\s\S]*?priority[\s\S]*?Enter to open; Space to move\./, "Cards need a descriptive aria-label with the move/open shortcuts");
assert.match(kanban, /aria-keyshortcuts=\{selectMode \? undefined : "Enter Space"\}/, "Cards declare their key shortcuts outside select mode");
assert.doesNotMatch(kanban, /aria-selected=\{isSelected\}/, "Invalid aria-selected on the card must be removed");
assert.doesNotMatch(kanban, /aria-grabbed=\{isGrabbed\}/, "Deprecated aria-grabbed must be removed (state is in the label + live announce)");
// Keyboard DnD contract preserved.
assert.match(kanban, /data-card-id=\{card\.id\}/, "Cards keep data-card-id for keyboard grab");
assert.match(kanban, /board-kanban-card--grabbed/, "Grabbed visual affordance preserved");

// ───────── Mobile board chrome ─────────
assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.board-search-input\s*\{[\s\S]*height:\s*44px[\s\S]*\.board-view-toggle\s*\{[\s\S]*display:\s*none[\s\S]*\.board-toolbar-btn,\s*\n\s*\.board-new-card-btn\s*\{[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Mobile board search and toolbar controls should meet thumb-sized touch targets",
);

assert.match(
  styles,
  /\.board-card-stack__filters\s*\{[\s\S]*flex:\s*0 0 54px[\s\S]*min-height:\s*54px[\s\S]*overflow-y:\s*hidden/,
  "Mobile BoardCardStack filters should reserve full touch-sized chip height instead of clipping to a scrollbar sliver",
);

assert.match(
  styles,
  /\.board-card-stack__chip\s*\{[\s\S]*height:\s*var\(--touch-target\)/,
  "Mobile BoardCardStack filter chips should meet the shared touch target",
);

assert.match(
  styles,
  /\.board-card-stack__section-add\s*\{[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Mobile BoardCardStack section add button should meet the shared touch target",
);

// The task inspector goes full-screen on phones, so its controls are primary
// touch targets — the desktop-dense 24-28px close/action sizes must scale up.
assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.board-drawer-close,\s*\n\s*\.board-drawer-path-open\s*\{[\s\S]*min-width:\s*var\(--touch-target\)[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Mobile inspector close/open-path controls should meet the shared touch target via min-* (so the 44px hit area wins the cascade over the earlier-in-file base width/height)",
);
assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.board-drawer-lifecycle-action,[\s\S]*\.board-drawer-chat-cta,[\s\S]*\.board-drawer-delete-btn,[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Mobile inspector lifecycle/chat/delete actions should meet the shared touch target",
);

// ── Schedule urgency surfaced on the card itself (#1) ──
assert.match(
  kanban,
  /urgency === "overdue" \? " board-kanban-card--overdue" : urgency === "due-soon" \? " board-kanban-card--due-soon"/,
  "the card container carries an urgency modifier, not just the date chip",
);
assert.match(
  styles,
  /\.board-kanban-card--overdue:not\(\.board-kanban-card--selected\)\s*\{[^}]*--color-danger/,
  "overdue cards get a danger tint, guarded so selection still wins",
);
assert.match(
  styles,
  /\.board-kanban-card--due-soon:not\(\.board-kanban-card--selected\)\s*\{[^}]*--color-warning/,
  "due-soon cards get a warning tint, guarded so selection still wins",
);

// ── Inline quick-add composer per column (#2) ──
assert.match(kanban, /onQuickAdd\?:\s*\(/, "BoardKanban accepts an onQuickAdd handler");
assert.match(kanban, /board-kanban-quickadd-trigger/, "each column has an inline add-a-card trigger");
assert.match(
  kanban,
  /e\.key === "Enter" && !e\.shiftKey[\s\S]*?requestSubmit\(\)/,
  "Enter submits the quick-add composer (Shift+Enter for a newline)",
);
assert.match(
  kanban,
  /groupBy === "familiar"[\s\S]*?familiarId: key === "__unassigned__" \? null : key/,
  "quick-add inherits the swimlane's familiar so the card lands in the right lane",
);
assert.match(view, /onQuickAdd=\{quickAdd\}/, "BoardView wires the quick-add create path");

console.log("board-ux-polish.test.ts: ok");
