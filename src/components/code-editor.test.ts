// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// CodeMirror editor for the Projects file preview edit mode (replaces the
// plain textarea with real syntax highlighting + line numbers).

const editor = await readFile(new URL("./code-editor.tsx", import.meta.url), "utf8");
const comux = await readFile(new URL("./comux-view.tsx", import.meta.url), "utf8");
const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));

// Deps are present and pinned exact (dependency-policy guards the pinning).
assert.ok(pkg.dependencies["@uiw/react-codemirror"], "react-codemirror dep present");
assert.ok(pkg.dependencies["@uiw/codemirror-extensions-langs"], "codemirror langs dep present");
assert.match(pkg.dependencies["@uiw/react-codemirror"], /^\d+\.\d+\.\d+$/, "react-codemirror pinned exact");

// Editor selects a grammar by file extension and falls back to plain text.
assert.match(editor, /EXT_TO_LANG: Record<string, LanguageName>/, "extension → language map exists");
assert.match(editor, /ts: "ts"[\s\S]*?tsx: "tsx"[\s\S]*?py: "python"[\s\S]*?rs: "rs"/, "common extensions map to valid grammar names");
assert.match(editor, /loadLanguage\(langName\)/, "the language extension is loaded for the file");

// Save / cancel keymap works with the editor focused.
assert.match(
  editor,
  /key: "Mod-s", preventDefault: true, run: \(\) => \{ onSave\(\); return true; \}/,
  "Cmd/Ctrl+S saves from inside the editor",
);
assert.match(editor, /key: "Escape", run: \(\) => \{ onCancel\(\); return true; \}/, "Escape cancels from inside the editor");

// Editor chrome is themed to the app's CSS tokens (not the generic dark theme).
assert.match(editor, /const appTheme = EditorView\.theme\(/, "a CodeMirror theme is defined from app tokens");
assert.match(editor, /backgroundColor: "var\(--bg-base\)"/, "editor background uses the app surface token");
assert.match(editor, /caretColor: "var\(--accent-presence\)"/, "caret uses the app accent token");
assert.match(editor, /theme=\{appTheme\}/, "the editor uses the app theme");

// comux uses CodeEditor in edit mode — the plain textarea is gone.
assert.match(comux, /import \{ CodeEditor \} from "@\/components\/code-editor"/, "comux imports CodeEditor");
assert.match(
  comux,
  /editing \? \([\s\S]*?<CodeEditor[\s\S]*?value=\{editValue\}[\s\S]*?onChange=\{setEditValue\}[\s\S]*?onSave=\{[\s\S]*?saveEdit[\s\S]*?onCancel=\{cancelEditing\}/,
  "edit mode renders CodeEditor wired to the edit state",
);
assert.doesNotMatch(comux, /<textarea[\s\S]*?value=\{editValue\}/, "the plain edit textarea is replaced");

console.log("code-editor.test.ts: ok");
