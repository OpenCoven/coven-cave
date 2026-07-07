// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const view = await readFile(new URL("./grimoire-view.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const modeType = await readFile(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");

// ── Surface registration: mode, title, render branch, sidebar row ────────────

assert.match(modeType, /\| "grimoire"/, "grimoire is a WorkspaceMode");
assert.match(workspace, /grimoire: "Grimoire"/, "grimoire has a page title (sr-only h1)");
assert.match(workspace, /mode === "grimoire" \? \(\s*<GrimoireView \/>/, "grimoire mode renders GrimoireView");
assert.match(sidebar, /\| "grimoire"/, "grimoire is a FolderMode");
assert.match(sidebar, /id: "grimoire", label: "Grimoire"/, "grimoire has a sidebar row (and ⌘K palette entry via FOLDER_MODES)");

// ── Navigator: three sources, searchable, new-entry affordance ───────────────

assert.match(view, /export function GrimoireView\(/, "GrimoireView must be exported");
assert.match(view, /fetch\("\/api\/knowledge"/, "navigator lists the knowledge vault");
assert.match(view, /fetch\("\/api\/memory"/, "navigator lists memory files");
assert.match(view, /fetch\("\/api\/journal"/, "navigator lists journal days");
assert.match(view, /aria-label="Search grimoire documents"/, "navigator search is labelled");
assert.match(view, /New entry/, "knowledge entries can be created here");
assert.match(view, /aria-label="Knowledge vault"[\s\S]*aria-label="Memory files"[\s\S]*aria-label="Journal"/, "sections are labelled landmarks");

// ── Detail: the right transport per source ───────────────────────────────────

assert.match(view, /<MemoryMdEditor/, "memory docs edit through the mtime-guarded memory editor");
assert.match(view, /method: "POST",[\s\S]*?\/api\/knowledge|\/api\/knowledge",\s*\{\s*method: "POST"/, "knowledge saves POST the vault API");
assert.match(view, /rawToKnowledgePayload/, "knowledge title/tags round-trip through frontmatter mapping");
assert.match(view, /showHeader=\{false\}/, "journal reflections edit without a frontmatter header");
assert.match(view, /reflectedBy: state\?\.reflectedBy \?\? null/, "journal saves preserve the reflecting familiar");

// ── Deep link + responsive master-detail ─────────────────────────────────────

assert.match(view, /#grimoire:/, "selection is deep-linkable via #grimoire:<kind>:<id>");
assert.match(view, /GRIMOIRE_HASH_PREFIX/, "hash prefix is shared with cross-surface links (grimoire-link.ts)");
assert.match(view, /decodeURIComponent/, "hash ids are URL-decoded");
assert.match(view, /aria-label="Back to document list"/, "compact widths get a back affordance");
assert.match(view, /@container\/grimoire/, "layout adapts via container queries");

// ── Delete/trash actions (cave-kv3) ──────────────────────────────────────────

assert.match(view, /useConfirm\(\)/, "destructive actions confirm through the shared dialog");
assert.match(view, /\/api\/memory\/delete/, "memory files archive through the trash API");
assert.match(view, /\/api\/knowledge\?id=\$\{encodeURIComponent\(selection\.id\)\}/, "knowledge entries delete through their API");
assert.match(view, /\/api\/journal\?date=\$\{encodeURIComponent\(selection\.date\)\}/, "journal reflections delete through their API");
assert.match(view, /Move to trash/, "memory delete is labelled as restorable trash");
assert.match(view, /danger: true/, "the confirm renders its destructive style");
assert.match(view, /closeTab\(selectionKey\(selection\)\);\s*void load\(\)/, "a successful delete closes the doc's tab and reloads the navigator");
assert.match(view, /deleteError \? \(\s*<span role="alert"/, "delete failures are announced");

// ── Tabs: persisted multi-doc editing (cave-90u) ─────────────────────────────

assert.match(view, /"cave:grimoire:tabs"/, "open tabs persist to localStorage (recent docs across sessions)");
assert.match(view, /"cave:grimoire:active-tab"/, "the active tab persists too");
assert.match(view, /export const MAX_OPEN_TABS = 8/, "open-tab count is capped");
assert.match(view, /role="tablist"[\s\S]*?aria-label="Open documents"/, "tab strip is an accessible tablist");
assert.match(view, /role="tab"[\s\S]*?aria-selected=\{active\}/, "tabs expose selection state");
assert.match(view, /aria-label=\{`Close \$\{tabTitle\(tab\)\}`\}/, "each tab has a labelled close button");
// The core multi-tab behavior: every open tab's editor stays mounted so
// unsaved drafts survive switching tabs (inactive tabs are display:none).
assert.match(view, /key === selectedKey \? "h-full min-h-0" : "hidden"/, "inactive tab editors stay mounted, just hidden");
assert.match(view, /kind !== "knowledge-new"/, "unsaved new-entry drafts are not restored across reloads");
assert.match(view, /replaceTab\(key, \{ kind: "knowledge", id: saved\.id \}\)/, "saving a new entry swaps its draft tab for the real doc");
assert.match(view, /const evictIndex = tabs\.findIndex/, "over-cap opens evict the oldest non-active tab");
assert.match(view, /fromHash/, "a #grimoire: deep link merges into (and activates within) the restored tab set");

// ── cave-xr0 slice 2: outgoing [[wiki-link]] chips ──────────────────────────
// The open doc's resolved wiki-links render as a chip row below the editor,
// resolved against the loaded doc lists (no server index); resolved chips
// navigate via openDoc, unresolved ones render dashed + inert.
assert.match(view, /from "@\/lib\/wiki-link-resolve"/, "grimoire-view uses the wiki-link resolver engine");
assert.match(view, /function GrimoireDocLinks\(/, "there is a doc-links chip component");
assert.match(view, /resolveOutgoingLinks\(markdown, docIndex\)/, "chips come from resolving the open doc's markdown against the index");
assert.match(
  view,
  /docIndex = useMemo<WikiDocIndex>\([\s\S]{0,220}memory:[\s\S]{0,40}m\.fullPath/,
  "the doc index maps memory entries by fullPath (the same path openDoc navigates to)",
);
assert.match(view, /onClick=\{\(\) => onOpen\(ref\)\}/, "a resolved chip navigates to its doc");
assert.match(view, /title="No matching Grimoire doc"[\s\S]{0,160}border-dashed/, "an unresolved link renders dashed + inert with a hint");
assert.match(view, /<GrimoireDocLinks\b[\s\S]{0,160}onOpen=\{openDoc\}/, "the chip row is wired to openDoc for the active doc");

console.log("grimoire-view.test: ok");
