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
assert.match(view, /decodeURIComponent/, "hash ids are URL-decoded");
assert.match(view, /aria-label="Back to document list"/, "compact widths get a back affordance");
assert.match(view, /@container\/grimoire/, "layout adapts via container queries");

console.log("grimoire-view.test: ok");
