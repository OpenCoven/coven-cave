// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const mode = read("../../lib/workspace-mode.ts");
const workspace = read("../workspace.tsx");
const sidebar = read("../sidebar-minimal.tsx");
const view = read("./journal-view.tsx");
const list = read("./canvas-list.tsx");
const entries = read("./journal-entries.tsx");
const css = read("../../styles/journal.css");

// Mode renamed canvas -> journal
assert.match(mode, /\|\s*"journal"/, "WorkspaceMode includes journal");
assert.doesNotMatch(mode, /\|\s*"canvas"/, "WorkspaceMode no longer includes canvas");

// Workspace wiring
assert.match(workspace, /journal:\s*"Journal"/, "mode title is Journal");
assert.match(workspace, /mode === "journal" \?\s*\(\s*<JournalView/, "renders JournalView for journal mode");
assert.match(workspace, /import \{ JournalView \}/, "imports JournalView");
assert.doesNotMatch(workspace, /import \{ CanvasView \}/, "no longer imports CanvasView");
assert.match(workspace, /case "\/journal":/, "has a /journal slash command");

// Sidebar entry renamed
assert.match(sidebar, /id: "journal"/, "sidebar exposes the journal folder");
assert.doesNotMatch(sidebar, /id: "canvas"/, "sidebar no longer exposes canvas");

// JournalView is a two-tab shell hosting the Canvas list
assert.match(view, /<Tabs[\s\S]{0,160}variant="underline"/, "JournalView renders the shared underline Tabs");
assert.match(view, /label: "Journal"/, "has a Journal tab");
assert.match(view, /label: "Canvas"/, "has a Canvas tab");
assert.match(view, /<CanvasList/, "renders CanvasList in the Canvas tab");

// CanvasList reuses the artifact pipeline, not React Flow
assert.match(list, /\/api\/canvas/, "CanvasList loads artifacts from /api/canvas");
assert.match(list, /generateArtifactCode/, "CanvasList generates via generateArtifactCode");
assert.doesNotMatch(list, /@xyflow\/react/, "CanvasList does not use React Flow");
assert.match(list, /editingTitleId,\s*setEditingTitleId/, "CanvasList tracks which canvas item title is being renamed");
assert.match(list, /aria-label=\{`Rename \$\{a\.title \|\| "Untitled sketch"\}`\}/, "Canvas item rows expose a rename button");
assert.match(list, /commitRename/, "CanvasList persists renamed canvas item titles");

// The Code tab offers a Copy button (only while the code view is active) that
// copies the current editable source via the robust clipboard helper.
assert.match(list, /import \{ copyText \} from "@\/lib\/clipboard"/, "CanvasList imports the clipboard helper");
assert.match(list, /view === "code" \? \(/, "Copy button is gated to the Code tab");
assert.match(list, /copyText\(codeDraft\)/, "Copy button copies the current code draft");
assert.match(list, /name=\{copied \? "ph:check" : "ph:copy"\}/, "Copy button shows a copied confirmation icon");
assert.match(list, /onKeyDown=\{\(e\) => \{[\s\S]*?e\.key === "Enter"[\s\S]*?commitRename/, "Canvas item rename input commits on Enter");
assert.match(list, /onKeyDown=\{\(e\) => \{[\s\S]*?e\.key === "Escape"[\s\S]*?cancelRename/, "Canvas item rename input cancels on Escape");
assert.match(list, /codeDraft,\s*setCodeDraft/, "Canvas Code tab tracks an editable source draft");
assert.match(list, /function saveCodeEdit\(\)/, "Canvas Code tab exposes a save action for edited source");
assert.match(list, /persist\(next\)/, "Canvas Code tab saves edited source through the existing canvas artifact store");
assert.match(list, /aria-label="Edit canvas code"/, "Canvas Code tab renders an editable code textarea");
assert.match(list, /aria-label="Save canvas code"/, "Canvas Code tab renders a save-code action");
assert.match(list, /aria-label="Revert canvas code edits"/, "Canvas Code tab renders a revert action");
assert.match(list, /e\.key === "s"[\s\S]*?saveCodeEdit/, "Canvas Code tab supports Cmd/Ctrl+S save");
assert.match(list, /e\.key === "Escape"[\s\S]*?revertCodeEdit/, "Canvas Code tab supports Escape to revert unsaved edits");
assert.match(css, /\.journal-list \{[\s\S]*?min-width:\s*0;/, "Journal master-detail shell can shrink inside the workspace");
assert.match(css, /\.journal-detail \{[\s\S]*?overflow:\s*hidden;/, "Journal detail pane contains overflowing code surfaces");
assert.match(css, /\.journal-detail__code \{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?white-space:\s*pre-wrap;[\s\S]*?overflow-wrap:\s*anywhere;/, "Canvas Code tab wraps long source lines instead of overflowing horizontally");
assert.match(css, /\.journal-detail__code--hl pre\.shiki \{[\s\S]*?white-space:\s*pre-wrap;[\s\S]*?overflow-wrap:\s*anywhere;/, "Highlighted Canvas code wraps long Shiki lines too");
assert.match(css, /\.journal-detail__code--editor\s*\{[\s\S]*?resize:\s*none;[\s\S]*?outline:\s*none;/, "Canvas Code tab editor keeps the same contained code pane geometry");

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

// ── Canvas tab: async setState guarded against unmount ──────────────────────
// Generation is a slow LLM call; leaving Canvas mid-generate must not setState
// on a dead tree. load() and runGeneration() bail on a cleared mountedRef.
assert.match(list, /const mountedRef = useRef\(true\)/, "canvas tracks mounted state");
assert.match(list, /return \(\) => \{ mountedRef\.current = false; \}/, "canvas clears mountedRef on unmount");
assert.match(list, /await generateArtifactCode\([\s\S]{0,80}?if \(!mountedRef\.current\) return;/, "runGeneration bails after the LLM call if unmounted");
assert.match(list, /const json = await res\.json\(\)[\s\S]{0,80}?if \(!mountedRef\.current\) return;/, "load bails after the fetch if unmounted");

console.log("journal-view.test.ts: ok");
