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
// The stacked layout is keyed to the surface's own width (@container board) so
// it also engages inside a narrow drag-to-split pane on a wide viewport.
assert.match(
  styles,
  /\.board-shell\s*\{[^}]*container:\s*board \/ inline-size/,
  "the board shell establishes the board query container",
);
assert.match(
  styles,
  /@container board \(max-width: 767px\) \{[\s\S]*\.board-header\s*\{[\s\S]*flex-wrap:\s*wrap/,
  "Narrow board header should keep its stacked layout",
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
  /@container board \(max-width: 767px\) \{[\s\S]*\.board-search-input\s*\{[\s\S]*height:\s*44px[\s\S]*\.board-view-toggle\s*\{[\s\S]*display:\s*none[\s\S]*\.board-toolbar-btn,\s*\n\s*\.board-new-card-btn\s*\{[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Narrow board search and toolbar controls should meet thumb-sized touch targets",
);

// The touch ghost is fixed-position with viewport coords — the board container's
// layout containment would trap it in the pane, so it portals to document.body.
assert.match(kanban, /createPortal\(\s*<div\s*\n?\s*className="board-kanban-touch-ghost"/, "the kanban touch ghost renders through a portal");

assert.match(
  styles,
  /\.board-card-stack__filters\s*\{[\s\S]*flex:\s*0 0 54px[\s\S]*min-height:\s*54px[\s\S]*overflow-y:\s*hidden/,
  "Mobile BoardCardStack filters should reserve full touch-sized chip height instead of clipping to a scrollbar sliver",
);

// The bespoke filter chips were replaced by the shared Tabs component (which
// owns its own touch sizing); their orphaned CSS must stay deleted.
assert.doesNotMatch(
  styles,
  /\.board-card-stack__chip\b/,
  "dead BoardCardStack filter-chip CSS must not return (filters render via Tabs)",
);

assert.match(
  styles,
  /\.board-card-stack__section-add\s*\{[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Mobile BoardCardStack section add button should meet the shared touch target",
);

// The task inspector goes full-screen on phones, so its controls are primary
// touch targets — the desktop-dense 24-28px close/action sizes must scale up.
// (.board-drawer-path-open was dead CSS — no JSX renders it — and was removed
// from this selector list in the 2026-07-02 board audit.)
assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.board-drawer-close\s*\{[\s\S]*min-width:\s*var\(--touch-target\)[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Mobile inspector close control should meet the shared touch target via min-* (so the 44px hit area wins the cascade over the earlier-in-file base width/height)",
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

// ── WIP limits per column (#3) ──
assert.match(kanban, /wipLimits\?:\s*WipLimits/, "BoardKanban accepts WIP limits");
assert.match(kanban, /const wipEnabled = groupBy === "status" && !!onSetWipLimit/, "WIP UI is scoped to status grouping where the count is the status total");
assert.match(kanban, /board-kanban-column--wip-over/, "an over-limit column gets a warning treatment");
assert.match(kanban, /\{limit != null \? `\$\{count\}\/\$\{limit\}` : count\}/, "the badge shows count/limit when a limit is set");
assert.match(styles, /\.board-kanban-column-count--over\s*\{[^}]*--color-danger/, "over-limit count badge turns danger");
assert.match(view, /onSetWipLimit=\{setWipLimitFor\}/, "BoardView wires the WIP-limit setter");
assert.match(view, /writeWipLimits\(next\)/, "WIP limits persist on change");

// ── Board-audit fixes (2026-07-02) ───────────────────────────────────────────
const gantt = await readFile(new URL("./board-gantt.tsx", import.meta.url), "utf8");
const stack = await readFile(new URL("./board-card-stack.tsx", import.meta.url), "utf8");

// 1. The inspector remounts per card: its title/notes are uncontrolled
//    (defaultValue + save-on-blur), so switching cards while the drawer is open
//    must reset them — otherwise a blur writes card A's text onto card B.
assert.match(view, /key=\{selectedCard\.id\}/, "BoardInspector is keyed by card id so uncontrolled fields reset on card switch");

// 2. Poll ticks keep the previous cards reference when content is unchanged —
//    an idle board must not re-render every card/row/bar every 15s.
assert.match(
  view,
  /setCards\(\(prev\) => \(arrayContentEqual\(prev, loaded\) \? prev : loaded\)\)/,
  "the board poll guards setCards with arrayContentEqual",
);

// 3. A second reschedule inside the undo window must not clobber the snapshot —
//    Undo restores the ORIGINAL dates, not the intermediate position.
assert.match(
  view,
  /pending && pending\.id === id\s*\n?\s*\? pending/,
  "a pending reschedule-undo for the same card is never re-armed",
);

// 4. The dead stats memo (computed every render, rendered nowhere) stays gone.
assert.doesNotMatch(view, /const stats = useMemo/, "the unused stats memo must not return");

// 5. Familiar resolution is hoisted — resolve once per view, never per card/row.
assert.match(kanban, /const resolvedFamiliars = useResolvedFamiliars\(familiars, \{ includeArchived: true \}\)/, "kanban resolves familiars once at the board level");
assert.doesNotMatch(kanban, /useResolvedFamiliars\(rawFamiliar/, "kanban must not resolve familiars per card");
assert.match(stack, /const resolvedFamiliars = useResolvedFamiliars\(familiars, \{ includeArchived: true \}\)/, "card-stack resolves familiars once at the top");
assert.doesNotMatch(stack, /familiars\.find\(/, "card-stack rows use O(1) map lookups, not per-row find()");

// 6. Attachment count renders in ALL four views (kanban/table already pinned).
assert.match(stack, /board-card-stack__row-attachments/, "the mobile stack shows an attachment count");
assert.match(gantt, /cg-attach/, "the gantt task label shows an attachment count");

// ── Board CRUD announces for AT (2026-07-02 audit follow-up) ─────────────────
assert.match(view, /const \{ announce \} = useAnnouncer\(\)/, "BoardView consumes the shared announcer");
assert.match(view, /announce\(`Created task '\$\{draft\.title\.trim\(\)\}'\.`\)/, "create announces");
assert.match(view, /announce\(`Deleted \$\{toRemove\.length\} task/, "delete announces with undo hint");
assert.match(view, /announce\(`Cleared \$\{cleared\.length\} done task/, "clear-done announces");
assert.match(view, /announce\(`Moved '\$\{title\}' to /, "moveCardToStatus announces for every view");
assert.match(view, /announce\(`Rescheduled '\$\{before\.title\}'\$\{range \? ` — \$\{range\}` : ""\}\. Undo available\.`\)/, "reschedule announces with the committed dates");
assert.match(view, /announce\(`Restored /, "undo paths announce restoration");
// The final "Moved" message is BoardView's alone — kanban's drop paths must not
// double-announce it (they keep their grab/over/cancel narration).
assert.doesNotMatch(kanban, /announce\(`Moved '/, "kanban no longer announces the final move");

// ── Intent ops replace full-array PATCHes (2026-07-03 merge-semantics fix) ───
const inspector = await readFile(new URL("./board-inspector.tsx", import.meta.url), "utf8");
assert.match(inspector, /ops: \{ stepOps: \[\{ op: "toggle", id \}\] \}/, "step toggle sends an intent op");
assert.match(inspector, /ops: \{ stepOps: \[\{ op: "add", text, id: crypto\.randomUUID\(\) \}\] \}/, "step add pre-generates its id so optimistic and persisted steps match");
assert.match(inspector, /ops: \{ labelOps: \[\{ op: "add", value: l \}\] \}/, "label add sends an intent op");
assert.match(inspector, /ops: \{ linkOps: \[\{ op: "add", value: url \}\] \}/, "link add sends an intent op");
assert.doesNotMatch(inspector, /onPatch\(card\.id, \{ steps: steps\.(map|filter)/, "no interactive editor PATCHes a full steps array computed from render state");
assert.match(gantt, /op: "setDate", id: row\.stepId/, "gantt step drag sends setDate ops, not the whole steps array");
assert.match(view, /applyCardOps\(c, ops, new Date\(\)\.toISOString\(\)\)/, "the optimistic render resolves ops with the same shared function the server uses");
assert.match(view, /if \(json\.card\) setCards\(\(prev\) => prev\.map\(\(c\) => \(c\.id === id \? \(json\.card as Card\) : c\)\)\)/, "a successful PATCH adopts the server card");

// ── A11y batch (2026-07-03) ───────────────────────────────────────────────────
const table = await readFile(new URL("./board-table.tsx", import.meta.url), "utf8");
assert.match(kanban, /const ariaMeta = \[/, "kanban folds chip metadata into the card's accessible name");
assert.match(kanban, /\$\{ariaMeta \? `, \$\{ariaMeta\}` : ""\}/, "the accessible name carries schedule/chat/attachments/labels");
assert.match(table, /aria-label=\{selectMode \? `\$\{card\.title\}/, "table select-mode rows are named by their card title");
assert.match(kanban, /rootRef\.current\?\.contains\(target\)/, "grab keydown handling is scoped to the board");
assert.match(kanban, /if \(grabbedCardId && !inBoard\)/, "a grab releases when focus leaves the board");
assert.match(kanban, /document\.querySelector<HTMLElement>\(`\[data-card-id="\$\{movedId\}"\]`\)\?\.focus\(\)/, "keyboard drop refocuses the moved card");
assert.match(gantt, /announce\(`Rescheduled '\$\{row\.label\}':/, "gantt step reschedules announce the committed range");

// ── Selection survives a view-mode switch AND stays visible (P1-6, 2026-07-03
// heuristic audit): the new view mounts at scroll 0, so BoardView scrolls the
// still-selected card back into view. Scroll only — no focus steal.
assert.match(view, /prevViewModeRef\.current !== viewMode/, "view switches are detected against the previous mode, not selection changes");
assert.match(view, /\[data-card-id="\$\{selectedCardId\}"\]/, "the selected card is located by its data-card-id in the mounted view");
assert.match(view, /scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)/, "the selected card scrolls into view without recentering the whole board");
assert.match(view, /return \(\) => cancelAnimationFrame\(frame\);/, "the scroll rAF is a fresh closure cancelled on cleanup (no persistent ref guard to wedge)");
assert.doesNotMatch(view, /querySelector<HTMLElement>\(`\[data-card-id="\$\{selectedCardId\}"\]`\)\s*\?\.focus\(\)/, "view switches must not steal focus from the toggle the user clicked");
assert.match(gantt, /data-card-id=\{row\.cardId\}/, "gantt rows carry data-card-id so the view-switch scroll finds them");

console.log("board-ux-polish.test.ts: ok");
