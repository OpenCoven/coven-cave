// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("./rail-files-panel.tsx", import.meta.url), "utf8");
const preview = readFileSync(new URL("./rail-file-preview.tsx", import.meta.url), "utf8");

// ─── rail-files-panel.tsx ─────────────────────────────────────────────────────
assert.match(panel, /export function RailFilesPanel\(/, "exports RailFilesPanel");
assert.match(panel, /import \{ ProjectTree \} from "@\/components\/project-tree"/, "imports ProjectTree");
assert.match(panel, /import \{ RailFilePreview \} from "@\/components\/rail-file-preview"/, "imports RailFilePreview");
assert.match(panel, /import \{ Group, Panel, Separator, useDefaultLayout \} from "react-resizable-panels"/, "fullscreen Files uses resizable panels with layout persistence");
assert.match(panel, /import \{ SeparatorHandle \} from "@\/components\/ui\/separator-handle"/, "fullscreen Files uses the shared resize handle");
assert.match(panel, /import \{ SessionChangesPanel \} from "@\/components\/session-changes-panel"/, "fullscreen Files includes a far-right diffs panel");
assert.match(panel, /isFullscreen = false/, "RailFilesPanel accepts a fullscreen layout flag");
assert.match(panel, /useState<string \| null>\(null\)/, "owns selectedPath state");
assert.match(panel, /onFileClick=\{setSelectedPath\}/, "passes onFileClick to the tree");
assert.match(panel, /selectedPath=\{selectedPath\}/, "threads selectedPath into the tree");
assert.match(panel, /path=\{selectedPath\}/, "feeds the selected path into the preview");
assert.match(panel, /if \(isFullscreen\)/, "fullscreen Files takes a distinct IDE layout branch");
assert.match(panel, /className="workspace-rail__files workspace-rail__files--ide"/, "fullscreen root gets an IDE layout class");
assert.match(panel, /orientation="horizontal"/, "fullscreen Files splits left-to-right");
assert.match(panel, /id="workspace-rail-files-tree"[\s\S]*?defaultSize="280px"[\s\S]*?minSize="220px"[\s\S]*?ProjectTree/, "file tree is the left resizable pane");
assert.match(panel, /id="workspace-rail-files-editor"[\s\S]*?minSize="36%"[\s\S]*?RailFilePreview/, "open file/code is the flexible main pane");
assert.match(panel, /id="workspace-rail-files-diffs"[\s\S]*?defaultSize="340px"[\s\S]*?minSize="280px"[\s\S]*?SessionChangesPanel/, "diffs/changes are the far-right pane");
assert.match(panel, /if \(!projectRoot\)/, "handles the null-projectRoot state");
assert.match(panel, /No project linked/, "renders a muted no-project state");

// The IDE split persists across sessions: id + all three panel ids registered,
// and the layout props actually reach the Group.
assert.match(panel, /id: "workspace-rail-files-ide"/, "the IDE layout persists under a stable id");
assert.match(
  panel,
  /panelIds: \["workspace-rail-files-tree", "workspace-rail-files-editor", "workspace-rail-files-diffs"\]/,
  "all three panes are registered for persistence",
);
assert.match(
  panel,
  /defaultLayout=\{defaultLayout\}\s+onLayoutChanged=\{onLayoutChanged\}/,
  "the fullscreen Group restores and saves its layout",
);
// The preview's launchpad hands back repo-relative paths; the panel resolves
// them against the project root (same normalization as focusPath events).
assert.match(panel, /onOpenPath=\{openPath\}/, "the preview can open paths (launchpad)");
assert.match(panel, /const openPath = useCallback/, "launchpad paths resolve through one helper");

// ─── rail-file-preview.tsx (view + inline edit) ──────────────────────────────
assert.match(preview, /export function RailFilePreview\(/, "exports RailFilePreview");
assert.match(preview, /\/api\/project-file/, "fetches the project-file route");
assert.match(preview, /Select a file/, "muted empty state when no file selected");
assert.match(preview, /SyntaxBlock/, "renders text via SyntaxBlock");
assert.match(preview, /MarkdownBlock/, "renders markdown via MarkdownBlock");
assert.match(preview, /kind === "image"/, "handles image files");

// Inline editing: text files (except .env) can be edited and saved back.
assert.match(preview, /import \{ CodeEditor \} from "@\/components\/code-editor"/, "uses the shared CodeMirror editor");
assert.match(preview, /const saveEdit = useCallback/, "has a saveEdit callback");
assert.match(preview, /method: "POST"/, "writes back to the project-file route");
assert.match(preview, /const editable = file\?\.kind === "text" && !fileName\(path \?\? ""\)\.startsWith\("\.env"\)/, "guards .env and non-text from editing");
assert.match(preview, /savingRef/, "in-flight guard blocks concurrent saves (Cmd-S vs button)");
assert.match(preview, /onClick=\{startEditing\}/, "exposes an Edit affordance");
assert.match(preview, /useAnnouncer/, "announces save success/failure to assistive tech");

// Empty-state launchpad: the main pane offers changed files as one-click
// opens instead of sitting dead until the tree is used.
assert.match(preview, /\/api\/changes\?projectRoot=/, "the empty state fetches the working-tree status");
assert.match(preview, /f\.status !== "deleted"/, "deleted files are excluded — nothing to preview");
assert.match(preview, /const LAUNCHPAD_CAP = 6/, "the launchpad caps its list");
assert.match(preview, /onClick=\{\(\) => onOpenPath\(f\.path\)\}/, "each changed file opens in the preview");
assert.match(preview, /if \(path \|\| !projectRoot \|\| !onOpenPath\) return/, "the status fetch only runs for an empty, openable preview");

// ─── cave-chat.css: fullscreen sizes to its containing block ─────────────────
// Sizing via inset alone keeps this correct regardless of what the containing
// block is: historically the mode wrapper (.cave-mode-fade retained a
// transform), now the true viewport (root cause fixed in cave-cco). width/
// height:100v* stacked on a containing-block offset is what clipped the
// diffs pane — the rule must never size to viewport units.
const css = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");
const fullscreenBlock = css.slice(
  css.indexOf(".workspace-rail--fullscreen {"),
  css.indexOf("}", css.indexOf(".workspace-rail--fullscreen {")),
);
assert.match(fullscreenBlock, /inset: 0/, "fullscreen fills via inset");
assert.doesNotMatch(fullscreenBlock, /100vw|100vh/, "fullscreen never sizes to the viewport (containing-block offset would clip the right pane)");

console.log("rail-files-panel.test.ts OK");
