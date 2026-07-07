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

// Syntax colors come from the SAME palette as read mode (Shiki mood-c-dark).
// Without an explicit HighlightStyle, CodeMirror falls back to its default
// syntax palette, which is designed for LIGHT backgrounds (#a11 strings,
// #940 comments) — unreadable on the dark --code-surface. The palette +
// editor frame now live in code-editor-theme.ts, shared with the MdEditor
// (MARKDOWN mode + Milkdown Crepe code blocks).
const theme = await readFile(new URL("./code-editor-theme.ts", import.meta.url), "utf8");
assert.ok(pkg.dependencies["@codemirror/language"], "@codemirror/language dep present for HighlightStyle");
assert.ok(pkg.dependencies["@lezer/highlight"], "@lezer/highlight dep present for lezer tags");
assert.match(
  theme,
  /import \{ HighlightStyle, syntaxHighlighting \} from "@codemirror\/language"/,
  "theme module imports HighlightStyle/syntaxHighlighting",
);
assert.match(
  theme,
  /import moodCTheme from "@\/styles\/shiki\/mood-c-dark\.json"/,
  "syntax palette single source of truth is the shiki mood-c-dark theme json",
);
assert.match(theme, /export const moodHighlight = HighlightStyle\.define\(/, "a HighlightStyle maps lezer tags to the mood-c palette");
assert.match(theme, /syntaxHighlighting\(moodHighlight\)/, "the highlight style ships in the combined theme extension");
assert.match(editor, /syntaxHighlighting\(moodHighlight\)/, "the editor installs the shared highlight style");
// The code surface stays dark in EVERY app theme (light modes included), so
// editor text/gutter inks must be fixed mood-c inks, not theme text tokens
// (--text-primary is a dark ink in light themes → dark-on-dark).
assert.doesNotMatch(theme, /color: "var\(--text-primary\)"/, "editor ink must not ride theme text tokens on the fixed-dark code surface");
assert.doesNotMatch(theme, /color: "var\(--text-muted\)"/, "gutter ink must not ride theme text tokens on the fixed-dark code surface");

// Editor chrome is themed to the app's CSS tokens (not the generic dark theme).
assert.match(theme, /export const caveEditorFrame = EditorView\.theme\(/, "a CodeMirror theme is defined from app tokens");
assert.match(theme, /backgroundColor: "var\(--code-surface\)"/, "editor background matches the read code surface via --code-surface");
assert.match(theme, /caretColor: "var\(--accent-presence\)"/, "caret uses the app accent token");
assert.match(editor, /from "@\/components\/code-editor-theme"/, "the editor consumes the shared theme module");
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
