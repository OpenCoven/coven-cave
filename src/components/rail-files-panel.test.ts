// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("./rail-files-panel.tsx", import.meta.url), "utf8");
const preview = readFileSync(new URL("./rail-file-preview.tsx", import.meta.url), "utf8");

// ─── rail-files-panel.tsx ─────────────────────────────────────────────────────
assert.match(panel, /export function RailFilesPanel\(/, "exports RailFilesPanel");
assert.match(panel, /import \{ ProjectTree \} from "@\/components\/project-tree"/, "imports ProjectTree");
assert.match(panel, /import \{ RailFilePreview \} from "@\/components\/rail-file-preview"/, "imports RailFilePreview");
assert.match(panel, /useState<string \| null>\(null\)/, "owns selectedPath state");
assert.match(panel, /onFileClick=\{setSelectedPath\}/, "passes onFileClick to the tree");
assert.match(panel, /selectedPath=\{selectedPath\}/, "threads selectedPath into the tree");
assert.match(panel, /path=\{selectedPath\}/, "feeds the selected path into the preview");
assert.match(panel, /if \(!projectRoot\)/, "handles the null-projectRoot state");
assert.match(panel, /No project linked/, "renders a muted no-project state");

// ─── rail-file-preview.tsx (read-only) ───────────────────────────────────────
assert.match(preview, /export function RailFilePreview\(/, "exports RailFilePreview");
assert.match(preview, /\/api\/project-file/, "fetches the project-file route");
assert.match(preview, /Select a file/, "muted empty state when no file selected");
assert.match(preview, /SyntaxBlock/, "renders text via SyntaxBlock");
assert.match(preview, /MarkdownBlock/, "renders markdown via MarkdownBlock");
assert.match(preview, /kind === "image"/, "handles image files");
assert.doesNotMatch(preview, /CodeEditor/, "read-only: no editor");
assert.doesNotMatch(preview, /onSave|saveEdit/, "read-only: no save path");

console.log("rail-files-panel.test.ts OK");
