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
assert.match(view, /role="tablist"/, "JournalView renders a tablist");
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
// copies the artifact source via the robust clipboard helper.
assert.match(list, /import \{ copyText \} from "@\/lib\/clipboard"/, "CanvasList imports the clipboard helper");
assert.match(list, /view === "code" \? \(/, "Copy button is gated to the Code tab");
assert.match(list, /copyText\(selected\.code\)/, "Copy button copies the selected artifact's code");
assert.match(list, /name=\{copied \? "ph:check" : "ph:copy"\}/, "Copy button shows a copied confirmation icon");
assert.match(list, /onKeyDown=\{\(e\) => \{[\s\S]*?e\.key === "Enter"[\s\S]*?commitRename/, "Canvas item rename input commits on Enter");
assert.match(list, /onKeyDown=\{\(e\) => \{[\s\S]*?e\.key === "Escape"[\s\S]*?cancelRename/, "Canvas item rename input cancels on Escape");
assert.match(css, /\.journal-list \{[\s\S]*?min-width:\s*0;/, "Journal master-detail shell can shrink inside the workspace");
assert.match(css, /\.journal-detail \{[\s\S]*?overflow:\s*hidden;/, "Journal detail pane contains overflowing code surfaces");
assert.match(css, /\.journal-detail__code \{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?white-space:\s*pre-wrap;[\s\S]*?overflow-wrap:\s*anywhere;/, "Canvas Code tab wraps long source lines instead of overflowing horizontally");
assert.match(css, /\.journal-detail__code--hl pre\.shiki \{[\s\S]*?white-space:\s*pre-wrap;[\s\S]*?overflow-wrap:\s*anywhere;/, "Highlighted Canvas code wraps long Shiki lines too");

// JournalEntries can be edited and deleted through the persisted journal API.
assert.match(entries, /editing,\s*setEditing/, "JournalEntries tracks edit mode for daily reflections");
assert.match(entries, /draftReflection,\s*setDraftReflection/, "JournalEntries keeps a reflection edit draft");
assert.match(entries, /function startEdit\(\)/, "JournalEntries exposes an edit action");
assert.match(entries, /async function saveEdit\(\)/, "JournalEntries saves edited reflections");
assert.match(entries, /fetch\("\/api\/journal",\s*\{[\s\S]*?method:\s*"POST"[\s\S]*?reflection:\s*draftReflection/, "JournalEntries persists edited reflection text through /api/journal POST");
assert.match(entries, /async function deleteEntry\(\)/, "JournalEntries exposes a delete action");
assert.match(entries, /fetch\(`\/api\/journal\?date=\$\{encodeURIComponent\(day\.date\)\}`,\s*\{ method: "DELETE" \}/, "JournalEntries deletes the selected persisted day through /api/journal DELETE");
assert.match(entries, /aria-label="Edit journal entry"/, "JournalEntries renders an edit affordance");
assert.match(entries, /aria-label="Delete journal entry"/, "JournalEntries renders a delete affordance");
assert.match(entries, /onKeyDown=\{\(e\) => \{[\s\S]*?e\.key === "Escape"[\s\S]*?cancelEdit/, "Journal edit textarea cancels on Escape");

// JournalEntries is scoped to the selected familiar and its memory coverage.
assert.match(entries, /const selectedFamiliarId = activeFamiliarId \?\? familiars\[0\]\?\.id \?\? null/, "JournalEntries derives one selected familiar scope");
assert.match(entries, /const listQuery = selectedFamiliarId \? `\?familiar=\$\{encodeURIComponent\(selectedFamiliarId\)\}` : ""/, "JournalEntries loads only selected-familiar journal summaries");
assert.match(entries, /const detailQuery = selectedFamiliarId\s*\?\s*`date=\$\{encodeURIComponent\(slug\)\}&familiar=\$\{encodeURIComponent\(selectedFamiliarId\)\}`\s*:\s*`date=\$\{encodeURIComponent\(slug\)\}`/, "JournalEntries loads selected-familiar journal details");
assert.match(entries, /day\.stats\.covenOrigin[\s\S]*?coven files/, "Journal stats include Coven-origin memory files");
assert.match(entries, /day\.stats\.externalRuntimes[\s\S]*?external runtime files/, "Journal stats include external runtime memory files");
assert.match(entries, /day\.stats\.runtimeMemory[\s\S]*?runtime files/, "Journal stats include runtime memory files");

console.log("journal-view.test.ts: ok");
