// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const mode = read("../../lib/workspace-mode.ts");
const workspace = read("../workspace.tsx");
const sidebar = read("../sidebar-minimal.tsx");
const view = read("./journal-view.tsx");
const list = read("./canvas-list.tsx");

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

console.log("journal-view.test.ts: ok");
