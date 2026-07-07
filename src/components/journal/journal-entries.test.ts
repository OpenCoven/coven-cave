// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const entries = read("./journal-entries.tsx");
const css = read("../../styles/journal.css");

assert.match(css, /\.journal-list \{[\s\S]*?min-width:\s*0;/, "Journal master-detail shell can shrink inside the workspace");
assert.match(css, /\.journal-detail \{[\s\S]*?overflow:\s*hidden;/, "Journal detail pane contains overflowing code surfaces");

// JournalEntries can be edited and deleted through the persisted journal API.
assert.match(entries, /editing,\s*setEditing/, "JournalEntries tracks edit mode for daily reflections");
assert.match(entries, /draftReflection,\s*setDraftReflection/, "JournalEntries keeps a reflection edit draft");
assert.match(entries, /function startEdit\(\)/, "JournalEntries exposes an edit action");
assert.match(entries, /async function saveEdit\(\)/, "JournalEntries saves edited reflections");
assert.match(entries, /fetch\("\/api\/journal",\s*\{[\s\S]*?method:\s*"POST"[\s\S]*?reflection:\s*draftReflection/, "JournalEntries persists edited reflection text through /api/journal POST");
assert.match(entries, /function deleteEntry\(\)/, "JournalEntries exposes a delete action");
assert.match(entries, /fetch\(`\/api\/journal\?date=\$\{encodeURIComponent\(date\)\}`,\s*\{ method: "DELETE" \}/, "JournalEntries deletes the selected persisted day through /api/journal DELETE");
// Delete is deferred + undoable: it routes through the shared useUndoDelete helper.
assert.match(entries, /scheduleDelete\(date,/, "JournalEntries defers the delete through useUndoDelete");
assert.match(entries, /<UndoToast/, "JournalEntries renders an UndoToast for deletes");
assert.match(entries, /aria-label="Edit journal entry"/, "JournalEntries renders an edit affordance");
assert.match(entries, /aria-label="Delete journal entry"/, "JournalEntries renders a delete affordance");
assert.match(entries, /onKeyDown=\{\(e\) => \{[\s\S]*?e\.key === "Escape"[\s\S]*?cancelEdit/, "Journal edit textarea cancels on Escape");
// ⌘/Ctrl+Enter saves the reflection editor (was: Save reachable only by tabbing
// to the ✓ button), and focus returns to the Edit button when leaving the editor.
assert.match(
  entries,
  /e\.key === "Enter" && \(e\.metaKey \|\| e\.ctrlKey\)[\s\S]*?void saveEdit\(\)/,
  "Journal edit textarea saves on ⌘/Ctrl+Enter",
);
assert.match(
  entries,
  /if \(wasEditingRef\.current && !editing\) editBtnRef\.current\?\.focus\(\)/,
  "Leaving the journal editor restores focus to the Edit button",
);
assert.match(entries, /ref=\{editBtnRef\}/, "the Edit button is the focus-restore target");
assert.match(
  entries,
  /await loadDays\(\);[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?editBtnRef\.current\?\.focus\(\)/,
  "save re-asserts focus on the next frame, after the reload's re-render commits",
);

// JournalEntries is scoped to the selected familiar and its memory coverage.
assert.match(entries, /const selectedFamiliarId = activeFamiliarId \?\? familiars\[0\]\?\.id \?\? null/, "JournalEntries derives one selected familiar scope");
// The list is now fetched whole and filtered client-side by the multiselect
// scope (empty = All), so switching familiars/scope never refetches.
assert.match(entries, /await fetch\(`\/api\/journal`, \{ cache: "no-store" \}\)/, "JournalEntries fetches the full journal day list");
assert.match(entries, /if \(!familiarInScope\(scope, d\.reflectedBy\)\) return false/, "JournalEntries filters the day list by the familiar multiselect scope");
// The day detail scopes its memory stats to the single active familiar (null at 0/≥ 2).
assert.match(entries, /const detailQuery = activeFamiliarId\s*\?\s*`date=\$\{encodeURIComponent\(slug\)\}&familiar=\$\{encodeURIComponent\(activeFamiliarId\)\}`\s*:\s*`date=\$\{encodeURIComponent\(slug\)\}`/, "JournalEntries scopes day detail stats to the active familiar");
assert.match(entries, /day\.stats\.covenOrigin[\s\S]*?coven files/, "Journal stats include Coven-origin memory files");
assert.match(entries, /day\.stats\.externalRuntimes[\s\S]*?external runtime files/, "Journal stats include external runtime memory files");
assert.match(entries, /day\.stats\.runtimeMemory[\s\S]*?runtime files/, "Journal stats include runtime memory files");

// ── Day-fetch race + unmount guards ─────────────────────────────────────────
// Rapid day switching must not let a slow earlier fetch overwrite the current
// selection, and no async setState may land after unmount.
assert.match(entries, /const loadDayReqRef = useRef\(0\)/, "loadDay tracks a request id");
assert.match(entries, /const reqId = \+\+loadDayReqRef\.current/, "each loadDay stamps a request id");
assert.match(entries, /if \(reqId !== loadDayReqRef\.current \|\| !mountedRef\.current\) return/, "a stale/late day fetch is dropped");
assert.match(entries, /const mountedRef = useRef\(true\)/, "tracks mounted state for async guards");
assert.match(entries, /return \(\) => \{ mountedRef\.current = false; \}/, "mountedRef is cleared on unmount");

// ── Selected day is announced + keyboard-navigable ──────────────────────────
assert.match(entries, /aria-current=\{d\.date === selected \? "true" : undefined\}/, "the open day row is aria-current");
assert.match(entries, /onKeyDown=\{onRailKeyDown\}/, "the day rail handles arrow-key navigation");
assert.match(entries, /e\.key === "ArrowDown" \? Math\.min\(btns\.length - 1, i \+ 1\)/, "ArrowDown moves to the next day");
// Chronological prev/next entry controls in the detail header.
assert.match(entries, /aria-label="Newer entry"/, "detail header has a newer-entry control");
assert.match(entries, /aria-label="Older entry"/, "detail header has an older-entry control");
assert.match(entries, /const hasOlder = dayIndex >= 0 && dayIndex < filteredDays\.length - 1/, "older-entry availability derives from the visible list");
assert.match(css, /\.journal-entry__sec--nav \{[\s\S]*?justify-content: space-between/, "the heading row lays out the nav controls");

// ── Click-to-automate: suggested next steps become one-click actions ─────────
// The familiar's `<coven:next-paths>` suggestions are no longer static text —
// each opens an automate tray (Run now / Add task / Remind me) that turns the
// step into a real action with no typing.
assert.match(entries, /function NextPaths\(/, "JournalEntries renders an interactive NextPaths component for suggested steps");
assert.match(entries, /aria-expanded=\{isOpen\}/, "each suggested step is an expandable automate chip");
assert.match(
  entries,
  /new CustomEvent\("cave:agents-new-chat", \{ detail: \{ familiarId, initialPrompt: text \} \}\)/,
  "Run now opens a chat that acts on the suggestion (self-contained, no prop threading)",
);
assert.match(
  entries,
  /fetch\("\/api\/board",\s*\{[\s\S]*?method:\s*"POST"[\s\S]*?title: text/,
  "Add task files the suggestion on the task board via /api/board POST",
);
assert.match(
  entries,
  /fetch\("\/api\/inbox",\s*\{[\s\S]*?kind:\s*"reminder"[\s\S]*?title: text[\s\S]*?fireAt: when\.toISOString\(\)/,
  "Remind me schedules the suggestion as a reminder via /api/inbox POST",
);
assert.match(entries, /aria-label=\{`\$\{a\.label\}: \$\{s\}`\}/, "each automate action exposes an accessible label naming the step");
assert.match(entries, /className=\{`journal-next__act[\s\S]*?\$\{isDone \? " is-done" : ""\}/, "automate actions flash a success state when they land");
// One-click confirmation toast, with a deep-link to the surface the action wrote to.
assert.match(entries, /className="journal-notice"[\s\S]*?role="status"[\s\S]*?aria-live="polite"/, "an automate action shows an aria-live confirmation toast");
assert.match(
  entries,
  /new CustomEvent\("cave:navigate-mode", \{ detail: \{ mode: notice\.action!\.mode \} \}\)/,
  "the toast's action deep-links to the surface the automation landed on",
);
assert.match(entries, /className=\{`journal-entry-gen\$\{generating \? " is-generating" : ""\}`\}/, "the generate button animates while reflecting");

// Engaging click feedback: chips/actions/buttons have press + transition styling,
// with a reduced-motion fallback.
assert.match(css, /\.journal-next__chip \{[\s\S]*?cursor: pointer;/, "suggested-step chips are styled, interactive controls");
assert.match(css, /\.journal-next__act\b/, "automate tray action buttons are styled");
assert.match(css, /\.journal-next__act\.is-done \{[\s\S]*?animation: journal-act-pop/, "a landed automate action pops with a success animation");
assert.match(css, /\.journal-notice \{[\s\S]*?position: fixed/, "the automate confirmation toast is styled");
assert.match(css, /\.journal-entry-gen:active:not\(:disabled\) \{ transform:/, "the generate button has a tactile press");
assert.match(css, /\.journal-day:active \{ transform:/, "day rows have a tactile press");
assert.match(css, /\.journal-entry__action:active:not\(:disabled\) \{ transform: scale/, "entry action icons have a tactile press");
assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.journal-next__chip,/, "the new interactions respect prefers-reduced-motion");

console.log("journal-entries.test.ts: ok");
